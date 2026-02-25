/**
 * Plugin System — Entry point
 *
 * Re-exports all plugin types, registry, hooks, skills, and loader.
 */

export type {
  JarvisPluginDefinition,
  JarvisPluginModule,
  PluginApi,
  PluginRuntimeConfig,
  PluginLogger,
  PluginToolContext,
  PluginToolFactory,
  PluginHookName,
  PluginHookHandler,
  PluginHookContext,
  HookEvents,
  HookResults,
  PluginHookRegistration,
  PluginToolRegistration,
  PluginService,
  PromptSection,
  SkillDefinition,
} from './types.js';

export { PluginRegistry, type PluginRecord } from './registry.js';
export { HookRunner } from './hook-runner.js';
export { loadPlugins, type PluginLoaderConfig, type LoadedPluginSystem } from './loader.js';
export { loadSkills, buildSkillsPromptSection } from './skill-loader.js';

// Built-in plugins
export { createMemoryPlugin } from './builtin/memory-plugin.js';
export { createMetricsPlugin } from './builtin/metrics-plugin.js';
export { createAutoSavePlugin } from './builtin/auto-save-plugin.js';
export { createTaskPlannerPlugin } from './builtin/task-planner-plugin.js';
export { createNotificationsPlugin } from './builtin/notifications-plugin.js';
export { createWorkflowEnginePlugin } from './builtin/workflow-engine-plugin.js';
export { createSystemMonitorPlugin } from './builtin/system-monitor-plugin.js';
export { createActivityTimelinePlugin } from './builtin/activity-timeline-plugin.js';
export { createHealthCheckPlugin } from './builtin/health-check-plugin.js';
export { createRateLimiterPlugin } from './builtin/rate-limiter-plugin.js';
export { createVoicePlugin } from './builtin/voice-plugin.js';
export { createObsidianPlugin } from './builtin/obsidian-plugin.js';
