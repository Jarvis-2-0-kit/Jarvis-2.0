/**
 * Home Assistant Integration Tool
 *
 * Controls smart home devices via Home Assistant REST API.
 * Supports: lights, switches, climate, covers, scenes, automations,
 *   sensors, scripts, media players, locks, fans, and arbitrary services.
 *
 * Requires:
 *   - HASS_URL (e.g., http://192.168.1.100:8123)
 *   - HASS_TOKEN (long-lived access token from HA profile page)
 */

import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface HomeAssistantConfig {
  /** Home Assistant base URL (e.g., http://192.168.1.100:8123) */
  readonly url?: string;
  /** Long-lived access token */
  readonly token?: string;
}

type HassAction =
  | 'status'
  | 'states'
  | 'toggle'
  | 'turn_on'
  | 'turn_off'
  | 'set'
  | 'call_service'
  | 'scenes'
  | 'trigger_scene'
  | 'automations'
  | 'trigger_automation'
  | 'history'
  | 'areas'
  | 'devices';

interface HassEntity {
  entity_id: string;
  state: string;
  attributes: Record<string, unknown>;
  last_changed: string;
  last_updated: string;
}

// ─── API client ──────────────────────────────────────────────────────

class HassAPI {
  private url: string;
  private token: string;

  constructor(url: string, token: string) {
    this.url = url.replace(/\/$/, '');
    this.token = token;
  }

  private async fetch(endpoint: string, options: RequestInit = {}): Promise<unknown> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000);

    const res = await fetch(`${this.url}/api${endpoint}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${this.token}`,
        'Content-Type': 'application/json',
        ...((options.headers as Record<string, string>) || {}),
      },
    });

    clearTimeout(timeoutId);

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Home Assistant API ${res.status}: ${text}`);
    }

    return res.json();
  }

  // ── Status ──

  async getStatus(): Promise<string> {
    const config = (await this.fetch('/config')) as { location_name: string; version: string; state: string };
    const states = (await this.fetch('/states')) as HassEntity[];

    const domainCounts: Record<string, number> = {};
    for (const entity of states) {
      const domain = entity.entity_id.split('.')[0]!;
      domainCounts[domain] = (domainCounts[domain] || 0) + 1;
    }

    const onCount = states.filter((s) => ['on', 'home', 'open', 'playing'].includes(s.state)).length;

    return [
      `🏠 Home Assistant: ${config.location_name}`,
      `📦 Version: ${config.version}`,
      `📊 Entities: ${states.length} total, ${onCount} active`,
      '',
      'Entity counts by domain:',
      ...Object.entries(domainCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([domain, count]) => `  ${domain}: ${count}`),
    ].join('\n');
  }

  // ── States ──

  async getStates(domain?: string, area?: string): Promise<string> {
    const states = (await this.fetch('/states')) as HassEntity[];

    let filtered = states;
    if (domain) {
      filtered = filtered.filter((s) => s.entity_id.startsWith(domain + '.'));
    }
    if (area) {
      filtered = filtered.filter(
        (s) =>
          (s.attributes['friendly_name'] as string)?.toLowerCase().includes(area.toLowerCase()) ||
          s.entity_id.toLowerCase().includes(area.toLowerCase()),
      );
    }

    if (filtered.length === 0) {
      return `No entities found${domain ? ` in domain "${domain}"` : ''}${area ? ` in area "${area}"` : ''}.`;
    }

    // Group by domain for readability
    const grouped: Record<string, HassEntity[]> = {};
    for (const entity of filtered) {
      const d = entity.entity_id.split('.')[0]!;
      if (!grouped[d]) grouped[d] = [];
      grouped[d]!.push(entity);
    }

    const lines: string[] = [`Entities (${filtered.length} found):\n`];
    for (const [d, entities] of Object.entries(grouped)) {
      lines.push(`── ${d} (${entities.length}) ──`);
      for (const e of entities.slice(0, 30)) {
        const name = (e.attributes['friendly_name'] as string) || e.entity_id;
        const unit = (e.attributes['unit_of_measurement'] as string) || '';
        const stateStr = e.state + (unit ? ` ${unit}` : '');
        const icon = getStateIcon(e);
        lines.push(`  ${icon} ${name}: ${stateStr}`);
      }
      if (entities.length > 30) {
        lines.push(`  ... and ${entities.length - 30} more`);
      }
    }

    return lines.join('\n');
  }

  // ── Control ──

  async toggle(entityId: string): Promise<string> {
    const domain = entityId.split('.')[0];
    await this.fetch(`/services/${domain}/toggle`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
    // Get new state
    await new Promise((r) => setTimeout(r, 500));
    const state = (await this.fetch(`/states/${entityId}`)) as HassEntity;
    return `Toggled ${entityId} → ${state.state}`;
  }

  async turnOn(entityId: string, data?: Record<string, unknown>): Promise<string> {
    const domain = entityId.split('.')[0];
    await this.fetch(`/services/${domain}/turn_on`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId, ...data }),
    });
    return `Turned on: ${entityId}${data ? ` with ${JSON.stringify(data)}` : ''}`;
  }

  async turnOff(entityId: string): Promise<string> {
    const domain = entityId.split('.')[0];
    await this.fetch(`/services/${domain}/turn_off`, {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
    return `Turned off: ${entityId}`;
  }

  async setEntityAttributes(entityId: string, attributes: Record<string, unknown>): Promise<string> {
    const domain = entityId.split('.')[0];

    // Common service mappings
    if (domain === 'climate' && attributes['temperature'] !== undefined) {
      await this.fetch(`/services/climate/set_temperature`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...attributes }),
      });
    } else if (domain === 'light' && (attributes['brightness'] !== undefined || attributes['color_temp'] !== undefined || attributes['rgb_color'] !== undefined)) {
      await this.fetch(`/services/light/turn_on`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...attributes }),
      });
    } else if (domain === 'cover') {
      const position = attributes['position'] as number | undefined;
      if (position !== undefined) {
        await this.fetch(`/services/cover/set_cover_position`, {
          method: 'POST',
          body: JSON.stringify({ entity_id: entityId, position }),
        });
      }
    } else if (domain === 'fan' && attributes['percentage'] !== undefined) {
      await this.fetch(`/services/fan/set_percentage`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...attributes }),
      });
    } else if (domain === 'media_player') {
      if (attributes['volume_level'] !== undefined) {
        await this.fetch(`/services/media_player/volume_set`, {
          method: 'POST',
          body: JSON.stringify({ entity_id: entityId, ...attributes }),
        });
      }
    } else {
      // Generic service call
      await this.fetch(`/services/${domain}/turn_on`, {
        method: 'POST',
        body: JSON.stringify({ entity_id: entityId, ...attributes }),
      });
    }

    return `Set ${entityId}: ${JSON.stringify(attributes)}`;
  }

  // ── Scenes & Automations ──

  async getScenes(): Promise<string> {
    const states = (await this.fetch('/states')) as HassEntity[];
    const scenes = states.filter((s) => s.entity_id.startsWith('scene.'));

    if (scenes.length === 0) return 'No scenes found.';

    const lines = scenes.map((s) => {
      const name = (s.attributes['friendly_name'] as string) || s.entity_id;
      return `  🎭 ${name} (${s.entity_id})`;
    });

    return `Scenes (${scenes.length}):\n\n${lines.join('\n')}`;
  }

  async triggerScene(entityId: string): Promise<string> {
    await this.fetch('/services/scene/turn_on', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
    return `Scene activated: ${entityId}`;
  }

  async getAutomations(): Promise<string> {
    const states = (await this.fetch('/states')) as HassEntity[];
    const automations = states.filter((s) => s.entity_id.startsWith('automation.'));

    if (automations.length === 0) return 'No automations found.';

    const lines = automations.map((s) => {
      const name = (s.attributes['friendly_name'] as string) || s.entity_id;
      const icon = s.state === 'on' ? '✅' : '⏸';
      return `  ${icon} ${name} (${s.state})\n     ${s.entity_id}`;
    });

    return `Automations (${automations.length}):\n\n${lines.join('\n')}`;
  }

  async triggerAutomation(entityId: string): Promise<string> {
    await this.fetch('/services/automation/trigger', {
      method: 'POST',
      body: JSON.stringify({ entity_id: entityId }),
    });
    return `Automation triggered: ${entityId}`;
  }

  // ── Generic service call ──

  async callService(domain: string, service: string, data?: Record<string, unknown>): Promise<string> {
    const result = await this.fetch(`/services/${domain}/${service}`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
    return `Service ${domain}.${service} called.\nResult: ${JSON.stringify(result, null, 2).slice(0, 2000)}`;
  }

  // ── History ──

  async getHistory(entityId: string, hours: number = 24): Promise<string> {
    const end = new Date().toISOString();
    const start = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
    const data = (await this.fetch(
      `/history/period/${start}?end_time=${end}&filter_entity_id=${entityId}&minimal_response`,
    )) as HassEntity[][];

    if (!data?.[0]?.length) {
      return `No history for ${entityId} in the last ${hours} hours.`;
    }

    const entries = data[0].slice(-30); // Last 30 state changes
    const lines = entries.map((e) => {
      const time = new Date(e.last_changed).toLocaleString();
      return `  [${time}] ${e.state}`;
    });

    return `History for ${entityId} (last ${hours}h, ${data[0].length} changes):\n\n${lines.join('\n')}`;
  }

  // ── Areas / Devices ──

  async getAreas(): Promise<string> {
    try {
      // Areas are accessed via websocket API, fall back to template
      const data = (await this.fetch('/template', {
        method: 'POST',
        body: JSON.stringify({ template: '{{ areas() | list | tojson }}' }),
      })) as string;
      return `Areas: ${data}`;
    } catch {
      return 'Areas API requires WebSocket connection. Use the HA UI for area management.';
    }
  }

  async getDevices(): Promise<string> {
    const states = (await this.fetch('/states')) as HassEntity[];

    if (states.length === 0) {
      return 'No entities/devices found.';
    }

    // Group entities by domain as a proxy for device type
    const grouped: Record<string, HassEntity[]> = {};
    for (const entity of states) {
      const domain = entity.entity_id.split('.')[0]!;
      if (!grouped[domain]) grouped[domain] = [];
      grouped[domain]!.push(entity);
    }

    const lines: string[] = [`Devices by domain (${states.length} entities total):\n`];
    for (const [domain, entities] of Object.entries(grouped).sort((a, b) => b[1].length - a[1].length)) {
      lines.push(`── ${domain} (${entities.length}) ──`);
      for (const e of entities.slice(0, 20)) {
        const name = (e.attributes['friendly_name'] as string) || e.entity_id;
        const unit = (e.attributes['unit_of_measurement'] as string) || '';
        const stateStr = e.state + (unit ? ` ${unit}` : '');
        const icon = getStateIcon(e);
        lines.push(`  ${icon} ${name} [${e.entity_id}]: ${stateStr}`);
      }
      if (entities.length > 20) {
        lines.push(`  ... and ${entities.length - 20} more`);
      }
    }

    return lines.join('\n');
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function getStateIcon(entity: HassEntity): string {
  const domain = entity.entity_id.split('.')[0];
  const state = entity.state;

  const icons: Record<string, Record<string, string>> = {
    light: { on: '💡', off: '⬛', unavailable: '❌' },
    switch: { on: '🟢', off: '🔴', unavailable: '❌' },
    binary_sensor: { on: '🟡', off: '⚪', unavailable: '❌' },
    climate: { heat: '🔥', cool: '❄️', auto: '🌡️', off: '⏹' },
    cover: { open: '🪟', closed: '🏠', opening: '⬆️', closing: '⬇️' },
    lock: { locked: '🔒', unlocked: '🔓' },
    fan: { on: '💨', off: '⏹' },
    media_player: { playing: '▶️', paused: '⏸', idle: '⏹', off: '⏹' },
    sensor: { _default: '📊' },
    person: { home: '🏠', not_home: '🚗' },
    automation: { on: '✅', off: '⏸' },
  };

  return icons[domain!]?.[state] || icons[domain!]?.['_default'] || '•';
}

// ─── Tool class ──────────────────────────────────────────────────────

export class HomeAssistantTool implements AgentTool {
  private api?: HassAPI;

  definition = {
    name: 'home_assistant',
    description:
      'Control smart home via Home Assistant. Actions: status (HA overview), states (list entities, optionally filtered by domain/area), toggle/turn_on/turn_off (control devices), set (set attributes like brightness, temperature), call_service (raw HA service call), scenes/trigger_scene, automations/trigger_automation, history (entity history), areas, devices.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: [
            'status',
            'states',
            'toggle',
            'turn_on',
            'turn_off',
            'set',
            'call_service',
            'scenes',
            'trigger_scene',
            'automations',
            'trigger_automation',
            'history',
            'areas',
            'devices',
          ],
          description: 'Action to perform',
        },
        entity_id: {
          type: 'string',
          description: 'Entity ID (e.g., light.living_room, climate.thermostat)',
        },
        domain: {
          type: 'string',
          description: 'Entity domain filter (e.g., light, switch, sensor, climate)',
        },
        area: {
          type: 'string',
          description: 'Area/room name filter',
        },
        service: {
          type: 'string',
          description: 'Service name (for call_service action)',
        },
        data: {
          type: 'object',
          description: 'Service data / attributes to set (e.g., {"brightness": 128, "color_temp": 300})',
        },
        hours: {
          type: 'number',
          description: 'Hours of history to retrieve (default: 24)',
        },
      },
      required: ['action'],
    },
  };

  constructor(config: HomeAssistantConfig = {}) {
    const url = config.url || process.env['HASS_URL'] || process.env['HOME_ASSISTANT_URL'];
    const token = config.token || process.env['HASS_TOKEN'] || process.env['HOME_ASSISTANT_TOKEN'];

    if (url && token) {
      this.api = new HassAPI(url, token);
    }
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    if (!this.api) {
      return createErrorResult(
        'Home Assistant not configured. Set HASS_URL and HASS_TOKEN in .env.\n' +
          'Get a long-lived access token from: HA → Profile → Long-Lived Access Tokens → Create Token',
      );
    }

    const action = params['action'] as HassAction;
    const entityId = params['entity_id'] as string;
    const data = params['data'] as Record<string, unknown>;

    // Validate entity_id format to prevent path traversal in API URLs
    if (entityId && !/^[a-zA-Z0-9_]+\.[a-zA-Z0-9_]+$/.test(entityId)) {
      return createErrorResult(
        `Invalid entity_id format: "${entityId}". Expected format: domain.name (e.g., light.living_room)`
      );
    }

    try {
      switch (action) {
        case 'status':
          return createToolResult(await this.api.getStatus());

        case 'states':
          return createToolResult(await this.api.getStates(params['domain'] as string, params['area'] as string));

        case 'toggle': {
          if (!entityId) return createErrorResult('toggle requires entity_id');
          return createToolResult(await this.api.toggle(entityId));
        }

        case 'turn_on': {
          if (!entityId) return createErrorResult('turn_on requires entity_id');
          return createToolResult(await this.api.turnOn(entityId, data));
        }

        case 'turn_off': {
          if (!entityId) return createErrorResult('turn_off requires entity_id');
          return createToolResult(await this.api.turnOff(entityId));
        }

        case 'set': {
          if (!entityId) return createErrorResult('set requires entity_id');
          if (!data) return createErrorResult('set requires data (e.g., {"brightness": 128})');
          return createToolResult(await this.api.setEntityAttributes(entityId, data));
        }

        case 'call_service': {
          const domain = params['domain'] as string;
          const service = params['service'] as string;
          if (!domain || !service) return createErrorResult('call_service requires domain and service');
          // Validate domain and service to prevent path traversal in API URL
          if (!/^[a-zA-Z0-9_]+$/.test(domain)) {
            return createErrorResult(`Invalid domain: "${domain}". Only alphanumeric and underscores allowed.`);
          }
          if (!/^[a-zA-Z0-9_]+$/.test(service)) {
            return createErrorResult(`Invalid service: "${service}". Only alphanumeric and underscores allowed.`);
          }
          return createToolResult(await this.api.callService(domain, service, data));
        }

        case 'scenes':
          return createToolResult(await this.api.getScenes());

        case 'trigger_scene': {
          if (!entityId) return createErrorResult('trigger_scene requires entity_id (scene.xxx)');
          return createToolResult(await this.api.triggerScene(entityId));
        }

        case 'automations':
          return createToolResult(await this.api.getAutomations());

        case 'trigger_automation': {
          if (!entityId) return createErrorResult('trigger_automation requires entity_id (automation.xxx)');
          return createToolResult(await this.api.triggerAutomation(entityId));
        }

        case 'history': {
          if (!entityId) return createErrorResult('history requires entity_id');
          const hours = Math.max(1, Math.min(720, (params['hours'] as number) || 24)); // Cap at 30 days
          return createToolResult(await this.api.getHistory(entityId, hours));
        }

        case 'areas':
          return createToolResult(await this.api.getAreas());

        case 'devices':
          return createToolResult(await this.api.getDevices());

        default:
          return createErrorResult(`Unknown action: ${action}`);
      }
    } catch (err) {
      return createErrorResult(`Home Assistant error: ${(err as Error).message}`);
    }
  }
}
