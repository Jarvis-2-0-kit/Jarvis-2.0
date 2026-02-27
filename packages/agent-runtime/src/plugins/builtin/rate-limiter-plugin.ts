/**
 * Rate Limiter Plugin — Prevents runaway tool/LLM calls.
 *
 * Guards against:
 * - Excessive tool calls (infinite loops, stuck retries)
 * - Token budget overruns
 * - Individual tool call frequency limits
 *
 * Tools:
 * - rate_limiter_status: Check current rate limits and usage
 * - rate_limiter_reset: Reset rate counters
 *
 * Hooks:
 * - before_tool_call: Enforce per-tool and global rate limits
 * - llm_output: Track token budget consumption
 * - session_start: Reset session-scoped counters
 */

import type { JarvisPluginDefinition } from '../types.js';

interface RateLimitConfig {
  maxToolCallsPerMinute: number;
  maxToolCallsPerSession: number;
  maxTokensPerSession: number;
  maxConsecutiveSameToolCalls: number;
  cooldownMs: number;
}

interface RateState {
  toolCallsThisMinute: number;
  toolCallsThisSession: number;
  tokensThisSession: number;
  minuteWindowStart: number;
  lastToolName: string;
  consecutiveSameToolCount: number;
  totalBlocked: number;
  perToolCounts: Record<string, number>;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxToolCallsPerMinute: 60,
  maxToolCallsPerSession: 500,
  maxTokensPerSession: 500_000,
  maxConsecutiveSameToolCalls: 15,
  cooldownMs: 100,
};

export function createRateLimiterPlugin(): JarvisPluginDefinition {
  const config = { ...DEFAULT_CONFIG };

  // Keyed by sessionId so concurrent sessions don't corrupt each other's state
  const sessionStateMap = new Map<string, RateState & { lastCallTime: number }>();

  function createSessionState(): RateState & { lastCallTime: number } {
    return {
      toolCallsThisMinute: 0,
      toolCallsThisSession: 0,
      tokensThisSession: 0,
      minuteWindowStart: Date.now(),
      lastToolName: '',
      consecutiveSameToolCount: 0,
      totalBlocked: 0,
      perToolCounts: {},
      lastCallTime: 0,
    };
  }

  function getOrCreateState(sessionId: string): RateState & { lastCallTime: number } {
    if (!sessionStateMap.has(sessionId)) {
      sessionStateMap.set(sessionId, createSessionState());
    }
    return sessionStateMap.get(sessionId)!;
  }

  function resetMinuteWindow(state: RateState): void {
    const now = Date.now();
    if (now - state.minuteWindowStart > 60_000) {
      state.toolCallsThisMinute = 0;
      state.minuteWindowStart = now;
    }
  }

  return {
    id: 'rate-limiter',
    name: 'Rate Limiter',
    description: 'Prevents runaway tool calls and token budget overruns',
    version: '1.0.0',

    register(api) {
      const log = api.logger;

      // Merge plugin config if provided
      const pluginCfg = api.pluginConfig as Partial<RateLimitConfig>;
      if (pluginCfg.maxToolCallsPerMinute) config.maxToolCallsPerMinute = pluginCfg.maxToolCallsPerMinute;
      if (pluginCfg.maxToolCallsPerSession) config.maxToolCallsPerSession = pluginCfg.maxToolCallsPerSession;
      if (pluginCfg.maxTokensPerSession) config.maxTokensPerSession = pluginCfg.maxTokensPerSession;
      if (pluginCfg.maxConsecutiveSameToolCalls) config.maxConsecutiveSameToolCalls = pluginCfg.maxConsecutiveSameToolCalls;

      // --- Tools ---

      api.registerTool({
        name: 'rate_limiter_status',
        description: 'Check current rate limiter status, showing usage vs limits for tool calls and tokens.',
        inputSchema: { type: 'object' as const, properties: {} },
        execute: async (_params, ctx) => {
          const sessionId = (ctx as { sessionId?: string }).sessionId ?? '';
          const state = getOrCreateState(sessionId);
          resetMinuteWindow(state);
          const lines = [
            '=== Rate Limiter Status ===',
            '',
            `Tool calls this minute: ${state.toolCallsThisMinute}/${config.maxToolCallsPerMinute}`,
            `Tool calls this session: ${state.toolCallsThisSession}/${config.maxToolCallsPerSession}`,
            `Tokens this session: ${state.tokensThisSession.toLocaleString()}/${config.maxTokensPerSession.toLocaleString()}`,
            `Consecutive same-tool calls: ${state.consecutiveSameToolCount}/${config.maxConsecutiveSameToolCalls} (${state.lastToolName || 'none'})`,
            `Total blocked: ${state.totalBlocked}`,
            '',
            'Top tool calls:',
            ...Object.entries(state.perToolCounts)
              .sort(([, a], [, b]) => b - a)
              .slice(0, 10)
              .map(([tool, count]) => `  ${tool}: ${count}`),
          ];
          return { type: 'text' as const, text: lines.join('\n') };
        },
      });

      api.registerTool({
        name: 'rate_limiter_reset',
        description: 'Reset all rate limiter counters. Use if you hit a limit and need to continue.',
        inputSchema: { type: 'object' as const, properties: {} },
        execute: async (_params, ctx) => {
          const sessionId = (ctx as { sessionId?: string }).sessionId ?? '';
          sessionStateMap.set(sessionId, createSessionState());
          log.info('Rate limiter counters reset');
          return { type: 'text' as const, text: 'Rate limiter counters have been reset.' };
        },
      });

      // --- Hooks ---

      api.on('before_tool_call', (event, ctx) => {
        const state = getOrCreateState(ctx.sessionId ?? '');
        resetMinuteWindow(state);
        const now = Date.now();
        const toolName = event.toolName;

        // Track per-tool counts
        state.perToolCounts[toolName] = (state.perToolCounts[toolName] || 0) + 1;

        // Track consecutive same-tool calls
        if (toolName === state.lastToolName) {
          state.consecutiveSameToolCount++;
        } else {
          state.consecutiveSameToolCount = 1;
          state.lastToolName = toolName;
        }

        // Check: token budget exceeded
        if (state.tokensThisSession > config.maxTokensPerSession) {
          state.totalBlocked++;
          log.warn(`Rate limiter: session token budget exceeded (${state.tokensThisSession.toLocaleString()}/${config.maxTokensPerSession.toLocaleString()})`);
          return {
            block: true,
            blockReason: `Rate limit: token budget exceeded — ${state.tokensThisSession.toLocaleString()} tokens used (max: ${config.maxTokensPerSession.toLocaleString()}). Use rate_limiter_reset to clear.`,
          };
        }

        // Check: consecutive same-tool limit
        if (state.consecutiveSameToolCount > config.maxConsecutiveSameToolCalls) {
          state.totalBlocked++;
          log.warn(`Rate limiter: blocked ${toolName} (${state.consecutiveSameToolCount} consecutive calls)`);
          return {
            block: true,
            blockReason: `Rate limit: ${toolName} called ${state.consecutiveSameToolCount} times consecutively (max: ${config.maxConsecutiveSameToolCalls}). Use rate_limiter_reset to clear if this is intentional.`,
          };
        }

        // Check: per-minute rate
        state.toolCallsThisMinute++;
        if (state.toolCallsThisMinute > config.maxToolCallsPerMinute) {
          state.totalBlocked++;
          log.warn(`Rate limiter: blocked (${state.toolCallsThisMinute}/min exceeds ${config.maxToolCallsPerMinute}/min)`);
          return {
            block: true,
            blockReason: `Rate limit: ${state.toolCallsThisMinute} tool calls this minute (max: ${config.maxToolCallsPerMinute}). Wait or use rate_limiter_reset.`,
          };
        }

        // Check: per-session limit
        state.toolCallsThisSession++;
        if (state.toolCallsThisSession > config.maxToolCallsPerSession) {
          state.totalBlocked++;
          log.warn(`Rate limiter: session tool call limit reached (${state.toolCallsThisSession})`);
          return {
            block: true,
            blockReason: `Rate limit: ${state.toolCallsThisSession} tool calls this session (max: ${config.maxToolCallsPerSession}).`,
          };
        }

        // Enforce minimum cooldown between calls
        if (config.cooldownMs > 0 && (now - state.lastCallTime) < config.cooldownMs) {
          // Don't block, just note it — the cooldown is very short
        }
        state.lastCallTime = now;

        return undefined;
      }, { priority: 100 }); // High priority — runs before other hooks

      // Track token consumption
      api.on('llm_output', (event, ctx) => {
        const state = getOrCreateState(ctx.sessionId ?? '');
        state.tokensThisSession += event.usage.totalTokens;

        if (state.tokensThisSession > config.maxTokensPerSession * 0.9) {
          log.warn(`Token budget approaching limit: ${state.tokensThisSession.toLocaleString()}/${config.maxTokensPerSession.toLocaleString()}`);
        }
      });

      // Initialize session state on session_start; clean up on session_end
      api.on('session_start', (event) => {
        sessionStateMap.set(event.sessionId, createSessionState());
        log.debug('Rate limiter counters initialized for new session');
      });

      api.on('session_end', (event) => {
        sessionStateMap.delete(event.sessionId);
      });

      // Prompt section
      api.registerPromptSection({
        title: 'Rate Limits',
        content: [
          'Rate limiting is active to prevent runaway operations.',
          `Limits: ${config.maxToolCallsPerMinute}/min, ${config.maxToolCallsPerSession}/session, ${config.maxConsecutiveSameToolCalls} consecutive same-tool.`,
          'If blocked, use `rate_limiter_status` to check or `rate_limiter_reset` to clear.',
        ].join('\n'),
        priority: -15,
      });

      log.info('Rate Limiter plugin registered', {
        maxPerMin: config.maxToolCallsPerMinute,
        maxPerSession: config.maxToolCallsPerSession,
        maxTokens: config.maxTokensPerSession,
      });
    },
  };
}
