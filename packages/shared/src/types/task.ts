import { z } from 'zod';

export const TaskPriority = z.enum(['low', 'normal', 'high', 'critical']);
export type TaskPriority = z.infer<typeof TaskPriority>;

export const TaskStatus = z.enum([
  'pending',
  'queued',
  'assigned',
  'in-progress',
  'completed',
  'failed',
  'cancelled',
]);
export type TaskStatus = z.infer<typeof TaskStatus>;

export const TaskDefinition = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  priority: TaskPriority.default('normal'),
  status: TaskStatus.default('pending'),
  requiredCapabilities: z.array(z.string()),
  assignedAgent: z.string().nullable().default(null),
  parentTaskId: z.string().nullable().default(null),
  subtaskIds: z.array(z.string()).default([]),
  createdAt: z.number(),
  updatedAt: z.number(),
  deadline: z.number().optional(),
  metadata: z.record(z.unknown()).default({}),
});
export type TaskDefinition = z.infer<typeof TaskDefinition>;

export const TaskResult = z.object({
  taskId: z.string(),
  agentId: z.string(),
  status: z.enum(['completed', 'failed']),
  output: z.string(),
  artifacts: z.array(z.string()).default([]),
  startedAt: z.number(),
  completedAt: z.number(),
  tokenUsage: z.object({
    inputTokens: z.number(),
    outputTokens: z.number(),
    cost: z.number(),
  }).optional(),
  error: z.string().optional(),
});
export type TaskResult = z.infer<typeof TaskResult>;

export const TaskProgress = z.object({
  taskId: z.string(),
  agentId: z.string(),
  status: TaskStatus,
  progress: z.number().min(0).max(100).optional(),
  currentStep: z.string().optional(),
  logs: z.array(z.string()).default([]),
  timestamp: z.number(),
});
export type TaskProgress = z.infer<typeof TaskProgress>;
