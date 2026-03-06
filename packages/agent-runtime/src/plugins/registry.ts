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
  /** Stop functions collected when startServices() is called */
  private storedStopFns: Array<() => void> = [];

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

    // Snapshot indices before registration so we can roll back on failure
    const toolsBefore = this.toolRegistrations.length;
    const hooksBefore = this.hookRegistrations.length;
    const servicesBefore = this.services.length;
    const promptsBefore = this.promptSections.length;

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
      // Roll back any registrations made before the error
      this.toolRegistrations.splice(toolsBefore);
      this.hookRegistrations.splice(hooksBefore);
      this.services.splice(servicesBefore);
      this.promptSections.splice(promptsBefore);
      log.warn(`Rolled back partial registrations for plugin: ${definition.id}`);
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
            tools: toolOrFactory.map((t) => this.normalizePluginTool(t)),
          });
        } else {
          // Single tool - normalize from plugin format { name, inputSchema, execute }
          // to AgentTool format { definition: { name, description, input_schema }, execute }
          this.toolRegistrations.push({
            pluginId,
            tool: this.normalizePluginTool(toolOrFactory as AgentTool),
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

  // ─── Tool Normalization ──────────────────────────────────────────

  /**
   * Convert plugin tool format { name, description, inputSchema, execute }
   * to AgentTool format { definition: { name, description, input_schema }, execute }
   */
  private normalizePluginTool(tool: unknown): AgentTool {
    const t = tool as Record<string, unknown>;

    // Already in AgentTool format (has definition property)
    if (t.definition && typeof t.definition === 'object') {
      return tool as AgentTool;
    }

    // Plugin format: { name, description, inputSchema, execute }
    const name = t.name as string;
    const description = (t.description as string) || '';
    const inputSchema = (t.inputSchema ?? t.input_schema ?? { type: 'object', properties: {} }) as Record<string, unknown>;
    const executeFn = t.execute as (params: Record<string, unknown>, context: unknown) => Promise<unknown>;

    return {
      definition: {
        name,
        description,
        input_schema: inputSchema,
      },
      execute: async (params, context) => {
        const result = await executeFn(params, context);
        const r = result as Record<string, unknown>;
        // Normalize result: plugin may return { type, text } instead of { type, content }
        if (r && r.type === 'text' && r.text && !r.content) {
          return { type: 'text' as const, content: r.text as string };
        }
        return result as { type: 'text' | 'image' | 'error'; content: string; metadata?: Record<string, unknown> };
      },
    };
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
          for (const rawTool of factoryTools) {
            const t = this.normalizePluginTool(rawTool);
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
   * Start all registered services. Stop functions are stored internally so
   * cleanup() can always stop them even if the caller loses the reference.
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

    // Store internally so cleanup() can always call them
    this.storedStopFns.push(...stopFns);

    return stopFns;
  }

  // ─── Cleanup ─────────────────────────────────────────────────────

  /**
   * Clean up all registered resources. Call on shutdown to prevent leaks.
   * Always stops services started via startServices(), plus any additional
   * stop functions passed as argument.
   */
  async cleanup(stopFns?: Array<() => void>): Promise<void> {
    // Combine internally stored stop fns with any explicitly passed ones
    const allStopFns = [...this.storedStopFns, ...(stopFns ?? [])];
    this.storedStopFns = [];

    for (const stop of allStopFns) {
      try {
        stop();
      } catch (err) {
        log.error(`Service stop failed: ${(err as Error).message}`);
      }
    }

    // Clear all registrations
    this.toolRegistrations = [];
    this.hookRegistrations = [];
    this.services = [];
    this.promptSections = [];

    log.info('Plugin registry cleaned up');
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
