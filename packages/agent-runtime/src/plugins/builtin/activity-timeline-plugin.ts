/**
 * Agent Activity Timeline Plugin
 *
 * Tracks all agent activities and creates a rich timeline of events.
 * Persists timeline entries to NAS for cross-session review.
 *
 * Features:
 * - Records task assignments, completions, and failures
 * - Records tool calls with duration
 * - Records LLM calls with token usage
 * - Records session starts and ends
 * - Provides timeline query tool for agents
 * - Provides summary/analytics tool
 *
 * Tools:
 * - activity_timeline: Query recent activity with filters
 * - activity_summary: Get analytics summary of agent activity
 *
 * Hooks:
 * - task_assigned, task_completed, task_failed
 * - before_tool_call, after_tool_call
 * - llm_output
 * - session_start, session_end
 * - agent_start, agent_end
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

// ─── Types ────────────────────────────────────────────────────────────

interface TimelineEntry {
  id: string;
  timestamp: number;
  agentId: string;
  category: 'task' | 'tool' | 'llm' | 'session' | 'agent' | 'message';
  action: string;
  detail: string;
  metadata: Record<string, unknown>;
  duration?: number;
}

interface TimelineState {
  entries: TimelineEntry[];
  stats: {
    totalTasks: number;
    completedTasks: number;
    failedTasks: number;
    totalToolCalls: number;
    totalLlmCalls: number;
    totalTokensIn: number;
    totalTokensOut: number;
    sessionCount: number;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────

let entryIdCounter = 0;
function genId(): string {
  return `tl_${++entryIdCounter}_${Date.now().toString(36)}`;
}

// Keep last N entries in memory
const MAX_ENTRIES = 500;
/** Stale tool-call timer threshold (10 minutes) */
const STALE_TIMER_MS = 600_000;
/** Interval for cleaning stale tool-call timers (5 minutes) */
const TIMER_CLEANUP_INTERVAL_MS = 300_000;

// ─── Plugin ───────────────────────────────────────────────────────────

export function createActivityTimelinePlugin(): JarvisPluginDefinition {
  const state: TimelineState = {
    entries: [],
    stats: {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalToolCalls: 0,
      totalLlmCalls: 0,
      totalTokensIn: 0,
      totalTokensOut: 0,
      sessionCount: 0,
    },
  };

  // Track tool call start times
  const toolCallTimers = new Map<string, number>();

  function addEntry(
    agentId: string,
    category: TimelineEntry['category'],
    action: string,
    detail: string,
    metadata: Record<string, unknown> = {},
    duration?: number,
  ): void {
    const entry: TimelineEntry = {
      id: genId(),
      timestamp: Date.now(),
      agentId,
      category,
      action,
      detail,
      metadata,
      duration,
    };
    state.entries.push(entry);
    if (state.entries.length > MAX_ENTRIES) {
      state.entries = state.entries.slice(-MAX_ENTRIES);
    }
  }

  function persistTimeline(nasPath: string, agentId: string): void {
    try {
      const dir = join(nasPath, 'timelines');
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

      const filePath = join(dir, `${agentId}-timeline.json`);
      const data = {
        agentId,
        lastUpdated: Date.now(),
        stats: state.stats,
        entries: state.entries.slice(-200),
      };
      writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
    } catch { /* ignore write errors */ }
  }

  return {
    id: 'activity-timeline',
    name: 'Agent Activity Timeline',
    description: 'Tracks and records all agent activities for timeline review and analytics',
    version: '1.0.0',

    register(api) {
      const log = api.logger;

      // ─── Tools ───────────────────────────────────────────────

      api.registerTool({
        name: 'activity_timeline',
        description: 'Query the agent activity timeline. Returns recent events with optional filters.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            category: {
              type: 'string',
              enum: ['task', 'tool', 'llm', 'session', 'agent', 'message', 'all'],
              description: 'Filter by event category',
            },
            limit: {
              type: 'number',
              description: 'Max entries to return (default: 30)',
            },
            since: {
              type: 'number',
              description: 'Only entries after this timestamp (epoch ms)',
            },
            search: {
              type: 'string',
              description: 'Search in action/detail text',
            },
          },
        },
        execute: async (input: Record<string, unknown>) => {
          const category = (input.category as string) || 'all';
          const limit = (input.limit as number) || 30;
          const since = (input.since as number) || 0;
          const search = ((input.search as string) || '').toLowerCase();

          let filtered = state.entries;

          if (category !== 'all') {
            filtered = filtered.filter((e) => e.category === category);
          }
          if (since > 0) {
            filtered = filtered.filter((e) => e.timestamp > since);
          }
          if (search) {
            filtered = filtered.filter(
              (e) =>
                e.action.toLowerCase().includes(search) ||
                e.detail.toLowerCase().includes(search),
            );
          }

          const results = filtered.slice(-limit);

          const lines = results.map((e) => {
            const time = new Date(e.timestamp).toLocaleTimeString();
            const dur = e.duration ? ` (${e.duration}ms)` : '';
            return `[${time}] [${e.category}] ${e.action}: ${e.detail}${dur}`;
          });

          return {
            type: 'text' as const,
            text: [
              `Activity Timeline (${results.length} entries):`,
              '',
              ...lines,
            ].join('\n'),
          };
        },
      });

      api.registerTool({
        name: 'activity_summary',
        description: 'Get a summary of agent activity: task counts, tool usage, token consumption, session stats.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
        execute: async () => {
          const { stats } = state;
          const recentEntries = state.entries.slice(-50);

          // Calculate top tools
          const toolCounts: Record<string, number> = {};
          for (const e of state.entries) {
            if (e.category === 'tool' && e.action === 'tool_call') {
              const name = (e.metadata.toolName as string) || 'unknown';
              toolCounts[name] = (toolCounts[name] || 0) + 1;
            }
          }
          const topTools = Object.entries(toolCounts)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10)
            .map(([name, count]) => `  ${name}: ${count} calls`);

          // Calculate avg tool duration
          const toolDurations = state.entries
            .filter((e) => e.category === 'tool' && e.duration)
            .map((e) => e.duration!);
          const avgToolDuration = toolDurations.length
            ? (toolDurations.reduce((a, b) => a + b, 0) / toolDurations.length).toFixed(0)
            : 'N/A';

          return {
            type: 'text' as const,
            text: [
              '=== Activity Summary ===',
              '',
              `Tasks: ${stats.totalTasks} total, ${stats.completedTasks} completed, ${stats.failedTasks} failed`,
              `Tool Calls: ${stats.totalToolCalls} (avg duration: ${avgToolDuration}ms)`,
              `LLM Calls: ${stats.totalLlmCalls}`,
              `Tokens: ${stats.totalTokensIn.toLocaleString()} in / ${stats.totalTokensOut.toLocaleString()} out`,
              `Sessions: ${stats.sessionCount}`,
              '',
              'Top Tools:',
              ...topTools,
              '',
              `Timeline entries: ${state.entries.length}`,
              `Last activity: ${recentEntries.length > 0 ? new Date(recentEntries[recentEntries.length - 1].timestamp).toLocaleString() : 'none'}`,
            ].join('\n'),
          };
        },
      });

      // ─── Hooks ───────────────────────────────────────────────

      // Agent lifecycle
      api.on('agent_start', (event) => {
        addEntry(event.agentId, 'agent', 'agent_start', `Agent ${event.agentId} (${event.role}) started on ${event.hostname}`);
        log.info('Activity timeline started', { agentId: event.agentId });
      });

      api.on('agent_end', (event) => {
        addEntry(event.agentId, 'agent', 'agent_end', `Agent stopped: ${event.reason}`);
        persistTimeline(api.config.nasPath, event.agentId);
      });

      // Session lifecycle
      api.on('session_start', (event) => {
        state.stats.sessionCount++;
        addEntry(event.agentId, 'session', 'session_start', `Session ${event.sessionId} started${event.taskId ? ` for task ${event.taskId}` : ''}`);
      });

      api.on('session_end', (event) => {
        const usage = event.tokenUsage;
        addEntry(event.agentId, 'session', 'session_end', `Session ${event.sessionId} ended — ${usage.totalTokens.toLocaleString()} tokens`, {
          tokenUsage: usage,
        });
        // Persist periodically
        persistTimeline(api.config.nasPath, event.agentId);
      });

      // Task lifecycle
      api.on('task_assigned', (event) => {
        state.stats.totalTasks++;
        addEntry(api.config.agentId, 'task', 'task_assigned', `Task: ${event.title}`, {
          taskId: event.taskId,
          priority: event.priority,
        });
      });

      api.on('task_completed', (event) => {
        state.stats.completedTasks++;
        addEntry(api.config.agentId, 'task', 'task_completed', `Task ${event.taskId} completed — ${event.artifacts.length} artifacts`, {
          taskId: event.taskId,
          artifactCount: event.artifacts.length,
        });
      });

      api.on('task_failed', (event) => {
        state.stats.failedTasks++;
        addEntry(api.config.agentId, 'task', 'task_failed', `Task ${event.taskId} failed: ${event.error}`, {
          taskId: event.taskId,
          error: event.error,
        });
      });

      // Tool calls
      api.on('before_tool_call', (event) => {
        toolCallTimers.set(event.toolId, performance.now());
      });

      api.on('after_tool_call', (event) => {
        state.stats.totalToolCalls++;
        const startTime = toolCallTimers.get(event.toolId);
        const duration = startTime ? Math.round(performance.now() - startTime) : event.elapsed;
        toolCallTimers.delete(event.toolId);

        addEntry(api.config.agentId, 'tool', 'tool_call', `${event.toolName}`, {
          toolName: event.toolName,
          toolId: event.toolId,
          inputKeys: Object.keys(event.input),
        }, duration);
      });

      // LLM calls
      api.on('llm_output', (event) => {
        state.stats.totalLlmCalls++;
        state.stats.totalTokensIn += event.usage.inputTokens;
        state.stats.totalTokensOut += event.usage.outputTokens;

        addEntry(api.config.agentId, 'llm', 'llm_call', `${event.model} — ${event.usage.totalTokens.toLocaleString()} tokens (${event.stopReason})`, {
          model: event.model,
          usage: event.usage,
          stopReason: event.stopReason,
        });
      });

      // Messages
      api.on('message_received', (event) => {
        addEntry(api.config.agentId, 'message', 'message_in', `[${event.source}] ${event.content.slice(0, 100)}${event.content.length > 100 ? '...' : ''}`);
      });

      // ─── Service: stale timer cleanup ──────────────────────

      api.registerService({
        name: 'timeline-timer-cleanup',
        start: async () => {
          const interval = setInterval(() => {
            const now = Date.now();
            for (const [key, startTime] of toolCallTimers) {
              if (now - startTime > STALE_TIMER_MS) {
                toolCallTimers.delete(key);
              }
            }
          }, TIMER_CLEANUP_INTERVAL_MS);
          interval.unref();
          return () => clearInterval(interval);
        },
      });

      // Add prompt section
      api.registerPromptSection({
        title: 'Activity Timeline',
        content: [
          'You have access to an activity timeline that records all your actions.',
          'Use `activity_timeline` to review recent events or search history.',
          'Use `activity_summary` for analytics on tasks, tool usage, and token consumption.',
        ].join('\n'),
        priority: -5,
      });

      log.info('Activity Timeline plugin registered');
    },
  };
}
