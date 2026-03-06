import IORedis from 'ioredis';
import { createLogger, DEFAULT_REDIS_URL } from '@jarvis/shared';

// ioredis default export is the Redis class in CJS, namespace in ESM
const Redis = IORedis as unknown as typeof IORedis.default extends undefined ? typeof IORedis : typeof IORedis.default;
type RedisInstance = InstanceType<typeof Redis>;

const log = createLogger('gateway:redis');

export class RedisClient {
  private client: RedisInstance | null = null;
  private subscriber: RedisInstance | null = null;
  private readonly pubsubHandlers: Map<string, Set<(message: string) => void>> = new Map();

  constructor(private readonly url: string = DEFAULT_REDIS_URL) {}

  async connect(): Promise<void> {
    try {
      this.client = new Redis(this.url, {
        retryStrategy: (times: number) => Math.min(times * 500, 5000),
        maxRetriesPerRequest: 3,
        lazyConnect: false,
      });

      const safeUrl = (() => { try { const u = new URL(this.url); u.password = '***'; u.username = '***'; return u.toString(); } catch { return '[invalid url]'; } })();
      this.client.on('connect', () => log.info(`Connected to Redis at ${safeUrl}`));
      this.client.on('error', (err: Error) => log.error('Redis error', { error: String(err) }));
      this.client.on('reconnecting', () => log.warn('Redis reconnecting...'));

      // Separate connection for pub/sub
      this.subscriber = this.client.duplicate();
      this.subscriber.on('error', (err: Error) => log.error('Redis subscriber error', { error: String(err) }));
      this.subscriber.on('message', (channel: string, message: string) => {
        const handlers = this.pubsubHandlers.get(channel);
        if (handlers) {
          for (const handler of handlers) {
            try {
              handler(message);
            } catch (err) {
              log.error(`Error in pubsub handler for ${channel}`, { error: String(err) });
            }
          }
        }
      });
    } catch (err) {
      log.error('Failed to connect to Redis', { error: String(err) });
      throw err;
    }
  }

  /** Get the raw Redis client */
  get raw(): RedisInstance {
    if (!this.client) throw new Error('Redis not connected');
    return this.client;
  }

  // --- Key-Value Operations ---

  async get(key: string): Promise<string | null> {
    return this.raw.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.raw.setex(key, ttlSeconds, value);
    } else {
      await this.raw.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.raw.del(key);
  }

  // --- Hash Operations ---

  async hset(key: string, data: Record<string, string>): Promise<void> {
    await this.raw.hset(key, data);
  }

  async hgetall(key: string): Promise<Record<string, string>> {
    return this.raw.hgetall(key);
  }

  async hget(key: string, field: string): Promise<string | null> {
    return this.raw.hget(key, field);
  }

  // --- Sorted Set Operations ---

  async zadd(key: string, score: number, member: string): Promise<void> {
    await this.raw.zadd(key, score, member);
  }

  async zrange(key: string, start: number, stop: number): Promise<string[]> {
    return this.raw.zrange(key, start, stop);
  }

  async zrem(key: string, member: string): Promise<void> {
    await this.raw.zrem(key, member);
  }

  // --- JSON Helpers ---

  async getJson<T>(key: string): Promise<T | null> {
    const raw = await this.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as T;
    } catch (err) {
      log.warn(`Failed to parse JSON for key`, { error: String(err) });
      return null;
    }
  }

  async setJson(key: string, value: unknown, ttlSeconds?: number): Promise<void> {
    await this.set(key, JSON.stringify(value), ttlSeconds);
  }

  // --- Pub/Sub ---

  async subscribeChannel(channel: string, handler: (message: string) => void): Promise<void> {
    if (!this.subscriber) throw new Error('Redis subscriber not initialized');

    if (!this.pubsubHandlers.has(channel)) {
      this.pubsubHandlers.set(channel, new Set());
      await this.subscriber.subscribe(channel);
    }
    this.pubsubHandlers.get(channel)!.add(handler);
    log.info(`Subscribed to Redis channel: ${channel}`);
  }

  async publishChannel(channel: string, message: string): Promise<void> {
    await this.raw.publish(channel, message);
  }

  /** Check if connected */
  get isConnected(): boolean {
    return this.client !== null && this.client.status === 'ready';
  }

  /** Close all connections */
  async close(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
    if (this.client) {
      await this.client.quit();
      this.client = null;
    }
    this.pubsubHandlers.clear();
    log.info('Redis connections closed');
  }
}
