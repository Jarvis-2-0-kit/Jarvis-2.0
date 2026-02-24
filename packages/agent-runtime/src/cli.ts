/**
 * CLI entry point for starting an agent on a Mac Mini worker.
 *
 * Usage:
 *   AGENT_ID=agent-alpha AGENT_ROLE=dev tsx packages/agent-runtime/src/cli.ts
 *   AGENT_ID=agent-beta AGENT_ROLE=marketing tsx packages/agent-runtime/src/cli.ts
 */

import { config as dotenvConfig } from 'dotenv';

// Load .env but only fill in values that are MISSING or empty.
// This prevents .env from overriding per-agent CLI env vars like AGENT_ID/AGENT_ROLE
// while still picking up API keys that may not be set in the shell environment.
const parsed = dotenvConfig().parsed ?? {};
for (const [key, value] of Object.entries(parsed)) {
  if (!process.env[key] || process.env[key] === '') {
    process.env[key] = value;
  }
}

import { createLogger } from '@jarvis/shared';
import { ToolRegistry } from '@jarvis/tools';
import { AgentRunner } from './engine/runner.js';
import type { AgentRole } from './system-prompt/index.js';
import type { AgentId } from '@jarvis/shared';
import { hostname } from 'node:os';

const log = createLogger('agent:cli');

const agentId = (process.env['JARVIS_AGENT_ID'] ?? process.env['AGENT_ID'] ?? 'agent-alpha') as AgentId;
const role = (process.env['JARVIS_AGENT_ROLE'] ?? process.env['AGENT_ROLE'] ?? 'dev') as AgentRole;
const machineId = process.env['JARVIS_MACHINE_ID'] ?? process.env['MACHINE_ID'] ?? hostname();
const host = process.env['AGENT_HOSTNAME'] ?? hostname();
const natsUrl = process.env['NATS_URL'] ?? 'nats://localhost:4222';
const natsUrlThunderbolt = process.env['NATS_URL_THUNDERBOLT'] ?? undefined;
const thunderboltEnabled = process.env['THUNDERBOLT_ENABLED'] === 'true';
const nasMount = process.env['JARVIS_NAS_MOUNT'] ?? '/Volumes/JarvisNAS/jarvis';
const workspace = process.env['WORKSPACE_PATH'] ?? `${nasMount}/workspace/projects`;
const defaultModel = process.env['DEFAULT_MODEL'] ?? 'claude-sonnet-4-6';

// SSH host config for remote machine control
const sshAlphaHost = process.env['SSH_ALPHA_HOST'] ?? process.env['VNC_ALPHA_HOST'];
const sshAlphaUser = process.env['SSH_ALPHA_USER'] ?? process.env['VNC_ALPHA_USERNAME'];
const sshAlphaPass = process.env['SSH_ALPHA_PASSWORD'] ?? process.env['VNC_ALPHA_PASSWORD'];
const sshBetaHost = process.env['SSH_BETA_HOST'] ?? process.env['BETA_IP'];
const sshBetaUser = process.env['SSH_BETA_USER'] ?? process.env['VNC_BETA_USERNAME'] ?? process.env['BETA_USER'];
const sshBetaPass = process.env['SSH_BETA_PASSWORD'] ?? process.env['VNC_BETA_PASSWORD'];

// Build SSH hosts map
const sshHosts: Record<string, { host: string; username: string; password?: string }> = {};
if (sshAlphaHost && sshAlphaUser) {
  sshHosts['agent-alpha'] = { host: sshAlphaHost, username: sshAlphaUser, password: sshAlphaPass };
}
if (sshBetaHost && sshBetaUser) {
  sshHosts['agent-beta'] = { host: sshBetaHost, username: sshBetaUser, password: sshBetaPass };
}

// VNC host config for computer use (screenshots + mouse/keyboard via VNC protocol)
const vncAlphaHost = process.env['VNC_ALPHA_HOST'];
const vncAlphaPass = process.env['VNC_ALPHA_PASSWORD'];
const vncBetaHost = process.env['BETA_IP'] ?? process.env['VNC_BETA_HOST'];
const vncBetaPass = process.env['VNC_BETA_PASSWORD'];

const vncHosts: Record<string, { host: string; vncPort: number; vncPassword: string; ssh?: { host: string; username: string; password?: string } }> = {};
if (vncAlphaHost && vncAlphaPass) {
  vncHosts['agent-alpha'] = {
    host: vncAlphaHost,
    vncPort: 5900,
    vncPassword: vncAlphaPass,
    ssh: sshHosts['agent-alpha'],
  };
}
if (vncBetaHost && vncBetaPass) {
  vncHosts['agent-beta'] = {
    host: vncBetaHost,
    vncPort: 5900,
    vncPassword: vncBetaPass,
    ssh: sshHosts['agent-beta'],
  };
}

// Integration config from env
const hassUrl = process.env['HASS_URL'] || process.env['HOME_ASSISTANT_URL'];
const hassToken = process.env['HASS_TOKEN'] || process.env['HOME_ASSISTANT_TOKEN'];
const spotifyToken = process.env['SPOTIFY_ACCESS_TOKEN'];
const spotifyRefresh = process.env['SPOTIFY_REFRESH_TOKEN'];
const spotifyClientId = process.env['SPOTIFY_CLIENT_ID'];
const spotifyClientSecret = process.env['SPOTIFY_CLIENT_SECRET'];

// Capability sets per role
const CAPABILITIES: Record<string, string[]> = {
  dev: ['code', 'build', 'deploy', 'browser', 'exec', 'file', 'web', 'app-store', 'computer-use', 'ssh', 'imessage', 'spotify', 'home-assistant', 'cron'],
  marketing: ['research', 'social-media', 'content', 'analytics', 'browser', 'web', 'file', 'computer-use', 'ssh', 'imessage', 'spotify', 'home-assistant', 'cron'],
};

async function main(): Promise<void> {
  log.info(`=== Jarvis 2.0 Agent Runtime ===`);
  log.info(`Agent: ${agentId} (${role})`);
  log.info(`Machine: ${machineId} / ${host}`);
  log.info(`NATS: ${natsUrl}`);
  if (thunderboltEnabled && natsUrlThunderbolt) {
    log.info(`NATS Thunderbolt: ${natsUrlThunderbolt} (10 Gbps priority)`);
  }
  log.info(`NAS: ${nasMount}`);
  log.info(`Model: ${defaultModel}`);

  // Initialize tools
  const hasSshHosts = Object.keys(sshHosts).length > 0;
  const hasVncHosts = Object.keys(vncHosts).length > 0;
  log.info(`SSH hosts: ${hasSshHosts ? Object.entries(sshHosts).map(([k, v]) => `${k}→${v.host}`).join(', ') : 'none'}`);
  log.info(`VNC hosts: ${hasVncHosts ? Object.entries(vncHosts).map(([k, v]) => `${k}→${v.host}:${v.vncPort}`).join(', ') : 'none'}`);

  // Integrations enabled
  const enableIMessage = process.platform === 'darwin';
  const enableSpotify = process.platform === 'darwin' || !!spotifyToken;
  const enableHomeAssistant = !!(hassUrl && hassToken);
  const enableCron = true; // Always available
  const enableCalendar = process.platform === 'darwin';

  const integrations: string[] = [];
  if (enableIMessage) integrations.push('iMessage');
  if (enableSpotify) integrations.push('Spotify' + (spotifyToken ? '(API)' : '(local)'));
  if (enableHomeAssistant) integrations.push('HomeAssistant');
  if (enableCron) integrations.push('Cron');
  if (enableCalendar) integrations.push('Calendar');
  log.info(`Integrations: ${integrations.length > 0 ? integrations.join(', ') : 'none'}`);

  const tools = new ToolRegistry({
    enableBrowser: true,
    enableExec: true,
    enableFileOps: true,
    enableWebFetch: true,
    enableWebSearch: true,
    enableMessageAgent: false, // Will be enabled after NATS connects
    enableSsh: hasSshHosts,
    enableComputerUse: hasVncHosts,
    enableIMessage,
    enableSpotify,
    enableHomeAssistant,
    enableCron,
    enableCalendar,
    braveApiKey: process.env['BRAVE_API_KEY'],
    perplexityApiKey: process.env['PERPLEXITY_API_KEY'],
    sshHosts: hasSshHosts ? sshHosts : undefined,
    vncHosts: hasVncHosts ? vncHosts : undefined,
    spotifyConfig: spotifyToken ? {
      accessToken: spotifyToken,
      refreshToken: spotifyRefresh,
      clientId: spotifyClientId,
      clientSecret: spotifyClientSecret,
    } : undefined,
    homeAssistantConfig: enableHomeAssistant ? {
      url: hassUrl,
      token: hassToken,
    } : undefined,
    cronConfig: {
      jobsDir: `${nasMount}/cron-jobs`,
    },
  });

  // Create runner
  const runner = new AgentRunner({
    agentId,
    role,
    machineId,
    hostname: host,
    natsUrl,
    natsUrlThunderbolt: thunderboltEnabled ? natsUrlThunderbolt : undefined,
    nasMountPath: nasMount,
    workspacePath: workspace,
    capabilities: CAPABILITIES[role] ?? [],
    defaultModel,
    tools,
    llm: {
      anthropicApiKey: process.env['ANTHROPIC_API_KEY'],
      openaiApiKey: process.env['OPENAI_API_KEY'],
      googleApiKey: process.env['GOOGLE_AI_API_KEY'],
      ollamaBaseUrl: process.env['OLLAMA_BASE_URL'],
      openrouterApiKey: process.env['OPENROUTER_API_KEY'],
    },
  });

  // Graceful shutdown
  const shutdown = async () => {
    log.info('Shutting down...');
    await runner.stop();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Start
  await runner.start();
}

main().catch((err) => {
  log.error(`Fatal: ${(err as Error).message}`);
  process.exit(1);
});
