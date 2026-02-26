import { connect, StringCodec, type NatsConnection, type Subscription } from 'nats';
import { createLogger, NatsSubjects, HEARTBEAT_INTERVAL, HEARTBEAT_TIMEOUT, type AgentId, type AgentState, type AgentRole, type ChatStreamDelta } from '@jarvis/shared';

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

export interface PeerAgent {
  agentId: string;
  role: string;
  capabilities: string[];
  machineId: string;
  hostname: string;
  status: string;
  lastSeen: number;
}

export interface InterAgentMsg {
  id: string;
  type: string;
  from: string;
  to?: string;
  content?: string;
  payload?: unknown;
  replyTo?: string;
  timestamp: number;
}

/**
 * NatsHandler manages NATS connectivity for an agent:
 * - Heartbeat broadcasts
 * - Status updates
 * - Task reception
 * - Result publishing
 * - Inter-agent messaging (DM, broadcast, discovery)
 * - Coordination (task delegation)
 */
export class NatsHandler {
  private nc: NatsConnection | null = null;
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;
  private subscriptions: Subscription[] = [];
  private subscriptionLoops: Promise<void>[] = [];
  private taskCallback: ((task: TaskAssignment) => void) | null = null;
  private chatCallback: ((msg: { from: string; content: string; sessionId?: string; metadata?: Record<string, unknown> }) => void) | null = null;
  private dmCallback: ((msg: InterAgentMsg) => void) | null = null;
  private broadcastCallback: ((msg: InterAgentMsg) => void) | null = null;
  private coordinationCallback: ((msg: InterAgentMsg) => void) | null = null;
  private startedAt: number = Date.now();
  private completedTasks: number = 0;
  private failedTasks: number = 0;
  private currentStatus: string = 'starting';
  private activeTaskId: string | null = null;
  private activeTaskDescription: string | null = null;

  /** Known peer agents in the system */
  readonly peers: Map<string, PeerAgent> = new Map();

  constructor(private config: NatsHandlerConfig) {}

  async connect(): Promise<void> {
    const servers = [
      this.config.natsUrlThunderbolt,
      this.config.natsUrl,
    ].filter((s): s is string => !!s);

    const MAX_RETRIES = 30;
    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const natsOpts: Record<string, unknown> = {
          servers,
          name: this.config.agentId,
          reconnect: true,
          maxReconnectAttempts: -1,
          reconnectTimeWait: 2000,
        };

        // NATS authentication via env vars
        if (process.env['NATS_USER'] && process.env['NATS_PASS']) {
          natsOpts.user = process.env['NATS_USER'];
          natsOpts.pass = process.env['NATS_PASS'];
        } else if (process.env['NATS_TOKEN']) {
          natsOpts.token = process.env['NATS_TOKEN'];
        }

        this.nc = await connect(natsOpts as Parameters<typeof connect>[0]);
        break;
      } catch (err) {
        if (attempt === MAX_RETRIES) throw err;
        log.warn(`NATS connect attempt ${attempt}/${MAX_RETRIES} failed: ${(err as Error).message}. Retrying in 3s...`);
        await new Promise(r => setTimeout(r, 3000));
      }
    }

    log.info(`Connected to NATS (servers: ${servers.join(', ')})`);

    // Monitor connection status (tracked for clean shutdown)
    this.subscriptionLoops.push((async () => {
      if (!this.nc) return;
      try {
        for await (const status of this.nc.status()) {
          switch (status.type) {
            case 'reconnecting':
              log.warn(`NATS reconnecting... (${String(status.data)})`);
              break;
            case 'reconnect':
              log.info(`NATS reconnected successfully`);
              await this.register();
              await this.announcePresence('online');
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
      } catch (err) {
        log.warn(`NATS status monitor ended: ${(err as Error).message}`);
      }
    })());

    await this.register();
    this.startHeartbeat();
    this.subscribeToTasks();
    this.subscribeToChat();
    this.subscribeToDiscovery();
    this.subscribeToDM();
    this.subscribeToAgentsBroadcast();
    this.subscribeToCoordination();
    await this.announcePresence('online');
  }

  // ─── Agent State ──────────────────────────────────

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

  private async register(): Promise<void> {
    this.currentStatus = 'idle';
    const state = this.buildAgentState();
    await this.publish(NatsSubjects.agentStatus(this.config.agentId), state);
    log.info(`Registered agent: ${this.config.agentId} (role: ${this.config.role})`);
  }

  // ─── Heartbeat ────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(async () => {
      try {
        await this.publish(NatsSubjects.agentHeartbeat(this.config.agentId), {
          agentId: this.config.agentId,
          timestamp: Date.now(),
          memoryUsage: process.memoryUsage().heapUsed,
          uptime: process.uptime(),
          status: this.currentStatus,
          peers: Array.from(this.peers.keys()),
        });
        const state = this.buildAgentState();
        await this.publish(NatsSubjects.agentStatus(this.config.agentId), state);

        // Re-announce presence so peers refresh lastSeen
        await this.announcePresence('online');

        // Prune stale peers
        const now = Date.now();
        for (const [id, peer] of this.peers) {
          if (now - peer.lastSeen > HEARTBEAT_TIMEOUT) {
            this.peers.delete(id);
            log.info(`Peer ${id} went offline (timeout)`);
          }
        }
      } catch (err) {
        log.error(`Heartbeat failed: ${(err as Error).message}`);
      }
    }, HEARTBEAT_INTERVAL);
  }

  // ─── Task Subscriptions ───────────────────────────

  private subscribeToTasks(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.agentTask(this.config.agentId));
    this.subscriptions.push(sub);

    this.subscriptionLoops.push((async () => {
      try {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data)) as TaskAssignment;
            log.info(`Received task: ${data.taskId} - ${data.title}`);
            this.taskCallback?.(data);
          } catch (err) {
            log.error(`Failed to parse task message: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log.warn(`Task subscription ended: ${(err as Error).message}`);
      }
    })());
  }

  private subscribeToChat(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.chat(this.config.agentId));
    this.subscriptions.push(sub);

    this.subscriptionLoops.push((async () => {
      try {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data)) as { from: string; content: string; sessionId?: string; metadata?: Record<string, unknown> };
            log.info(`Chat from ${data.from}: ${data.content.slice(0, 80)}`);
            this.chatCallback?.(data);
          } catch (err) {
            log.error(`Failed to parse chat message: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log.warn(`Chat subscription ended: ${(err as Error).message}`);
      }
    })());
  }

  // ─── Inter-Agent Communication ────────────────────

  /** Subscribe to agent discovery announcements */
  private subscribeToDiscovery(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.agentsDiscovery);
    this.subscriptions.push(sub);

    this.subscriptionLoops.push((async () => {
      try {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data)) as {
              agentId: string; role: string; capabilities: string[];
              machineId: string; hostname: string; status: string; timestamp: number;
            };
            if (data.agentId === this.config.agentId) continue; // skip self

            if (data.status === 'offline') {
              this.peers.delete(data.agentId);
              log.info(`Peer ${data.agentId} announced offline`);
            } else {
              const isNew = !this.peers.has(data.agentId);
              this.peers.set(data.agentId, {
                agentId: data.agentId,
                role: data.role,
                capabilities: data.capabilities,
                machineId: data.machineId,
                hostname: data.hostname,
                status: data.status,
                lastSeen: Date.now(),
              });
              if (isNew) {
                log.info(`Discovered peer: ${data.agentId} (role: ${data.role}, machine: ${data.hostname})`);
                // Announce back so the new agent knows about us
                await this.announcePresence('online');
              }
            }
          } catch (err) {
            log.error(`Discovery parse error: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log.warn(`Discovery subscription ended: ${(err as Error).message}`);
      }
    })());
  }

  /** Subscribe to direct messages from other agents */
  private subscribeToDM(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.agentDM(this.config.agentId));
    this.subscriptions.push(sub);

    this.subscriptionLoops.push((async () => {
      try {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data)) as InterAgentMsg;
            log.info(`DM from ${data.from}: ${(data.content || '').slice(0, 80)}`);

            // Update peer last seen
            if (this.peers.has(data.from)) {
              this.peers.get(data.from)!.lastSeen = Date.now();
            }

            this.dmCallback?.(data);
          } catch (err) {
            log.error(`DM parse error: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log.warn(`DM subscription ended: ${(err as Error).message}`);
      }
    })());
  }

  /** Subscribe to shared agents broadcast channel */
  private subscribeToAgentsBroadcast(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.agentsBroadcast);
    this.subscriptions.push(sub);

    this.subscriptionLoops.push((async () => {
      try {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data)) as InterAgentMsg;
            if (data.from === this.config.agentId) continue; // skip own broadcasts
            log.info(`Broadcast from ${data.from}: ${data.type} — ${(data.content || '').slice(0, 60)}`);

            // Update peer last seen
            if (this.peers.has(data.from)) {
              this.peers.get(data.from)!.lastSeen = Date.now();
            }

            this.broadcastCallback?.(data);
          } catch (err) {
            log.error(`Broadcast parse error: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log.warn(`Broadcast subscription ended: ${(err as Error).message}`);
      }
    })());
  }

  /** Subscribe to coordination requests (task delegation) */
  private subscribeToCoordination(): void {
    if (!this.nc) return;
    const sub = this.nc.subscribe(NatsSubjects.coordinationRequest);
    this.subscriptions.push(sub);

    this.subscriptionLoops.push((async () => {
      try {
        for await (const msg of sub) {
          try {
            const data = JSON.parse(sc.decode(msg.data)) as InterAgentMsg;
            if (data.from === this.config.agentId) continue;
            // Only handle if directed at us or broadcast
            if (data.to && data.to !== this.config.agentId) continue;

            log.info(`Coordination from ${data.from}: ${data.type} — ${(data.content || '').slice(0, 60)}`);
            this.coordinationCallback?.(data);
          } catch (err) {
            log.error(`Coordination parse error: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        log.warn(`Coordination subscription ended: ${(err as Error).message}`);
      }
    })());
  }

  // ─── Callbacks ────────────────────────────────────

  onTask(callback: (task: TaskAssignment) => void): void {
    this.taskCallback = callback;
  }

  onChat(callback: (msg: { from: string; content: string; sessionId?: string; metadata?: Record<string, unknown> }) => void): void {
    this.chatCallback = callback;
  }

  onDM(callback: (msg: InterAgentMsg) => void): void {
    this.dmCallback = callback;
  }

  onBroadcast(callback: (msg: InterAgentMsg) => void): void {
    this.broadcastCallback = callback;
  }

  onCoordination(callback: (msg: InterAgentMsg) => void): void {
    this.coordinationCallback = callback;
  }

  // ─── Publishing ───────────────────────────────────

  /** Announce presence on discovery channel */
  async announcePresence(status: 'online' | 'offline'): Promise<void> {
    await this.publish(NatsSubjects.agentsDiscovery, {
      agentId: this.config.agentId,
      role: this.config.role,
      capabilities: this.config.capabilities,
      machineId: this.config.machineId,
      hostname: this.config.hostname,
      status,
      timestamp: Date.now(),
    });
    log.info(`Announced presence: ${status} (peers: ${this.peers.size})`);
  }

  /** Send direct message to another agent */
  async sendDM(toAgentId: string, content: string, payload?: unknown): Promise<void> {
    const msg: InterAgentMsg = {
      id: `dm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'dm',
      from: this.config.agentId,
      to: toAgentId,
      content,
      payload,
      timestamp: Date.now(),
    };
    await this.publish(NatsSubjects.agentDM(toAgentId), msg);
    log.info(`DM sent to ${toAgentId}: ${content.slice(0, 60)}`);
  }

  /** Broadcast message to all agents */
  async broadcastToAgents(content: string, type: string = 'broadcast', payload?: unknown): Promise<void> {
    const msg: InterAgentMsg = {
      id: `bc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      from: this.config.agentId,
      content,
      payload,
      timestamp: Date.now(),
    };
    await this.publish(NatsSubjects.agentsBroadcast, msg);
  }

  /** Request task delegation to another agent */
  async delegateTask(toAgentId: string, task: { taskId?: string; title: string; description: string; priority?: string }): Promise<void> {
    const msg: InterAgentMsg = {
      id: `del-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'delegation',
      from: this.config.agentId,
      to: toAgentId,
      content: task.title,
      payload: task,
      timestamp: Date.now(),
    };
    await this.publish(NatsSubjects.coordinationRequest, msg);
    log.info(`Delegation request to ${toAgentId}: ${task.title}`);
  }

  /** Respond to coordination request */
  async respondCoordination(replyTo: string, accepted: boolean, reason?: string): Promise<void> {
    const msg: InterAgentMsg = {
      id: `coord-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type: 'delegation-ack',
      from: this.config.agentId,
      content: accepted ? 'accepted' : `rejected: ${reason || 'busy'}`,
      replyTo,
      timestamp: Date.now(),
    };
    await this.publish(NatsSubjects.coordinationResponse, msg);
  }

  /** Publish status update */
  async updateStatus(status: string, activeTaskId?: string, activeTaskDescription?: string): Promise<void> {
    this.currentStatus = status;
    this.activeTaskId = activeTaskId ?? null;
    this.activeTaskDescription = activeTaskDescription ?? null;
    const state = this.buildAgentState();
    await this.publish(NatsSubjects.agentStatus(this.config.agentId), state);
  }

  trackTaskComplete(success: boolean): void {
    if (success) this.completedTasks++;
    else this.failedTasks++;
  }

  async publishResult(taskId: string, result: { success: boolean; output: string; artifacts?: string[] }): Promise<void> {
    await this.publish(NatsSubjects.agentResult(this.config.agentId), {
      agentId: this.config.agentId,
      taskId,
      ...result,
      timestamp: Date.now(),
    });
  }

  async publishProgress(taskId: string, progress: { step: string; percentage?: number; log?: string }): Promise<void> {
    await this.publish(`jarvis.task.${taskId}.progress`, {
      agentId: this.config.agentId,
      taskId,
      ...progress,
      timestamp: Date.now(),
    });
  }

  async broadcastDashboard(event: string, payload: unknown): Promise<void> {
    await this.publish(NatsSubjects.dashboardBroadcast, {
      event,
      source: this.config.agentId,
      payload,
      timestamp: Date.now(),
    });
  }

  async sendChatResponse(content: string, metadata?: Record<string, unknown>): Promise<void> {
    await this.publish(NatsSubjects.chatBroadcast, {
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      from: this.config.agentId,
      to: 'user',
      role: this.config.role,
      content,
      timestamp: Date.now(),
      ...metadata,
    });
  }

  /** Publish an ephemeral streaming delta (thinking/text/tool_start/done) — not persisted */
  async sendChatStream(delta: Omit<ChatStreamDelta, 'from' | 'timestamp'>): Promise<void> {
    await this.publish(NatsSubjects.chatStream, {
      from: this.config.agentId,
      ...delta,
      timestamp: Date.now(),
    });
  }

  /** Get list of known online peers */
  getPeers(): PeerAgent[] {
    return Array.from(this.peers.values());
  }

  /** Check if a specific agent is online */
  isPeerOnline(agentId: string): boolean {
    const peer = this.peers.get(agentId);
    return !!peer && (Date.now() - peer.lastSeen) < HEARTBEAT_TIMEOUT;
  }

  // ─── Low-level ────────────────────────────────────

  async publish(subject: string, data: unknown): Promise<void> {
    if (!this.nc) throw new Error('Not connected to NATS');
    this.nc.publish(subject, sc.encode(JSON.stringify(data)));
  }

  async disconnect(): Promise<void> {
    // Announce offline before disconnecting
    try {
      await this.announcePresence('offline');
    } catch { /* ignore if NATS already gone */ }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];

    if (this.nc) {
      // Drain with timeout to prevent hanging on stuck subscriptions
      try {
        await Promise.race([
          this.nc.drain(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Drain timeout')), 5000)),
        ]);
      } catch (err) {
        log.warn(`NATS drain timeout/failed: ${(err as Error).message}`);
        try { this.nc.close(); } catch { /* ignore */ }
      }
      this.nc = null;
      log.info('Disconnected from NATS');
    }

    // Wait for subscription loops to finish
    await Promise.allSettled(this.subscriptionLoops);
    this.subscriptionLoops = [];
  }
}
