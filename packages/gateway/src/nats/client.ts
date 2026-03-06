import { connect, type NatsConnection, type Subscription, StringCodec, type Msg } from 'nats';
import { createLogger, DEFAULT_NATS_URL } from '@jarvis/shared';

const log = createLogger('gateway:nats');
const sc = StringCodec();

export class NatsClient {
  private connection: NatsConnection | null = null;
  private readonly subscriptions: Map<string, Subscription> = new Map();
  private readonly servers: string[];

  constructor(primaryUrl: string = DEFAULT_NATS_URL, _thunderboltUrl?: string) {
    // Gateway runs on Master (same machine as NATS) - always use primary (localhost)
    // Thunderbolt URL is only used by remote agents connecting FROM other machines
    this.servers = [primaryUrl];
  }

  async connect(): Promise<void> {
    try {
      log.info(`Connecting to NATS servers: ${this.servers.join(', ')}`);
      const natsOpts: Record<string, unknown> = {
        servers: this.servers,
        name: 'jarvis-gateway',
        reconnect: true,
        maxReconnectAttempts: 50,
        reconnectTimeWait: 2000,
        timeout: 10000,
      };

      // NATS authentication via env vars (required)
      if (process.env['NATS_USER'] && process.env['NATS_PASS']) {
        natsOpts.user = process.env['NATS_USER'];
        natsOpts.pass = process.env['NATS_PASS'];
        log.info('NATS: using user/pass authentication');
      } else if (process.env['NATS_TOKEN']) {
        natsOpts.token = process.env['NATS_TOKEN'];
        log.info('NATS: using token authentication');
      } else {
        log.error('NATS: no authentication configured. Set NATS_TOKEN or NATS_USER/NATS_PASS in .env');
        throw new Error('NATS authentication is required. Set NATS_TOKEN or NATS_USER + NATS_PASS.');
      }

      this.connection = await connect(natsOpts as Parameters<typeof connect>[0]);

      log.info(`Connected to NATS (servers: ${this.servers.join(', ')})`);

      // Monitor connection status
      void (async () => {
        if (!this.connection) return;
        for await (const status of this.connection.status()) {
          log.info(`NATS status: ${status.type}`, { data: String(status.data) });
        }
      })();
    } catch (err) {
      log.error('Failed to connect to NATS', { error: String(err) });
      throw err;
    }
  }

  /** Publish a message to a subject */
  async publish(subject: string, data: unknown): Promise<void> {
    if (!this.connection) throw new Error('NATS not connected');
    const payload = sc.encode(JSON.stringify(data));
    this.connection.publish(subject, payload);
  }

  /** Subscribe to a subject with a handler */
  subscribe(subject: string, handler: (data: unknown, msg: Msg) => void): Subscription {
    if (!this.connection) throw new Error('NATS not connected');

    // Unsubscribe existing subscription for this subject to prevent duplicates
    if (this.subscriptions.has(subject)) {
      this.subscriptions.get(subject)!.unsubscribe();
      this.subscriptions.delete(subject);
    }

    const sub = this.connection.subscribe(subject);
    this.subscriptions.set(subject, sub);

    void (async () => {
      for await (const msg of sub) {
        try {
          const data: unknown = JSON.parse(sc.decode(msg.data));
          handler(data, msg);
        } catch (err) {
          log.error(`Error processing message on ${subject}`, { error: String(err) });
        }
      }
    })();

    log.info(`Subscribed to ${subject}`);
    return sub;
  }

  /** Request-reply pattern */
  async request<T = unknown>(subject: string, data: unknown, timeoutMs = 5000): Promise<T> {
    if (!this.connection) throw new Error('NATS not connected');
    const payload = sc.encode(JSON.stringify(data));
    const response = await this.connection.request(subject, payload, { timeout: timeoutMs });
    return JSON.parse(sc.decode(response.data)) as T;
  }

  /** Unsubscribe from a subject */
  unsubscribe(subject: string): void {
    const sub = this.subscriptions.get(subject);
    if (sub) {
      sub.unsubscribe();
      this.subscriptions.delete(subject);
      log.info(`Unsubscribed from ${subject}`);
    }
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this.connection !== null && !this.connection.isClosed();
  }

  /** Close connection */
  async close(): Promise<void> {
    if (this.connection) {
      for (const sub of this.subscriptions.values()) {
        sub.unsubscribe();
      }
      this.subscriptions.clear();
      await this.connection.drain();
      this.connection = null;
      log.info('NATS connection closed');
    }
  }
}
