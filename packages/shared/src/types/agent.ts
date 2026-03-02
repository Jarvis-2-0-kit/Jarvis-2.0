import { z } from 'zod';

export const AgentId = z.string().min(1);
export type AgentId = z.infer<typeof AgentId>;

export const AgentRole = z.enum(['orchestrator', 'dev', 'marketing']);
export type AgentRole = z.infer<typeof AgentRole>;

export const AgentStatus = z.enum([
  'offline',
  'starting',
  'idle',
  'busy',
  'error',
  'shutting-down',
]);
export type AgentStatus = z.infer<typeof AgentStatus>;

export const AgentCapability = z.enum([
  'code',
  'build',
  'deploy',
  'browser',
  'app-store',
  'google-play',
  'web-maintenance',
  'social-media',
  'market-research',
  'content-creation',
  'analytics',
  'finance',
  'pr',
  'exec',
  'file-ops',
  'web-search',
  'web-fetch',
]);
export type AgentCapability = z.infer<typeof AgentCapability>;

export const AgentIdentity = z.object({
  agentId: AgentId,
  machineId: z.string(),
  role: AgentRole,
  hostname: z.string(),
  ip: z.string().optional(),
});
export type AgentIdentity = z.infer<typeof AgentIdentity>;

export const AgentCapabilities = z.object({
  agentId: AgentId,
  machineId: z.string(),
  capabilities: z.array(AgentCapability),
  tools: z.array(z.string()),
  models: z.array(z.string()),
  maxConcurrency: z.number().int().positive().default(3),
});
export type AgentCapabilities = z.infer<typeof AgentCapabilities>;

export const AgentState = z.object({
  identity: AgentIdentity,
  status: AgentStatus,
  activeTaskId: z.string().nullable(),
  activeTaskDescription: z.string().nullable(),
  lastHeartbeat: z.number(),
  startedAt: z.number(),
  completedTasks: z.number().default(0),
  failedTasks: z.number().default(0),
});
export type AgentState = z.infer<typeof AgentState>;

export interface AgentRegistryEntry {
  agentId: string;
  role: AgentRole;
  hostname: string;
  ip: string;
  machineId: string;
  natsToken: string;
  authToken: string;
  isLocal: boolean;
  deployedAt: number;
  lastSeen: number | null;
  config: {
    model?: string;
    tools?: Record<string, boolean>;
    skills?: Record<string, boolean>;
  };
}

export const AGENT_DEFAULTS: Record<string, { role: AgentRole; capabilities: readonly AgentCapability[] }> = Object.freeze({
  'jarvis': Object.freeze({
    role: 'orchestrator',
    capabilities: Object.freeze([
      'code', 'build', 'deploy', 'browser', 'app-store', 'google-play',
      'web-maintenance', 'social-media', 'market-research', 'content-creation',
      'analytics', 'finance', 'pr', 'exec', 'file-ops', 'web-search', 'web-fetch',
    ] as const),
  }),
  'agent-smith': Object.freeze({
    role: 'dev',
    capabilities: Object.freeze([
      'code', 'build', 'deploy', 'browser', 'app-store', 'google-play',
      'web-maintenance', 'exec', 'file-ops', 'web-search', 'web-fetch',
    ] as const),
  }),
  'agent-johny': Object.freeze({
    role: 'marketing',
    capabilities: Object.freeze([
      'social-media', 'market-research', 'content-creation', 'analytics',
      'finance', 'pr', 'browser', 'exec', 'file-ops', 'web-search', 'web-fetch',
    ] as const),
  }),
});
