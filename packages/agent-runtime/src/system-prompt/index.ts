import { buildOrchestratorPrompt } from './templates/orchestrator.js';
import { buildDevAgentPrompt } from './templates/dev-agent.js';
import { buildMarketingAgentPrompt } from './templates/marketing-agent.js';
import { buildCoreSections } from './templates/core-sections.js';

export type AgentRole = 'orchestrator' | 'dev' | 'marketing';
export type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface PromptContext {
  agentId: string;
  role: AgentRole;
  hostname: string;
  workspacePath: string;
  nasPath: string;
  currentTask?: string;
  capabilities?: string[];
  thinkLevel?: ThinkLevel;
  defaultModel?: string;
}

const TEMPLATE_MAP: Record<AgentRole, (ctx: PromptContext) => string> = {
  orchestrator: buildOrchestratorPrompt,
  dev: buildDevAgentPrompt,
  marketing: buildMarketingAgentPrompt,
};

/**
 * Build system prompt for a given agent role.
 * Combines role-specific template with core sections adapted from OpenClaw:
 * Safety, Tool Call Style, Memory, Heartbeats, Workspace guidelines.
 */
export function buildSystemPrompt(context: PromptContext): string {
  const builder = TEMPLATE_MAP[context.role];
  if (!builder) throw new Error(`Unknown agent role: ${context.role}`);

  const rolePrompt = builder(context);
  const coreSections = buildCoreSections(context);

  return `${rolePrompt}\n\n${coreSections}`;
}

export { buildOrchestratorPrompt } from './templates/orchestrator.js';
export { buildDevAgentPrompt } from './templates/dev-agent.js';
export { buildMarketingAgentPrompt } from './templates/marketing-agent.js';
export { buildCoreSections } from './templates/core-sections.js';
