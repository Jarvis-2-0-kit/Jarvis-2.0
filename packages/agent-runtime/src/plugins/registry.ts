/**
 * Plugin Registry — Central registry for all plugins, tools, hooks, and services.
 * Inspired by OpenClaw's PluginRegistry pattern.
 */

import { createLogger } from '@jarvis/shared';
import type { AgentTool } from '@jarvis/tools';
import type {
  JarvisPluginDefinition,
  JarvisPluginModule,
  PluginApi,
  PluginRuntimeConfig,
  PluginLogger,
  PluginToolRegistration,
  PluginToolFactory,
  PluginToolContext,
  PluginHookRegistration,
  PluginHookName,
  PluginHookHandler,
  PluginService,
  PromptSection,
} from './types.js';

const log = createLogger('plugins:registry');

export interface PluginRecord {
  id: string;
  name: string;
  description?: string;
  version?: string;
  enabled: boolean;
  source: string; // 'builtin' | 'local' | 'npm'
}

export class PluginRegistry {
  private plugins: PluginRecord[] = [];
  private toolRegistrations: PluginToolRegistration[] = [];
  private hookRegistrations: PluginHookRegistration[] = [];
  private services: Array<{ pluginId: string; service: PluginService }> = [];
  private promptSections: Array<{ pluginId: string; section: PromptSection }> = [];
  private runtimeConfig: PluginRuntimeConfig;
  private pluginConfigs: Record<string, Record<string, unknown>> = {};

  constructor(config: PluginRuntimeConfig, pluginConfigs?: Record<string, Record<string, unknown>>) {
    this.runtimeConfig = config;
    this.pluginConfigs = pluginConfigs ?? {};
  }

  // ─── Plugin Registration ─────────────────────────────────────────

  /**
   * Register a plugin. Supports both full definition and shorthand function.
   */
  async registerPlugin(
    module: JarvisPluginModule,
    options?: { id?: string; name?: string; source?: string },
  ): Promise<void> {
    let definition: JarvisPluginDefinition;

    if (typeof module === 'function') {
      const id = options?.id ?? `plugin-${this.plugins.length}`;
      definition = {
        id,
        name: options?.name ?? id,
        register: module,
      };
    } else {
      definition = module;
    }

    const record: PluginRecord = {
      id: definition.id,
      name: definition.name,
      description: definition.description,
      version: definition.version,
      enabled: true,
      source: options?.source ?? 'local',
    };

    this.plugins.push(record);

    // Create the API object for this plugin
    const api = this.createPluginApi(definition);

    try {
      // Register phase
      await definition.register(api);
      log.info(`Plugin registered: ${definition.id} (${definition.name})`);

      // Activate phase (if provided)
      if (definition.activate) {
        await definition.activate(api);
        log.info(`Plugin activated: ${definition.id}`);
      }
    } catch (err) {
      record.enabled = false;
      log.error(`Plugin registration failed: ${definition.id} - ${(err as Error).message}`);
    }
  }

  // ─── Plugin API Factory ──────────────────────────────────────────

  private createPluginApi(definition: JarvisPluginDefinition): PluginApi {
    const pluginId = definition.id;
    const pluginConfig = this.pluginConfigs[pluginId] ?? {};

    const logger: PluginLogger = {
      info: (msg, meta) => log.info(`[${pluginId}] ${msg}`, meta),
      warn: (msg, meta) => log.warn(`[${pluginId}] ${msg}`, meta),
      error: (msg, meta) => log.error(`[${pluginId}] ${msg}`, meta),
      debug: (msg, meta) => log.info(`[${pluginId}] [DEBUG] ${msg}`, meta),
    };

    const api: PluginApi = {
      id: pluginId,
      name: definition.name,
      config: this.runtimeConfig,
      pluginConfig,
      logger,

      registerTool: (toolOrFactory) => {
        if (typeof toolOrFactory === 'function') {
          // Tool factory
          this.toolRegistrations.push({
            pluginId,
            factory: toolOrFactory as PluginToolFactory,
          });
        } else if (Array.isArray(toolOrFactory)) {
          // Array of tools
          this.toolRegistrations.push({
            pluginId,
            tools: toolOrFactory,
          });
        } else {
          // Single tool
          this.toolRegistrations.push({
            pluginId,
            tool: toolOrFactory as AgentTool,
          });
        }
      },

      registerHook: <K extends PluginHookName>(
        name: K,
        handler: PluginHookHandler<K>,
        options?: { priority?: number },
      ) => {
        this.hookRegistrations.push({
          pluginId,
          hookName: name,
          handler: handler as PluginHookHandler<PluginHookName>,
          priority: options?.priority ?? 0,
        });
      },

      on: <K extends PluginHookName>(
        name: K,
        handler: PluginHookHandler<K>,
        options?: { priority?: number },
      ) => {
        api.registerHook(name, handler, options);
      },

      registerService: (service) => {
        this.services.push({ pluginId, service });
      },

      registerPromptSection: (section) => {
        this.promptSections.push({ pluginId, section });
      },

      resolvePath: (input: string) => {
        if (input.startsWith('/')) return input;
        return `${this.runtimeConfig.nasPath}/plugins/${pluginId}/${input}`;
      },
    };

    return api;
  }

  // ─── Tool Resolution ─────────────────────────────────────────────

  /**
   * Resolve all registered plugin tools for the current context.
   * Calls factories with context, flattens arrays, deduplicates.
   */
  resolveTools(context: PluginToolContext): AgentTool[] {
    const tools: AgentTool[] = [];
    const seenNames = new Set<string>();

    for (const reg of this.toolRegistrations) {
      try {
        if (reg.tool) {
          if (!seenNames.has(reg.tool.definition.name)) {
            tools.push(reg.tool);
            seenNames.add(reg.tool.definition.name);
          }
        } else if (reg.tools) {
          for (const t of reg.tools) {
            if (!seenNames.has(t.definition.name)) {
              tools.push(t);
              seenNames.add(t.definition.name);
            }
          }
        } else if (reg.factory) {
          const result = reg.factory(context);
          const factoryTools = Array.isArray(result) ? result : [result];
          for (const t of factoryTools) {
            if (!seenNames.has(t.definition.name)) {
              tools.push(t);
              seenNames.add(t.definition.name);
            }
          }
        }
      } catch (err) {
        log.error(`Tool resolution failed for plugin ${reg.pluginId}: ${(err as Error).message}`);
      }
    }

    return tools;
  }

  // ─── Hook Access ─────────────────────────────────────────────────

  /**
   * Get all hooks for a specific event, sorted by priority (high first).
   */
  getHooks<K extends PluginHookName>(name: K): PluginHookRegistration[] {
    return this.hookRegistrations
      .filter((h) => h.hookName === name)
      .sort((a, b) => b.priority - a.priority);
  }

  /** Check if any hooks exist for an event */
  hasHooks(name: PluginHookName): boolean {
    return this.hookRegistrations.some((h) => h.hookName === name);
  }

  // ─── Prompt Sections ─────────────────────────────────────────────

  /**
   * Get all registered prompt sections, sorted by priority.
   */
  getPromptSections(): PromptSection[] {
    return this.promptSections
      .map((ps) => ps.section)
      .sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
  }

  // ─── Services ────────────────────────────────────────────────────

  /**
   * Start all registered services.
   */
  async startServices(): Promise<Array<() => void>> {
    const stopFns: Array<() => void> = [];

    for (const { pluginId, service } of this.services) {
      try {
        const stop = await service.start();
        if (stop) stopFns.push(stop);
        log.info(`Service started: ${service.name} (from ${pluginId})`);
      } catch (err) {
        log.error(`Service start failed: ${service.name} (${pluginId}) - ${(err as Error).message}`);
      }
    }

    return stopFns;
  }

  // ─── Inspection ──────────────────────────────────────────────────

  /** List all registered plugins */
  getPlugins(): PluginRecord[] {
    return [...this.plugins];
  }

  /** Get summary for logging */
  getSummary(): string {
    const parts = [
      `${this.plugins.length} plugins`,
      `${this.toolRegistrations.length} tools`,
      `${this.hookRegistrations.length} hooks`,
      `${this.services.length} services`,
      `${this.promptSections.length} prompt sections`,
    ];
    return parts.join(', ');
  }
}
