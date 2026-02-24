/**
 * Hook Runner — Executes lifecycle hooks with error handling and result merging.
 * Inspired by OpenClaw's createHookRunner pattern.
 *
 * Hooks run in priority order (high first). First non-void result wins
 * for hooks that return modifying results (e.g., model override).
 */

import { createLogger } from '@jarvis/shared';
import type { PluginRegistry } from './registry.js';
import type {
  PluginHookName,
  PluginHookContext,
  HookEvents,
  HookResults,
} from './types.js';

const log = createLogger('plugins:hooks');

export class HookRunner {
  constructor(
    private readonly registry: PluginRegistry,
    private readonly options: { catchErrors?: boolean } = { catchErrors: true },
  ) {}

  /**
   * Run all hooks for a given event.
   * Returns the merged result from all hook handlers.
   */
  async run<K extends PluginHookName>(
    name: K,
    event: HookEvents[K],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<HookResults[K]> {
    const hooks = this.registry.getHooks(name);
    if (hooks.length === 0) return undefined as HookResults[K];

    let mergedResult: Record<string, unknown> | undefined;

    for (const hook of hooks) {
      try {
        const hookCtx: PluginHookContext = { ...ctx, pluginId: hook.pluginId };
        const result = await hook.handler(event, hookCtx);

        if (result !== undefined && result !== null) {
          // Merge results: first non-undefined value for each key wins
          if (typeof result === 'object') {
            if (!mergedResult) mergedResult = {};
            for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
              if (value !== undefined && !(key in mergedResult)) {
                mergedResult[key] = value;
              }
            }
          }
        }
      } catch (err) {
        if (this.options.catchErrors) {
          log.error(`Hook ${name} (plugin: ${hook.pluginId}) error: ${(err as Error).message}`);
        } else {
          throw err;
        }
      }
    }

    return (mergedResult ?? undefined) as HookResults[K];
  }

  // ─── Typed convenience methods ─────────────────────────────────

  async runBeforeModelResolve(
    event: HookEvents['before_model_resolve'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<HookResults['before_model_resolve']> {
    return this.run('before_model_resolve', event, ctx);
  }

  async runBeforePromptBuild(
    event: HookEvents['before_prompt_build'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<HookResults['before_prompt_build']> {
    return this.run('before_prompt_build', event, ctx);
  }

  async runLlmInput(
    event: HookEvents['llm_input'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<HookResults['llm_input']> {
    return this.run('llm_input', event, ctx);
  }

  async runLlmOutput(
    event: HookEvents['llm_output'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('llm_output', event, ctx);
  }

  async runBeforeToolCall(
    event: HookEvents['before_tool_call'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<HookResults['before_tool_call']> {
    return this.run('before_tool_call', event, ctx);
  }

  async runAfterToolCall(
    event: HookEvents['after_tool_call'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<HookResults['after_tool_call']> {
    return this.run('after_tool_call', event, ctx);
  }

  async runSessionStart(
    event: HookEvents['session_start'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('session_start', event, ctx);
  }

  async runSessionEnd(
    event: HookEvents['session_end'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('session_end', event, ctx);
  }

  async runAgentStart(
    event: HookEvents['agent_start'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('agent_start', event, ctx);
  }

  async runAgentEnd(
    event: HookEvents['agent_end'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('agent_end', event, ctx);
  }

  async runMessageReceived(
    event: HookEvents['message_received'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('message_received', event, ctx);
  }

  async runTaskAssigned(
    event: HookEvents['task_assigned'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('task_assigned', event, ctx);
  }

  async runTaskCompleted(
    event: HookEvents['task_completed'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('task_completed', event, ctx);
  }

  async runTaskFailed(
    event: HookEvents['task_failed'],
    ctx: Omit<PluginHookContext, 'pluginId'>,
  ): Promise<void> {
    await this.run('task_failed', event, ctx);
  }
}
