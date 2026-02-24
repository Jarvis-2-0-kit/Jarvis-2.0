/**
 * Plugin Loader — Discovers and loads plugins from NAS and local directories.
 * Inspired by OpenClaw's loader.ts
 *
 * Plugin locations (in load order):
 * 1. Built-in plugins (bundled with agent-runtime)
 * 2. NAS plugins: jarvis-nas/plugins/<plugin-id>/
 * 3. Local workspace plugins (future)
 *
 * Each plugin directory should contain:
 *   - jarvis.plugin.json (manifest)
 *   - index.ts or index.js (entry point)
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '@jarvis/shared';
import { PluginRegistry } from './registry.js';
import type { JarvisPluginDefinition, JarvisPluginModule, PluginRuntimeConfig } from './types.js';
import { HookRunner } from './hook-runner.js';

// Built-in plugins
import { createMemoryPlugin } from './builtin/memory-plugin.js';
import { createMetricsPlugin } from './builtin/metrics-plugin.js';
import { createAutoSavePlugin } from './builtin/auto-save-plugin.js';
import { createTaskPlannerPlugin } from './builtin/task-planner-plugin.js';
import { createNotificationsPlugin } from './builtin/notifications-plugin.js';
import { createWorkflowEnginePlugin } from './builtin/workflow-engine-plugin.js';
import { createSystemMonitorPlugin } from './builtin/system-monitor-plugin.js';
import { createActivityTimelinePlugin } from './builtin/activity-timeline-plugin.js';
import { createHealthCheckPlugin } from './builtin/health-check-plugin.js';
import { createRateLimiterPlugin } from './builtin/rate-limiter-plugin.js';
import { createVoicePlugin } from './builtin/voice-plugin.js';

const log = createLogger('plugins:loader');

export interface PluginLoaderConfig {
  runtimeConfig: PluginRuntimeConfig;
  nasPath: string;
  enableBuiltins?: boolean;
  pluginConfigs?: Record<string, Record<string, unknown>>;
}

export interface LoadedPluginSystem {
  registry: PluginRegistry;
  hookRunner: HookRunner;
}

/**
 * Load all plugins and return the registry + hook runner.
 */
export async function loadPlugins(config: PluginLoaderConfig): Promise<LoadedPluginSystem> {
  const registry = new PluginRegistry(config.runtimeConfig, config.pluginConfigs);
  const hookRunner = new HookRunner(registry, { catchErrors: true });

  // 1. Load built-in plugins
  if (config.enableBuiltins !== false) {
    log.info('Loading built-in plugins...');
    const builtins: JarvisPluginDefinition[] = [
      createMemoryPlugin(),
      createMetricsPlugin(),
      createAutoSavePlugin(),
      createTaskPlannerPlugin(),
      createNotificationsPlugin(),
      createWorkflowEnginePlugin(),
      createSystemMonitorPlugin(),
      createActivityTimelinePlugin(),
      createHealthCheckPlugin(),
      createRateLimiterPlugin(),
      createVoicePlugin(),
    ];

    for (const plugin of builtins) {
      await registry.registerPlugin(plugin, { source: 'builtin' });
    }
  }

  // 2. Load NAS plugins
  const pluginsDir = join(config.nasPath, 'plugins');
  if (existsSync(pluginsDir)) {
    log.info(`Scanning NAS plugins: ${pluginsDir}`);
    try {
      const entries = readdirSync(pluginsDir, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith('.') || entry.name.startsWith('_')) continue;

        const pluginDir = join(pluginsDir, entry.name);
        const manifestPath = join(pluginDir, 'jarvis.plugin.json');

        if (!existsSync(manifestPath)) {
          log.warn(`Plugin directory without manifest: ${entry.name}`);
          continue;
        }

        try {
          const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
          const entryPath = findPluginEntry(pluginDir);

          if (entryPath) {
            // Dynamic import of plugin
            const module = await import(entryPath) as { default?: JarvisPluginModule };
            const pluginModule = module.default ?? module;

            if (typeof pluginModule === 'function' || (typeof pluginModule === 'object' && 'register' in pluginModule)) {
              await registry.registerPlugin(
                pluginModule as JarvisPluginModule,
                {
                  id: manifest.id ?? entry.name,
                  name: manifest.name ?? entry.name,
                  source: 'nas',
                },
              );
            } else {
              log.warn(`Invalid plugin module: ${entry.name} (no register function or default export)`);
            }
          }
        } catch (err) {
          log.error(`Failed to load plugin ${entry.name}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      log.error(`Failed to scan plugins directory: ${(err as Error).message}`);
    }
  }

  log.info(`Plugin system loaded: ${registry.getSummary()}`);
  return { registry, hookRunner };
}

/**
 * Find the entry point file for a plugin directory.
 */
function findPluginEntry(pluginDir: string): string | null {
  const candidates = [
    'index.ts',
    'index.js',
    'index.mjs',
    'src/index.ts',
    'src/index.js',
    'dist/index.js',
  ];

  for (const candidate of candidates) {
    const path = join(pluginDir, candidate);
    if (existsSync(path)) return path;
  }

  return null;
}
