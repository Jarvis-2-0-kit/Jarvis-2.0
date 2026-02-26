import {
  type AgentState,
  type AgentCapabilities,
  type TaskDefinition,
  type TaskResult,
  RedisKeys,
  createLogger,
} from '@jarvis/shared';
import type { RedisClient } from './client.js';

const log = createLogger('gateway:state-store');

export class StateStore {
  constructor(private readonly redis: RedisClient) {}

  // --- Agent State ---

  async setAgentState(state: AgentState): Promise<void> {
    const key = RedisKeys.agentStatus(state.identity.agentId);
    await this.redis.setJson(key, state);
  }

  async getAgentState(agentId: string): Promise<AgentState | null> {
    return this.redis.getJson<AgentState>(RedisKeys.agentStatus(agentId));
  }

  async getAllAgentStates(): Promise<AgentState[]> {
    const states: AgentState[] = [];
    for (const id of ['jarvis', 'agent-smith', 'agent-johny']) {
      const state = await this.getAgentState(id);
      if (state) states.push(state);
    }
    return states;
  }

  async updateHeartbeat(agentId: string): Promise<void> {
    const state = await this.getAgentState(agentId);
    if (state) {
      state.lastHeartbeat = Date.now();
      await this.setAgentState(state);
    }
  }

  // --- Agent Capabilities ---

  async setCapabilities(caps: AgentCapabilities): Promise<void> {
    const key = RedisKeys.agentCapabilities(caps.agentId);
    await this.redis.setJson(key, caps);
  }

  async getCapabilities(agentId: string): Promise<AgentCapabilities | null> {
    return this.redis.getJson<AgentCapabilities>(RedisKeys.agentCapabilities(agentId));
  }

  // --- Tasks ---

  async createTask(task: TaskDefinition): Promise<void> {
    const key = RedisKeys.task(task.id);
    await this.redis.setJson(key, task);

    // Add to priority queue
    const queueKey = RedisKeys.taskQueue(task.priority);
    await this.redis.zadd(queueKey, task.createdAt, task.id);
    log.info(`Task created: ${task.id}`, { title: task.title, priority: task.priority });
  }

  async getTask(taskId: string): Promise<TaskDefinition | null> {
    return this.redis.getJson<TaskDefinition>(RedisKeys.task(taskId));
  }

  async updateTask(taskId: string, updates: Partial<TaskDefinition>): Promise<void> {
    const task = await this.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);

    const updated = { ...task, ...updates, updatedAt: Date.now() };
    await this.redis.setJson(RedisKeys.task(taskId), updated);
  }

  async getTasksByPriority(priority: string, limit = 50): Promise<string[]> {
    return this.redis.zrange(RedisKeys.taskQueue(priority), 0, limit - 1);
  }

  async getPendingTasks(limit = 50): Promise<TaskDefinition[]> {
    const tasks: TaskDefinition[] = [];
    for (const priority of ['critical', 'high', 'normal', 'low']) {
      const ids = await this.getTasksByPriority(priority, limit - tasks.length);
      for (const id of ids) {
        const task = await this.getTask(id);
        if (task && (task.assignedAgent === null || task.assignedAgent === undefined)) {
          tasks.push(task);
        }
      }
      if (tasks.length >= limit) break;
    }
    return tasks;
  }

  async getAllTasks(limit = 100): Promise<TaskDefinition[]> {
    const tasks: TaskDefinition[] = [];
    const seen = new Set<string>();
    for (const priority of ['critical', 'high', 'normal', 'low']) {
      const ids = await this.getTasksByPriority(priority, limit);
      for (const id of ids) {
        if (seen.has(id)) continue;
        seen.add(id);
        const task = await this.getTask(id);
        if (task) tasks.push(task);
      }
      if (tasks.length >= limit) break;
    }
    return tasks;
  }

  async setTaskResult(result: TaskResult): Promise<void> {
    const key = `${RedisKeys.task(result.taskId)}:result`;
    await this.redis.setJson(key, result);

    // Remove from queue
    for (const priority of ['critical', 'high', 'normal', 'low']) {
      await this.redis.zrem(RedisKeys.taskQueue(priority), result.taskId);
    }
  }

  async getTaskResult(taskId: string): Promise<TaskResult | null> {
    return this.redis.getJson<TaskResult>(`${RedisKeys.task(taskId)}:result`);
  }
}
