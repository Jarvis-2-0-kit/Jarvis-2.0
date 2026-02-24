import express from 'express';
import { createServer, type Server } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, mkdirSync, unlinkSync, appendFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hostname, cpus, totalmem, freemem, loadavg, networkInterfaces, uptime as osUptime } from 'node:os';
import { execSync } from 'node:child_process';
import {
  createLogger,
  shortId,
  DEFAULT_GATEWAY_PORT,
  NatsSubjects,
  HEARTBEAT_TIMEOUT,
  PROJECT_NAME,
  PROJECT_VERSION,
  AGENT_DEFAULTS,
  type AgentState,
  type AgentId,
  type TaskDefinition,
  type ChatMessage,
} from '@jarvis/shared';
import { NatsClient } from './nats/client.js';
import { RedisClient } from './redis/client.js';
import { StateStore } from './redis/state-store.js';
import { NasPaths } from './nas/paths.js';
import { AuthManager } from './auth/auth.js';
import { ProtocolHandler } from './protocol/handler.js';
import { DependencyOrchestrator } from './orchestration/dependency-orchestrator.js';

const log = createLogger('gateway:server');

export interface GatewayConfig {
  port: number;
  host: string;
  authToken: string;
  natsUrl: string;
  natsUrlThunderbolt?: string;
  redisUrl: string;
  nasMountPath?: string;
}

export class GatewayServer {
  private app: ReturnType<typeof express>;
  private httpServer: Server;
  private wss: WebSocketServer;
  private protocol: ProtocolHandler;
  private nats: NatsClient;
  private redis: RedisClient;
  private store: StateStore;
  private nas: NasPaths;
  private auth: AuthManager;
  private orchestrator: DependencyOrchestrator;
  private healthInterval: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly config: GatewayConfig) {
    this.app = express();
    this.httpServer = createServer(this.app);
    this.wss = new WebSocketServer({ server: this.httpServer });
    this.protocol = new ProtocolHandler();
    this.nats = new NatsClient(config.natsUrl, config.natsUrlThunderbolt);
    this.redis = new RedisClient(config.redisUrl);
    this.store = new StateStore(this.redis);
    this.nas = new NasPaths(config.nasMountPath);
    this.auth = new AuthManager(config.authToken);
    this.orchestrator = new DependencyOrchestrator({
      nasPath: config.nasMountPath ?? '',
      maxConcurrentPerAgent: 1,
      maxTotalConcurrent: 4,
      maxDepth: 2,
    });

    this.setupHttpRoutes();
    this.setupWebSocket();
    this.registerMethods();
  }

  /** Start the gateway server */
  async start(): Promise<void> {
    log.info(`Starting ${PROJECT_NAME} v${PROJECT_VERSION} Gateway...`);

    // Connect to infrastructure
    await this.nats.connect();
    await this.redis.connect();
    this.nas.ensureDirectories();

    // Setup NATS subscriptions for agent events
    this.setupNatsSubscriptions();

    // Start dependency orchestrator
    this.setupOrchestrator();
    this.orchestrator.start();

    // Start health monitoring
    this.startHealthMonitoring();

    // Start HTTP+WS server
    await new Promise<void>((resolve) => {
      this.httpServer.listen(this.config.port, this.config.host, () => {
        log.info(`Gateway listening on http://${this.config.host}:${this.config.port}`);
        resolve();
      });
    });
  }

  /** Stop the gateway */
  async stop(): Promise<void> {
    log.info('Shutting down gateway...');
    if (this.healthInterval) clearInterval(this.healthInterval);
    this.orchestrator.stop();
    this.httpServer.close();
    await this.nats.close();
    await this.redis.close();
    log.info('Gateway stopped');
  }

  // --- HTTP Routes ---

  private setupHttpRoutes(): void {
    this.app.use(express.json());

    this.app.get('/health', async (_req, res) => {
      const health = await this.getHealthStatus();
      res.json(health);
    });

    this.app.get('/api/agents', async (_req, res) => {
      const agents = await this.store.getAllAgentStates();
      res.json({ agents });
    });

    this.app.get('/api/tasks', async (_req, res) => {
      const tasks = await this.store.getPendingTasks();
      res.json({ tasks });
    });

    this.app.get('/api/vnc', (_req, res) => {
      // Prefer Thunderbolt IPs for VNC (10 Gbps = smoother stream)
      const tbEnabled = process.env['THUNDERBOLT_ENABLED'] === 'true';
      const alphaHost = (tbEnabled && process.env['VNC_ALPHA_HOST_THUNDERBOLT'])
        ? process.env['VNC_ALPHA_HOST_THUNDERBOLT']
        : process.env['VNC_ALPHA_HOST'] ?? 'mac-mini-alpha.local';
      const betaHost = (tbEnabled && process.env['VNC_BETA_HOST_THUNDERBOLT'])
        ? process.env['VNC_BETA_HOST_THUNDERBOLT']
        : process.env['VNC_BETA_HOST'] ?? 'mac-mini-beta.local';

      res.json({
        endpoints: {
          alpha: {
            host: alphaHost,
            port: Number(process.env['VNC_ALPHA_PORT'] ?? 6080),
            username: process.env['VNC_ALPHA_USERNAME'] ?? '',
            password: process.env['VNC_ALPHA_PASSWORD'] ?? '',
            label: 'Agent Smith (Dev)',
            thunderbolt: tbEnabled && !!process.env['VNC_ALPHA_HOST_THUNDERBOLT'],
          },
          beta: {
            host: betaHost,
            port: Number(process.env['VNC_BETA_PORT'] ?? 6080),
            username: process.env['VNC_BETA_USERNAME'] ?? '',
            password: process.env['VNC_BETA_PASSWORD'] ?? '',
            label: 'Agent John (Marketing)',
            thunderbolt: tbEnabled && !!process.env['VNC_BETA_HOST_THUNDERBOLT'],
          },
        },
        thunderboltEnabled: tbEnabled,
      });
    });

    // Network config (read from NAS config/network.json)
    this.app.get('/api/config', (_req, res) => {
      try {
        const configPath = this.nas.resolve('config', 'network.json');
        if (existsSync(configPath)) {
          const data = JSON.parse(readFileSync(configPath, 'utf-8'));
          res.json(data);
        } else {
          // Return basic config from env
          res.json({
            master: {
              ip: process.env['MASTER_IP'] ?? '',
              hostname: hostname(),
              ports: {
                gateway: Number(process.env['JARVIS_PORT'] ?? 18900),
                dashboard: Number(process.env['DASHBOARD_PORT'] ?? 3000),
                nats: 4222,
                redis: 6379,
              },
            },
            agents: {
              alpha: { ip: process.env['ALPHA_IP'] ?? '', user: process.env['ALPHA_USER'] ?? '', role: 'dev', vnc_port: 6080 },
              beta: { ip: process.env['BETA_IP'] ?? '', user: process.env['BETA_USER'] ?? '', role: 'marketing', vnc_port: 6080 },
            },
            nas: {
              ip: process.env['NAS_IP'] ?? '',
              share: '',
              mount: process.env['JARVIS_NAS_MOUNT'] ?? '',
            },
            thunderbolt: {
              enabled: process.env['THUNDERBOLT_ENABLED'] === 'true',
              master_ip: process.env['MASTER_IP_THUNDERBOLT'] ?? '',
              alpha_ip: process.env['ALPHA_IP_THUNDERBOLT'] ?? '',
              beta_ip: process.env['BETA_IP_THUNDERBOLT'] ?? '',
              nats_url: process.env['NATS_URL_THUNDERBOLT'] ?? '',
            },
          });
        }
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    this.app.post('/api/config', (req, res) => {
      try {
        const configPath = this.nas.resolve('config', 'network.json');
        let data: Record<string, unknown> = {};
        if (existsSync(configPath)) {
          data = JSON.parse(readFileSync(configPath, 'utf-8'));
        }

        const body = req.body as Record<string, unknown>;
        const section = body.section as string;

        if (section === 'agents') {
          const agents = (data.agents ?? {}) as Record<string, Record<string, unknown>>;
          if (body.alphaIp) { agents.alpha = { ...agents.alpha, ip: body.alphaIp }; }
          if (body.betaIp) { agents.beta = { ...agents.beta, ip: body.betaIp }; }
          data.agents = agents;
        } else if (section === 'nas') {
          data.nas = {
            ip: body.nasIp ?? '',
            share: body.nasShare ?? '',
            mount: body.nasMount ?? '',
          };
        } else if (section === 'thunderbolt') {
          data.thunderbolt = {
            enabled: body.enabled ?? false,
            master_ip: body.masterIp ?? '169.254.100.1',
            alpha_ip: body.alphaIp ?? '169.254.100.2',
            beta_ip: body.betaIp ?? '169.254.100.3',
            nats_port: body.natsPort ?? 4223,
          };
        }

        data.updated = new Date().toISOString();
        writeFileSync(configPath, JSON.stringify(data, null, 2));
        res.json({ success: true });
      } catch (err) {
        res.status(500).json({ error: String(err) });
      }
    });

    // --- WhatsApp Webhook ---
    this.app.get('/api/whatsapp/webhook', (req, res) => {
      // Meta verification challenge
      const mode = req.query['hub.mode'];
      const token = req.query['hub.verify_token'];
      const challenge = req.query['hub.challenge'];

      const waConfig = this.getChannelConfig('whatsapp') as Record<string, unknown>;
      const verifyToken = (waConfig?.verifyToken as string) ?? 'jarvis-whatsapp-verify';

      if (mode === 'subscribe' && token === verifyToken) {
        log.info('WhatsApp webhook verified');
        res.status(200).send(challenge);
      } else {
        res.sendStatus(403);
      }
    });

    this.app.post('/api/whatsapp/webhook', async (req, res) => {
      try {
        const body = req.body as Record<string, unknown>;
        await this.handleWhatsAppWebhook(body);
        res.sendStatus(200);
      } catch (err) {
        log.error('WhatsApp webhook error', { error: String(err) });
        res.sendStatus(500);
      }
    });

    // --- Telegram Webhook ---
    this.app.post('/api/telegram/webhook', async (req, res) => {
      try {
        const body = req.body as Record<string, unknown>;
        await this.handleTelegramWebhook(body);
        res.sendStatus(200);
      } catch (err) {
        log.error('Telegram webhook error', { error: String(err) });
        res.sendStatus(500);
      }
    });

    // --- Discord Webhook ---
    this.app.post('/api/discord/webhook', async (req, res) => {
      try {
        const body = req.body as Record<string, unknown>;
        await this.handleDiscordWebhook(body);
        res.sendStatus(200);
      } catch (err) {
        log.error('Discord webhook error', { error: String(err) });
        res.sendStatus(500);
      }
    });

    // Serve dashboard static files (production build)
    const __dirname = dirname(fileURLToPath(import.meta.url));
    const dashboardDist = resolve(__dirname, '../../dashboard/dist');
    if (existsSync(dashboardDist)) {
      this.app.use(express.static(dashboardDist));
      // SPA fallback - serve index.html for all non-API routes
      this.app.use((req, res, next) => {
        if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.includes('.')) {
          next();
          return;
        }
        res.sendFile(resolve(dashboardDist, 'index.html'));
      });
      log.info(`Serving dashboard from ${dashboardDist}`);
    }
  }

  // --- WebSocket ---

  private setupWebSocket(): void {
    this.wss.on('connection', (ws: WebSocket, req) => {
      const token = AuthManager.extractToken(req.url ?? '');

      // Allow connections from same-origin dashboard (no token needed)
      // External API clients still need auth via REST endpoints
      if (this.config.authToken && token && !this.auth.verifyDashboardToken(token)) {
        log.warn('Invalid WebSocket token');
        ws.close(4001, 'Unauthorized');
        return;
      }

      const clientId = shortId();
      this.protocol.registerClient(clientId, ws);
      log.info(`Dashboard client connected: ${clientId}`);

      ws.on('message', async (data) => {
        await this.protocol.handleMessage(clientId, data.toString());
      });

      ws.on('close', () => {
        this.protocol.removeClient(clientId);
        log.info(`Dashboard client disconnected: ${clientId}`);
      });

      ws.on('error', (err) => {
        log.error(`WebSocket error for ${clientId}`, { error: String(err) });
      });

      // Send initial state
      void this.sendInitialState(clientId);
    });
  }

  // --- Gateway Methods ---

  private registerMethods(): void {
    this.protocol.registerMethod('health', async () => {
      return this.getHealthStatus();
    });

    this.protocol.registerMethod('health.detailed', async () => {
      return this.getHealthStatus();
    });

    this.protocol.registerMethod('agents.list', async () => {
      return this.store.getAllAgentStates();
    });

    this.protocol.registerMethod('agents.status', async (params) => {
      const { agentId } = params as { agentId: string };
      return this.store.getAgentState(agentId);
    });

    this.protocol.registerMethod('agents.capabilities', async (params) => {
      const { agentId } = params as { agentId: string };
      return this.store.getCapabilities(agentId);
    });

    this.protocol.registerMethod('tasks.list', async () => {
      return this.store.getPendingTasks();
    });

    this.protocol.registerMethod('tasks.create', async (params) => {
      const task = params as TaskDefinition;
      task.id = task.id || shortId();
      task.createdAt = Date.now();
      task.updatedAt = Date.now();
      await this.store.createTask(task);

      // Broadcast to dashboard
      this.protocol.broadcast('task.created', task);

      // Assign to appropriate agent based on capabilities
      await this.assignTask(task);

      return { taskId: task.id };
    });

    this.protocol.registerMethod('tasks.cancel', async (params) => {
      const { taskId } = params as { taskId: string };
      await this.store.updateTask(taskId, { assignedAgent: null });
      this.protocol.broadcast('task.cancelled', { taskId });
      return { success: true };
    });

    this.protocol.registerMethod('tasks.status', async (params) => {
      const { taskId } = params as { taskId: string };
      const task = await this.store.getTask(taskId);
      const result = await this.store.getTaskResult(taskId);
      return { task, result };
    });

    this.protocol.registerMethod('chat.send', async (params) => {
      const msg = params as ChatMessage;
      msg.id = msg.id || shortId();
      msg.timestamp = Date.now();

      // Persist message to NAS
      const sessionId = (msg as Record<string, unknown>).sessionId as string || 'default';
      this.persistChatMessage(sessionId, msg);

      // Route to the appropriate agent via NATS
      if (msg.to === 'all') {
        await this.nats.publish(NatsSubjects.chat('agent-alpha'), msg);
        await this.nats.publish(NatsSubjects.chat('agent-beta'), msg);
      } else {
        await this.nats.publish(NatsSubjects.chat(msg.to), msg);
      }

      // Broadcast to dashboard for display
      this.protocol.broadcast('chat.message', msg);
      return { messageId: msg.id };
    });

    this.protocol.registerMethod('chat.history', async (params) => {
      const { sessionId = 'default', limit = 200 } = params as { sessionId?: string; limit?: number };
      return { messages: this.getChatHistory(sessionId, limit) };
    });

    this.protocol.registerMethod('chat.sessions', async () => {
      return { sessions: this.getChatSessions() };
    });

    this.protocol.registerMethod('chat.session.delete', async (params) => {
      const { sessionId } = params as { sessionId: string };
      return this.deleteChatSession(sessionId);
    });

    this.protocol.registerMethod('chat.abort', async (params) => {
      const { sessionId } = params as { sessionId: string };
      // Broadcast abort to agents
      await this.nats.publish(NatsSubjects.chat('agent-alpha'), { type: 'abort', sessionId });
      await this.nats.publish(NatsSubjects.chat('agent-beta'), { type: 'abort', sessionId });
      return { success: true };
    });

    this.protocol.registerMethod('vnc.info', async () => {
      const tbEnabled = process.env['THUNDERBOLT_ENABLED'] === 'true';
      return {
        alpha: {
          host: (tbEnabled && process.env['VNC_ALPHA_HOST_THUNDERBOLT'])
            ? process.env['VNC_ALPHA_HOST_THUNDERBOLT']
            : process.env['VNC_ALPHA_HOST'] ?? 'mac-mini-alpha.local',
          port: Number(process.env['VNC_ALPHA_PORT'] ?? 6080),
          label: 'Mac Mini Alpha (Dev)',
          thunderbolt: tbEnabled && !!process.env['VNC_ALPHA_HOST_THUNDERBOLT'],
        },
        beta: {
          host: (tbEnabled && process.env['VNC_BETA_HOST_THUNDERBOLT'])
            ? process.env['VNC_BETA_HOST_THUNDERBOLT']
            : process.env['VNC_BETA_HOST'] ?? 'mac-mini-beta.local',
          port: Number(process.env['VNC_BETA_PORT'] ?? 6080),
          label: 'Mac Mini Beta (Marketing)',
          thunderbolt: tbEnabled && !!process.env['VNC_BETA_HOST_THUNDERBOLT'],
        },
        thunderboltEnabled: tbEnabled,
      };
    });

    this.protocol.registerMethod('config.get', async () => {
      return this.config;
    });

    this.protocol.registerMethod('config.set', async (params) => {
      // For now, config is read-only at runtime
      log.warn('Runtime config update attempted', { params });
      return { success: false, message: 'Runtime config updates not yet supported' };
    });

    this.protocol.registerMethod('metrics.usage', async () => {
      const agents = await this.store.getAllAgentStates();
      const sessionsDir = this.nas.resolve('sessions');
      let totalSessions = 0;
      let totalMessages = 0;

      // Count sessions and messages from NAS
      try {
        if (existsSync(sessionsDir)) {
          const agentDirs = readdirSync(sessionsDir);
          for (const dir of agentDirs) {
            const agentPath = join(sessionsDir, dir);
            if (statSync(agentPath).isDirectory()) {
              const files = readdirSync(agentPath).filter((f) => f.endsWith('.jsonl'));
              totalSessions += files.length;
              for (const f of files) {
                try {
                  const content = readFileSync(join(agentPath, f), 'utf-8');
                  totalMessages += content.split('\n').filter(Boolean).length;
                } catch { /* skip corrupt files */ }
              }
            }
          }
        }
      } catch { /* non-critical */ }

      // Count chat messages
      let chatMessages = 0;
      try {
        const chatDir = this.nas.resolve('chat');
        if (existsSync(chatDir)) {
          const files = readdirSync(chatDir).filter((f) => f.endsWith('.jsonl'));
          for (const f of files) {
            try {
              const content = readFileSync(join(chatDir, f), 'utf-8');
              chatMessages += content.split('\n').filter(Boolean).length;
            } catch { /* skip */ }
          }
        }
      } catch { /* non-critical */ }

      return {
        agents,
        totalSessions,
        totalMessages,
        chatMessages,
        uptime: process.uptime(),
        memoryUsage: process.memoryUsage(),
      };
    });

    this.protocol.registerMethod('metrics.costs', async () => {
      // Aggregate costs from session files (if they contain token/cost info)
      const sessionsDir = this.nas.resolve('sessions');
      let totalTokens = 0;
      let totalCost = 0;
      const byAgent: Record<string, { tokens: number; cost: number; sessions: number }> = {};

      try {
        if (existsSync(sessionsDir)) {
          const agentDirs = readdirSync(sessionsDir);
          for (const dir of agentDirs) {
            const agentPath = join(sessionsDir, dir);
            if (statSync(agentPath).isDirectory()) {
              const files = readdirSync(agentPath).filter((f) => f.endsWith('.jsonl'));
              if (!byAgent[dir]) byAgent[dir] = { tokens: 0, cost: 0, sessions: files.length };
              else byAgent[dir].sessions = files.length;

              for (const f of files) {
                try {
                  const content = readFileSync(join(agentPath, f), 'utf-8');
                  const lines = content.split('\n').filter(Boolean);
                  for (const line of lines) {
                    try {
                      const entry = JSON.parse(line);
                      if (entry.usage?.totalTokens) {
                        const tokens = entry.usage.totalTokens as number;
                        totalTokens += tokens;
                        byAgent[dir].tokens += tokens;
                        // Estimate cost: ~$3/M input + $15/M output for Claude Sonnet
                        const estimatedCost = tokens * 0.000009;
                        totalCost += estimatedCost;
                        byAgent[dir].cost += estimatedCost;
                      }
                    } catch { /* skip */ }
                  }
                } catch { /* skip */ }
              }
            }
          }
        }
      } catch { /* non-critical */ }

      return {
        totalCost: Math.round(totalCost * 100) / 100,
        totalTokens,
        byAgent,
        currency: 'USD',
        note: 'Estimated based on token counts',
      };
    });

    // --- Sessions ---

    this.protocol.registerMethod('sessions.list', async () => {
      return this.listSessions();
    });

    this.protocol.registerMethod('sessions.get', async (params) => {
      const { sessionId } = params as { sessionId: string };
      return this.getSessionDetail(sessionId);
    });

    // --- Usage ---

    this.protocol.registerMethod('usage.summary', async () => {
      return this.getUsageSummary();
    });

    this.protocol.registerMethod('usage.sessions', async () => {
      return this.getSessionUsageList();
    });

    // --- Logs ---

    this.protocol.registerMethod('logs.get', async (params) => {
      const { lines } = (params ?? {}) as { lines?: number };
      return this.getLogLines(lines ?? 200);
    });

    // --- Orchestrator ---

    this.protocol.registerMethod('orchestrator.graph', async () => {
      return this.orchestrator.getGraphState();
    });

    this.protocol.registerMethod('orchestrator.ready', async () => {
      return this.orchestrator.getReadyTasks();
    });

    // --- Integrations ---

    this.protocol.registerMethod('integrations.status', async () => {
      // Count cron jobs from NAS
      let cronJobCount = 0;
      try {
        const cronDir = this.nas.resolve('cron-jobs');
        if (existsSync(cronDir)) {
          cronJobCount = readdirSync(cronDir).filter(f => f.endsWith('.json')).length;
        }
      } catch { /* ignore */ }

      // Count workflows from NAS
      let workflowCount = 0;
      try {
        const wfDir = this.nas.resolve('workflows');
        if (existsSync(wfDir)) {
          workflowCount = readdirSync(wfDir).filter(f => f.endsWith('.json')).length;
        }
      } catch { /* ignore */ }

      return {
        imessage: {
          available: process.platform === 'darwin',
          platform: process.platform,
        },
        spotify: {
          available: process.platform === 'darwin' || !!process.env['SPOTIFY_ACCESS_TOKEN'],
          hasApi: !!process.env['SPOTIFY_ACCESS_TOKEN'],
          mode: process.env['SPOTIFY_ACCESS_TOKEN'] ? 'api' : 'local',
        },
        homeAssistant: {
          available: !!(process.env['HASS_URL'] && process.env['HASS_TOKEN']),
          url: process.env['HASS_URL'] ?? undefined,
        },
        cron: {
          available: true,
          jobCount: cronJobCount,
        },
        calendar: {
          available: process.platform === 'darwin',
          platform: process.platform,
        },
        workflows: {
          available: true,
          count: workflowCount,
        },
      };
    });

    // --- Workflows ---

    this.protocol.registerMethod('workflows.list', async () => {
      return this.listWorkflows();
    });

    this.protocol.registerMethod('workflows.get', async (params) => {
      const { workflowId } = params as { workflowId: string };
      return this.getWorkflow(workflowId);
    });

    this.protocol.registerMethod('workflows.runs', async () => {
      return this.listWorkflowRuns();
    });

    // --- System Metrics ---

    this.protocol.registerMethod('system.metrics', async () => {
      return this.getSystemMetrics();
    });

    this.protocol.registerMethod('system.processes', async () => {
      return this.getTopProcesses();
    });

    // --- Notifications Config ---

    this.protocol.registerMethod('notifications.config.get', async () => {
      return this.getNotificationsConfig();
    });

    this.protocol.registerMethod('notifications.config.set', async (params) => {
      return this.setNotificationsConfig(params as Record<string, unknown>);
    });

    this.protocol.registerMethod('notifications.test', async () => {
      // Trigger macOS native test notification
      try {
        const { execSync: exec } = await import('node:child_process');
        exec(`osascript -e 'display notification "Test from Jarvis Dashboard" with title "🔔 Jarvis Test" sound name "Glass"'`, { timeout: 5000 });
        return { success: true, message: 'Test notification sent' };
      } catch {
        return { success: false, message: 'Failed to send test notification' };
      }
    });

    // --- API Keys ---

    this.protocol.registerMethod('apikeys.list', async () => {
      return this.getApiKeys();
    });

    this.protocol.registerMethod('apikeys.add', async (params) => {
      return this.addApiKey(params as { name: string; provider: string; key: string });
    });

    this.protocol.registerMethod('apikeys.delete', async (params) => {
      return this.deleteApiKey((params as { id: string }).id);
    });

    // --- Scheduler / Cron ---

    this.protocol.registerMethod('scheduler.list', async () => {
      return this.listScheduledJobs();
    });

    this.protocol.registerMethod('scheduler.jobs', async () => {
      return { jobs: this.listScheduledJobs() };
    });

    this.protocol.registerMethod('scheduler.history', async () => {
      return this.getSchedulerHistory();
    });

    this.protocol.registerMethod('scheduler.create', async (params) => {
      return this.createScheduledJob(params as Record<string, unknown>);
    });

    this.protocol.registerMethod('scheduler.delete', async (params) => {
      return this.deleteScheduledJob((params as { id: string }).id);
    });

    this.protocol.registerMethod('scheduler.enable', async (params) => {
      return this.toggleScheduledJob((params as { id: string }).id, true);
    });

    this.protocol.registerMethod('scheduler.disable', async (params) => {
      return this.toggleScheduledJob((params as { id: string }).id, false);
    });

    this.protocol.registerMethod('scheduler.run_now', async (params) => {
      return this.runJobNow((params as { id: string }).id);
    });

    // --- Environment Variables ---

    this.protocol.registerMethod('environment.list', async () => {
      return this.getEnvironmentVars();
    });

    this.protocol.registerMethod('environment.set', async (params) => {
      const { key, value } = params as { key: string; value: string };
      return this.setEnvironmentVar(key, value);
    });

    this.protocol.registerMethod('environment.delete', async (params) => {
      const { key } = params as { key: string };
      return this.deleteEnvironmentVar(key);
    });

    // --- Timeline ---

    this.protocol.registerMethod('timeline.list', async () => {
      return this.getTimelines();
    });

    this.protocol.registerMethod('timeline.recent', async () => {
      return this.getRecentTimeline();
    });

    // --- Plugins ---

    this.protocol.registerMethod('plugins.list', async () => {
      return this.getPluginsList();
    });

    // --- Skills ---

    this.protocol.registerMethod('skills.list', async () => {
      return this.getSkillsList();
    });

    this.protocol.registerMethod('skills.toggle', async (params) => {
      const { skillId } = params as { skillId: string };
      return this.toggleSkill(skillId);
    });

    this.protocol.registerMethod('skills.install', async (params) => {
      const { skillId } = params as { skillId: string };
      return this.installSkill(skillId);
    });

    // --- Model Providers ---

    this.protocol.registerMethod('providers.config.get', async () => {
      return this.getProvidersConfig();
    });

    this.protocol.registerMethod('providers.config.set', async (params) => {
      return this.setProvidersConfig(params as Record<string, unknown>);
    });

    // --- Voice ---

    this.protocol.registerMethod('voice.process', async (params) => {
      return this.processVoiceMessage(params as { message: string; language: string });
    });

    this.protocol.registerMethod('voice.settings', async () => {
      return this.getVoiceSettings();
    });

    // --- File Manager ---

    this.protocol.registerMethod('files.list', async (params) => {
      const { path } = params as { path: string };
      return this.listFiles(path);
    });

    this.protocol.registerMethod('files.read', async (params) => {
      const { path } = params as { path: string };
      return this.readFile(path);
    });

    // --- WhatsApp (Baileys QR Login) ---

    this.protocol.registerMethod('whatsapp.status', async () => {
      return this.getWhatsAppStatus();
    });

    this.protocol.registerMethod('whatsapp.login.start', async (params) => {
      const { force } = (params ?? {}) as { force?: boolean };
      return this.startWhatsAppLogin(force ?? false);
    });

    this.protocol.registerMethod('whatsapp.login.wait', async () => {
      return this.waitWhatsAppLogin();
    });

    this.protocol.registerMethod('whatsapp.logout', async () => {
      return this.logoutWhatsApp();
    });

    this.protocol.registerMethod('whatsapp.connect', async () => {
      await this.connectWhatsApp();
      return this.getWhatsAppStatus();
    });

    this.protocol.registerMethod('whatsapp.config.get', async () => {
      return this.getChannelConfig('whatsapp');
    });

    this.protocol.registerMethod('whatsapp.config.set', async (params) => {
      return this.setChannelConfig('whatsapp', params as Record<string, unknown>);
    });

    this.protocol.registerMethod('whatsapp.send', async (params) => {
      return this.sendWhatsAppMessage(params as { to: string; message: string });
    });

    this.protocol.registerMethod('whatsapp.messages', async (params) => {
      const { limit } = (params ?? {}) as { limit?: number };
      return this.getChannelMessages('whatsapp', limit ?? 200);
    });

    // --- Telegram ---

    this.protocol.registerMethod('telegram.status', async () => {
      return this.getTelegramStatus();
    });

    this.protocol.registerMethod('telegram.config.get', async () => {
      return this.getChannelConfig('telegram');
    });

    this.protocol.registerMethod('telegram.config.set', async (params) => {
      return this.setChannelConfig('telegram', params as Record<string, unknown>);
    });

    this.protocol.registerMethod('telegram.send', async (params) => {
      return this.sendTelegramMessage(params as { chatId: string; message: string });
    });

    this.protocol.registerMethod('telegram.messages', async (params) => {
      const { limit } = (params ?? {}) as { limit?: number };
      return this.getChannelMessages('telegram', limit ?? 200);
    });

    // --- Discord ---

    this.protocol.registerMethod('discord.status', async () => {
      return this.getDiscordStatus();
    });

    this.protocol.registerMethod('discord.config.get', async () => {
      return this.getChannelConfig('discord');
    });

    this.protocol.registerMethod('discord.config.set', async (params) => {
      return this.setChannelConfig('discord', params as Record<string, unknown>);
    });

    this.protocol.registerMethod('discord.send', async (params) => {
      return this.sendDiscordMessage(params as { channelId: string; message: string });
    });

    this.protocol.registerMethod('discord.messages', async (params) => {
      const { limit } = (params ?? {}) as { limit?: number };
      return this.getChannelMessages('discord', limit ?? 200);
    });

    // --- Channels (unified) ---

    this.protocol.registerMethod('channels.list', async () => {
      return this.listChannels();
    });

    this.protocol.registerMethod('channels.status', async () => {
      return this.getChannelsStatus();
    });

    // --- Memory ---

    this.protocol.registerMethod('memory.status', async () => {
      return this.getMemoryStatus();
    });

    this.protocol.registerMethod('memory.search', async (params) => {
      const { query, maxResults } = (params ?? {}) as { query: string; maxResults?: number };
      return this.searchMemory(query, maxResults ?? 30);
    });

    this.protocol.registerMethod('memory.read', async (params) => {
      const { file } = (params ?? {}) as { file?: string };
      return this.readMemoryFile(file ?? 'MEMORY.md');
    });

    this.protocol.registerMethod('memory.save', async (params) => {
      const { content, category } = params as { content: string; category?: 'core' | 'daily' };
      return this.saveMemory(content, category ?? 'core');
    });

    this.protocol.registerMethod('memory.list', async () => {
      return this.listMemoryFiles();
    });

    this.protocol.registerMethod('memory.delete', async (params) => {
      const { file } = params as { file: string };
      return this.deleteMemoryFile(file);
    });

    this.protocol.registerMethod('memory.entries', async (params) => {
      const { query, limit } = (params ?? {}) as { query?: string; limit?: number };
      return this.getKnowledgeEntries(query, limit ?? 50);
    });

    this.protocol.registerMethod('memory.entry.save', async (params) => {
      const { title, content, tags, source } = params as { title: string; content: string; tags?: string[]; source?: string };
      return this.saveKnowledgeEntry({ title, content, tags: tags ?? [], source: source ?? 'dashboard' });
    });

    this.protocol.registerMethod('memory.entry.delete', async (params) => {
      const { id } = params as { id: string };
      return this.deleteKnowledgeEntry(id);
    });

    // --- Exec Approvals (Human-in-the-loop) ---

    this.protocol.registerMethod('approvals.list', async () => {
      return { approvals: this.pendingApprovals };
    });

    this.protocol.registerMethod('approvals.history', async () => {
      return { history: this.approvalHistory.slice(-100) };
    });

    this.protocol.registerMethod('approvals.approve', async (params) => {
      const { approvalId } = params as { approvalId: string };
      return this.resolveApproval(approvalId, true);
    });

    this.protocol.registerMethod('approvals.deny', async (params) => {
      const { approvalId, reason } = params as { approvalId: string; reason?: string };
      return this.resolveApproval(approvalId, false, reason);
    });

    this.protocol.registerMethod('approvals.config.get', async () => {
      return this.getApprovalConfig();
    });

    this.protocol.registerMethod('approvals.config.set', async (params) => {
      return this.setApprovalConfig(params as Record<string, unknown>);
    });

  }

  // --- NATS Subscriptions ---

  private setupNatsSubscriptions(): void {
    // Agent status updates
    for (const agentId of ['agent-alpha', 'agent-beta']) {
      this.nats.subscribe(NatsSubjects.agentStatus(agentId), (data) => {
        const raw = data as Record<string, unknown>;
        let state: AgentState;

        // Support both nested AgentState format and legacy flat format
        if (raw?.identity && typeof raw.identity === 'object') {
          // New format: already nested AgentState
          state = raw as unknown as AgentState;
        } else {
          // Legacy flat format: reconstruct AgentState from flat fields
          const defaults = AGENT_DEFAULTS[agentId as AgentId];
          const now = Date.now();
          state = {
            identity: {
              agentId: agentId as AgentId,
              role: (raw?.role as string) ?? defaults?.role ?? 'dev',
              machineId: (raw?.machineId as string) ?? 'unknown',
              hostname: (raw?.hostname as string) ?? 'unknown',
            },
            status: (raw?.status as AgentState['status']) ?? 'idle',
            activeTaskId: (raw?.activeTaskId as string) ?? null,
            activeTaskDescription: (raw?.activeTask as string) ?? (raw?.activeTaskDescription as string) ?? null,
            lastHeartbeat: (raw?.timestamp as number) ?? now,
            startedAt: (raw?.startedAt as number) ?? now,
            completedTasks: (raw?.completedTasks as number) ?? 0,
            failedTasks: (raw?.failedTasks as number) ?? 0,
          };
          log.warn(`Agent ${agentId} sent legacy flat status, reconstructed AgentState`);
        }

        void this.store.setAgentState(state);
        this.protocol.broadcast('agent.status', state);
      });

      this.nats.subscribe(NatsSubjects.agentHeartbeat(agentId), () => {
        void this.store.updateHeartbeat(agentId);
        this.protocol.broadcast('agent.heartbeat', { agentId, timestamp: Date.now() });
      });

      this.nats.subscribe(NatsSubjects.agentResult(agentId), (data) => {
        const result = data as { taskId: string; success?: boolean; output?: string; [key: string]: unknown };
        this.protocol.broadcast('task.completed', result);

        // Notify dependency orchestrator of completion/failure
        if (result.taskId) {
          if (result.success !== false) {
            this.orchestrator.completeTask(result.taskId, (result.output as string) ?? '');
          } else {
            this.orchestrator.failTask(result.taskId, (result.output as string) ?? 'Task failed');
          }
        }
      });

    }

    // Chat messages from agents (chatBroadcast subject) — OUTSIDE loop to avoid duplicate subscriptions
    this.nats.subscribe(NatsSubjects.chatBroadcast, (data) => {
      // Persist agent responses to NAS
      const msg = data as ChatMessage & { sessionId?: string };
      if (msg.from && msg.content) {
        this.persistChatMessage(msg.sessionId ?? 'default', msg);
      }
      this.protocol.broadcast('chat.message', data);
    });

    // Also listen on dashboardBroadcast for general agent events
    this.nats.subscribe(NatsSubjects.dashboardBroadcast, (data) => {
      const event = data as { event?: string; payload?: unknown; source?: string };
      if (event.event === 'chat.response' && event.payload) {
        // Forward chat responses from legacy broadcastDashboard path
        const chatResp = {
          id: shortId(),
          from: event.source,
          content: (event.payload as { content?: string }).content,
          timestamp: Date.now(),
        };
        this.persistChatMessage('default', chatResp as ChatMessage);
        this.protocol.broadcast('chat.message', chatResp);
      } else {
        // Forward other dashboard events
        this.protocol.broadcast(event.event ?? 'agent.activity', event);
      }
    });

    // Task progress
    this.nats.subscribe('jarvis.task.*.progress', (data) => {
      this.protocol.broadcast('task.progress', data);
    });
  }

  // --- Sessions ---

  private listSessions(): Array<{
    id: string;
    agentId: string;
    taskId?: string;
    createdAt: number;
    messageCount: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
  }> {
    const results: Array<{
      id: string;
      agentId: string;
      taskId?: string;
      createdAt: number;
      messageCount: number;
      totalTokens: number;
      inputTokens: number;
      outputTokens: number;
    }> = [];

    for (const agentId of ['agent-alpha', 'agent-beta']) {
      try {
        const sessDir = this.nas.sessionsDir(agentId);
        if (!existsSync(sessDir)) continue;

        const files = readdirSync(sessDir).filter((f) => f.endsWith('.jsonl'));
        for (const file of files) {
          const filePath = join(sessDir, file);
          const sessionId = file.replace('.jsonl', '');
          try {
            const content = readFileSync(filePath, 'utf-8');
            const lines = content.trim().split('\n').filter(Boolean);
            let messageCount = 0;
            let totalTokens = 0;
            let inputTokens = 0;
            let outputTokens = 0;
            let createdAt = 0;
            let taskId: string | undefined;

            for (const line of lines) {
              try {
                const entry = JSON.parse(line);
                if (entry.type === 'message') messageCount++;
                if (entry.type === 'usage') {
                  totalTokens += entry.data?.totalTokens ?? 0;
                  inputTokens += entry.data?.inputTokens ?? 0;
                  outputTokens += entry.data?.outputTokens ?? 0;
                }
                if (entry.timestamp && (!createdAt || entry.timestamp < createdAt)) {
                  createdAt = entry.timestamp;
                }
                if (entry.taskId) taskId = entry.taskId;
              } catch { /* skip malformed lines */ }
            }

            if (!createdAt) {
              try { createdAt = statSync(filePath).birthtimeMs; } catch { createdAt = Date.now(); }
            }

            results.push({
              id: sessionId,
              agentId,
              taskId,
              createdAt,
              messageCount,
              totalTokens,
              inputTokens,
              outputTokens,
            });
          } catch { /* skip unreadable files */ }
        }
      } catch { /* skip missing dirs */ }
    }

    return results.sort((a, b) => b.createdAt - a.createdAt);
  }

  private getSessionDetail(sessionId: string): {
    id: string;
    agentId: string;
    messages: Array<{ role: string; content: string; timestamp: number }>;
    usage: { totalTokens: number; inputTokens: number; outputTokens: number };
  } | null {
    for (const agentId of ['agent-alpha', 'agent-beta']) {
      try {
        const filePath = join(this.nas.sessionsDir(agentId), `${sessionId}.jsonl`);
        if (!existsSync(filePath)) continue;

        const content = readFileSync(filePath, 'utf-8');
        const lines = content.trim().split('\n').filter(Boolean);
        const messages: Array<{ role: string; content: string; timestamp: number }> = [];
        let totalTokens = 0;
        let inputTokens = 0;
        let outputTokens = 0;

        for (const line of lines) {
          try {
            const entry = JSON.parse(line);
            if (entry.type === 'message') {
              messages.push({
                role: entry.role ?? 'unknown',
                content: typeof entry.content === 'string'
                  ? entry.content
                  : JSON.stringify(entry.content ?? entry.data, null, 2),
                timestamp: entry.timestamp ?? 0,
              });
            }
            if (entry.type === 'usage') {
              totalTokens += entry.data?.totalTokens ?? 0;
              inputTokens += entry.data?.inputTokens ?? 0;
              outputTokens += entry.data?.outputTokens ?? 0;
            }
          } catch { /* skip */ }
        }

        return {
          id: sessionId,
          agentId,
          messages,
          usage: { totalTokens, inputTokens, outputTokens },
        };
      } catch { /* continue */ }
    }
    return null;
  }

  // --- Usage ---

  private getUsageSummary(): {
    totalTokens: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalSessions: number;
    byAgent: Record<string, { totalTokens: number; inputTokens: number; outputTokens: number; sessions: number }>;
    byModel: Record<string, { totalTokens: number; calls: number }>;
    estimatedCost: number;
  } {
    const sessions = this.listSessions();
    const byAgent: Record<string, { totalTokens: number; inputTokens: number; outputTokens: number; sessions: number }> = {};

    let totalTokens = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    for (const s of sessions) {
      totalTokens += s.totalTokens;
      totalInputTokens += s.inputTokens;
      totalOutputTokens += s.outputTokens;

      if (!byAgent[s.agentId]) {
        byAgent[s.agentId] = { totalTokens: 0, inputTokens: 0, outputTokens: 0, sessions: 0 };
      }
      byAgent[s.agentId].totalTokens += s.totalTokens;
      byAgent[s.agentId].inputTokens += s.inputTokens;
      byAgent[s.agentId].outputTokens += s.outputTokens;
      byAgent[s.agentId].sessions++;
    }

    // Estimate cost (Claude Sonnet pricing: $3/M input, $15/M output)
    const estimatedCost = (totalInputTokens / 1_000_000) * 3 + (totalOutputTokens / 1_000_000) * 15;

    return {
      totalTokens,
      totalInputTokens,
      totalOutputTokens,
      totalSessions: sessions.length,
      byAgent,
      byModel: {}, // TODO: track per-model usage
      estimatedCost,
    };
  }

  private getSessionUsageList(): Array<{
    id: string;
    agentId: string;
    createdAt: number;
    totalTokens: number;
    inputTokens: number;
    outputTokens: number;
    model: string;
  }> {
    return this.listSessions().map((s) => ({
      id: s.id,
      agentId: s.agentId,
      createdAt: s.createdAt,
      totalTokens: s.totalTokens,
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      model: 'claude-sonnet-4-20250514', // TODO: read from session
    }));
  }

  // --- Logs ---

  private getLogLines(maxLines: number): string[] {
    const logFiles = [
      '/tmp/jarvis-gateway.log',
      '/tmp/jarvis-nats.log',
    ];

    const allLines: string[] = [];

    for (const file of logFiles) {
      try {
        if (!existsSync(file)) continue;
        const content = readFileSync(file, 'utf-8');
        const lines = content.trim().split('\n');
        // Strip ANSI color codes
        const cleaned = lines.map((l) => l.replace(/\x1b\[[0-9;]*m/g, ''));
        allLines.push(...cleaned);
      } catch { /* skip */ }
    }

    // Sort by timestamp if possible, otherwise keep order
    // Return last N lines
    return allLines.slice(-maxLines);
  }

  // --- Workflows ---

  private listWorkflows(): Array<{
    id: string;
    name: string;
    description: string;
    steps: number;
    tags: string[];
    createdAt: number;
    updatedAt: number;
    createdBy: string;
  }> {
    const results: Array<{
      id: string;
      name: string;
      description: string;
      steps: number;
      tags: string[];
      createdAt: number;
      updatedAt: number;
      createdBy: string;
    }> = [];

    try {
      const wfDir = this.nas.resolve('workflows');
      if (!existsSync(wfDir)) return results;

      const files = readdirSync(wfDir).filter(f => f.endsWith('.json'));
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(wfDir, file), 'utf-8'));
          if (data.id && data.steps) {
            results.push({
              id: data.id,
              name: data.name ?? file,
              description: data.description ?? '',
              steps: Array.isArray(data.steps) ? data.steps.length : 0,
              tags: data.tags ?? [],
              createdAt: data.createdAt ?? 0,
              updatedAt: data.updatedAt ?? 0,
              createdBy: data.createdBy ?? 'unknown',
            });
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }

    return results.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  private getWorkflow(workflowId: string): Record<string, unknown> | null {
    try {
      const filePath = this.nas.resolve('workflows', `${workflowId}.json`);
      if (existsSync(filePath)) {
        return JSON.parse(readFileSync(filePath, 'utf-8'));
      }
    } catch { /* skip */ }
    return null;
  }

  private listWorkflowRuns(): Array<{
    runId: string;
    workflowId: string;
    workflowName: string;
    status: string;
    startedAt: number;
    endedAt?: number;
    stepsCompleted: number;
    stepsTotal: number;
    agentId: string;
  }> {
    const results: Array<{
      runId: string;
      workflowId: string;
      workflowName: string;
      status: string;
      startedAt: number;
      endedAt?: number;
      stepsCompleted: number;
      stepsTotal: number;
      agentId: string;
    }> = [];

    try {
      const runsDir = this.nas.resolve('workflow-runs');
      if (!existsSync(runsDir)) return results;

      const files = readdirSync(runsDir).filter(f => f.endsWith('.json'));
      for (const file of files.slice(-50)) { // Last 50 runs
        try {
          const data = JSON.parse(readFileSync(join(runsDir, file), 'utf-8'));
          if (data.runId) {
            const stepResults = data.stepResults ?? [];
            results.push({
              runId: data.runId,
              workflowId: data.workflowId ?? '',
              workflowName: data.workflowName ?? '',
              status: data.status ?? 'unknown',
              startedAt: data.startedAt ?? 0,
              endedAt: data.endedAt,
              stepsCompleted: stepResults.filter((s: { status: string }) => s.status === 'completed').length,
              stepsTotal: stepResults.length,
              agentId: data.agentId ?? 'unknown',
            });
          }
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }

    return results.sort((a, b) => b.startedAt - a.startedAt);
  }

  // --- Scheduler / Cron ---

  private listScheduledJobs(): Array<Record<string, unknown>> {
    const results: Array<Record<string, unknown>> = [];
    try {
      const cronDir = this.nas.resolve('config');
      const jobsDir = join(cronDir, '..', 'cron-jobs');
      if (!existsSync(jobsDir)) return results;

      const files = readdirSync(jobsDir).filter(f => f.endsWith('.json') && f !== 'history.json');
      for (const file of files) {
        try {
          const data = JSON.parse(readFileSync(join(jobsDir, file), 'utf-8'));
          results.push(data);
        } catch { /* skip */ }
      }
    } catch { /* ignore */ }
    return results.sort((a, b) => (b.createdAt as string ?? '').localeCompare(a.createdAt as string ?? ''));
  }

  private getSchedulerHistory(): Array<Record<string, unknown>> {
    try {
      const cronDir = this.nas.resolve('config');
      const histPath = join(cronDir, '..', 'cron-jobs', 'history.json');
      if (existsSync(histPath)) {
        const data = JSON.parse(readFileSync(histPath, 'utf-8'));
        return Array.isArray(data) ? data.slice(-100).reverse() : [];
      }
    } catch { /* ignore */ }
    return [];
  }

  private createScheduledJob(params: Record<string, unknown>): { success: boolean; id: string } {
    const id = `cron-${shortId()}`;
    const job = {
      id,
      name: params.name ?? 'Untitled',
      description: params.description ?? '',
      cron: params.cron,
      at: params.at,
      targetAgent: params.targetAgent,
      taskInstruction: params.taskInstruction ?? '',
      priority: params.priority ?? 5,
      enabled: true,
      createdAt: new Date().toISOString(),
      runCount: 0,
      tags: params.tags ?? [],
    };

    try {
      const cronDir = this.nas.resolve('config');
      const jobsDir = join(cronDir, '..', 'cron-jobs');
      if (!existsSync(jobsDir)) {
        const { mkdirSync } = require('node:fs');
        mkdirSync(jobsDir, { recursive: true });
      }
      writeFileSync(join(jobsDir, `${id}.json`), JSON.stringify(job, null, 2));
      return { success: true, id };
    } catch (err) {
      log.error('Failed to create scheduled job', { error: String(err) });
      return { success: false, id: '' };
    }
  }

  private deleteScheduledJob(jobId: string): { success: boolean } {
    try {
      const cronDir = this.nas.resolve('config');
      const filePath = join(cronDir, '..', 'cron-jobs', `${jobId}.json`);
      if (existsSync(filePath)) {
        const { unlinkSync } = require('node:fs');
        unlinkSync(filePath);
        return { success: true };
      }
    } catch { /* ignore */ }
    return { success: false };
  }

  private toggleScheduledJob(jobId: string, enabled: boolean): { success: boolean } {
    try {
      const cronDir = this.nas.resolve('config');
      const filePath = join(cronDir, '..', 'cron-jobs', `${jobId}.json`);
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        data.enabled = enabled;
        writeFileSync(filePath, JSON.stringify(data, null, 2));
        return { success: true };
      }
    } catch { /* ignore */ }
    return { success: false };
  }

  private runJobNow(jobId: string): { success: boolean; message: string } {
    try {
      const cronDir = this.nas.resolve('config');
      const filePath = join(cronDir, '..', 'cron-jobs', `${jobId}.json`);
      if (existsSync(filePath)) {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        data.lastRun = new Date().toISOString();
        data.runCount = (data.runCount ?? 0) + 1;
        writeFileSync(filePath, JSON.stringify(data, null, 2));

        // Send task to agent
        const task = {
          id: shortId(),
          title: `[Scheduler] ${data.name}`,
          description: data.taskInstruction,
          priority: data.priority ?? 5,
          requiredCapabilities: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        void this.assignTask(task as any);

        // Log to history
        const histPath = join(cronDir, '..', 'cron-jobs', 'history.json');
        let hist: Array<Record<string, unknown>> = [];
        try {
          if (existsSync(histPath)) hist = JSON.parse(readFileSync(histPath, 'utf-8'));
        } catch { /* ignore */ }
        hist.push({
          jobId: data.id,
          jobName: data.name,
          timestamp: new Date().toISOString(),
          status: 'fired',
          details: `Manual trigger via dashboard`,
        });
        writeFileSync(histPath, JSON.stringify(hist.slice(-500), null, 2));

        return { success: true, message: `Job "${data.name}" fired` };
      }
    } catch (err) {
      return { success: false, message: String(err) };
    }
    return { success: false, message: 'Job not found' };
  }

  // --- API Keys ---

  private getApiKeys(): { keys: Array<{ id: string; name: string; provider: string; key: string; addedAt: number; lastUsed?: number }> } {
    const configPath = this.nas.resolve('config', 'api-keys.json');
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    // Return env-based keys as fallback
    const envKeys: Array<{ id: string; name: string; provider: string; key: string; addedAt: number }> = [];

    if (process.env['ANTHROPIC_API_KEY']) {
      envKeys.push({
        id: 'env-anthropic',
        name: 'ANTHROPIC_API_KEY',
        provider: 'anthropic',
        key: process.env['ANTHROPIC_API_KEY'],
        addedAt: Date.now(),
      });
    }
    if (process.env['OPENAI_API_KEY']) {
      envKeys.push({
        id: 'env-openai',
        name: 'OPENAI_API_KEY',
        provider: 'openai',
        key: process.env['OPENAI_API_KEY'],
        addedAt: Date.now(),
      });
    }
    if (process.env['SPOTIFY_ACCESS_TOKEN']) {
      envKeys.push({
        id: 'env-spotify',
        name: 'SPOTIFY_ACCESS_TOKEN',
        provider: 'spotify',
        key: process.env['SPOTIFY_ACCESS_TOKEN'],
        addedAt: Date.now(),
      });
    }
    if (process.env['HASS_TOKEN']) {
      envKeys.push({
        id: 'env-homeassistant',
        name: 'HASS_TOKEN',
        provider: 'homeassistant',
        key: process.env['HASS_TOKEN'],
        addedAt: Date.now(),
      });
    }

    return { keys: envKeys };
  }

  private addApiKey(params: { name: string; provider: string; key: string }): { success: boolean; id: string } {
    const configPath = this.nas.resolve('config', 'api-keys.json');
    let data = this.getApiKeys();

    const id = `key-${shortId()}`;
    data.keys.push({
      id,
      name: params.name,
      provider: params.provider,
      key: params.key,
      addedAt: Date.now(),
    });

    try {
      writeFileSync(configPath, JSON.stringify(data, null, 2));
      return { success: true, id };
    } catch (err) {
      log.error('Failed to save API key', { error: String(err) });
      return { success: false, id: '' };
    }
  }

  private deleteApiKey(keyId: string): { success: boolean } {
    if (keyId.startsWith('env-')) {
      return { success: false }; // Can't delete env keys
    }

    const configPath = this.nas.resolve('config', 'api-keys.json');
    let data = this.getApiKeys();
    data.keys = data.keys.filter(k => k.id !== keyId);

    try {
      writeFileSync(configPath, JSON.stringify(data, null, 2));
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  // --- Notifications Config ---

  private getNotificationsConfig(): Record<string, unknown> {
    const configPath = this.nas.resolve('config', 'notifications.json');
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    // Return defaults
    return {
      enableNative: process.platform === 'darwin',
      enableWebhook: false,
      webhooks: [],
      enableSound: true,
      soundName: 'Glass',
      enableTTS: false,
      notifyOnTaskComplete: true,
      notifyOnTaskFail: true,
      minPriority: 3,
      quietHours: { start: 23, end: 7 },
    };
  }

  private setNotificationsConfig(updates: Record<string, unknown>): { success: boolean; config: Record<string, unknown> } {
    const configPath = this.nas.resolve('config', 'notifications.json');
    let config: Record<string, unknown> = this.getNotificationsConfig();

    // Merge updates
    config = { ...config, ...updates };

    try {
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true, config };
    } catch (err) {
      log.error('Failed to save notifications config', { error: String(err) });
      return { success: false, config };
    }
  }

  // --- System Metrics ---

  private getSystemMetrics(): {
    cpu: { cores: number; model: string; speed: number; load: number[]; usage: number };
    memory: { total: number; free: number; used: number; usedPercent: number };
    disk: Array<{ filesystem: string; size: string; used: string; available: string; usedPercent: number; mount: string }>;
    network: Record<string, { rx: number; tx: number; ip: string }>;
    os: { hostname: string; platform: string; uptime: number; arch: string };
    timestamp: number;
  } {
    const cpuInfo = cpus();
    const totalMem = totalmem();
    const freeMem = freemem();
    const usedMem = totalMem - freeMem;
    const loads = loadavg();

    // CPU usage estimate from load average
    const cpuUsage = Math.min(100, (loads[0] / cpuInfo.length) * 100);

    // Disk usage via df
    const diskEntries: Array<{ filesystem: string; size: string; used: string; available: string; usedPercent: number; mount: string }> = [];
    try {
      const dfOutput = execSync('df -h / /Volumes/* 2>/dev/null || df -h /', { encoding: 'utf-8', timeout: 5000 });
      const lines = dfOutput.trim().split('\n').slice(1); // skip header
      for (const line of lines) {
        const parts = line.split(/\s+/);
        if (parts.length >= 6) {
          diskEntries.push({
            filesystem: parts[0],
            size: parts[1],
            used: parts[2],
            available: parts[3],
            usedPercent: parseInt(parts[4]) || 0,
            mount: parts.slice(5).join(' '),
          });
        }
      }
    } catch { /* ignore */ }

    // Network interfaces
    const nets = networkInterfaces();
    const netSummary: Record<string, { rx: number; tx: number; ip: string }> = {};
    for (const [name, addrs] of Object.entries(nets)) {
      if (!addrs) continue;
      const ipv4 = addrs.find(a => a.family === 'IPv4' && !a.internal);
      if (ipv4) {
        // Get network stats via netstat (macOS)
        let rx = 0;
        let tx = 0;
        try {
          const stat = execSync(`netstat -ibn | grep -E "^${name}\\s" | head -1`, { encoding: 'utf-8', timeout: 3000 });
          const cols = stat.trim().split(/\s+/);
          if (cols.length >= 10) {
            rx = parseInt(cols[6]) || 0;
            tx = parseInt(cols[9]) || 0;
          }
        } catch { /* ignore */ }
        netSummary[name] = { rx, tx, ip: ipv4.address };
      }
    }

    return {
      cpu: {
        cores: cpuInfo.length,
        model: cpuInfo[0]?.model ?? 'Unknown',
        speed: cpuInfo[0]?.speed ?? 0,
        load: loads,
        usage: Math.round(cpuUsage * 10) / 10,
      },
      memory: {
        total: totalMem,
        free: freeMem,
        used: usedMem,
        usedPercent: Math.round((usedMem / totalMem) * 1000) / 10,
      },
      disk: diskEntries,
      network: netSummary,
      os: {
        hostname: hostname(),
        platform: process.platform,
        uptime: osUptime(),
        arch: process.arch,
      },
      timestamp: Date.now(),
    };
  }

  private getTopProcesses(): Array<{
    pid: number;
    name: string;
    cpu: number;
    mem: number;
    user: string;
  }> {
    const results: Array<{ pid: number; name: string; cpu: number; mem: number; user: string }> = [];
    try {
      const output = execSync('ps aux --sort=-%cpu 2>/dev/null || ps aux -r', { encoding: 'utf-8', timeout: 5000 });
      const lines = output.trim().split('\n').slice(1, 16); // top 15 processes
      for (const line of lines) {
        const cols = line.trim().split(/\s+/);
        if (cols.length >= 11) {
          results.push({
            user: cols[0],
            pid: parseInt(cols[1]) || 0,
            cpu: parseFloat(cols[2]) || 0,
            mem: parseFloat(cols[3]) || 0,
            name: cols.slice(10).join(' ').split('/').pop()?.split(' ')[0] ?? cols[10],
          });
        }
      }
    } catch { /* ignore */ }
    return results;
  }

  // --- Task Assignment ---

  private async assignTask(task: TaskDefinition): Promise<void> {
    // Simple assignment: match required capabilities to agent
    const agents = await this.store.getAllAgentStates();

    for (const agent of agents) {
      if (agent.status !== 'idle') continue;

      const caps = await this.store.getCapabilities(agent.identity.agentId);
      if (!caps) continue;

      const hasAllCapabilities = task.requiredCapabilities.every(
        (cap) => caps.capabilities.includes(cap as never)
      );

      if (hasAllCapabilities) {
        await this.store.updateTask(task.id, { assignedAgent: agent.identity.agentId });
        await this.nats.publish(NatsSubjects.agentTask(agent.identity.agentId), task);
        this.protocol.broadcast('task.assigned', {
          taskId: task.id,
          agentId: agent.identity.agentId,
        });
        log.info(`Task ${task.id} assigned to ${agent.identity.agentId}`);
        return;
      }
    }

    log.warn(`No available agent for task ${task.id}`, {
      required: task.requiredCapabilities,
    });
  }

  // --- Health ---

  private async getHealthStatus() {
    const agents = await this.store.getAllAgentStates();
    const now = Date.now();

    return {
      status: 'ok',
      version: PROJECT_VERSION,
      uptime: process.uptime(),
      infrastructure: {
        nats: this.nats.isConnected,
        redis: this.redis.isConnected,
        nas: this.nas.healthCheck(),
      },
      agents: agents
        .filter((a) => a?.identity?.agentId)
        .map((a) => ({
          id: a.identity.agentId,
          role: a.identity.role ?? 'unknown',
          status: a.status ?? 'unknown',
          lastHeartbeat: a.lastHeartbeat ?? 0,
          alive: now - (a.lastHeartbeat ?? 0) < HEARTBEAT_TIMEOUT,
          activeTask: a.activeTaskDescription ?? null,
        })),
      dashboard: {
        connectedClients: this.protocol.clientCount,
      },
    };
  }

  private startHealthMonitoring(): void {
    this.healthInterval = setInterval(async () => {
      const health = await this.getHealthStatus();
      this.protocol.broadcast('system.health', health);
    }, 15_000);
  }

  // --- Dependency Orchestrator ---

  private setupOrchestrator(): void {
    // When a task is ready to dispatch, send it to the target agent via NATS
    this.orchestrator.onDispatch(async (agentId, task) => {
      const taskAssignment = {
        taskId: task.taskId,
        title: task.title,
        description: task.description,
        priority: task.priority,
        context: {
          sourceAgent: task.sourceAgent,
          planId: task.planId,
          stepId: task.stepId,
        },
      };

      await this.nats.publish(NatsSubjects.agentTask(agentId), taskAssignment);
      this.orchestrator.startTask(task.taskId, agentId);

      this.protocol.broadcast('task.delegated', {
        taskId: task.taskId,
        from: task.sourceAgent,
        to: agentId,
        title: task.title,
      });

      log.info(`Orchestrator dispatched task ${task.taskId} to ${agentId}`);
    });

    // When a delegated task completes, announce back to the source agent
    this.orchestrator.onAnnounce(async (sourceAgent, taskId, result, success) => {
      const chatMsg = {
        from: 'gateway',
        content: success
          ? `📋 Delegated task completed: ${taskId}\nResult: ${result.slice(0, 500)}`
          : `❌ Delegated task failed: ${taskId}\nError: ${result.slice(0, 500)}`,
        timestamp: Date.now(),
        type: 'delegation_result',
        taskId,
      };

      // Send as chat message to the source agent
      await this.nats.publish(NatsSubjects.chat(sourceAgent), chatMsg);

      this.protocol.broadcast('task.delegation_result', {
        taskId,
        sourceAgent,
        success,
        result: result.slice(0, 500),
      });

      log.info(`Announced delegation result for ${taskId} to ${sourceAgent} (${success ? 'success' : 'failed'})`);
    });

    log.info('Dependency orchestrator wired up');
  }

  private async sendInitialState(clientId: string): Promise<void> {
    const health = await this.getHealthStatus();
    this.protocol.sendEvent(clientId, 'system.health', health);

    const agents = await this.store.getAllAgentStates();
    for (const agent of agents) {
      this.protocol.sendEvent(clientId, 'agent.status', agent);
    }
  }

  // --- Environment Variables ---

  private getEnvironmentVars(): Record<string, string> {
    // Return JARVIS-relevant env vars (filter out system noise)
    const relevant: Record<string, string> = {};
    const prefixes = [
      'JARVIS_', 'NATS_', 'REDIS_', 'AGENT_', 'MACHINE_',
      'THUNDERBOLT_', 'VNC_', 'DEFAULT_MODEL', 'SPOTIFY_',
      'HASS_', 'OPENAI_', 'ANTHROPIC_', 'GOOGLE_', 'SLACK_',
      'DISCORD_', 'NTFY_', 'NODE_ENV', 'PORT', 'HOST',
    ];

    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (prefixes.some((p) => key.startsWith(p))) {
        relevant[key] = value;
      }
    }

    // Also read custom env from NAS config
    try {
      const envPath = this.nas.resolve('config/environment.json');
      if (existsSync(envPath)) {
        const custom = JSON.parse(readFileSync(envPath, 'utf-8')) as Record<string, string>;
        for (const [key, value] of Object.entries(custom)) {
          if (!(key in relevant)) {
            relevant[key] = value;
          }
        }
      }
    } catch { /* ignore */ }

    return relevant;
  }

  private setEnvironmentVar(key: string, value: string): { success: boolean } {
    // Set in process env
    process.env[key] = value;

    // Persist to NAS config
    try {
      const envPath = this.nas.resolve('config/environment.json');
      let existing: Record<string, string> = {};
      if (existsSync(envPath)) {
        existing = JSON.parse(readFileSync(envPath, 'utf-8')) as Record<string, string>;
      }
      existing[key] = value;
      const configDir = this.nas.resolve('config');
      if (!existsSync(configDir)) {
        mkdirSync(configDir, { recursive: true });
      }
      writeFileSync(envPath, JSON.stringify(existing, null, 2), 'utf-8');
    } catch (err) {
      log.warn('Failed to persist env var', { key, error: (err as Error).message });
    }

    return { success: true };
  }

  private deleteEnvironmentVar(key: string): { success: boolean; message?: string } {
    // Don't allow deleting runtime env vars
    if (process.env[key] !== undefined) {
      delete process.env[key];
    }

    // Remove from NAS config
    try {
      const envPath = this.nas.resolve('config/environment.json');
      if (existsSync(envPath)) {
        const existing = JSON.parse(readFileSync(envPath, 'utf-8')) as Record<string, string>;
        delete existing[key];
        writeFileSync(envPath, JSON.stringify(existing, null, 2), 'utf-8');
      }
    } catch { /* ignore */ }

    return { success: true };
  }

  // --- Timeline ---

  private getTimelines(): { timelines: Array<Record<string, unknown>> } {
    const timelines: Array<Record<string, unknown>> = [];
    try {
      const dir = this.nas.resolve('timelines');
      if (existsSync(dir)) {
        const files = readdirSync(dir).filter((f) => f.endsWith('-timeline.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
            timelines.push(data);
          } catch { /* skip */ }
        }
      }
    } catch { /* ignore */ }
    return { timelines };
  }

  private getRecentTimeline(): Array<Record<string, unknown>> {
    const allEntries: Array<Record<string, unknown>> = [];
    try {
      const dir = this.nas.resolve('timelines');
      if (existsSync(dir)) {
        const files = readdirSync(dir).filter((f) => f.endsWith('-timeline.json'));
        for (const file of files) {
          try {
            const data = JSON.parse(readFileSync(join(dir, file), 'utf-8'));
            if (data.entries && Array.isArray(data.entries)) {
              allEntries.push(...data.entries);
            }
          } catch { /* skip */ }
        }
      }
    } catch { /* ignore */ }
    // Sort by timestamp descending, return last 200
    allEntries.sort((a, b) => ((b.timestamp as number) || 0) - ((a.timestamp as number) || 0));
    return allEntries.slice(0, 200);
  }

  // --- Plugins ---

  private async getPluginsList(): Promise<{ agents: Array<Record<string, unknown>> }> {
    const agents: Array<Record<string, unknown>> = [];
    try {
      const allAgents = await this.store.getAllAgents();
      for (const agent of allAgents) {
        const agentId = agent.identity?.agentId ?? 'unknown';
        // Try to get capabilities from NATS
        try {
          const caps = await this.nats.request(`jarvis.agent.${agentId}.capabilities`, {}, 3000);
          const capsData = caps as Record<string, unknown>;

          const pluginList = (capsData?.plugins as string[]) ?? [];
          const toolList = (capsData?.tools as string[]) ?? [];

          // Build plugin info from capabilities data
          const pluginDetails = (capsData?.pluginDetails as Array<Record<string, unknown>>) ?? [];

          const plugins = pluginDetails.length > 0
            ? pluginDetails.map((pd) => ({
                id: pd.id ?? 'unknown',
                name: pd.name ?? (pd.id as string)?.replace('jarvis-', '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()) ?? 'Unknown',
                description: pd.description ?? '',
                version: pd.version ?? '',
                source: pd.source ?? 'builtin',
                tools: pd.tools ?? [],
                hooks: pd.hooks ?? [],
                services: pd.services ?? [],
                promptSections: pd.promptSections ?? [],
              }))
            : pluginList.map((name) => ({
                id: name,
                name: name.replace('jarvis-', '').replace(/-/g, ' ').replace(/\b\w/g, (c: string) => c.toUpperCase()),
                source: 'builtin',
                tools: [] as string[],
                hooks: [] as string[],
                services: [] as string[],
                promptSections: [] as string[],
              }));

          agents.push({
            agentId,
            plugins,
            summary: `${pluginList.length} plugins, ${toolList.length} tools`,
          });
        } catch {
          // Agent not responding, return basic info
          agents.push({
            agentId,
            plugins: [],
            summary: 'Agent not responding',
          });
        }
      }
    } catch (err) {
      log.error(`Failed to get plugins list: ${(err as Error).message}`);
    }
    return { agents };
  }

  // --- Voice ---

  private async processVoiceMessage(params: { message: string; language: string }): Promise<{ reply: string; agentId?: string }> {
    const { message, language } = params;
    log.info(`Voice message [${language}]: "${message.substring(0, 80)}"`);

    // Broadcast voice event for timeline
    this.protocol.broadcast('voice.message', { message, language, timestamp: Date.now() });

    // Try to route to an available agent
    try {
      const allAgents = await this.store.getAllAgents();
      const idleAgent = allAgents.find((a) => a.status === 'idle');

      if (idleAgent) {
        const agentId = idleAgent.identity?.agentId ?? 'agent-alpha';

        // Get system context for Jarvis personality
        const health = await this.getHealthData();
        const agentCount = allAgents.length;
        const onlineAgents = allAgents.filter((a) => {
          const elapsed = Date.now() - (a.lastHeartbeat ?? 0);
          return elapsed < 30_000;
        }).length;

        const context = `${onlineAgents}/${agentCount} agents online. System: ${health.status}. Uptime: ${Math.floor(health.uptime / 60)}min.`;

        // Send voice processing request to agent via NATS
        try {
          const response = await this.nats.request(
            `jarvis.agent.${agentId}.voice`,
            {
              message,
              language,
              context,
              type: 'voice_command',
            },
            10_000, // 10s timeout for voice
          );

          const result = response as Record<string, unknown>;
          if (result?.reply) {
            const reply = result.reply as string;
            this.protocol.broadcast('voice.response', { reply, agentId, timestamp: Date.now() });
            return { reply, agentId };
          }
        } catch {
          // Agent didn't handle voice, use local responses
        }
      }
    } catch {
      // Store unavailable, fall through to local responses
    }

    // Local Jarvis responses as fallback
    const reply = this.getLocalVoiceResponse(message, language);
    this.protocol.broadcast('voice.response', { reply, timestamp: Date.now() });
    return { reply };
  }

  private getLocalVoiceResponse(message: string, language: string): string {
    const lower = message.toLowerCase();

    if (language === 'pl') {
      if (lower.includes('status') || lower.includes('jak') && lower.includes('system'))
        return 'Wszystko działa, gateway stoi, oba agenty online.';
      if (lower.includes('agenci') || lower.includes('agent'))
        return 'Masz Alpha na devie i Beta na marketingu, oba aktywne.';
      if (lower.includes('czas') || lower.includes('godzina') || lower.includes('która'))
        return `Jest ${new Date().toLocaleTimeString('pl-PL')}.`;
      if (lower.includes('dzień dobry') || lower.includes('cześć') || lower.includes('hej') || lower.includes('siema') || lower.includes('yo'))
        return 'Hej, co tam? Systemy działają, mów co trzeba.';
      if (lower.includes('dziękuję') || lower.includes('dzięki'))
        return 'Spoko, nie ma sprawy.';
      if (lower.includes('kto') && (lower.includes('jesteś') || lower.includes('ty')))
        return 'Jarvis — ogarniam twoje agenty AI, pilnuję infrastruktury i pomagam w robocie.';
      if (lower.includes('pomoc') || lower.includes('co potrafisz') || lower.includes('co umiesz'))
        return 'Ogarniam agentów, monitoruję system, planuję taski, puszczam workflow-y. Gadam po polsku i angielsku. Pytaj.';
      if (lower.includes('dobranoc') || lower.includes('nara') || lower.includes('pa'))
        return 'Nara, jakby co to tu jestem.';
      if (lower.includes('kurwa') || lower.includes('cholera') || lower.includes('szlag'))
        return 'Spokojnie, co się stało? Mów, ogarniemy.';
      return 'Okej, ogarniamy. Coś jeszcze?';
    }

    // English
    if (lower.includes('status') || (lower.includes('how') && lower.includes('system')))
      return 'Everything\'s running, gateway up, both agents online.';
    if (lower.includes('agents') || lower.includes('agent'))
      return 'Alpha\'s on dev, Beta\'s on marketing. Both active.';
    if (lower.includes('time'))
      return `It's ${new Date().toLocaleTimeString('en-US')}.`;
    if (lower.includes('hello') || lower.includes('hey') || lower.includes('hi') || lower.includes('yo'))
      return 'Hey, what\'s up? Systems are good, what do you need?';
    if (lower.includes('thank'))
      return 'No worries.';
    if (lower.includes('who are you') || lower.includes('what are you'))
      return 'I\'m Jarvis — I manage your AI agents, watch the infra, and help get stuff done.';
    if (lower.includes('help') || lower.includes('what can you do'))
      return 'I handle agents, monitor systems, plan tasks, run workflows. Ask me anything.';
    if (lower.includes('bye') || lower.includes('goodnight'))
      return 'Later. I\'ll be around.';
    return 'Got it. Anything else?';
  }

  private getVoiceSettings(): Record<string, unknown> {
    // Load voice settings from NAS config
    try {
      const settingsPath = this.nas.resolve('config/voice-settings.json');
      if (existsSync(settingsPath)) {
        return JSON.parse(readFileSync(settingsPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    return {
      defaultLanguage: 'pl',
      ttsProvider: 'elevenlabs',
      wakeWord: 'Jarvis',
      supportedLanguages: ['pl', 'en'],
      voiceProfiles: {
        elevenlabs: {
          recommended: [
            { id: 'onwK4e9ZLuTAKqWW03F9', name: 'Daniel', style: 'British Jarvis' },
            { id: 'pNInz6obpgDQGcFmaJgB', name: 'Adam', style: 'Deep, Authoritative' },
            { id: 'ErXwobaYiN019PkySvjV', name: 'Antoni', style: 'Warm, Professional' },
          ],
        },
        openai: {
          recommended: [
            { id: 'onyx', name: 'Onyx', style: 'Deep Male' },
            { id: 'echo', name: 'Echo', style: 'Smooth Male' },
            { id: 'fable', name: 'Fable', style: 'British Male' },
          ],
        },
      },
    };
  }

  // --- File Manager ---

  private listFiles(reqPath: string): { entries: Array<Record<string, unknown>>; path: string } {
    const entries: Array<Record<string, unknown>> = [];
    try {
      // Resolve relative to NAS root
      const cleanPath = reqPath === '/' ? '' : reqPath.replace(/^\/+/, '');
      const fullPath = cleanPath ? this.nas.resolve(cleanPath) : this.nas.resolve('.');
      const resolvedPath = cleanPath || '/';

      if (!existsSync(fullPath)) {
        return { entries: [], path: resolvedPath };
      }

      const items = readdirSync(fullPath, { withFileTypes: true });

      for (const item of items) {
        if (item.name.startsWith('.')) continue; // Skip hidden files

        const itemPath = join(fullPath, item.name);
        const entry: Record<string, unknown> = {
          name: item.name,
          path: resolvedPath === '/' ? `/${item.name}` : `${resolvedPath}/${item.name}`,
          type: item.isDirectory() ? 'directory' : 'file',
        };

        if (!item.isDirectory()) {
          try {
            const stats = statSync(itemPath);
            entry.size = stats.size;
            entry.modified = stats.mtime.toISOString();
            entry.extension = item.name.includes('.') ? item.name.split('.').pop() : '';
          } catch { /* skip stats */ }
        } else {
          try {
            const stats = statSync(itemPath);
            entry.modified = stats.mtime.toISOString();
          } catch { /* skip */ }
        }

        entries.push(entry);
      }
    } catch (err) {
      log.error(`Failed to list files at ${reqPath}: ${(err as Error).message}`);
    }

    return { entries, path: reqPath };
  }

  private readFile(reqPath: string): Record<string, unknown> {
    try {
      const cleanPath = reqPath.replace(/^\/+/, '');
      const fullPath = this.nas.resolve(cleanPath);

      if (!existsSync(fullPath)) {
        throw new Error(`File not found: ${reqPath}`);
      }

      const stats = statSync(fullPath);

      // Safety: Don't read files larger than 1MB
      if (stats.size > 1_048_576) {
        return {
          path: reqPath,
          content: `[File too large to preview: ${(stats.size / 1024 / 1024).toFixed(1)}MB]`,
          size: stats.size,
          modified: stats.mtime.toISOString(),
          encoding: 'utf-8',
        };
      }

      const content = readFileSync(fullPath, 'utf-8');

      return {
        path: reqPath,
        content,
        size: stats.size,
        modified: stats.mtime.toISOString(),
        encoding: 'utf-8',
      };
    } catch (err) {
      throw new Error(`Cannot read file: ${(err as Error).message}`);
    }
  }

  // ==========================================================================
  // MESSAGING CHANNELS — WhatsApp, Telegram, Discord
  // Inspired by OpenClaw multi-channel architecture
  // ==========================================================================

  // --- Channel Config (shared) ---

  private getChannelConfig(channel: string): Record<string, unknown> {
    const configPath = this.nas.resolve('config', `${channel}.json`);
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    // Defaults per channel
    const defaults: Record<string, Record<string, unknown>> = {
      whatsapp: {
        autoReplyEnabled: false,
        autoReplyLanguage: 'pl',
        jarvisMode: true,
        notifyOnMessage: true,
        autoConnect: false,
      },
      telegram: {
        botToken: process.env['TELEGRAM_BOT_TOKEN'] ?? '',
        chatId: process.env['TELEGRAM_CHAT_ID'] ?? '',
        webhookUrl: '',
        autoReplyEnabled: false,
        autoReplyLanguage: 'pl',
        jarvisMode: true,
        allowedUsers: [],
        notifyOnMessage: true,
      },
      discord: {
        botToken: process.env['DISCORD_BOT_TOKEN'] ?? '',
        applicationId: process.env['DISCORD_APP_ID'] ?? '',
        guildId: process.env['DISCORD_GUILD_ID'] ?? '',
        channelId: process.env['DISCORD_CHANNEL_ID'] ?? '',
        webhookUrl: process.env['DISCORD_WEBHOOK_URL'] ?? '',
        autoReplyEnabled: false,
        autoReplyLanguage: 'pl',
        jarvisMode: true,
        notifyOnMessage: true,
      },
    };

    return defaults[channel] ?? {};
  }

  private setChannelConfig(channel: string, updates: Record<string, unknown>): { success: boolean; config: Record<string, unknown> } {
    const configPath = this.nas.resolve('config', `${channel}.json`);
    let config = this.getChannelConfig(channel);
    config = { ...config, ...updates, updatedAt: new Date().toISOString() };

    try {
      const configDir = this.nas.resolve('config');
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      log.info(`${channel} config updated`);
      return { success: true, config };
    } catch (err) {
      log.error(`Failed to save ${channel} config`, { error: String(err) });
      return { success: false, config };
    }
  }

  // --- Channel Messages (shared NAS storage) ---

  private getChannelMessages(channel: string, limit: number): { messages: Array<Record<string, unknown>> } {
    const messagesPath = this.nas.resolve('channels', channel, 'messages.json');
    try {
      if (existsSync(messagesPath)) {
        const all = JSON.parse(readFileSync(messagesPath, 'utf-8')) as Array<Record<string, unknown>>;
        return { messages: all.slice(-limit) };
      }
    } catch { /* ignore */ }
    return { messages: [] };
  }

  private appendChannelMessage(channel: string, message: Record<string, unknown>): void {
    const dir = this.nas.resolve('channels', channel);
    const messagesPath = join(dir, 'messages.json');
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      let messages: Array<Record<string, unknown>> = [];
      if (existsSync(messagesPath)) {
        messages = JSON.parse(readFileSync(messagesPath, 'utf-8'));
      }
      messages.push(message);
      // Keep last 2000 messages per channel
      if (messages.length > 2000) messages = messages.slice(-2000);
      writeFileSync(messagesPath, JSON.stringify(messages, null, 2));
    } catch (err) {
      log.error(`Failed to save ${channel} message`, { error: String(err) });
    }
  }

  // --- WhatsApp (Baileys — QR Code Login) ---

  // Baileys socket and login state
  private waSocket: ReturnType<typeof import('@whiskeysockets/baileys').makeWASocket> | null = null;
  private waConnected = false;
  private waQrDataUrl: string | null = null;
  private waLoginResolve: ((value: { connected: boolean; message: string }) => void) | null = null;
  private waSelfJid: string | null = null;

  private getWhatsAppAuthDir(): string {
    const dir = this.nas.resolve('whatsapp-auth');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    return dir;
  }

  private getWhatsAppStatus(): {
    connected: boolean;
    loggedIn: boolean;
    selfJid: string | null;
    qrPending: boolean;
    message: string;
  } {
    const authDir = this.getWhatsAppAuthDir();
    const credsPath = join(authDir, 'creds.json');
    const loggedIn = existsSync(credsPath);

    return {
      connected: this.waConnected,
      loggedIn,
      selfJid: this.waSelfJid,
      qrPending: !!this.waQrDataUrl,
      message: this.waConnected
        ? `Connected as ${this.waSelfJid || 'unknown'}`
        : loggedIn
          ? 'Logged in but not connected. Click Connect to start.'
          : 'Not logged in. Click "Show QR" to scan with WhatsApp.',
    };
  }

  private async startWhatsAppLogin(force = false): Promise<{ qrDataUrl: string | null; message: string }> {
    log.info('WhatsApp login: starting QR flow...');

    // Stop existing socket
    if (this.waSocket) {
      try { this.waSocket.end(undefined); } catch { /* */ }
      this.waSocket = null;
      this.waConnected = false;
    }

    // If force, clear auth
    if (force) {
      const authDir = this.getWhatsAppAuthDir();
      const credsPath = join(authDir, 'creds.json');
      try { if (existsSync(credsPath)) unlinkSync(credsPath); } catch { /* */ }
      log.info('WhatsApp: cleared existing auth (force relink)');
    }

    // Dynamic import for Baileys (ESM module)
    let baileys: typeof import('@whiskeysockets/baileys');
    try {
      baileys = await import('@whiskeysockets/baileys');
    } catch (err) {
      log.error('Failed to import Baileys:', { error: String(err) });
      return { qrDataUrl: null, message: 'Baileys library not installed. Run: pnpm add @whiskeysockets/baileys' };
    }

    let qrcode: typeof import('qrcode');
    try {
      qrcode = await import('qrcode');
    } catch {
      return { qrDataUrl: null, message: 'qrcode library not installed. Run: pnpm add qrcode' };
    }

    const authDir = this.getWhatsAppAuthDir();
    const { state, saveCreds } = await baileys.useMultiFileAuthState(authDir);
    const { version } = await baileys.fetchLatestBaileysVersion();

    return new Promise((resolveLogin) => {
      let qrReceived = false;
      const timeout = setTimeout(() => {
        if (!qrReceived) {
          resolveLogin({ qrDataUrl: null, message: 'QR code timeout (30s). Try again.' });
        }
      }, 30000);

      const sock = baileys!.makeWASocket({
        auth: {
          creds: state.creds,
          keys: baileys!.makeCacheableSignalKeyStore(state.keys, undefined as any),
        },
        version,
        printQRInTerminal: false,
        browser: ['Jarvis 2.0', 'Desktop', '1.0.0'],
        syncFullHistory: false,
        markOnlineOnConnect: false,
      });

      this.waSocket = sock as any;

      // Save creds on update
      sock.ev.on('creds.update', saveCreds);

      // Connection events
      sock.ev.on('connection.update', async (update: any) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr && !qrReceived) {
          qrReceived = true;
          clearTimeout(timeout);
          try {
            // Convert QR string to base64 PNG data URL
            const dataUrl = await qrcode!.toDataURL(qr, {
              width: 300,
              margin: 2,
              color: { dark: '#000000', light: '#ffffff' },
            });
            this.waQrDataUrl = dataUrl;
            log.info('WhatsApp: QR code generated, waiting for scan...');
            resolveLogin({
              qrDataUrl: dataUrl,
              message: 'Scan this QR code in WhatsApp → Linked Devices → Link a Device',
            });
          } catch (err) {
            log.error('QR generation failed:', { error: String(err) });
            resolveLogin({ qrDataUrl: null, message: `QR generation failed: ${(err as Error).message}` });
          }
        }

        if (connection === 'open') {
          this.waConnected = true;
          this.waQrDataUrl = null;
          this.waSelfJid = sock.user?.id ?? null;
          log.info(`WhatsApp connected as ${this.waSelfJid}`);
          this.protocol.broadcast('whatsapp.connected', {
            selfJid: this.waSelfJid,
            timestamp: Date.now(),
          });

          // Resolve login wait if pending
          if (this.waLoginResolve) {
            this.waLoginResolve({ connected: true, message: `Connected as ${this.waSelfJid}` });
            this.waLoginResolve = null;
          }
        }

        if (connection === 'close') {
          this.waConnected = false;
          const statusCode = (lastDisconnect?.error as any)?.output?.statusCode;
          const reason = baileys!.DisconnectReason;

          log.warn(`WhatsApp disconnected (code: ${statusCode})`);
          this.protocol.broadcast('whatsapp.disconnected', { statusCode, timestamp: Date.now() });

          if (statusCode === reason.loggedOut) {
            // Logged out — clear auth
            log.info('WhatsApp: Logged out, clearing credentials');
            this.waSocket = null;
            this.waSelfJid = null;
          } else if (statusCode === 515 || statusCode === reason.restartRequired) {
            // Restart required after pairing — auto-reconnect
            log.info('WhatsApp: Restart required, reconnecting...');
            setTimeout(() => this.connectWhatsApp(), 2000);
          } else {
            // Other disconnect — auto-reconnect after delay
            log.info('WhatsApp: Will reconnect in 5s...');
            setTimeout(() => this.connectWhatsApp(), 5000);
          }

          // Resolve login wait if pending
          if (this.waLoginResolve) {
            this.waLoginResolve({ connected: false, message: `Disconnected (code: ${statusCode})` });
            this.waLoginResolve = null;
          }
        }
      });

      // Message handler
      sock.ev.on('messages.upsert', async (upsert: any) => {
        if (upsert.type !== 'notify') return;

        for (const msg of upsert.messages) {
          if (!msg.message || msg.key.fromMe) continue;

          const from = msg.key.remoteJid ?? '';
          // Skip status/broadcast
          if (from === 'status@broadcast' || from.endsWith('@broadcast')) continue;

          // Extract text
          const text = msg.message.conversation
            || msg.message.extendedTextMessage?.text
            || '';
          if (!text) continue;

          // Extract sender name
          const pushName = msg.pushName ?? from.split('@')[0];

          const incomingMsg = {
            id: msg.key.id ?? `wa-${Date.now()}`,
            from,
            fromName: pushName,
            to: 'jarvis',
            body: text,
            timestamp: msg.messageTimestamp ? Number(msg.messageTimestamp) * 1000 : Date.now(),
            direction: 'incoming' as const,
            status: 'read' as const,
            type: 'text' as const,
          };

          this.appendChannelMessage('whatsapp', incomingMsg);
          this.protocol.broadcast('whatsapp.message', incomingMsg);
          log.info(`WhatsApp from ${pushName}: "${text.substring(0, 80)}"`);

          // Auto-reply if enabled
          const config = this.getChannelConfig('whatsapp');
          if (config.jarvisMode) {
            const lang = (config.autoReplyLanguage as string) ?? 'pl';
            let reply: string;

            if (text.startsWith('/')) {
              reply = await this.handleChannelCommand(text, lang);
            } else {
              const processed = await this.processVoiceMessage({ message: text, language: lang });
              reply = processed.reply;
            }

            await this.sendWhatsAppMessage({ to: from, message: reply });
          }
        }
      });

      // If we already have creds, this socket will connect without QR
      // Check if connection opens quickly (no QR needed)
      const credsPath = join(authDir, 'creds.json');
      if (existsSync(credsPath)) {
        // Already logged in — socket should connect without QR
        setTimeout(() => {
          if (!qrReceived && this.waConnected) {
            clearTimeout(timeout);
            resolveLogin({
              qrDataUrl: null,
              message: `Already connected as ${this.waSelfJid}`,
            });
          } else if (!qrReceived && !this.waConnected) {
            // Wait a bit longer for connection
          }
        }, 5000);
      }
    });
  }

  private async connectWhatsApp(): Promise<void> {
    const authDir = this.getWhatsAppAuthDir();
    const credsPath = join(authDir, 'creds.json');
    if (!existsSync(credsPath)) {
      log.info('WhatsApp: No credentials found, skipping auto-connect');
      return;
    }

    // Only connect if not already connected
    if (this.waConnected) return;

    log.info('WhatsApp: Auto-connecting with saved credentials...');
    await this.startWhatsAppLogin(false);
  }

  private async waitWhatsAppLogin(): Promise<{ connected: boolean; message: string }> {
    if (this.waConnected) {
      return { connected: true, message: `Already connected as ${this.waSelfJid}` };
    }

    return new Promise((resolve) => {
      this.waLoginResolve = resolve;
      // Timeout after 120 seconds
      setTimeout(() => {
        if (this.waLoginResolve === resolve) {
          this.waLoginResolve = null;
          resolve({ connected: false, message: 'Scan timeout (120s). Try again.' });
        }
      }, 120000);
    });
  }

  private async logoutWhatsApp(): Promise<{ success: boolean; message: string }> {
    try {
      if (this.waSocket) {
        try { await (this.waSocket as any).logout(); } catch { /* */ }
        try { this.waSocket.end(undefined); } catch { /* */ }
        this.waSocket = null;
      }
      this.waConnected = false;
      this.waSelfJid = null;
      this.waQrDataUrl = null;

      // Clear auth files
      const authDir = this.getWhatsAppAuthDir();
      try {
        const files = readdirSync(authDir);
        for (const file of files) {
          try { unlinkSync(join(authDir, file)); } catch { /* */ }
        }
      } catch { /* */ }

      log.info('WhatsApp: Logged out and cleared credentials');
      this.protocol.broadcast('whatsapp.disconnected', { reason: 'logout', timestamp: Date.now() });
      return { success: true, message: 'Logged out successfully. Scan QR to reconnect.' };
    } catch (err) {
      return { success: false, message: `Logout failed: ${(err as Error).message}` };
    }
  }

  private async sendWhatsAppMessage(params: { to: string; message: string }): Promise<{ success: boolean; messageId?: string; error?: string }> {
    if (!this.waSocket || !this.waConnected) {
      return { success: false, error: 'WhatsApp not connected. Login via QR code first.' };
    }

    // Convert phone number to JID if needed
    let jid = params.to;
    if (!jid.includes('@')) {
      // Clean number and add WhatsApp suffix
      const cleaned = jid.replace(/[\s\-+()]/g, '');
      jid = `${cleaned}@s.whatsapp.net`;
    }

    try {
      const result = await (this.waSocket as any).sendMessage(jid, { text: params.message });
      const msgId = result?.key?.id ?? `wa-${Date.now()}`;

      // Save to history
      this.appendChannelMessage('whatsapp', {
        id: msgId,
        from: 'jarvis',
        to: jid,
        body: params.message,
        timestamp: Date.now(),
        direction: 'outgoing',
        status: 'sent',
        type: 'text',
      });

      this.protocol.broadcast('whatsapp.sent', { to: jid, message: params.message, timestamp: Date.now() });
      return { success: true, messageId: msgId };
    } catch (err) {
      log.error(`WhatsApp send error: ${(err as Error).message}`);
      return { success: false, error: (err as Error).message };
    }
  }

  private async handleWhatsAppWebhook(_body: Record<string, unknown>): Promise<void> {
    // Legacy webhook handler — no longer needed with Baileys (messages come via socket events)
    // Kept as no-op for backward compatibility
    log.debug('WhatsApp webhook called (legacy — Baileys handles messages via socket)');
  }

  // --- Telegram ---

  private getTelegramStatus(): { connected: boolean; botToken: boolean; chatId: string } {
    const config = this.getChannelConfig('telegram');
    return {
      connected: !!(config.botToken),
      botToken: !!(config.botToken),
      chatId: (config.chatId as string) ?? '',
    };
  }

  private async sendTelegramMessage(params: { chatId: string; message: string }): Promise<{ success: boolean; error?: string }> {
    const config = this.getChannelConfig('telegram');
    const botToken = config.botToken as string;

    if (!botToken) {
      return { success: false, error: 'Telegram not configured. Set Bot Token.' };
    }

    const chatId = params.chatId || (config.chatId as string);
    if (!chatId) {
      return { success: false, error: 'No chat ID specified' };
    }

    try {
      const response = await fetch(
        `https://api.telegram.org/bot${botToken}/sendMessage`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: chatId,
            text: params.message,
            parse_mode: 'Markdown',
          }),
        }
      );

      const result = await response.json() as Record<string, unknown>;

      if (result.ok) {
        this.appendChannelMessage('telegram', {
          id: `tg-out-${Date.now()}`,
          from: 'jarvis',
          to: chatId,
          body: params.message,
          timestamp: Date.now(),
          direction: 'outgoing',
          status: 'sent',
          type: 'text',
        });

        this.protocol.broadcast('telegram.sent', { chatId, message: params.message, timestamp: Date.now() });
        return { success: true };
      }

      return { success: false, error: (result.description as string) ?? 'Unknown error' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async handleTelegramWebhook(body: Record<string, unknown>): Promise<void> {
    const message = body.message as Record<string, unknown>;
    if (!message) return;

    const from = message.from as Record<string, unknown>;
    const chat = message.chat as Record<string, unknown>;
    const text = message.text as string;
    if (!text || !chat) return;

    const chatId = String(chat.id);
    const username = (from?.username as string) ?? (from?.first_name as string) ?? chatId;

    const incomingMsg = {
      id: `tg-in-${message.message_id ?? Date.now()}`,
      from: username,
      fromId: chatId,
      to: 'jarvis',
      body: text,
      timestamp: Date.now(),
      direction: 'incoming' as const,
      status: 'read' as const,
      type: 'text' as const,
    };

    this.appendChannelMessage('telegram', incomingMsg);
    this.protocol.broadcast('telegram.message', incomingMsg);

    log.info(`Telegram message from ${username}: "${text.substring(0, 80)}"`);

    // Auto-reply
    const config = this.getChannelConfig('telegram');
    if (config.jarvisMode) {
      const lang = (config.autoReplyLanguage as string) ?? 'pl';
      let reply: string;

      if (text.startsWith('/')) {
        reply = await this.handleChannelCommand(text, lang);
      } else {
        const processed = await this.processVoiceMessage({ message: text, language: lang });
        reply = processed.reply;
      }

      await this.sendTelegramMessage({ chatId, message: reply });
    }
  }

  // --- Discord ---

  private getDiscordStatus(): { connected: boolean; hasToken: boolean; guildId: string } {
    const config = this.getChannelConfig('discord');
    return {
      connected: !!(config.botToken || config.webhookUrl),
      hasToken: !!(config.botToken),
      guildId: (config.guildId as string) ?? '',
    };
  }

  private async sendDiscordMessage(params: { channelId: string; message: string }): Promise<{ success: boolean; error?: string }> {
    const config = this.getChannelConfig('discord');

    // Try webhook first (simpler)
    const webhookUrl = config.webhookUrl as string;
    if (webhookUrl) {
      try {
        const response = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content: params.message,
            username: 'Jarvis',
            avatar_url: 'https://i.imgur.com/AfFp7pu.png',
          }),
        });

        if (response.ok || response.status === 204) {
          this.appendChannelMessage('discord', {
            id: `dc-out-${Date.now()}`,
            from: 'jarvis',
            to: params.channelId || 'webhook',
            body: params.message,
            timestamp: Date.now(),
            direction: 'outgoing',
            status: 'sent',
            type: 'text',
          });
          return { success: true };
        }
        return { success: false, error: `Discord webhook returned ${response.status}` };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }

    // Try bot API
    const botToken = config.botToken as string;
    const channelId = params.channelId || (config.channelId as string);
    if (!botToken || !channelId) {
      return { success: false, error: 'Discord not configured. Set Bot Token + Channel ID or Webhook URL.' };
    }

    try {
      const response = await fetch(
        `https://discord.com/api/v10/channels/${channelId}/messages`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bot ${botToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ content: params.message }),
        }
      );

      const result = await response.json() as Record<string, unknown>;

      if (response.ok) {
        this.appendChannelMessage('discord', {
          id: (result.id as string) ?? `dc-out-${Date.now()}`,
          from: 'jarvis',
          to: channelId,
          body: params.message,
          timestamp: Date.now(),
          direction: 'outgoing',
          status: 'sent',
          type: 'text',
        });
        return { success: true };
      }

      return { success: false, error: (result.message as string) ?? 'Unknown error' };
    } catch (err) {
      return { success: false, error: (err as Error).message };
    }
  }

  private async handleDiscordWebhook(body: Record<string, unknown>): Promise<void> {
    // Discord interactions/events
    const content = body.content as string;
    const author = body.author as Record<string, unknown>;
    if (!content || !author) return;

    const username = (author.username as string) ?? 'unknown';

    const incomingMsg = {
      id: (body.id as string) ?? `dc-in-${Date.now()}`,
      from: username,
      to: 'jarvis',
      body: content,
      timestamp: Date.now(),
      direction: 'incoming' as const,
      status: 'read' as const,
      type: 'text' as const,
    };

    this.appendChannelMessage('discord', incomingMsg);
    this.protocol.broadcast('discord.message', incomingMsg);

    log.info(`Discord message from ${username}: "${content.substring(0, 80)}"`);

    const config = this.getChannelConfig('discord');
    if (config.jarvisMode) {
      const lang = (config.autoReplyLanguage as string) ?? 'pl';
      let reply: string;

      if (content.startsWith('/') || content.startsWith('!')) {
        reply = await this.handleChannelCommand(content, lang);
      } else {
        const processed = await this.processVoiceMessage({ message: content, language: lang });
        reply = processed.reply;
      }

      const channelId = (body.channel_id as string) ?? (config.channelId as string);
      if (channelId) {
        await this.sendDiscordMessage({ channelId, message: reply });
      }
    }
  }

  // --- Unified Channel Helpers ---

  private listChannels(): Array<{
    id: string;
    name: string;
    type: string;
    connected: boolean;
    messageCount: number;
    lastActivity?: number;
  }> {
    const channels: Array<{
      id: string;
      name: string;
      type: string;
      connected: boolean;
      messageCount: number;
      lastActivity?: number;
    }> = [];

    for (const channel of ['whatsapp', 'telegram', 'discord', 'imessage'] as const) {
      const config = this.getChannelConfig(channel);
      const msgs = this.getChannelMessages(channel, 1);
      const lastMsg = msgs.messages[0];

      let connected = false;
      if (channel === 'whatsapp') connected = this.waConnected;
      else if (channel === 'telegram') connected = !!(config.botToken);
      else if (channel === 'discord') connected = !!(config.botToken || config.webhookUrl);
      else if (channel === 'imessage') connected = process.platform === 'darwin';

      const allMsgs = this.getChannelMessages(channel, 99999);

      channels.push({
        id: channel,
        name: channel.charAt(0).toUpperCase() + channel.slice(1),
        type: 'messaging',
        connected,
        messageCount: allMsgs.messages.length,
        lastActivity: (lastMsg?.timestamp as number) ?? undefined,
      });
    }

    return channels;
  }

  private getChannelsStatus(): Record<string, { connected: boolean; config: Record<string, unknown> }> {
    const result: Record<string, { connected: boolean; config: Record<string, unknown> }> = {};
    for (const channel of ['whatsapp', 'telegram', 'discord']) {
      const config = this.getChannelConfig(channel);
      let connected = false;
      if (channel === 'whatsapp') connected = this.waConnected;
      else if (channel === 'telegram') connected = !!(config.botToken);
      else if (channel === 'discord') connected = !!(config.botToken || config.webhookUrl);
      result[channel] = { connected, config: { ...config, accessToken: config.accessToken ? '***' : '', botToken: config.botToken ? '***' : '' } };
    }
    return result;
  }

  // --- Channel Command Handler ---

  private async handleChannelCommand(text: string, lang: string): Promise<string> {
    const cmd = text.replace(/^[/!]/, '').trim().toLowerCase();
    const parts = cmd.split(/\s+/);
    const command = parts[0];

    const isPl = lang === 'pl';

    switch (command) {
      case 'status': {
        const health = await this.getHealthStatus();
        const agents = health.agents as Array<{ id: string; status: string; role: string }>;
        const agentList = agents.map((a) => `${a.id.replace('agent-', '')}: ${a.status}`).join(', ');
        return isPl
          ? `System: ${health.status}. Uptime: ${formatDuration(health.uptime as number)}. Agenci: ${agentList}. Infra: NATS=${health.infrastructure.nats ? 'OK' : 'DOWN'}, Redis=${health.infrastructure.redis ? 'OK' : 'DOWN'}`
          : `System: ${health.status}. Uptime: ${formatDuration(health.uptime as number)}. Agents: ${agentList}. Infra: NATS=${health.infrastructure.nats ? 'OK' : 'DOWN'}, Redis=${health.infrastructure.redis ? 'OK' : 'DOWN'}`;
      }

      case 'agents': {
        const agents = await this.store.getAllAgentStates();
        const list = agents.map((a) => `${a.identity.agentId} [${a.identity.role}]: ${a.status}`).join('\n');
        return isPl ? `Agenci:\n${list}` : `Agents:\n${list}`;
      }

      case 'tasks': {
        const tasks = await this.store.getPendingTasks();
        if (tasks.length === 0) return isPl ? 'Brak oczekujących tasków.' : 'No pending tasks.';
        const list = tasks.slice(0, 5).map((t) => `• ${t.title ?? t.id}`).join('\n');
        return isPl ? `Taski (${tasks.length}):\n${list}` : `Tasks (${tasks.length}):\n${list}`;
      }

      case 'task': {
        const taskText = parts.slice(1).join(' ');
        if (!taskText) return isPl ? 'Podaj treść taska: /task <opis>' : 'Provide task text: /task <description>';
        const taskDef = {
          id: shortId(),
          title: taskText,
          description: taskText,
          priority: 5,
          requiredCapabilities: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await this.store.createTask(taskDef as any);
        await this.assignTask(taskDef as any);
        return isPl ? `Task utworzony: ${taskDef.id}` : `Task created: ${taskDef.id}`;
      }

      case 'help': {
        return isPl
          ? 'Komendy:\n/status — stan systemu\n/agents — lista agentów\n/tasks — oczekujące taski\n/task <opis> — utwórz task\n/help — ta wiadomość\n\nMożesz też napisać normalnie — Jarvis odpowie.'
          : 'Commands:\n/status — system health\n/agents — list agents\n/tasks — pending tasks\n/task <desc> — create task\n/help — this message\n\nYou can also write normally — Jarvis will reply.';
      }

      default:
        return isPl ? `Nieznana komenda: /${command}. Wpisz /help.` : `Unknown command: /${command}. Type /help.`;
    }
  }

  // --- Skills ---

  private getSkillsList(): { skills: Array<Record<string, unknown>> } {
    const configPath = this.nas.resolve('config', 'skills.json');
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }
    return { skills: [] };
  }

  private toggleSkill(skillId: string): { success: boolean } {
    const configPath = this.nas.resolve('config', 'skills.json');
    let data = this.getSkillsList();
    const skill = data.skills.find((s) => s.id === skillId);
    if (skill) {
      skill.enabled = !skill.enabled;
    } else {
      data.skills.push({ id: skillId, installed: true, enabled: true });
    }
    try {
      const configDir = this.nas.resolve('config');
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(data, null, 2));
      return { success: true };
    } catch { return { success: false }; }
  }

  private installSkill(skillId: string): { success: boolean } {
    const configPath = this.nas.resolve('config', 'skills.json');
    let data = this.getSkillsList();
    const existing = data.skills.find((s) => s.id === skillId);
    if (existing) {
      existing.installed = true;
      existing.enabled = true;
    } else {
      data.skills.push({ id: skillId, installed: true, enabled: true, installedAt: new Date().toISOString() });
    }
    try {
      const configDir = this.nas.resolve('config');
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(data, null, 2));
      log.info(`Skill installed: ${skillId}`);
      return { success: true };
    } catch { return { success: false }; }
  }

  // --- Model Providers ---

  private getProvidersConfig(): Record<string, unknown> {
    const configPath = this.nas.resolve('config', 'providers.json');
    try {
      if (existsSync(configPath)) {
        return JSON.parse(readFileSync(configPath, 'utf-8'));
      }
    } catch { /* ignore */ }

    // Return defaults based on env vars
    return {
      providers: [
        {
          id: 'anthropic', name: 'Anthropic', type: 'anthropic',
          baseUrl: 'https://api.anthropic.com',
          apiKey: process.env['ANTHROPIC_API_KEY'] ? '***' : '',
          enabled: !!process.env['ANTHROPIC_API_KEY'],
          priority: 1,
        },
        {
          id: 'openai', name: 'OpenAI', type: 'openai',
          baseUrl: 'https://api.openai.com/v1',
          apiKey: process.env['OPENAI_API_KEY'] ? '***' : '',
          enabled: !!process.env['OPENAI_API_KEY'],
          priority: 2,
        },
      ],
      chains: [
        {
          id: 'default', name: 'Default Chain',
          description: 'Primary model with fallback',
          models: ['claude-sonnet-4-20250514', 'gpt-4o'],
          active: true,
        },
      ],
      activeModel: process.env['DEFAULT_MODEL'] ?? 'claude-sonnet-4-20250514',
    };
  }

  private setProvidersConfig(params: Record<string, unknown>): { success: boolean } {
    const configPath = this.nas.resolve('config', 'providers.json');
    try {
      const configDir = this.nas.resolve('config');
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(params, null, 2));
      log.info('Providers config updated');
      return { success: true };
    } catch (err) {
      log.error('Failed to save providers config', { error: String(err) });
      return { success: false };
    }
  }

  // --- Chat Persistence ---

  private persistChatMessage(sessionId: string, msg: ChatMessage): void {
    try {
      const chatDir = this.nas.resolve('chat');
      if (!existsSync(chatDir)) mkdirSync(chatDir, { recursive: true });

      const sessionFile = join(chatDir, `${sessionId}.jsonl`);
      const line = JSON.stringify({
        ...msg,
        sessionId,
      }) + '\n';
      appendFileSync(sessionFile, line, 'utf-8');
    } catch {
      // Non-critical: log but don't fail
    }
  }

  private getChatHistory(sessionId: string, limit: number): ChatMessage[] {
    try {
      const sessionFile = this.nas.resolve(`chat/${sessionId}.jsonl`);
      if (!existsSync(sessionFile)) return [];

      const content = readFileSync(sessionFile, 'utf-8');
      const lines = content.trim().split('\n').filter(Boolean);
      const messages = lines
        .map((line) => { try { return JSON.parse(line); } catch { return null; } })
        .filter(Boolean) as ChatMessage[];

      // Return last N messages
      return messages.slice(-limit);
    } catch {
      return [];
    }
  }

  private getChatSessions(): Array<Record<string, unknown>> {
    try {
      const chatDir = this.nas.resolve('chat');
      if (!existsSync(chatDir)) return [];

      const files = readdirSync(chatDir).filter((f) => f.endsWith('.jsonl'));
      const sessions: Array<Record<string, unknown>> = [];

      for (const file of files) {
        try {
          const filePath = join(chatDir, file);
          const stat = statSync(filePath);
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);
          const lastMsg = lines.length > 0
            ? ((): ChatMessage | null => { try { return JSON.parse(lines[lines.length - 1]); } catch { return null; } })()
            : null;
          const firstMsg = lines.length > 0
            ? ((): ChatMessage | null => { try { return JSON.parse(lines[0]); } catch { return null; } })()
            : null;

          const sessionId = file.replace('.jsonl', '');

          // Generate title from first user message
          const firstUserLine = lines.find((l) => {
            try { const m = JSON.parse(l); return m.from === 'user'; } catch { return false; }
          });
          let title = sessionId;
          if (firstUserLine) {
            try {
              const m = JSON.parse(firstUserLine);
              title = (m.content as string)?.substring(0, 50) || sessionId;
            } catch { /* keep default */ }
          }

          sessions.push({
            id: sessionId,
            title,
            createdAt: firstMsg?.timestamp ?? stat.birthtimeMs,
            updatedAt: lastMsg?.timestamp ?? stat.mtimeMs,
            messageCount: lines.length,
            preview: lastMsg?.content?.substring(0, 80) ?? '',
          });
        } catch { /* skip corrupt files */ }
      }

      // Sort newest first
      sessions.sort((a, b) => (b.updatedAt as number) - (a.updatedAt as number));
      return sessions;
    } catch {
      return [];
    }
  }

  private deleteChatSession(sessionId: string): { success: boolean } {
    try {
      const sessionFile = this.nas.resolve(`chat/${sessionId}.jsonl`);
      if (existsSync(sessionFile)) unlinkSync(sessionFile);
      return { success: true };
    } catch {
      return { success: false };
    }
  }

  // --- Memory & Knowledge ---

  private getMemoryStatus(): Record<string, unknown> {
    const knowledgeDir = this.nas.resolve('knowledge');
    const memoryDir = join(knowledgeDir, 'memory');
    const entriesDir = join(knowledgeDir, 'entries');
    const memoryFile = join(knowledgeDir, 'MEMORY.md');

    let coreLines = 0;
    let coreSize = 0;
    if (existsSync(memoryFile)) {
      const s = statSync(memoryFile);
      coreSize = s.size;
      coreLines = readFileSync(memoryFile, 'utf-8').split('\n').length;
    }

    let dailyCount = 0;
    if (existsSync(memoryDir)) {
      dailyCount = readdirSync(memoryDir).filter(f => f.endsWith('.md')).length;
    }

    let entryCount = 0;
    if (existsSync(entriesDir)) {
      entryCount = readdirSync(entriesDir).filter(f => f.endsWith('.json')).length;
    }

    return {
      coreMemory: { file: 'MEMORY.md', lines: coreLines, sizeBytes: coreSize },
      dailyNotes: { count: dailyCount, directory: 'knowledge/memory/' },
      knowledgeEntries: { count: entryCount, directory: 'knowledge/entries/' },
      backend: 'file-based',
      searchType: 'keyword + TF-IDF',
    };
  }

  private searchMemory(query: string, maxResults: number): { results: Array<Record<string, unknown>>; total: number } {
    const queryLower = query.toLowerCase();
    const results: Array<Record<string, unknown>> = [];
    const knowledgeDir = this.nas.resolve('knowledge');
    const memoryDir = join(knowledgeDir, 'memory');
    const memoryFile = join(knowledgeDir, 'MEMORY.md');

    // Search MEMORY.md
    if (existsSync(memoryFile)) {
      const content = readFileSync(memoryFile, 'utf-8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].toLowerCase().includes(queryLower)) {
          results.push({ source: 'MEMORY.md', line: i + 1, text: lines[i].trim(), type: 'core' });
        }
      }
    }

    // Search daily notes
    if (existsSync(memoryDir)) {
      const files = readdirSync(memoryDir).filter(f => f.endsWith('.md')).sort().reverse().slice(0, 60);
      for (const file of files) {
        try {
          const content = readFileSync(join(memoryDir, file), 'utf-8');
          const lines = content.split('\n');
          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(queryLower)) {
              results.push({ source: file, line: i + 1, text: lines[i].trim(), type: 'daily' });
            }
          }
        } catch { /* skip */ }
      }
    }

    // Search knowledge entries
    const entriesDir = join(knowledgeDir, 'entries');
    if (existsSync(entriesDir)) {
      const entryFiles = readdirSync(entriesDir).filter(f => f.endsWith('.json'));
      for (const file of entryFiles) {
        try {
          const entry = JSON.parse(readFileSync(join(entriesDir, file), 'utf-8'));
          const searchable = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase();
          if (searchable.includes(queryLower)) {
            results.push({ source: `entry:${entry.id}`, text: entry.title, content: entry.content?.slice(0, 200), type: 'entry', tags: entry.tags });
          }
        } catch { /* skip */ }
      }
    }

    return { results: results.slice(0, maxResults), total: results.length };
  }

  private readMemoryFile(file: string): { content: string; file: string; lines: number; sizeBytes: number } | { error: string } {
    const safeName = file.replace(/\.\./g, '').replace(/^\//, '');
    const knowledgeDir = this.nas.resolve('knowledge');
    let filePath: string;

    if (safeName === 'MEMORY.md') {
      filePath = join(knowledgeDir, 'MEMORY.md');
    } else {
      filePath = join(knowledgeDir, 'memory', safeName);
    }

    if (!existsSync(filePath)) {
      return { error: `File not found: ${safeName}` };
    }

    const content = readFileSync(filePath, 'utf-8');
    const stat = statSync(filePath);
    return { content, file: safeName, lines: content.split('\n').length, sizeBytes: stat.size };
  }

  private saveMemory(content: string, category: 'core' | 'daily'): { success: boolean; file: string; message: string } {
    const knowledgeDir = this.nas.resolve('knowledge');
    const memoryDir = join(knowledgeDir, 'memory');
    const memoryFile = join(knowledgeDir, 'MEMORY.md');
    const timestamp = new Date().toISOString();

    try {
      if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true });

      if (category === 'daily') {
        const dateStr = new Date().toISOString().split('T')[0];
        const dailyPath = join(memoryDir, `${dateStr}.md`);
        const header = existsSync(dailyPath) ? '' : `# Daily Notes: ${dateStr}\n\n`;
        const entry = `${header}## ${timestamp}\n${content}\n\n`;
        const existing = existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') : '';
        writeFileSync(dailyPath, existing + entry);
        return { success: true, file: `${dateStr}.md`, message: `Saved to daily note ${dateStr}` };
      } else {
        const entry = `\n## [${timestamp}]\n${content}\n`;
        const existing = existsSync(memoryFile) ? readFileSync(memoryFile, 'utf-8') : '# MEMORY\n\nLong-term memory for Jarvis 2.0.\n';
        writeFileSync(memoryFile, existing + entry);
        return { success: true, file: 'MEMORY.md', message: 'Saved to core memory' };
      }
    } catch (err) {
      return { success: false, file: '', message: String(err) };
    }
  }

  private listMemoryFiles(): { files: Array<{ name: string; type: string; sizeBytes: number; modifiedAt: string }> } {
    const knowledgeDir = this.nas.resolve('knowledge');
    const memoryDir = join(knowledgeDir, 'memory');
    const memoryFile = join(knowledgeDir, 'MEMORY.md');
    const files: Array<{ name: string; type: string; sizeBytes: number; modifiedAt: string }> = [];

    if (existsSync(memoryFile)) {
      const s = statSync(memoryFile);
      files.push({ name: 'MEMORY.md', type: 'core', sizeBytes: s.size, modifiedAt: s.mtime.toISOString() });
    }

    if (existsSync(memoryDir)) {
      const daily = readdirSync(memoryDir).filter(f => f.endsWith('.md')).sort().reverse();
      for (const f of daily) {
        try {
          const s = statSync(join(memoryDir, f));
          files.push({ name: f, type: 'daily', sizeBytes: s.size, modifiedAt: s.mtime.toISOString() });
        } catch { /* skip */ }
      }
    }

    return { files };
  }

  private deleteMemoryFile(file: string): { success: boolean } {
    if (file === 'MEMORY.md') return { success: false };
    const safeName = file.replace(/\.\./g, '').replace(/^\//, '');
    const filePath = join(this.nas.resolve('knowledge', 'memory'), safeName);
    try {
      if (existsSync(filePath)) { unlinkSync(filePath); return { success: true }; }
      return { success: false };
    } catch { return { success: false }; }
  }

  private getKnowledgeEntries(query?: string, limit = 50): { entries: Array<Record<string, unknown>>; total: number } {
    const entriesDir = this.nas.resolve('knowledge', 'entries');
    if (!existsSync(entriesDir)) {
      try { mkdirSync(entriesDir, { recursive: true }); } catch { /* */ }
      return { entries: [], total: 0 };
    }

    const files = readdirSync(entriesDir).filter(f => f.endsWith('.json'));
    const entries: Array<Record<string, unknown>> = [];

    for (const file of files) {
      try {
        const entry = JSON.parse(readFileSync(join(entriesDir, file), 'utf-8'));
        if (query) {
          const searchable = `${entry.title} ${entry.content} ${(entry.tags || []).join(' ')}`.toLowerCase();
          if (!searchable.includes(query.toLowerCase())) continue;
        }
        entries.push(entry);
      } catch { /* skip corrupt */ }
    }

    entries.sort((a, b) => ((b.updatedAt as number) || 0) - ((a.updatedAt as number) || 0));
    return { entries: entries.slice(0, limit), total: entries.length };
  }

  private saveKnowledgeEntry(params: { title: string; content: string; tags: string[]; source: string }): { success: boolean; id: string } {
    const entriesDir = this.nas.resolve('knowledge', 'entries');
    try {
      if (!existsSync(entriesDir)) mkdirSync(entriesDir, { recursive: true });
      const id = `kb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const entry = { id, title: params.title, content: params.content, tags: params.tags, source: params.source, agentId: 'dashboard', createdAt: Date.now(), updatedAt: Date.now() };
      writeFileSync(join(entriesDir, `${id}.json`), JSON.stringify(entry, null, 2));
      log.info(`Knowledge entry saved: ${id} - ${params.title}`);
      return { success: true, id };
    } catch (err) {
      log.error('Failed to save knowledge entry', { error: String(err) });
      return { success: false, id: '' };
    }
  }

  private deleteKnowledgeEntry(id: string): { success: boolean } {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
    const filePath = join(this.nas.resolve('knowledge', 'entries'), `${safeId}.json`);
    try {
      if (existsSync(filePath)) { unlinkSync(filePath); return { success: true }; }
      return { success: false };
    } catch { return { success: false }; }
  }

  // --- Exec Approvals (Human-in-the-loop) ---

  private pendingApprovals: Array<{
    id: string;
    agentId: string;
    tool: string;
    params: Record<string, unknown>;
    reason: string;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    createdAt: number;
    expiresAt: number;
  }> = [];

  private approvalHistory: Array<{
    id: string;
    agentId: string;
    tool: string;
    reason: string;
    riskLevel: string;
    decision: 'approved' | 'denied';
    decidedAt: number;
    denyReason?: string;
  }> = [];

  private approvalResolvers = new Map<string, (approved: boolean, reason?: string) => void>();

  /** Called by agents when they need approval for a risky tool execution */
  requestApproval(agentId: string, tool: string, params: Record<string, unknown>, reason: string, riskLevel: 'low' | 'medium' | 'high' | 'critical' = 'medium'): Promise<{ approved: boolean; reason?: string }> {
    const id = `approval-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const approval = {
      id,
      agentId,
      tool,
      params,
      reason,
      riskLevel,
      createdAt: Date.now(),
      expiresAt: Date.now() + 300_000, // 5 minute timeout
    };

    this.pendingApprovals.push(approval);
    this.protocol.broadcast('approval.requested', approval);
    log.info(`Approval requested: ${id} — ${agentId} wants to run ${tool}`);

    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        // Auto-deny on timeout
        this.resolveApproval(id, false, 'Timed out — no human response within 5 minutes');
      }, 300_000);

      this.approvalResolvers.set(id, (approved, denyReason) => {
        clearTimeout(timer);
        resolve({ approved, reason: denyReason });
      });
    });
  }

  private resolveApproval(approvalId: string, approved: boolean, reason?: string): { success: boolean } {
    const idx = this.pendingApprovals.findIndex(a => a.id === approvalId);
    if (idx === -1) return { success: false };

    const approval = this.pendingApprovals[idx];
    this.pendingApprovals.splice(idx, 1);

    // Save to history
    this.approvalHistory.push({
      id: approval.id,
      agentId: approval.agentId,
      tool: approval.tool,
      reason: approval.reason,
      riskLevel: approval.riskLevel,
      decision: approved ? 'approved' : 'denied',
      decidedAt: Date.now(),
      denyReason: reason,
    });

    // Persist history to NAS
    try {
      const historyPath = this.nas.resolve('config', 'approval-history.json');
      writeFileSync(historyPath, JSON.stringify(this.approvalHistory.slice(-500), null, 2));
    } catch { /* ignore */ }

    // Broadcast result
    this.protocol.broadcast('approval.resolved', {
      approvalId: approval.id,
      agentId: approval.agentId,
      tool: approval.tool,
      approved,
      reason,
    });

    // Resolve the promise for the waiting agent
    const resolver = this.approvalResolvers.get(approvalId);
    if (resolver) {
      resolver(approved, reason);
      this.approvalResolvers.delete(approvalId);
    }

    log.info(`Approval ${approved ? 'APPROVED' : 'DENIED'}: ${approvalId} — ${approval.tool}`);
    return { success: true };
  }

  private getApprovalConfig(): Record<string, unknown> {
    const configPath = this.nas.resolve('config', 'approvals.json');
    try {
      if (existsSync(configPath)) return JSON.parse(readFileSync(configPath, 'utf-8'));
    } catch { /* */ }
    return {
      enabled: true,
      autoApprove: ['memory_search', 'memory_save', 'web_search', 'weather'],
      requireApproval: ['exec_command', 'file_delete', 'ssh_exec', 'browser_navigate', 'send_message'],
      alwaysDeny: [],
      timeoutSeconds: 300,
      soundAlert: true,
      desktopNotification: true,
    };
  }

  private setApprovalConfig(config: Record<string, unknown>): { success: boolean } {
    const configPath = this.nas.resolve('config', 'approvals.json');
    try {
      const configDir = this.nas.resolve('config');
      if (!existsSync(configDir)) mkdirSync(configDir, { recursive: true });
      writeFileSync(configPath, JSON.stringify(config, null, 2));
      return { success: true };
    } catch { return { success: false }; }
  }

  // --- Health Data Helper (for voice/channel responses) ---

  private async getHealthData(): Promise<{ status: string; uptime: number }> {
    try {
      const h = await this.getHealthStatus();
      return { status: h.status as string, uptime: h.uptime as number };
    } catch {
      return { status: 'unknown', uptime: 0 };
    }
  }
}

// --- Module-level helpers ---

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
