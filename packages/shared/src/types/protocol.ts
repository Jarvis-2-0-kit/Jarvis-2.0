import { z } from 'zod';

/**
 * WebSocket protocol frames between Dashboard <-> Gateway
 * Inspired by OpenClaw's gateway protocol (src/gateway/protocol/schema.ts)
 */

export const RequestFrame = z.object({
  type: z.literal('req'),
  id: z.string(),
  method: z.string(),
  params: z.unknown().optional(),
});
export type RequestFrame = z.infer<typeof RequestFrame>;

export const ResponseFrame = z.object({
  type: z.literal('res'),
  id: z.string(),
  result: z.unknown().optional(),
  error: z.object({
    code: z.number(),
    message: z.string(),
    details: z.unknown().optional(),
  }).optional(),
});
export type ResponseFrame = z.infer<typeof ResponseFrame>;

export const EventFrame = z.object({
  type: z.literal('event'),
  event: z.string(),
  payload: z.unknown(),
});
export type EventFrame = z.infer<typeof EventFrame>;

export const Frame = z.discriminatedUnion('type', [
  RequestFrame,
  ResponseFrame,
  EventFrame,
]);
export type Frame = z.infer<typeof Frame>;

/** Gateway method names */
export const GatewayMethod = z.enum([
  // Health
  'health',
  'health.detailed',

  // Agents
  'agents.list',
  'agents.status',
  'agents.capabilities',

  // Tasks
  'tasks.list',
  'tasks.create',
  'tasks.cancel',
  'tasks.status',

  // Sessions
  'sessions.list',
  'sessions.preview',

  // Chat
  'chat.send',
  'chat.history',

  // VNC
  'vnc.info',

  // Logs
  'logs.tail',
  'logs.stop',

  // Config
  'config.get',
  'config.set',

  // Metrics
  'metrics.usage',
  'metrics.costs',
]);
export type GatewayMethod = z.infer<typeof GatewayMethod>;

/** Event names emitted by Gateway to Dashboard */
export const GatewayEvent = z.enum([
  'agent.status',
  'agent.activity',
  'agent.heartbeat',
  'task.created',
  'task.assigned',
  'task.progress',
  'task.completed',
  'task.failed',
  'chat.message',
  'system.health',
  'system.error',
  'log.line',
  'metrics.update',
]);
export type GatewayEvent = z.infer<typeof GatewayEvent>;

/** Standard error codes */
export const ErrorCode = {
  INVALID_REQUEST: 400,
  UNAUTHORIZED: 401,
  NOT_FOUND: 404,
  METHOD_NOT_FOUND: 405,
  INTERNAL_ERROR: 500,
  AGENT_UNAVAILABLE: 503,
  TIMEOUT: 504,
} as const;
