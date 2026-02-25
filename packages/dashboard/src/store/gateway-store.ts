import { create } from 'zustand';
import { gateway } from '../gateway/client.js';

interface AgentState {
  identity: { agentId: string; role: string; machineId: string; hostname: string };
  status: string;
  activeTaskId: string | null;
  activeTaskDescription: string | null;
  lastHeartbeat: number;
  completedTasks: number;
  failedTasks: number;
}

interface ChatMessage {
  id: string;
  from: string;
  to: string;
  content: string;
  timestamp: number;
}

interface TaskDef {
  id: string;
  title: string;
  description: string;
  priority: string;
  status?: string;
  assignedAgent: string | null;
  requiredCapabilities?: string[];
  createdAt?: number;
  updatedAt?: number;
}

interface ActivityEntry {
  id: string;
  agentId: string;
  action: string;
  detail: string;
  timestamp: number;
}

export type FeedEntryType = 'tool_call' | 'task_progress' | 'delegation' | 'status_change';

export interface FeedEntry {
  id: string;
  type: FeedEntryType;
  agentId: string;
  timestamp: number;
  detail: string;
  // tool_call
  toolName?: string;
  toolArgs?: string;
  // task_progress
  taskId?: string;
  progress?: number; // 0-100
  taskTitle?: string;
  // delegation
  fromAgent?: string;
  toAgent?: string;
  // status_change
  oldStatus?: string;
  newStatus?: string;
}

interface HealthInfo {
  status: string;
  version: string;
  uptime: number;
  infrastructure: {
    nats: boolean;
    redis: boolean;
    nas: { mounted: boolean; path: string };
  };
  agents: Array<{
    id: string;
    role: string;
    status: string;
    alive: boolean;
    activeTask: string | null;
  }>;
  dashboard: { connectedClients: number };
}

interface GatewayStore {
  connected: boolean;
  agents: Map<string, AgentState>;
  tasks: TaskDef[];
  chatMessages: ChatMessage[];
  activityLog: ActivityEntry[];
  activityFeed: FeedEntry[];
  taskProgress: Map<string, FeedEntry>;
  health: HealthInfo | null;
  consoleLines: Array<{ agentId: string; line: string; timestamp: number }>;

  // Actions
  init: () => void;
  sendChat: (to: string, content: string) => void;
  createTask: (task: Partial<TaskDef>) => void;
}

let initialized = false;

export const useGatewayStore = create<GatewayStore>((set) => ({
  connected: false,
  agents: new Map(),
  tasks: [],
  chatMessages: [],
  activityLog: [],
  activityFeed: [],
  taskProgress: new Map(),
  health: null,
  consoleLines: [],

  init: () => {
    if (initialized) return;
    initialized = true;
    gateway.connect();

    gateway.on('_connected', () => {
      set({ connected: true });
      // Fetch initial state
      void gateway.request('agents.list').then((agents) => {
        const map = new Map<string, AgentState>();
        for (const a of agents as AgentState[]) {
          map.set(a.identity.agentId, a);
        }
        set({ agents: map });
      });
      void gateway.request('tasks.list').then((tasks) => {
        set({ tasks: tasks as TaskDef[] });
      });
    });

    gateway.on('_disconnected', () => {
      set({ connected: false });
    });

    gateway.on('agent.status', (payload) => {
      const state = payload as AgentState;
      set((prev) => {
        const agents = new Map(prev.agents);
        const oldAgent = agents.get(state.identity.agentId);
        agents.set(state.identity.agentId, state);

        // Emit status_change feed entry when status actually changes
        if (oldAgent && oldAgent.status !== state.status) {
          const feedEntry: FeedEntry = {
            id: `feed-sc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            type: 'status_change',
            agentId: state.identity.agentId,
            timestamp: Date.now(),
            detail: `${state.identity.agentId} → ${state.status}`,
            oldStatus: oldAgent.status,
            newStatus: state.status,
          };
          return {
            agents,
            activityFeed: [...prev.activityFeed.slice(-299), feedEntry],
          };
        }

        return { agents };
      });
    });

    gateway.on('agent.activity', (payload) => {
      const entry = payload as ActivityEntry;

      // Also push tool_call entries to activityFeed
      const isToolCall = entry.action?.startsWith('tool') || entry.action?.includes('call');
      if (isToolCall) {
        const feedEntry: FeedEntry = {
          id: `feed-tc-${entry.id}`,
          type: 'tool_call',
          agentId: entry.agentId,
          timestamp: entry.timestamp,
          detail: entry.detail,
          toolName: entry.action.replace('tool:', '').replace('tool_call:', ''),
          toolArgs: entry.detail,
        };
        set((prev) => ({
          activityLog: [...prev.activityLog.slice(-200), entry],
          activityFeed: [...prev.activityFeed.slice(-299), feedEntry],
        }));
      } else {
        set((prev) => ({
          activityLog: [...prev.activityLog.slice(-200), entry],
        }));
      }
    });

    gateway.on('task.progress', (payload) => {
      const data = payload as { taskId: string; agentId: string; progress: number; detail?: string; title?: string };
      const feedEntry: FeedEntry = {
        id: `feed-tp-${data.taskId}-${Date.now()}`,
        type: 'task_progress',
        agentId: data.agentId,
        timestamp: Date.now(),
        detail: data.detail ?? `Task ${data.taskId} — ${data.progress}%`,
        taskId: data.taskId,
        progress: data.progress,
        taskTitle: data.title,
      };
      set((prev) => {
        const taskProgress = new Map(prev.taskProgress);
        if (data.progress >= 100) {
          taskProgress.delete(data.taskId);
        } else {
          taskProgress.set(data.taskId, feedEntry);
        }
        return {
          activityFeed: [...prev.activityFeed.slice(-299), feedEntry],
          taskProgress,
        };
      });
    });

    gateway.on('coordination.request', (payload) => {
      const data = payload as { fromAgent: string; toAgent: string; taskId?: string; detail?: string };
      const feedEntry: FeedEntry = {
        id: `feed-del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'delegation',
        agentId: data.fromAgent,
        timestamp: Date.now(),
        detail: data.detail ?? `${data.fromAgent} → ${data.toAgent}`,
        fromAgent: data.fromAgent,
        toAgent: data.toAgent,
        taskId: data.taskId,
      };
      set((prev) => ({
        activityFeed: [...prev.activityFeed.slice(-299), feedEntry],
      }));
    });

    gateway.on('coordination.response', (payload) => {
      const data = payload as { fromAgent: string; toAgent: string; taskId?: string; detail?: string };
      const feedEntry: FeedEntry = {
        id: `feed-delr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: 'delegation',
        agentId: data.fromAgent,
        timestamp: Date.now(),
        detail: data.detail ?? `${data.fromAgent} responded to ${data.toAgent}`,
        fromAgent: data.fromAgent,
        toAgent: data.toAgent,
        taskId: data.taskId,
      };
      set((prev) => ({
        activityFeed: [...prev.activityFeed.slice(-299), feedEntry],
      }));
    });

    gateway.on('task.created', (payload) => {
      const task = payload as TaskDef;
      set((prev) => ({ tasks: [...prev.tasks, task] }));
    });

    gateway.on('task.completed', (payload) => {
      const result = payload as { taskId: string };
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.id === result.taskId ? { ...t, status: 'completed' } : t
        ),
      }));
    });

    gateway.on('task.cancelled', (payload) => {
      const result = payload as { taskId: string };
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.id === result.taskId ? { ...t, status: 'cancelled', assignedAgent: null } : t
        ),
      }));
    });

    gateway.on('task.assigned', (payload) => {
      const result = payload as { taskId: string; agentId: string };
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.id === result.taskId ? { ...t, status: 'assigned', assignedAgent: result.agentId } : t
        ),
      }));
    });

    gateway.on('task.failed', (payload) => {
      const result = payload as { taskId: string };
      set((prev) => ({
        tasks: prev.tasks.map((t) =>
          t.id === result.taskId ? { ...t, status: 'failed' } : t
        ),
      }));
    });

    gateway.on('chat.message', (payload) => {
      const msg = payload as ChatMessage;
      set((prev) => ({
        chatMessages: [...prev.chatMessages.slice(-500), msg],
      }));
    });

    gateway.on('system.health', (payload) => {
      set({ health: payload as HealthInfo });
    });

    gateway.on('log.line', (payload) => {
      const line = payload as { agentId: string; line: string; timestamp: number };
      set((prev) => ({
        consoleLines: [...prev.consoleLines.slice(-1000), line],
      }));
    });
  },

  sendChat: (to: string, content: string) => {
    void gateway.request('chat.send', {
      from: 'user',
      to,
      content,
      timestamp: Date.now(),
    });
  },

  createTask: (task: Partial<TaskDef>) => {
    void gateway.request('tasks.create', {
      ...task,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
}));
