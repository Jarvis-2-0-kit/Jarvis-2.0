/**
 * Metrics Plugin — Tracks LLM usage, tool execution, and cost metrics.
 * Uses hooks to observe execution without modifying behavior.
 *
 * Registers:
 * - llm_output hook: Track token usage per model
 * - after_tool_call hook: Track tool execution times
 * - session_end hook: Save session metrics to NAS
 */

import { existsSync, mkdirSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

export function createMetricsPlugin(): JarvisPluginDefinition {
  return {
    id: 'jarvis-metrics',
    name: 'Usage Metrics',
    description: 'Tracks LLM usage, tool execution, and costs',
    version: '1.0.0',

    register(api) {
      const metricsDir = join(api.config.nasPath, 'metrics');
      try {
        mkdirSync(metricsDir, { recursive: true });
      } catch { /* exists */ }

      type MetricsState = {
        inputTokens: number;
        outputTokens: number;
        totalTokens: number;
        llmCalls: number;
        toolCalls: number;
        toolErrors: number;
        toolTimeMs: number;
        toolBreakdown: Record<string, { calls: number; errors: number; totalMs: number }>;
        models: Record<string, { calls: number; inputTokens: number; outputTokens: number }>;
      };

      function createMetricsState(): MetricsState {
        return {
          inputTokens: 0,
          outputTokens: 0,
          totalTokens: 0,
          llmCalls: 0,
          toolCalls: 0,
          toolErrors: 0,
          toolTimeMs: 0,
          toolBreakdown: {},
          models: {},
        };
      }

      // Keyed by sessionId so concurrent sessions don't share state
      const sessionMetricsMap = new Map<string, MetricsState>();

      function getOrCreate(sessionId: string): MetricsState {
        if (!sessionMetricsMap.has(sessionId)) {
          sessionMetricsMap.set(sessionId, createMetricsState());
        }
        return sessionMetricsMap.get(sessionId)!;
      }

      // ─── LLM output hook: track token usage ───
      api.on('llm_output', (event, ctx) => {
        const m = getOrCreate(ctx.sessionId ?? '');
        m.llmCalls++;
        m.inputTokens += event.usage.inputTokens;
        m.outputTokens += event.usage.outputTokens;
        m.totalTokens += event.usage.totalTokens;

        const model = event.model ?? 'unknown';
        if (!m.models[model]) {
          m.models[model] = { calls: 0, inputTokens: 0, outputTokens: 0 };
        }
        m.models[model].calls++;
        m.models[model].inputTokens += event.usage.inputTokens;
        m.models[model].outputTokens += event.usage.outputTokens;
      });

      // ─── Tool execution hook: track performance ───
      api.on('after_tool_call', (event, ctx) => {
        const m = getOrCreate(ctx.sessionId ?? '');
        m.toolCalls++;
        m.toolTimeMs += event.elapsed;

        if (event.result.type === 'error') {
          m.toolErrors++;
        }

        const name = event.toolName;
        if (!m.toolBreakdown[name]) {
          m.toolBreakdown[name] = { calls: 0, errors: 0, totalMs: 0 };
        }
        m.toolBreakdown[name].calls++;
        m.toolBreakdown[name].totalMs += event.elapsed;
        if (event.result.type === 'error') {
          m.toolBreakdown[name].errors++;
        }
      });

      // ─── Session end: persist metrics ───
      api.on('session_end', (event) => {
        const sessionMetrics = sessionMetricsMap.get(event.sessionId) ?? createMetricsState();
        sessionMetricsMap.delete(event.sessionId);

        const metricsData = {
          sessionId: event.sessionId,
          agentId: event.agentId,
          timestamp: new Date().toISOString(),
          ...sessionMetrics,
        };

        // Save to daily metrics file
        const dateStr = new Date().toISOString().split('T')[0];
        const dailyPath = join(metricsDir, `${dateStr}.jsonl`);

        try {
          if (!existsSync(metricsDir)) mkdirSync(metricsDir, { recursive: true });
          appendFileSync(dailyPath, JSON.stringify(metricsData) + '\n');
          api.logger.info(`Session metrics saved: ${sessionMetrics.llmCalls} LLM calls, ${sessionMetrics.toolCalls} tools, ${sessionMetrics.totalTokens} tokens`);
        } catch (err) {
          api.logger.error(`Failed to save metrics: ${(err as Error).message}`);
        }
      });

      api.logger.info('Metrics plugin registered with 3 hooks');
    },
  };
}
