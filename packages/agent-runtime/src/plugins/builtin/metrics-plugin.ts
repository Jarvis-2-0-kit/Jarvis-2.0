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

      // Accumulate metrics in memory during session
      const sessionMetrics = {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        llmCalls: 0,
        toolCalls: 0,
        toolErrors: 0,
        toolTimeMs: 0,
        toolBreakdown: {} as Record<string, { calls: number; errors: number; totalMs: number }>,
        models: {} as Record<string, { calls: number; inputTokens: number; outputTokens: number }>,
      };

      // ─── LLM output hook: track token usage ───
      api.on('llm_output', (event) => {
        sessionMetrics.llmCalls++;
        sessionMetrics.inputTokens += event.usage.inputTokens;
        sessionMetrics.outputTokens += event.usage.outputTokens;
        sessionMetrics.totalTokens += event.usage.totalTokens;

        const model = event.model ?? 'unknown';
        if (!sessionMetrics.models[model]) {
          sessionMetrics.models[model] = { calls: 0, inputTokens: 0, outputTokens: 0 };
        }
        sessionMetrics.models[model].calls++;
        sessionMetrics.models[model].inputTokens += event.usage.inputTokens;
        sessionMetrics.models[model].outputTokens += event.usage.outputTokens;
      });

      // ─── Tool execution hook: track performance ───
      api.on('after_tool_call', (event) => {
        sessionMetrics.toolCalls++;
        sessionMetrics.toolTimeMs += event.elapsed;

        if (event.result.type === 'error') {
          sessionMetrics.toolErrors++;
        }

        const name = event.toolName;
        if (!sessionMetrics.toolBreakdown[name]) {
          sessionMetrics.toolBreakdown[name] = { calls: 0, errors: 0, totalMs: 0 };
        }
        sessionMetrics.toolBreakdown[name].calls++;
        sessionMetrics.toolBreakdown[name].totalMs += event.elapsed;
        if (event.result.type === 'error') {
          sessionMetrics.toolBreakdown[name].errors++;
        }
      });

      // ─── Session end: persist metrics ───
      api.on('session_end', (event) => {
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

        // Reset for next session
        sessionMetrics.inputTokens = 0;
        sessionMetrics.outputTokens = 0;
        sessionMetrics.totalTokens = 0;
        sessionMetrics.llmCalls = 0;
        sessionMetrics.toolCalls = 0;
        sessionMetrics.toolErrors = 0;
        sessionMetrics.toolTimeMs = 0;
        sessionMetrics.toolBreakdown = {};
        sessionMetrics.models = {};
      });

      api.logger.info('Metrics plugin registered with 3 hooks');
    },
  };
}
