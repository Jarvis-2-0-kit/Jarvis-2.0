import { z } from 'zod';

export const AgentMessageType = z.enum([
  'task',
  'result',
  'query',
  'response',
  'notification',
  'heartbeat',
  'status',
  'chat',
]);
export type AgentMessageType = z.infer<typeof AgentMessageType>;

export const AgentMessage = z.object({
  id: z.string(),
  from: z.string(),
  to: z.string(),
  type: AgentMessageType,
  subject: z.string(),
  payload: z.unknown(),
  correlationId: z.string().optional(),
  timestamp: z.number(),
  priority: z.enum(['low', 'normal', 'high', 'critical']).default('normal'),
});
export type AgentMessage = z.infer<typeof AgentMessage>;

export const ChatMessage = z.object({
  id: z.string(),
  from: z.enum(['user', 'jarvis', 'agent-smith', 'agent-johny', 'system']),
  to: z.enum(['user', 'jarvis', 'agent-smith', 'agent-johny', 'all']),
  content: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** Strip chars dangerous for NATS subjects and Redis keys */
export function sanitizeToken(token: string): string {
  return token.replace(/[.*>\s\r\n\x00-\x1f]/g, '');
}

/** NATS subject helpers */
export const NatsSubjects = Object.freeze({
  agentStatus: (agentId: string) => `jarvis.agent.${sanitizeToken(agentId)}.status`,
  agentTask: (agentId: string) => `jarvis.agent.${sanitizeToken(agentId)}.task`,
  agentResult: (agentId: string) => `jarvis.agent.${sanitizeToken(agentId)}.result`,
  agentHeartbeat: (agentId: string) => `jarvis.agent.${sanitizeToken(agentId)}.heartbeat`,
  /** Direct message to a specific agent */
  agentDM: (agentId: string) => `jarvis.agent.${sanitizeToken(agentId)}.dm`,
  taskProgress: (taskId: string) => `jarvis.task.${sanitizeToken(taskId)}.progress`,
  dashboardBroadcast: 'jarvis.broadcast.dashboard',
  /** Shared broadcast channel — ALL agents + gateway subscribe */
  agentsBroadcast: 'jarvis.agents.broadcast',
  /** Agent discovery announcements (online/offline) */
  agentsDiscovery: 'jarvis.agents.discovery',
  /** Coordination — task delegation between agents */
  coordinationRequest: 'jarvis.coordination.request',
  coordinationResponse: 'jarvis.coordination.response',
  chat: (agentId: string) => `jarvis.chat.${sanitizeToken(agentId)}`,
  chatBroadcast: 'jarvis.chat.broadcast',
  chatStream: 'jarvis.chat.stream',
} as const);

/** Ephemeral streaming delta from an agent during LLM generation */
export interface ChatStreamDelta {
  from: string;
  phase: 'thinking' | 'text' | 'tool_start' | 'done';
  text?: string;
  toolName?: string;
  sessionId?: string;
  round?: number;
  timestamp: number;
}

/** Inter-agent message types */
export const InterAgentMessageType = z.enum([
  'discovery',    // Agent announcing online/offline
  'dm',           // Direct message between agents
  'delegation',   // Task delegation request
  'delegation-ack', // Task delegation accepted/rejected
  'broadcast',    // Message to all agents
  'query',        // Ask another agent something
  'response',     // Response to a query
]);
export type InterAgentMessageType = z.infer<typeof InterAgentMessageType>;

export const InterAgentMessage = z.object({
  id: z.string(),
  type: InterAgentMessageType,
  from: z.string(),
  to: z.string().optional(),          // omit = broadcast to all
  content: z.string().optional(),
  payload: z.unknown().optional(),
  replyTo: z.string().optional(),     // correlate responses
  timestamp: z.number(),
});
export type InterAgentMessage = z.infer<typeof InterAgentMessage>;

/** Redis key helpers */
export const RedisKeys = Object.freeze({
  agentStatus: (agentId: string) => `jarvis:agent:${sanitizeToken(agentId)}:status`,
  agentCapabilities: (agentId: string) => `jarvis:agent:${sanitizeToken(agentId)}:capabilities`,
  task: (taskId: string) => `jarvis:task:${sanitizeToken(taskId)}`,
  taskQueue: (priority: string) => `jarvis:task:queue:${sanitizeToken(priority)}`,
  session: (sessionKey: string) => `jarvis:session:${sanitizeToken(sessionKey)}`,
  config: 'jarvis:config',
  llmCache: (hash: string) => `jarvis:llm:cache:${sanitizeToken(hash)}`,
} as const);
