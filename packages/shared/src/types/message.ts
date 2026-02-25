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
  from: z.enum(['user', 'jarvis', 'agent-alpha', 'agent-beta', 'system']),
  to: z.enum(['user', 'jarvis', 'agent-alpha', 'agent-beta', 'all']),
  content: z.string(),
  timestamp: z.number(),
  metadata: z.record(z.unknown()).optional(),
});
export type ChatMessage = z.infer<typeof ChatMessage>;

/** NATS subject helpers */
export const NatsSubjects = {
  agentStatus: (agentId: string) => `jarvis.agent.${agentId}.status`,
  agentTask: (agentId: string) => `jarvis.agent.${agentId}.task`,
  agentResult: (agentId: string) => `jarvis.agent.${agentId}.result`,
  agentHeartbeat: (agentId: string) => `jarvis.agent.${agentId}.heartbeat`,
  /** Direct message to a specific agent */
  agentDM: (agentId: string) => `jarvis.agent.${agentId}.dm`,
  taskProgress: (taskId: string) => `jarvis.task.${taskId}.progress`,
  dashboardBroadcast: 'jarvis.broadcast.dashboard',
  /** Shared broadcast channel — ALL agents + gateway subscribe */
  agentsBroadcast: 'jarvis.agents.broadcast',
  /** Agent discovery announcements (online/offline) */
  agentsDiscovery: 'jarvis.agents.discovery',
  /** Coordination — task delegation between agents */
  coordinationRequest: 'jarvis.coordination.request',
  coordinationResponse: 'jarvis.coordination.response',
  chat: (agentId: string) => `jarvis.chat.${agentId}`,
  chatBroadcast: 'jarvis.chat.broadcast',
} as const;

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
export const RedisKeys = {
  agentStatus: (agentId: string) => `jarvis:agent:${agentId}:status`,
  agentCapabilities: (agentId: string) => `jarvis:agent:${agentId}:capabilities`,
  task: (taskId: string) => `jarvis:task:${taskId}`,
  taskQueue: (priority: string) => `jarvis:task:queue:${priority}`,
  session: (sessionKey: string) => `jarvis:session:${sessionKey}`,
  config: 'jarvis:config',
  llmCache: (hash: string) => `jarvis:llm:cache:${hash}`,
} as const;
