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
  assignedAgent: string | null;
  status?: string;
}

interface ActivityEntry {
  id: string;
  agentId: string;
  action: string;
  detail: string;
  timestamp: number;
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
  health: HealthInfo | null;
  consoleLines: Array<{ agentId: string; line: string; timestamp: number }>;

  // Actions
  init: () => void;
  sendChat: (to: string, content: string) => void;
  createTask: (task: Partial<TaskDef>) => void;
}

export const useGatewayStore = create<GatewayStore>((set) => ({
  connected: false,
  agents: new Map(),
  tasks: [],
  chatMessages: [],
  activityLog: [],
  health: null,
  consoleLines: [],

  init: () => {
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
        agents.set(state.identity.agentId, state);
        return { agents };
      });
    });

    gateway.on('agent.activity', (payload) => {
      const entry = payload as ActivityEntry;
      set((prev) => ({
        activityLog: [...prev.activityLog.slice(-200), entry],
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
