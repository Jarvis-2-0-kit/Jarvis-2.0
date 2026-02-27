/**
 * Task Planner Plugin — OpenClaw-inspired sub-agent spawning and multi-step planning.
 *
 * Gives agents the ability to:
 * - Decompose complex tasks into sub-steps
 * - Delegate work to other agents via NATS
 * - Track sub-task progress and dependencies
 * - Report structured progress on multi-step work
 *
 * Modeled after OpenClaw's sessions_spawn / subagent-registry patterns:
 * - Non-blocking delegation (fire-and-forget with result announcement)
 * - Depth-limited nesting (max 2 levels)
 * - Dependency tracking via parent-child relationships
 * - Concurrency limits to prevent runaway spawning
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────

interface PlanStep {
  id: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed' | 'blocked' | 'delegated';
  dependencies: string[];
  assignedAgent?: string;
  result?: string;
  error?: string;
  startedAt?: number;
  completedAt?: number;
  delegatedTaskId?: string;
}

interface ExecutionPlan {
  planId: string;
  parentTaskId?: string;
  title: string;
  description: string;
  strategy: string;
  steps: PlanStep[];
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'failed' | 'paused';
}

interface DelegatedTask {
  taskId: string;
  planId: string;
  stepId: string;
  targetAgent: string;
  title: string;
  description: string;
  status: 'pending' | 'in_progress' | 'completed' | 'failed';
  result?: string;
  sentAt: number;
  completedAt?: number;
}

// ─── Plugin ───────────────────────────────────────────────────────────

const MAX_ACTIVE_PLANS = 50;
const MAX_DELEGATED_TASKS = 100;

export function createTaskPlannerPlugin(): JarvisPluginDefinition {
  // In-memory state (per session)
  const activePlans = new Map<string, ExecutionPlan>();
  const delegatedTasks = new Map<string, DelegatedTask>();

  return {
    id: 'jarvis-task-planner',
    name: 'Task Planner & Delegation',
    description: 'Multi-step planning, sub-task delegation, and dependency tracking',
    version: '1.0.0',

    register: (api) => {
      const log = api.logger;
      const nasPath = api.config.nasPath;
      const plansDir = join(nasPath, 'plans');

      // Ensure plans directory
      if (!existsSync(plansDir)) {
        mkdirSync(plansDir, { recursive: true });
      }

      // ─── Tool: create_plan ─────────────────────────────────────────

      api.registerTool({
        definition: {
          name: 'create_plan',
          description: [
            'Create a structured execution plan for a complex task.',
            'Breaks down a task into ordered steps with dependencies.',
            'Each step can later be executed locally or delegated to another agent.',
            '',
            'Use this tool when:',
            '- A task has multiple distinct phases',
            '- Work needs to be parallelized across agents',
            '- Dependencies between steps need to be tracked',
            '- You need a clear progress trail',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Plan title (brief summary)',
              },
              description: {
                type: 'string',
                description: 'Full description of what this plan accomplishes',
              },
              strategy: {
                type: 'string',
                description: 'High-level strategy (e.g., "research → design → implement → test")',
              },
              steps: {
                type: 'array',
                description: 'Ordered list of steps',
                items: {
                  type: 'object',
                  properties: {
                    id: {
                      type: 'string',
                      description: 'Unique step ID (e.g., "step-1", "research", "deploy")',
                    },
                    title: {
                      type: 'string',
                      description: 'Step title',
                    },
                    description: {
                      type: 'string',
                      description: 'What this step involves',
                    },
                    dependencies: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'IDs of steps that must complete before this one',
                    },
                    assignedAgent: {
                      type: 'string',
                      description: 'Agent to delegate to (e.g., "agent-smith", "agent-johny"). Leave empty for self.',
                    },
                  },
                  required: ['id', 'title', 'description'],
                },
              },
              parentTaskId: {
                type: 'string',
                description: 'Parent task ID if this plan is for a specific task',
              },
            },
            required: ['title', 'strategy', 'steps'],
          },
        },
        execute: async (params) => {
          const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
          const steps: PlanStep[] = (params.steps as Array<Record<string, unknown>>).map((s) => ({
            id: (s.id as string) || `step-${Math.random().toString(36).slice(2, 8)}`,
            title: s.title as string,
            description: s.description as string,
            status: 'pending' as const,
            dependencies: (s.dependencies as string[]) ?? [],
            assignedAgent: s.assignedAgent as string | undefined,
          }));

          const plan: ExecutionPlan = {
            planId,
            parentTaskId: params.parentTaskId as string | undefined,
            title: params.title as string,
            description: (params.description as string) || '',
            strategy: params.strategy as string,
            steps,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            status: 'active',
          };

          activePlans.set(planId, plan);
          if (activePlans.size > MAX_ACTIVE_PLANS) {
            const firstKey = activePlans.keys().next().value;
            if (firstKey) activePlans.delete(firstKey);
          }
          savePlan(plansDir, plan);

          log.info(`[task-planner] Created plan ${planId}: ${plan.title} (${steps.length} steps)`);

          // Build visual representation
          const visual = buildPlanVisual(plan);

          return {
            type: 'text',
            content: `Plan created: ${planId}\n\n${visual}\n\nUse \`update_plan_step\` to mark steps in_progress/completed as you work through them.\nUse \`delegate_to_agent\` to send steps to other agents.`,
          };
        },
      });

      // ─── Tool: update_plan_step ────────────────────────────────────

      api.registerTool({
        definition: {
          name: 'update_plan_step',
          description: [
            'Update the status of a step in an active execution plan.',
            'Use this to mark steps as in_progress, completed, or failed.',
            'Automatically checks if dependent steps are now unblocked.',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {
              planId: {
                type: 'string',
                description: 'The plan ID',
              },
              stepId: {
                type: 'string',
                description: 'The step ID to update',
              },
              status: {
                type: 'string',
                enum: ['in_progress', 'completed', 'failed', 'blocked'],
                description: 'New status for the step',
              },
              result: {
                type: 'string',
                description: 'Result or output from completing this step',
              },
              error: {
                type: 'string',
                description: 'Error message if the step failed',
              },
            },
            required: ['planId', 'stepId', 'status'],
          },
        },
        execute: async (params) => {
          const planId = params.planId as string;
          if (!/^[\w-]+$/.test(planId)) {
            return { type: 'error' as const, content: 'Invalid plan ID' };
          }

          const plan = activePlans.get(planId);
          if (!plan) {
            return { type: 'error', content: `Plan not found: ${planId}` };
          }

          const step = plan.steps.find((s) => s.id === params.stepId);
          if (!step) {
            return { type: 'error', content: `Step not found: ${params.stepId} in plan ${planId}` };
          }

          step.status = params.status as PlanStep['status'];
          if (params.result) step.result = params.result as string;
          if (params.error) step.error = params.error as string;

          if (params.status === 'in_progress') {
            step.startedAt = Date.now();
          }
          if (params.status === 'completed' || params.status === 'failed') {
            step.completedAt = Date.now();
          }

          plan.updatedAt = Date.now();

          // Check if all steps completed
          const allCompleted = plan.steps.every((s) => s.status === 'completed');
          const anyFailed = plan.steps.some((s) => s.status === 'failed');
          if (allCompleted) plan.status = 'completed';
          else if (anyFailed) plan.status = 'failed';

          savePlan(plansDir, plan);

          // Find newly unblocked steps
          const readySteps = findReadySteps(plan);

          log.info(`[task-planner] Step ${params.stepId} → ${params.status} in plan ${planId}`);

          const visual = buildPlanVisual(plan);
          let response = `Step "${step.title}" updated to ${params.status}.\n\n${visual}`;

          if (readySteps.length > 0) {
            response += `\n\n🟢 Ready steps (dependencies met):\n`;
            for (const rs of readySteps) {
              response += `  - ${rs.id}: ${rs.title}`;
              if (rs.assignedAgent) response += ` → delegate to ${rs.assignedAgent}`;
              response += '\n';
            }
          }

          if (plan.status === 'completed') {
            response += '\n\n✅ All steps completed! Plan finished.';
          }

          return { type: 'text', content: response };
        },
      });

      // ─── Tool: get_plan ────────────────────────────────────────────

      api.registerTool({
        definition: {
          name: 'get_plan',
          description: 'Get the current status of an execution plan with all step statuses.',
          input_schema: {
            type: 'object',
            properties: {
              planId: {
                type: 'string',
                description: 'The plan ID. If omitted, shows the most recent active plan.',
              },
            },
          },
        },
        execute: async (params) => {
          if (params.planId && !/^[\w-]+$/.test(params.planId as string)) {
            return { type: 'error' as const, content: 'Invalid plan ID' };
          }

          let plan: ExecutionPlan | undefined;

          if (params.planId) {
            plan = activePlans.get(params.planId as string);
          } else {
            // Get most recent active plan
            const plans = Array.from(activePlans.values())
              .filter((p) => p.status === 'active')
              .sort((a, b) => b.updatedAt - a.updatedAt);
            plan = plans[0];
          }

          if (!plan) {
            // Try loading from disk
            if (params.planId) {
              plan = loadPlan(plansDir, params.planId as string);
            }
          }

          if (!plan) {
            return { type: 'text', content: 'No active plans found. Use create_plan to start one.' };
          }

          const visual = buildPlanVisual(plan);
          const readySteps = findReadySteps(plan);

          let response = visual;
          if (readySteps.length > 0) {
            response += `\n\n🟢 Ready to execute:\n`;
            for (const rs of readySteps) {
              response += `  - ${rs.id}: ${rs.title}\n`;
            }
          }

          return { type: 'text', content: response };
        },
      });

      // ─── Tool: delegate_to_agent ───────────────────────────────────

      api.registerTool({
        definition: {
          name: 'delegate_to_agent',
          description: [
            'Delegate a task or plan step to another agent in the Jarvis system.',
            'The task is sent via NATS and the target agent will execute it independently.',
            'Results are announced back automatically.',
            '',
            'Agents:',
            '  - agent-smith (Dev): code, build, deploy, testing, react-native',
            '  - agent-johny (Marketing): research, content, social-media, analytics',
            '',
            'NOTE: This is non-blocking — the target agent works independently.',
            'Use check_delegated_task to check on results later.',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {
              targetAgent: {
                type: 'string',
                enum: ['jarvis', 'agent-smith', 'agent-johny'],
                description: 'Target agent to delegate to',
              },
              title: {
                type: 'string',
                description: 'Task title for the target agent',
              },
              description: {
                type: 'string',
                description: 'Detailed task description. Include all context the target agent needs.',
              },
              priority: {
                type: 'string',
                enum: ['low', 'normal', 'high', 'critical'],
                description: 'Task priority',
              },
              planId: {
                type: 'string',
                description: 'If delegating a plan step, the plan ID',
              },
              stepId: {
                type: 'string',
                description: 'If delegating a plan step, the step ID',
              },
            },
            required: ['targetAgent', 'title', 'description'],
          },
        },
        execute: async (params, context) => {
          const targetAgent = params.targetAgent as string;
          const myAgent = context?.agentId ?? api.config.agentId;

          // Prevent self-delegation
          if (targetAgent === myAgent) {
            return { type: 'error', content: 'Cannot delegate to yourself. Execute the task directly.' };
          }

          const taskId = `delegated-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          const delegation: DelegatedTask = {
            taskId,
            planId: (params.planId as string) || '',
            stepId: (params.stepId as string) || '',
            targetAgent,
            title: params.title as string,
            description: params.description as string,
            status: 'pending',
            sentAt: Date.now(),
          };

          delegatedTasks.set(taskId, delegation);
          if (delegatedTasks.size > MAX_DELEGATED_TASKS) {
            const firstKey = delegatedTasks.keys().next().value;
            if (firstKey) delegatedTasks.delete(firstKey);
          }

          // Save delegation record to NAS
          const delegationsFile = join(nasPath, 'plans', 'delegations.jsonl');
          appendFileSync(delegationsFile, JSON.stringify(delegation) + '\n');

          // If part of a plan, update the step status
          if (params.planId && params.stepId) {
            const plan = activePlans.get(params.planId as string);
            if (plan) {
              const step = plan.steps.find((s) => s.id === params.stepId);
              if (step) {
                step.status = 'delegated';
                step.assignedAgent = targetAgent;
                step.delegatedTaskId = taskId;
                plan.updatedAt = Date.now();
                savePlan(plansDir, plan);
              }
            }
          }

          // Delegate via NATS if available, otherwise fall back to file-based delegation
          if (api.config.delegateTask) {
            await api.config.delegateTask(targetAgent, {
              taskId,
              title: params.title as string,
              description: params.description as string,
              priority: (params.priority as string) || 'normal',
            });
            log.info(`[task-planner] Delegation sent via NATS to ${targetAgent}`);
          } else {
            // Fallback: store delegation request as file for the runner to pick up
            const delegationFile = join(nasPath, 'plans', `delegation-${taskId}.json`);
            writeFileSync(delegationFile, JSON.stringify({
              taskId,
              targetAgent,
              title: params.title as string,
              description: params.description as string,
              priority: (params.priority as string) || 'normal',
              sourceAgent: myAgent,
              planId: params.planId || null,
              stepId: params.stepId || null,
              createdAt: Date.now(),
            }, null, 2));
            log.info(`[task-planner] Delegation saved to file (NATS not available)`);
          }

          log.info(
            `[task-planner] Delegated "${params.title}" to ${targetAgent} (taskId: ${taskId})`,
          );

          return {
            type: 'text',
            content: [
              `✅ Task delegated to ${targetAgent}`,
              `Task ID: ${taskId}`,
              `Title: ${params.title}`,
              `Priority: ${(params.priority as string) || 'normal'}`,
              '',
              'The delegation request has been saved. The gateway will route it to the target agent.',
              'Use `check_delegated_task` with this task ID to check results later.',
            ].join('\n'),
          };
        },
      });

      // ─── Tool: check_delegated_task ────────────────────────────────

      api.registerTool({
        definition: {
          name: 'check_delegated_task',
          description: 'Check the status and result of a task delegated to another agent.',
          input_schema: {
            type: 'object',
            properties: {
              taskId: {
                type: 'string',
                description: 'The delegated task ID. If omitted, lists all delegated tasks.',
              },
            },
          },
        },
        execute: async (params) => {
          if (!params.taskId) {
            // List all delegated tasks
            const tasks = Array.from(delegatedTasks.values());
            if (tasks.length === 0) {
              return { type: 'text', content: 'No delegated tasks found.' };
            }

            const lines = tasks.map((t) => {
              const elapsed = Date.now() - t.sentAt;
              const elapsedStr = elapsed < 60000
                ? `${Math.round(elapsed / 1000)}s ago`
                : `${Math.round(elapsed / 60000)}m ago`;
              return `  [${t.status}] ${t.taskId}: "${t.title}" → ${t.targetAgent} (${elapsedStr})`;
            });

            return { type: 'text', content: `Delegated tasks:\n${lines.join('\n')}` };
          }

          const task = delegatedTasks.get(params.taskId as string);

          // Check NAS result file (written by the target agent on completion)
          const resultFile = join(nasPath, 'plans', `result-${params.taskId}.json`);
          if (existsSync(resultFile)) {
            try {
              const result = JSON.parse(readFileSync(resultFile, 'utf-8'));
              // Update in-memory state if we have it
              if (task) {
                task.status = result.status ?? 'completed';
                task.result = result.output;
              }
              return {
                type: 'text',
                content: [
                  `Task: ${result.title ?? task?.title ?? params.taskId}`,
                  `Status: ${result.status ?? 'completed'}`,
                  `Agent: ${result.agentId ?? task?.targetAgent ?? 'unknown'}`,
                  `Result: ${result.output ?? '(no output)'}`,
                ].join('\n'),
              };
            } catch { /* ignore parse errors, fall through */ }
          }

          if (!task) {
            return { type: 'error', content: `Delegated task not found: ${params.taskId}` };
          }

          const elapsed = Date.now() - task.sentAt;
          const elapsedStr = elapsed < 60000
            ? `${Math.round(elapsed / 1000)}s`
            : `${Math.round(elapsed / 60000)}m`;

          return {
            type: 'text',
            content: [
              `Task: ${task.title}`,
              `ID: ${task.taskId}`,
              `Target: ${task.targetAgent}`,
              `Status: ${task.status}`,
              `Sent: ${elapsedStr} ago`,
              task.result ? `Result: ${task.result}` : '',
            ].filter(Boolean).join('\n'),
          };
        },
      });

      // ─── Tool: list_plans ──────────────────────────────────────────

      api.registerTool({
        definition: {
          name: 'list_plans',
          description: 'List all execution plans (active, completed, and failed).',
          input_schema: {
            type: 'object',
            properties: {
              status: {
                type: 'string',
                enum: ['active', 'completed', 'failed', 'all'],
                description: 'Filter by plan status. Defaults to "active".',
              },
            },
          },
        },
        execute: async (params) => {
          const filter = (params.status as string) || 'active';
          const plans = Array.from(activePlans.values())
            .filter((p) => filter === 'all' || p.status === filter)
            .sort((a, b) => b.updatedAt - a.updatedAt);

          if (plans.length === 0) {
            return { type: 'text', content: `No ${filter} plans found.` };
          }

          const lines = plans.map((p) => {
            const completedSteps = p.steps.filter((s) => s.status === 'completed').length;
            const totalSteps = p.steps.length;
            const progress = totalSteps > 0 ? Math.round((completedSteps / totalSteps) * 100) : 0;
            return `  [${p.status}] ${p.planId}: "${p.title}" (${completedSteps}/${totalSteps} steps, ${progress}%)`;
          });

          return { type: 'text', content: `Plans (${filter}):\n${lines.join('\n')}` };
        },
      });

      // ─── Prompt Section ────────────────────────────────────────────

      api.registerPromptSection({
        title: 'Task Planning & Delegation',
        priority: 8,
        content: [
          '### Multi-Step Task Planning',
          '',
          'For complex tasks with multiple phases, use the planning tools:',
          '',
          '1. **create_plan** — Break a complex task into ordered steps with dependencies',
          '2. **update_plan_step** — Track progress as you work through steps',
          '3. **get_plan** — Review current plan status and find ready steps',
          '4. **delegate_to_agent** — Send a step to another agent (non-blocking)',
          '5. **check_delegated_task** — Check on delegated work',
          '6. **list_plans** — See all active/completed plans',
          '',
          '### When to Plan:',
          '- Tasks with 3+ distinct phases',
          '- Work that spans both dev and marketing agents',
          '- Tasks with clear dependencies (research before implementation)',
          '- Long-running work where progress tracking matters',
          '',
          '### Delegation Best Practices:',
          '- Provide complete context in the description (target agent wakes up fresh)',
          '- Delegate research to agent-johny, code/build to agent-smith',
          '- Check delegated task results before proceeding with dependent steps',
          '- Keep plan steps granular — one clear outcome per step',
          '',
          '### Example Plan Structure:',
          '```',
          'Step 1: Research (agent-johny) → deps: []',
          'Step 2: Architecture (agent-smith) → deps: [step-1]',
          'Step 3: Implementation (agent-smith) → deps: [step-2]',
          'Step 4: Marketing prep (agent-johny) → deps: [step-1]  ← parallel!',
          'Step 5: Testing (agent-smith) → deps: [step-3]',
          'Step 6: Launch (both) → deps: [step-4, step-5]',
          '```',
        ].join('\n'),
      });

      // ─── Hooks ─────────────────────────────────────────────────────

      // On task_assigned: check if there's a matching plan to resume
      api.on('task_assigned', async (event) => {
        log.info(`[task-planner] Task assigned: ${event.taskId} — checking for existing plans`);
      });

      // On task_completed: check if this completes any delegated tasks
      api.on('task_completed', async (event) => {
        // Update any delegation records that match this task
        for (const [, delegation] of delegatedTasks) {
          if (delegation.taskId === event.taskId) {
            delegation.status = 'completed';
            delegation.result = event.output;
            delegation.completedAt = Date.now();

            // If linked to a plan step, update the plan
            if (delegation.planId && delegation.stepId) {
              const plan = activePlans.get(delegation.planId);
              if (plan) {
                const step = plan.steps.find((s) => s.id === delegation.stepId);
                if (step) {
                  step.status = 'completed';
                  step.result = event.output;
                  step.completedAt = Date.now();
                  plan.updatedAt = Date.now();
                  savePlan(plansDir, plan);
                }
              }
            }

            log.info(`[task-planner] Delegated task completed: ${delegation.taskId}`);
          }
        }
      });

      // On task_failed: update delegation status
      api.on('task_failed', async (event) => {
        for (const [, delegation] of delegatedTasks) {
          if (delegation.taskId === event.taskId) {
            delegation.status = 'failed';
            delegation.result = event.error;
            delegation.completedAt = Date.now();

            if (delegation.planId && delegation.stepId) {
              const plan = activePlans.get(delegation.planId);
              if (plan) {
                const step = plan.steps.find((s) => s.id === delegation.stepId);
                if (step) {
                  step.status = 'failed';
                  step.error = event.error;
                  step.completedAt = Date.now();
                  plan.updatedAt = Date.now();
                  savePlan(plansDir, plan);
                }
              }
            }

            log.info(`[task-planner] Delegated task failed: ${delegation.taskId}`);
          }
        }
      });

      log.info('[task-planner] Task Planner plugin registered with 6 tools + prompt section');
    },
  };
}

// ─── Helper Functions ─────────────────────────────────────────────────

function findReadySteps(plan: ExecutionPlan): PlanStep[] {
  return plan.steps.filter((step) => {
    if (step.status !== 'pending') return false;
    // All dependencies must be completed
    return step.dependencies.every((depId) => {
      const dep = plan.steps.find((s) => s.id === depId);
      return dep?.status === 'completed';
    });
  });
}

function buildPlanVisual(plan: ExecutionPlan): string {
  const statusIcons: Record<string, string> = {
    pending: '⬜',
    in_progress: '🔵',
    completed: '✅',
    failed: '❌',
    blocked: '🚫',
    delegated: '📤',
  };

  const completedCount = plan.steps.filter((s) => s.status === 'completed').length;
  const totalCount = plan.steps.length;
  const progress = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Progress bar
  const barLen = 20;
  const filled = Math.round((progress / 100) * barLen);
  const bar = '█'.repeat(filled) + '░'.repeat(barLen - filled);

  const lines = [
    `📋 Plan: ${plan.title} [${plan.status}]`,
    `   Strategy: ${plan.strategy}`,
    `   Progress: [${bar}] ${progress}% (${completedCount}/${totalCount})`,
    `   ID: ${plan.planId}`,
    '',
    '   Steps:',
  ];

  for (const step of plan.steps) {
    const icon = statusIcons[step.status] ?? '?';
    const deps = step.dependencies.length > 0
      ? ` (deps: ${step.dependencies.join(', ')})`
      : '';
    const agent = step.assignedAgent ? ` → ${step.assignedAgent}` : '';
    const elapsed = step.startedAt && step.completedAt
      ? ` [${Math.round((step.completedAt - step.startedAt) / 1000)}s]`
      : step.startedAt
        ? ` [running ${Math.round((Date.now() - step.startedAt) / 1000)}s]`
        : '';

    lines.push(`   ${icon} ${step.id}: ${step.title}${deps}${agent}${elapsed}`);

    if (step.result && step.status === 'completed') {
      const shortResult = step.result.length > 100
        ? step.result.slice(0, 100) + '...'
        : step.result;
      lines.push(`      └─ ${shortResult}`);
    }
    if (step.error) {
      lines.push(`      └─ Error: ${step.error}`);
    }
  }

  return lines.join('\n');
}

function savePlan(plansDir: string, plan: ExecutionPlan): void {
  if (!/^[\w-]+$/.test(plan.planId)) {
    return;
  }
  const planFile = join(plansDir, `${plan.planId}.json`);
  writeFileSync(planFile, JSON.stringify(plan, null, 2));
}

function loadPlan(plansDir: string, planId: string): ExecutionPlan | undefined {
  if (!/^[\w-]+$/.test(planId)) {
    return undefined;
  }
  const planFile = join(plansDir, `${planId}.json`);
  if (existsSync(planFile)) {
    return JSON.parse(readFileSync(planFile, 'utf-8'));
  }
  return undefined;
}
