/**
 * Dependency Orchestrator — Manages task DAGs with dependency resolution.
 *
 * Inspired by OpenClaw's subagent-registry + Lobster workflow patterns:
 * - Tracks parent-child task relationships
 * - Resolves dependencies before dispatching
 * - Handles delegation requests from agents
 * - Manages concurrency limits per agent
 * - Announces results back to requesting agents
 *
 * Works alongside the existing TaskDecomposer for initial decomposition,
 * but adds runtime orchestration of the resulting task graph.
 */

import { createLogger, type AgentId } from '@jarvis/shared';
import { existsSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const log = createLogger('orchestration:deps');

// ─── Types ────────────────────────────────────────────────────────────

export interface TaskNode {
  taskId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'critical';
  status: 'pending' | 'ready' | 'assigned' | 'in-progress' | 'completed' | 'failed';
  assignedAgent?: string;
  preferredAgent?: string;
  sourceAgent?: string;      // Agent that requested this delegation
  dependencies: string[];     // taskIds that must complete first
  dependents: string[];       // taskIds waiting on this task
  planId?: string;            // Linked execution plan
  stepId?: string;            // Linked plan step
  result?: string;
  error?: string;
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskGraph {
  nodes: Map<string, TaskNode>;
  /** Pending delegation requests from agents (file-based pickup) */
  pendingDelegations: DelegationRequest[];
}

export interface DelegationRequest {
  taskId: string;
  targetAgent: string;
  title: string;
  description: string;
  priority: string;
  sourceAgent: string;
  planId?: string;
  stepId?: string;
  createdAt: number;
}

export interface OrchestratorConfig {
  nasPath: string;
  maxConcurrentPerAgent: number;
  maxTotalConcurrent: number;
  maxDepth: number;
}

// ─── Orchestrator ─────────────────────────────────────────────────────

export class DependencyOrchestrator {
  private graph: TaskGraph;
  private config: OrchestratorConfig;
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private dispatchCallback: ((agentId: string, task: TaskNode) => Promise<void>) | null = null;
  private announceCallback: ((sourceAgent: string, taskId: string, result: string, success: boolean) => Promise<void>) | null = null;

  constructor(config: OrchestratorConfig) {
    this.config = config;
    this.graph = {
      nodes: new Map(),
      pendingDelegations: [],
    };
  }

  /** Set the callback for dispatching tasks to agents */
  onDispatch(callback: (agentId: string, task: TaskNode) => Promise<void>): void {
    this.dispatchCallback = callback;
  }

  /** Set the callback for announcing results back to source agents */
  onAnnounce(callback: (sourceAgent: string, taskId: string, result: string, success: boolean) => Promise<void>): void {
    this.announceCallback = callback;
  }

  /** Start the orchestrator polling loop */
  start(): void {
    log.info('Dependency orchestrator started');

    // Poll for delegation requests every 5 seconds
    this.pollInterval = setInterval(() => {
      this.pollDelegations();
      this.processReadyTasks();
    }, 5000);

    // Initial poll
    this.pollDelegations();
  }

  /** Stop the orchestrator */
  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    log.info('Dependency orchestrator stopped');
  }

  // ─── Task Graph Management ──────────────────────────────────────────

  /** Add a task to the dependency graph */
  addTask(task: TaskNode): void {
    this.graph.nodes.set(task.taskId, task);

    // Set up dependency relationships
    for (const depId of task.dependencies) {
      const depNode = this.graph.nodes.get(depId);
      if (depNode) {
        if (!depNode.dependents.includes(task.taskId)) {
          depNode.dependents.push(task.taskId);
        }
      }
    }

    // Check if immediately ready
    if (this.isDependenciesMet(task)) {
      task.status = 'ready';
    }

    log.info(`Task added to graph: ${task.taskId} (deps: ${task.dependencies.join(',') || 'none'})`);
  }

  /** Mark a task as completed and cascade to dependents */
  completeTask(taskId: string, result: string): void {
    const node = this.graph.nodes.get(taskId);
    if (!node) {
      log.warn(`Cannot complete unknown task: ${taskId}`);
      return;
    }

    node.status = 'completed';
    node.result = result;
    node.completedAt = Date.now();

    log.info(`Task completed: ${taskId}`);

    // Announce back to source agent if this was a delegation
    if (node.sourceAgent && this.announceCallback) {
      this.announceCallback(node.sourceAgent, taskId, result, true).catch((err) => {
        log.error(`Failed to announce completion to ${node.sourceAgent}: ${(err as Error).message}`);
      });
    }

    // Check if dependents are now ready
    for (const depId of node.dependents) {
      const dependent = this.graph.nodes.get(depId);
      if (dependent && dependent.status === 'pending') {
        if (this.isDependenciesMet(dependent)) {
          dependent.status = 'ready';
          log.info(`Task unblocked: ${depId} (dependencies met)`);
        }
      }
    }

    // Save result for file-based pickup
    this.saveTaskResult(node);
  }

  /** Mark a task as failed */
  failTask(taskId: string, error: string): void {
    const node = this.graph.nodes.get(taskId);
    if (!node) return;

    node.status = 'failed';
    node.error = error;
    node.completedAt = Date.now();

    log.info(`Task failed: ${taskId} — ${error}`);

    // Announce failure to source agent
    if (node.sourceAgent && this.announceCallback) {
      this.announceCallback(node.sourceAgent, taskId, error, false).catch((err) => {
        log.error(`Failed to announce failure to ${node.sourceAgent}: ${(err as Error).message}`);
      });
    }

    // Save result
    this.saveTaskResult(node);
  }

  /** Mark a task as in-progress */
  startTask(taskId: string, agentId: string): void {
    const node = this.graph.nodes.get(taskId);
    if (!node) return;

    node.status = 'in-progress';
    node.assignedAgent = agentId;
    node.startedAt = Date.now();
  }

  // ─── Dependency Resolution ──────────────────────────────────────────

  /** Check if all dependencies of a task are completed */
  private isDependenciesMet(task: TaskNode): boolean {
    if (task.dependencies.length === 0) return true;

    return task.dependencies.every((depId) => {
      const dep = this.graph.nodes.get(depId);
      return dep?.status === 'completed';
    });
  }

  /** Get all tasks that are ready to execute */
  getReadyTasks(): TaskNode[] {
    return Array.from(this.graph.nodes.values())
      .filter((node) => node.status === 'ready');
  }

  /** Get tasks assigned to a specific agent */
  getAgentTasks(agentId: string): TaskNode[] {
    return Array.from(this.graph.nodes.values())
      .filter((node) => node.assignedAgent === agentId && node.status === 'in-progress');
  }

  /** Get the full graph state for debugging/dashboard */
  getGraphState(): {
    totalTasks: number;
    pending: number;
    ready: number;
    inProgress: number;
    completed: number;
    failed: number;
    nodes: TaskNode[];
  } {
    const nodes = Array.from(this.graph.nodes.values());
    return {
      totalTasks: nodes.length,
      pending: nodes.filter((n) => n.status === 'pending').length,
      ready: nodes.filter((n) => n.status === 'ready').length,
      inProgress: nodes.filter((n) => n.status === 'in-progress').length,
      completed: nodes.filter((n) => n.status === 'completed').length,
      failed: nodes.filter((n) => n.status === 'failed').length,
      nodes,
    };
  }

  // ─── Delegation Polling ─────────────────────────────────────────────

  /** Poll NAS for delegation requests from agents */
  private pollDelegations(): void {
    const plansDir = join(this.config.nasPath, 'plans');
    if (!existsSync(plansDir)) return;

    try {
      const files = readdirSync(plansDir).filter((f) => f.startsWith('delegation-') && f.endsWith('.json'));

      for (const file of files) {
        const filePath = join(plansDir, file);
        try {
          const data = JSON.parse(readFileSync(filePath, 'utf-8')) as DelegationRequest;

          // Check if we already have this task
          if (this.graph.nodes.has(data.taskId)) continue;

          log.info(`Picked up delegation request: ${data.taskId} → ${data.targetAgent}`);

          // Create a task node from the delegation
          const taskNode: TaskNode = {
            taskId: data.taskId,
            title: data.title,
            description: data.description,
            priority: data.priority as TaskNode['priority'],
            status: 'ready', // Delegations have no graph dependencies (they come pre-resolved)
            preferredAgent: data.targetAgent,
            sourceAgent: data.sourceAgent,
            dependencies: [],
            dependents: [],
            planId: data.planId,
            stepId: data.stepId,
            createdAt: data.createdAt,
          };

          this.addTask(taskNode);

          // Remove the delegation file (processed)
          unlinkSync(filePath);
          log.info(`Processed delegation file: ${file}`);
        } catch (err) {
          log.error(`Failed to process delegation file ${file}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      log.error(`Failed to poll delegations: ${(err as Error).message}`);
    }
  }

  /** Process ready tasks and dispatch to agents */
  private processReadyTasks(): void {
    const readyTasks = this.getReadyTasks();
    if (readyTasks.length === 0) return;

    // Check global concurrency
    const inProgressCount = Array.from(this.graph.nodes.values())
      .filter((n) => n.status === 'in-progress').length;

    if (inProgressCount >= this.config.maxTotalConcurrent) {
      log.info(`Max concurrent tasks reached (${inProgressCount}/${this.config.maxTotalConcurrent}), waiting...`);
      return;
    }

    // Sort by priority
    const priorityOrder: Record<string, number> = { critical: 4, high: 3, normal: 2, low: 1 };
    readyTasks.sort((a, b) => (priorityOrder[b.priority] ?? 2) - (priorityOrder[a.priority] ?? 2));

    for (const task of readyTasks) {
      // Check per-agent concurrency
      const targetAgent = task.preferredAgent;
      if (targetAgent) {
        const agentInProgress = this.getAgentTasks(targetAgent).length;
        if (agentInProgress >= this.config.maxConcurrentPerAgent) {
          log.info(`Agent ${targetAgent} at max concurrency (${agentInProgress}), skipping task ${task.taskId}`);
          continue;
        }
      }

      // Dispatch
      if (this.dispatchCallback && targetAgent) {
        task.status = 'assigned';
        task.assignedAgent = targetAgent;

        this.dispatchCallback(targetAgent, task).then(() => {
          log.info(`Dispatched task ${task.taskId} to ${targetAgent}`);
        }).catch((err) => {
          log.error(`Failed to dispatch task ${task.taskId}: ${(err as Error).message}`);
          task.status = 'ready'; // Reset to retry
          task.assignedAgent = undefined;
        });
      }
    }
  }

  // ─── File-Based Result Storage ──────────────────────────────────────

  private saveTaskResult(node: TaskNode): void {
    const resultFile = join(this.config.nasPath, 'plans', `result-${node.taskId}.json`);
    writeFileSync(resultFile, JSON.stringify({
      taskId: node.taskId,
      title: node.title,
      status: node.status,
      agentId: node.assignedAgent,
      output: node.result ?? node.error ?? '',
      completedAt: node.completedAt,
      planId: node.planId,
      stepId: node.stepId,
    }, null, 2));
  }
}
