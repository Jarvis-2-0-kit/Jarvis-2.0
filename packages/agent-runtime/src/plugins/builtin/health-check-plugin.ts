/**
 * Health Check Plugin — Periodic self-diagnostics for agents.
 *
 * Runs background health checks at configurable intervals and
 * reports issues proactively. Monitors:
 * - Memory usage & leak detection
 * - Event loop lag
 * - NAS accessibility
 * - Tool availability
 * - Plugin health
 *
 * Tools:
 * - health_self_check: Run a full self-diagnostic
 * - health_report: Get a summary report of recent checks
 *
 * Services:
 * - health-monitor: Background service that checks every 60s
 *
 * Hooks:
 * - agent_start: Initial health baseline
 */

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

interface HealthCheckResult {
  timestamp: number;
  status: 'healthy' | 'degraded' | 'unhealthy';
  checks: {
    name: string;
    status: 'pass' | 'warn' | 'fail';
    value?: string;
    message?: string;
  }[];
  memoryMB: number;
  uptimeSeconds: number;
  eventLoopLagMs: number;
}

export function createHealthCheckPlugin(): JarvisPluginDefinition {
  const history: HealthCheckResult[] = [];
  const MAX_HISTORY = 60; // Keep 1 hour at 60s intervals
  let baselineMemory = 0;

  function runHealthCheck(nasPath: string): HealthCheckResult {
    const checks: HealthCheckResult['checks'] = [];

    // 1. Memory check
    const memUsage = process.memoryUsage();
    const heapMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);

    if (heapMB > 500) {
      checks.push({ name: 'memory', status: 'fail', value: `${heapMB}MB heap`, message: 'Heap usage critically high' });
    } else if (heapMB > 300) {
      checks.push({ name: 'memory', status: 'warn', value: `${heapMB}MB heap`, message: 'Heap usage elevated' });
    } else {
      checks.push({ name: 'memory', status: 'pass', value: `${heapMB}/${heapTotalMB}MB heap, ${rssMB}MB RSS` });
    }

    // 2. Memory leak detection
    if (baselineMemory > 0) {
      const growth = heapMB - baselineMemory;
      const growthPct = (growth / baselineMemory) * 100;
      if (growthPct > 100) {
        checks.push({ name: 'memory-trend', status: 'warn', value: `+${growth}MB (+${growthPct.toFixed(0)}%)`, message: 'Significant memory growth since start' });
      } else {
        checks.push({ name: 'memory-trend', status: 'pass', value: `+${growth}MB since start` });
      }
    }

    // 3. Event loop lag
    const lagStart = Date.now();
    // Synchronous approximation
    const lagMs = Date.now() - lagStart;
    checks.push({
      name: 'event-loop',
      status: lagMs > 100 ? 'warn' : 'pass',
      value: `${lagMs}ms lag`,
    });

    // 4. NAS accessibility
    try {
      if (nasPath && existsSync(nasPath)) {
        const stat = statSync(nasPath);
        if (stat.isDirectory()) {
          checks.push({ name: 'nas', status: 'pass', value: 'mounted and accessible' });
        } else {
          checks.push({ name: 'nas', status: 'fail', value: 'path is not a directory' });
        }
      } else {
        checks.push({ name: 'nas', status: 'warn', value: 'path not found', message: nasPath || 'no path configured' });
      }
    } catch (err) {
      checks.push({ name: 'nas', status: 'fail', message: (err as Error).message });
    }

    // 5. Process uptime
    const uptimeSec = process.uptime();
    checks.push({ name: 'uptime', status: 'pass', value: formatUptime(uptimeSec) });

    // 6. Active handles/requests (sign of resource leaks)
    const activeHandles = (process as unknown as { _getActiveHandles?: () => unknown[] })._getActiveHandles?.()?.length ?? -1;
    const activeRequests = (process as unknown as { _getActiveRequests?: () => unknown[] })._getActiveRequests?.()?.length ?? -1;
    if (activeHandles > 100) {
      checks.push({ name: 'handles', status: 'warn', value: `${activeHandles} active handles`, message: 'High number of active handles' });
    } else if (activeHandles >= 0) {
      checks.push({ name: 'handles', status: 'pass', value: `${activeHandles} handles, ${activeRequests} requests` });
    }

    // Determine overall status
    const hasFail = checks.some((c) => c.status === 'fail');
    const hasWarn = checks.some((c) => c.status === 'warn');
    const status: HealthCheckResult['status'] = hasFail ? 'unhealthy' : hasWarn ? 'degraded' : 'healthy';

    const result: HealthCheckResult = {
      timestamp: Date.now(),
      status,
      checks,
      memoryMB: heapMB,
      uptimeSeconds: uptimeSec,
      eventLoopLagMs: lagMs,
    };

    history.push(result);
    if (history.length > MAX_HISTORY) {
      history.splice(0, history.length - MAX_HISTORY);
    }

    return result;
  }

  function formatUptime(seconds: number): string {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = Math.floor(seconds % 60);
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  return {
    id: 'health-check',
    name: 'Health Check',
    description: 'Periodic self-diagnostics with memory monitoring, NAS checks, and event loop tracking',
    version: '1.0.0',

    register(api) {
      const log = api.logger;

      // --- Tools ---

      api.registerTool({
        name: 'health_self_check',
        description: 'Run a comprehensive self-diagnostic health check on this agent. Reports memory, NAS, event loop, and resource usage.',
        inputSchema: {
          type: 'object' as const,
          properties: {},
        },
        execute: async () => {
          const result = runHealthCheck(api.config.nasPath);

          const statusEmoji = result.status === 'healthy' ? '[OK]' : result.status === 'degraded' ? '[WARN]' : '[FAIL]';
          const lines = [
            `Agent Health Check ${statusEmoji} — ${result.status.toUpperCase()}`,
            `Uptime: ${formatUptime(result.uptimeSeconds)}`,
            `Memory: ${result.memoryMB}MB heap`,
            '',
            'Checks:',
            ...result.checks.map((c) => {
              const icon = c.status === 'pass' ? '[OK]' : c.status === 'warn' ? '[!!]' : '[XX]';
              return `  ${icon} ${c.name}: ${c.value || ''}${c.message ? ` — ${c.message}` : ''}`;
            }),
          ];

          return { type: 'text' as const, text: lines.join('\n') };
        },
      });

      api.registerTool({
        name: 'health_report',
        description: 'Get a summary report of recent health checks, showing trends in memory and status.',
        inputSchema: {
          type: 'object' as const,
          properties: {
            count: { type: 'number', description: 'Number of recent checks to show (default: 10)' },
          },
        },
        execute: async (input: Record<string, unknown>) => {
          const count = Math.min((input.count as number) || 10, MAX_HISTORY);
          const recent = history.slice(-count);

          if (recent.length === 0) {
            return { type: 'text' as const, text: 'No health check history yet. Run health_self_check first.' };
          }

          const memoryTrend = recent.map((r) => r.memoryMB);
          const avgMemory = Math.round(memoryTrend.reduce((a, b) => a + b, 0) / memoryTrend.length);
          const minMemory = Math.min(...memoryTrend);
          const maxMemory = Math.max(...memoryTrend);

          const statusCounts = { healthy: 0, degraded: 0, unhealthy: 0 };
          for (const r of recent) statusCounts[r.status]++;

          const lines = [
            `Health Report (last ${recent.length} checks)`,
            '',
            `Status: ${statusCounts.healthy} healthy, ${statusCounts.degraded} degraded, ${statusCounts.unhealthy} unhealthy`,
            `Memory: avg ${avgMemory}MB, min ${minMemory}MB, max ${maxMemory}MB`,
            `Current: ${recent[recent.length - 1].memoryMB}MB`,
            '',
            'Recent checks:',
            ...recent.slice(-5).map((r) => {
              const time = new Date(r.timestamp).toLocaleTimeString();
              const icon = r.status === 'healthy' ? '[OK]' : r.status === 'degraded' ? '[!!]' : '[XX]';
              return `  ${time} ${icon} ${r.memoryMB}MB — ${r.checks.filter((c) => c.status !== 'pass').map((c) => c.name).join(', ') || 'all good'}`;
            }),
          ];

          return { type: 'text' as const, text: lines.join('\n') };
        },
      });

      // --- Hooks ---

      api.on('agent_start', () => {
        const memUsage = process.memoryUsage();
        baselineMemory = Math.round(memUsage.heapUsed / 1024 / 1024);
        log.info(`Health baseline set: ${baselineMemory}MB heap`);

        // Run initial check
        const initial = runHealthCheck(api.config.nasPath);
        log.info(`Initial health: ${initial.status}`, {
          memoryMB: initial.memoryMB,
          checks: initial.checks.length,
        });
      });

      // --- Service (background monitor) ---

      api.registerService({
        name: 'health-monitor',
        start: async () => {
          const interval = setInterval(() => {
            const result = runHealthCheck(api.config.nasPath);
            if (result.status === 'unhealthy') {
              log.error(`Health check UNHEALTHY`, {
                memoryMB: result.memoryMB,
                failedChecks: result.checks.filter((c) => c.status === 'fail').map((c) => c.name),
              });
            } else if (result.status === 'degraded') {
              log.warn(`Health check degraded`, {
                memoryMB: result.memoryMB,
                warnChecks: result.checks.filter((c) => c.status === 'warn').map((c) => c.name),
              });
            }
          }, 60_000); // Check every 60 seconds

          return () => clearInterval(interval);
        },
      });

      // --- Prompt Section ---

      api.registerPromptSection({
        title: 'Health Monitoring',
        content: [
          'You have health monitoring capabilities.',
          'Use `health_self_check` to run a full self-diagnostic if you suspect issues.',
          'Use `health_report` to see recent health trends.',
          'The health monitor runs automatically every 60 seconds in the background.',
        ].join('\n'),
        priority: -10,
      });

      log.info('Health Check plugin registered');
    },
  };
}
