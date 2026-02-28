import { buildOrchestratorPrompt } from './templates/orchestrator.js';
import { buildDevAgentPrompt } from './templates/dev-agent.js';
import { buildMarketingAgentPrompt } from './templates/marketing-agent.js';
import { buildCoreSections } from './templates/core-sections.js';

export type AgentRole = 'orchestrator' | 'dev' | 'marketing';
export type ThinkLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high';

export interface NetworkPeer {
  agentId: string;
  role: string;
  hostname: string;
  ip: string;
  status: string;
}

export interface NetworkInfo {
  /** This agent's detected LAN IP */
  selfIp: string;
  /** NATS broker URL */
  natsUrl: string;
  /** Gateway URL */
  gatewayUrl: string;
  /** Whether NATS uses token auth */
  natsAuth: boolean;
  /** Currently discovered peers (from NATS) */
  peers: NetworkPeer[];
}

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
  /** Dynamic network info — replaces hardcoded IPs in templates */
  network?: NetworkInfo;
}

/**
 * Build a network info section from dynamic NetworkInfo.
 * Used by templates to replace hardcoded IPs.
 */
export function buildNetworkSection(network: NetworkInfo | undefined, selfAgentId: string): string {
  if (!network) return '';

  // Build agent table from self + peers
  const allAgents = [
    { agentId: selfAgentId, ip: network.selfIp, role: 'self', hostname: '(this machine)', status: 'online' },
    ...network.peers,
  ];

  const peerLines = network.peers.map((p) =>
    `- **${p.agentId}** (${p.role}) — ${p.hostname}${p.ip ? ` (${p.ip})` : ''} [${p.status}]`
  ).join('\n');

  const natsAuthStr = network.natsAuth ? 'token auth' : 'no auth';

  const lines = [
    `### Network (auto-discovered)`,
    `- This machine: ${network.selfIp}`,
    `- NATS: ${network.natsUrl} (${natsAuthStr})`,
    `- Gateway: ${network.gatewayUrl}`,
  ];

  if (network.peers.length > 0) {
    lines.push('', '### Peers Online', peerLines);
  } else {
    lines.push('', '### Peers Online', '(none currently connected)');
  }

  return lines.join('\n');
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
