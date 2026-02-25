import { connect, StringCodec, type NatsConnection, type Subscription } from 'nats';
import { createLogger, NatsSubjects, HEARTBEAT_INTERVAL, type AgentId, type AgentState, type AgentRole } from '@jarvis/shared';

const log = createLogger('agent:nats');
const sc = StringCodec();

export interface NatsHandlerConfig {
  agentId: AgentId;
  role: AgentRole;
  natsUrl: string;
  natsUrlThunderbolt?: string;
  capabilities: string[];
  machineId: string;
  hostname: string;
}

export interface TaskAssignment {
  taskId: string;
  title: string;
  description: string;
  priority: string;
  context?: Record<string, unknown>;
}

/**
 * NatsHandler manages NATS connectivity for an agent:
 * - Heartbeat broadcasts
 * - Status updates
 * - Task reception
 * - Result publishing
 * - Inter-agent messaging
 */
export class NatsHandler {
  private nc: NatsConnection | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private subscriptions: Subscription[] = [];
  private taskCallback: ((task: TaskAssignment) => void) | null = null;
  private chatCallback: ((msg: { from: string; content: string; sessionId?: string; metadata?: Record<string, unknown> }) => void) | null = null;
  private startedAt: number = Date.now();
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private currentStatus: string = 'starting';
  private activeTaskId: string | null = null;
  private activeTaskDescription: string | null = null;

  constructor(private config: NatsHandlerConfig) {}

  async connect(): Promise<void> {
    // Build server list: Thunderbolt first (priority, 10 Gbps), then regular network
    const servers = [
      this.config.natsUrlThunderbolt,
      this.config.natsUrl,
    ].filter((s): s is string => !!s);

    // Retry initial connection (WiFi can have transient EHOSTUNREACH)
    const MAX_RETRIES = 30;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        this.nc = await connect({
          servers,
          name: this.config.agentId,
          reconnect: true,
          maxReconnectAttempts: -1,
          reconnectTimeWait: 2000,
        });
        break; // Connected successfully
      } catch (err) {
        const msg = (err as Error).message;
        if (attempt === MAX_RETRIES) throw err;
        log.warn(`NATS connect attempt ${attempt}/${MAX_RETRIES} failed: ${msg}. Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    log.info(`Connected to NATS (servers: ${servers.join(', ')})`);

    // Monitor connection status (reconnects, disconnects, errors)
    void (async () => {
      if (!this.nc) return;
      for await (const status of this.nc.status()) {
        switch (status.type) {
          case 'reconnecting':
            log.warn(`NATS reconnecting... (${String(status.data)})`);
            break;
          case 'reconnect':
            log.info(`NATS reconnected successfully`);
            // Re-register after reconnect so gateway picks us up again
            await this.register();
            break;
          case 'disconnect':
            log.warn(`NATS disconnected: ${String(status.data)}`);
            break;
          case 'error':
            log.error(`NATS error: ${String(status.data)}`);
            break;
          default:
            log.info(`NATS status: ${status.type}`, { data: String(status.data) });
        }
      }
    })();

    await this.register();
    this.startHeartbeat();
    this.subscribeToTasks();
    this.subscribeToChat();
  }

  /** Build a proper AgentState object that matches the gateway's expected format */
  private buildAgentState(): AgentState {
    return {
      identity: {
        agentId: this.config.agentId,
        role: this.config.role,
        machineId: this.config.machineId,
        hostname: this.config.hostname,
      },
      status: this.currentStatus as AgentState['status'],
      activeTaskId: this.activeTaskId,
      activeTaskDescription: this.activeTaskDescription,
      lastHeartbeat: Date.now(),
      startedAt: this.startedAt,
      completedTasks: this.completedTasks,
      failedTasks: this.failedTasks,
    };
  }

  /** Register agent with gateway */
  private async register(): Promise<void> {
    this.currentStatus = 'idle';
    const state = this.buildAgentState();
    await this.publish(NatsSubjects.agentStatus(this.config.agentId), state);
    log.info(`Registered agent: ${this.config.agentId} (role: ${this.config.role})`);
  }

  /** Start heartbeat loop */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.publish(NatsSubjects.agentHeartbeat(this.config.agentId), {
          agentId: this.config.agentId,
          timestamp: Date.now(),
          memoryUsage: process.memoryUsage().heapUsed,
          uptime: process.uptime(),
          status: this.currentStatus,
        });
        // Also re-publish full state periodically so gateway stays in sync
        const state = this.buildAgentState();
        await this.publish(NatsSubjects.agentStatus(this.config.agentId), state);
      } catch (err) {
        log.error(`Heartbeat failed: ${(err as Error).message}`);
      }
    }, HEARTBEAT_INTERVAL);
  }

  /** Subscribe to task assignments */
  private subscribeToTasks(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.agentTask(this.config.agentId));
    this.subscriptions.push(sub);

    (async () => {
      for await (const msg of sub) {
        try {
          const data = JSON.parse(sc.decode(msg.data)) as TaskAssignment;
          log.info(`Received task: ${data.taskId} - ${data.title}`);
          this.taskCallback?.(data);
        } catch (err) {
          log.error(`Failed to parse task message: ${(err as Error).message}`);
        }
      }
    })();
  }

  /** Subscribe to chat messages from dashboard */
  private subscribeToChat(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.chat(this.config.agentId));
    this.subscriptions.push(sub);

    (async () => {
      for await (const msg of sub) {
        try {
          const data = JSON.parse(sc.decode(msg.data)) as { from: string; content: string; sessionId?: string; metadata?: Record<string, unknown> };
          log.info(`Chat from ${data.from}: ${data.content.slice(0, 80)}`);
          this.chatCallback?.(data);
        } catch (err) {
          log.error(`Failed to parse chat message: ${(err as Error).message}`);
        }
      }
    })();
  }

  /** Set callback for task assignments */
  onTask(callback: (task: TaskAssignment) => void): void {
    this.taskCallback = callback;
  }

  /** Set callback for chat messages */
  onChat(callback: (msg: { from: string; content: string; sessionId?: string; metadata?: Record<string, unknown> }) => void): void {
    this.chatCallback = callback;
  }

  /** Publish status update */
  async updateStatus(status: string, activeTaskId?: string, activeTaskDescription?: string): Promise<void> {
    this.currentStatus = status;
    this.activeTaskId = activeTaskId ?? null;
    this.activeTaskDescription = activeTaskDescription ?? null;
    const state = this.buildAgentState();
    await this.publish(NatsSubjects.agentStatus(this.config.agentId), state);
  }

  /** Track task completion stats */
  trackTaskComplete(success: boolean): void {
    if (success) {
      this.completedTasks++;
    } else {
      this.failedTasks++;
    }
  }

  /** Publish task result */
  async publishResult(taskId: string, result: { success: boolean; output: string; artifacts?: string[] }): Promise<void> {
    await this.publish(NatsSubjects.agentResult(this.config.agentId), {
      agentId: this.config.agentId,
      taskId,
      ...result,
      timestamp: Date.now(),
    });
  }

  /** Publish task progress */
  async publishProgress(taskId: string, progress: { step: string; percentage?: number; log?: string }): Promise<void> {
    await this.publish(`jarvis.task.${taskId}.progress`, {
      agentId: this.config.agentId,
      taskId,
      ...progress,
      timestamp: Date.now(),
    });
  }

  /** Broadcast to dashboard (general events) */
  async broadcastDashboard(event: string, payload: unknown): Promise<void> {
    await this.publish(NatsSubjects.dashboardBroadcast, {
      event,
      source: this.config.agentId,
      payload,
      timestamp: Date.now(),
    });
  }

  /** Send chat response back to dashboard via chatBroadcast subject */
  async sendChatResponse(content: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.publish(NatsSubjects.chatBroadcast, {
      from: this.config.agentId,
      role: this.config.role,
      content,
      timestamp: Date.now(),
      ...metadata,
    });
  }

  /** Publish generic NATS message */
  async publish(subject: string, data: unknown): Promise<void> {
    if (!this.nc) throw new Error('Not connected to NATS');
    this.nc.publish(subject, sc.encode(JSON.stringify(data)));
  }

  /** Disconnect from NATS */
  async disconnect(): Promise<void> {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    if (this.nc) {
      await this.nc.drain();
      this.nc = null;
      log.info('Disconnected from NATS');
    }
  }
}
