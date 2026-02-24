/**
 * Notifications Plugin — Multi-channel notification system for Jarvis agents.
 *
 * Channels:
 *   1. macOS native notifications (osascript)
 *   2. Webhook (HTTP POST to any URL — Slack, Discord, ntfy, etc.)
 *   3. NATS broadcast (real-time push to dashboard)
 *   4. Sound alerts (macOS say/afplay)
 *
 * Registers:
 *   - notify tool: Send notification via configured channels
 *   - notify_config tool: View/update notification preferences
 *   - task_completed hook: Auto-notify on task completion
 *   - task_failed hook: Auto-notify on task failure
 *
 * Config stored on NAS: config/notifications.json
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────

interface NotificationConfig {
  /** Enable macOS native notifications (default: true on darwin) */
  enableNative: boolean;
  /** Enable webhook notifications */
  enableWebhook: boolean;
  /** Webhook URLs (Slack, Discord, ntfy, custom) */
  webhooks: WebhookConfig[];
  /** Enable sound alerts */
  enableSound: boolean;
  /** Sound name for macOS (e.g., 'Glass', 'Hero', 'Ping') */
  soundName: string;
  /** Enable TTS for important alerts */
  enableTTS: boolean;
  /** Auto-notify on task completion */
  notifyOnTaskComplete: boolean;
  /** Auto-notify on task failure */
  notifyOnTaskFail: boolean;
  /** Minimum priority to trigger notification (1-10, default: 3) */
  minPriority: number;
  /** Quiet hours (no sound/native during these hours) */
  quietHours?: { start: number; end: number };
}

interface WebhookConfig {
  name: string;
  url: string;
  type: 'slack' | 'discord' | 'ntfy' | 'generic';
  enabled: boolean;
  /** Only send notifications at this priority or above */
  minPriority?: number;
}

interface Notification {
  title: string;
  message: string;
  priority: number; // 1-10
  channel?: string; // specific channel or 'all'
  sound?: boolean;
  tts?: boolean;
  data?: Record<string, unknown>;
}

// ─── Notification delivery ───────────────────────────────────────────

async function sendNativeNotification(title: string, message: string, sound?: string): Promise<void> {
  if (process.platform !== 'darwin') return;

  const soundClause = sound ? `sound name "${sound}"` : '';
  const script = `display notification "${escapeAS(message)}" with title "${escapeAS(title)}" ${soundClause}`;

  try {
    await execFileAsync('osascript', ['-e', script], { timeout: 5000 });
  } catch {
    // Notification permission might be denied
  }
}

async function sendTTS(text: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  try {
    await execFileAsync('say', ['-v', 'Samantha', text], { timeout: 15000 });
  } catch {
    // say might fail silently
  }
}

async function playSound(soundName: string): Promise<void> {
  if (process.platform !== 'darwin') return;
  const soundPath = `/System/Library/Sounds/${soundName}.aiff`;
  try {
    await execFileAsync('afplay', [soundPath], { timeout: 5000 });
  } catch {
    // Sound file might not exist
  }
}

async function sendWebhook(webhook: WebhookConfig, notification: Notification): Promise<void> {
  let body: string;
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  switch (webhook.type) {
    case 'slack': {
      body = JSON.stringify({
        text: `*${notification.title}*\n${notification.message}`,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: `*🤖 ${notification.title}*\n${notification.message}`,
            },
          },
        ],
      });
      break;
    }

    case 'discord': {
      const colors: Record<number, number> = {
        1: 0x808080, 2: 0x808080, 3: 0x00ff41, 4: 0x00ff41,
        5: 0x00bfff, 6: 0x00bfff, 7: 0xffaa00, 8: 0xffaa00,
        9: 0xff3333, 10: 0xff3333,
      };
      body = JSON.stringify({
        embeds: [{
          title: `🤖 ${notification.title}`,
          description: notification.message,
          color: colors[notification.priority] ?? 0x00ff41,
          timestamp: new Date().toISOString(),
          footer: { text: 'Jarvis 2.0' },
        }],
      });
      break;
    }

    case 'ntfy': {
      // ntfy.sh format
      headers['Title'] = notification.title;
      headers['Priority'] = notification.priority >= 8 ? '5' : notification.priority >= 5 ? '3' : '2';
      headers['Tags'] = 'robot';
      body = notification.message;
      headers['Content-Type'] = 'text/plain';
      break;
    }

    default: {
      body = JSON.stringify({
        title: notification.title,
        message: notification.message,
        priority: notification.priority,
        timestamp: new Date().toISOString(),
        source: 'jarvis',
        data: notification.data,
      });
    }
  }

  try {
    await fetch(webhook.url, {
      method: 'POST',
      headers,
      body,
      signal: AbortSignal.timeout(10000),
    });
  } catch {
    // Webhook might be unreachable
  }
}

function escapeAS(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function isQuietHours(config: NotificationConfig): boolean {
  if (!config.quietHours) return false;
  const hour = new Date().getHours();
  const { start, end } = config.quietHours;
  if (start <= end) {
    return hour >= start && hour < end;
  }
  // Wrap around midnight (e.g., 22-7)
  return hour >= start || hour < end;
}

// ─── Plugin ──────────────────────────────────────────────────────────

export function createNotificationsPlugin(): JarvisPluginDefinition {
  return {
    id: 'jarvis-notifications',
    name: 'Notifications',
    description: 'Multi-channel notification system (macOS native, webhook, sound, TTS)',
    version: '1.0.0',

    register(api) {
      const configPath = join(api.config.nasPath, 'config', 'notifications.json');

      // Ensure config dir exists
      try {
        mkdirSync(join(api.config.nasPath, 'config'), { recursive: true });
      } catch { /* exists */ }

      // Load or create default config
      function loadConfig(): NotificationConfig {
        try {
          if (existsSync(configPath)) {
            return JSON.parse(readFileSync(configPath, 'utf-8')) as NotificationConfig;
          }
        } catch { /* use defaults */ }

        const defaults: NotificationConfig = {
          enableNative: process.platform === 'darwin',
          enableWebhook: false,
          webhooks: [],
          enableSound: true,
          soundName: 'Glass',
          enableTTS: false,
          notifyOnTaskComplete: true,
          notifyOnTaskFail: true,
          minPriority: 3,
          quietHours: { start: 23, end: 7 },
        };

        saveConfig(defaults);
        return defaults;
      }

      function saveConfig(config: NotificationConfig): void {
        try {
          writeFileSync(configPath, JSON.stringify(config, null, 2));
        } catch { /* NAS might be unavailable */ }
      }

      // ─── Core send function ───

      async function sendNotification(notification: Notification, natsPublish?: (subject: string, data: unknown) => Promise<void>): Promise<string> {
        const config = loadConfig();
        const results: string[] = [];
        const quiet = isQuietHours(config);

        if (notification.priority < config.minPriority) {
          return `Notification skipped (priority ${notification.priority} < min ${config.minPriority})`;
        }

        // 1. macOS native notification
        if (config.enableNative && !quiet) {
          const sound = (notification.sound !== false && config.enableSound) ? config.soundName : undefined;
          await sendNativeNotification(notification.title, notification.message, sound);
          results.push('native');
        }

        // 2. Sound (separate from native notification sound)
        if (config.enableSound && notification.sound && !quiet) {
          await playSound(config.soundName);
          results.push('sound');
        }

        // 3. TTS
        if (config.enableTTS && notification.tts && !quiet) {
          await sendTTS(`${notification.title}. ${notification.message}`);
          results.push('tts');
        }

        // 4. Webhooks
        if (config.enableWebhook) {
          for (const webhook of config.webhooks) {
            if (!webhook.enabled) continue;
            if (webhook.minPriority && notification.priority < webhook.minPriority) continue;
            if (notification.channel && notification.channel !== 'all' && notification.channel !== webhook.name) continue;

            await sendWebhook(webhook, notification);
            results.push(`webhook:${webhook.name}`);
          }
        }

        // 5. NATS broadcast to dashboard
        if (natsPublish) {
          try {
            await natsPublish('jarvis.broadcast.dashboard', JSON.stringify({
              event: 'notification',
              payload: {
                title: notification.title,
                message: notification.message,
                priority: notification.priority,
                timestamp: Date.now(),
                source: api.config.agentId,
              },
            }));
            results.push('dashboard');
          } catch {
            // NATS might not be connected
          }
        }

        return `Notification sent via: ${results.join(', ') || 'none (all channels disabled or quiet hours)'}`;
      }

      // ─── notify tool ───

      api.registerTool({
        definition: {
          name: 'notify',
          description: 'Send a notification through configured channels (macOS native, webhook/Slack/Discord, sound, TTS). Use for important events, task completions, alerts, or when you need to get the user\'s attention.',
          input_schema: {
            type: 'object',
            properties: {
              title: {
                type: 'string',
                description: 'Notification title (short, descriptive)',
              },
              message: {
                type: 'string',
                description: 'Notification body (details)',
              },
              priority: {
                type: 'number',
                description: 'Priority 1-10 (1=low, 5=normal, 8=important, 10=critical). Default: 5',
              },
              channel: {
                type: 'string',
                description: 'Specific channel name or "all" (default: all)',
              },
              sound: {
                type: 'boolean',
                description: 'Play sound alert (default: true)',
              },
              tts: {
                type: 'boolean',
                description: 'Speak the notification aloud via TTS (default: false)',
              },
            },
            required: ['title', 'message'],
          },
        },

        async execute(params) {
          const notification: Notification = {
            title: (params as { title: string }).title,
            message: (params as { message: string }).message,
            priority: (params as { priority?: number }).priority ?? 5,
            channel: (params as { channel?: string }).channel ?? 'all',
            sound: (params as { sound?: boolean }).sound !== false,
            tts: (params as { tts?: boolean }).tts ?? false,
          };

          const result = await sendNotification(notification);
          return { type: 'text' as const, content: result };
        },
      });

      // ─── notify_config tool ───

      api.registerTool({
        definition: {
          name: 'notify_config',
          description: 'View or update notification configuration. Actions: get (view current config), set (update config), add_webhook (add a new webhook), remove_webhook (remove webhook by name), test (send a test notification).',
          input_schema: {
            type: 'object',
            properties: {
              action: {
                type: 'string',
                enum: ['get', 'set', 'add_webhook', 'remove_webhook', 'test'],
                description: 'Action to perform',
              },
              updates: {
                type: 'object',
                description: 'Config fields to update (for set action)',
              },
              webhook: {
                type: 'object',
                description: 'Webhook config (for add_webhook): { name, url, type, minPriority }',
                properties: {
                  name: { type: 'string' },
                  url: { type: 'string' },
                  type: { type: 'string', enum: ['slack', 'discord', 'ntfy', 'generic'] },
                  minPriority: { type: 'number' },
                },
              },
              webhook_name: {
                type: 'string',
                description: 'Webhook name to remove (for remove_webhook)',
              },
            },
            required: ['action'],
          },
        },

        async execute(params) {
          const { action } = params as { action: string };

          switch (action) {
            case 'get': {
              const config = loadConfig();
              const lines = [
                '📢 Notification Configuration:',
                '',
                `  Native (macOS):  ${config.enableNative ? '✅ ON' : '❌ OFF'}`,
                `  Webhooks:        ${config.enableWebhook ? '✅ ON' : '❌ OFF'} (${config.webhooks.filter(w => w.enabled).length}/${config.webhooks.length} active)`,
                `  Sound:           ${config.enableSound ? '✅ ON' : '❌ OFF'} (${config.soundName})`,
                `  TTS:             ${config.enableTTS ? '✅ ON' : '❌ OFF'}`,
                `  Min Priority:    ${config.minPriority}`,
                `  Quiet Hours:     ${config.quietHours ? `${config.quietHours.start}:00 - ${config.quietHours.end}:00` : 'OFF'}`,
                '',
                `  Task Complete:   ${config.notifyOnTaskComplete ? '✅' : '❌'}`,
                `  Task Failed:     ${config.notifyOnTaskFail ? '✅' : '❌'}`,
              ];

              if (config.webhooks.length > 0) {
                lines.push('', '  Webhooks:');
                for (const w of config.webhooks) {
                  lines.push(`    ${w.enabled ? '✅' : '❌'} ${w.name} (${w.type}) — ${w.url.slice(0, 50)}...${w.minPriority ? ` [min:${w.minPriority}]` : ''}`);
                }
              }

              return { type: 'text' as const, content: lines.join('\n') };
            }

            case 'set': {
              const config = loadConfig();
              const updates = (params as { updates?: Record<string, unknown> }).updates ?? {};
              Object.assign(config, updates);
              saveConfig(config);
              return { type: 'text' as const, content: `✅ Config updated: ${Object.keys(updates).join(', ')}` };
            }

            case 'add_webhook': {
              const config = loadConfig();
              const webhook = (params as { webhook?: Partial<WebhookConfig> }).webhook;
              if (!webhook?.name || !webhook?.url) {
                return { type: 'error' as const, content: 'add_webhook requires webhook.name and webhook.url' };
              }

              config.webhooks.push({
                name: webhook.name,
                url: webhook.url,
                type: (webhook.type as WebhookConfig['type']) ?? 'generic',
                enabled: true,
                minPriority: webhook.minPriority,
              });
              config.enableWebhook = true;
              saveConfig(config);

              return { type: 'text' as const, content: `✅ Webhook added: ${webhook.name} (${webhook.type ?? 'generic'})` };
            }

            case 'remove_webhook': {
              const config = loadConfig();
              const name = (params as { webhook_name?: string }).webhook_name;
              if (!name) {
                return { type: 'error' as const, content: 'remove_webhook requires webhook_name' };
              }

              const before = config.webhooks.length;
              config.webhooks = config.webhooks.filter((w) => w.name !== name);
              saveConfig(config);

              return {
                type: 'text' as const,
                content: config.webhooks.length < before
                  ? `🗑 Webhook removed: ${name}`
                  : `Webhook "${name}" not found`,
              };
            }

            case 'test': {
              const result = await sendNotification({
                title: 'Jarvis Test Notification',
                message: `Test from ${api.config.agentId} at ${new Date().toLocaleTimeString()}`,
                priority: 5,
                sound: true,
                tts: false,
              });
              return { type: 'text' as const, content: `🔔 Test: ${result}` };
            }

            default:
              return { type: 'error' as const, content: `Unknown action: ${action}` };
          }
        },
      });

      // ─── Lifecycle hooks ───

      // Auto-notify on task completion
      api.registerHook('task_completed', {
        priority: 50,
        handler: async (data) => {
          const config = loadConfig();
          if (!config.notifyOnTaskComplete) return data;

          const taskData = data as { taskId?: string; title?: string; description?: string };
          await sendNotification({
            title: `✅ Task Complete`,
            message: taskData.title ?? taskData.description ?? `Task ${taskData.taskId ?? 'unknown'} finished`,
            priority: 4,
            sound: true,
          });
          return data;
        },
      });

      // Auto-notify on task failure
      api.registerHook('task_failed', {
        priority: 50,
        handler: async (data) => {
          const config = loadConfig();
          if (!config.notifyOnTaskFail) return data;

          const taskData = data as { taskId?: string; error?: string; title?: string };
          await sendNotification({
            title: `❌ Task Failed`,
            message: taskData.error ?? taskData.title ?? `Task ${taskData.taskId ?? 'unknown'} failed`,
            priority: 8,
            sound: true,
          });
          return data;
        },
      });

      api.logger.info('[jarvis-notifications] Notifications plugin registered with 2 tools + 2 hooks');
    },
  };
}
