/**
 * System Monitor Plugin — Real-time hardware and system metrics.
 *
 * Provides agents with system health information:
 * - CPU usage (per-core and average)
 * - Memory usage (total, used, free, swap)
 * - Disk usage (per mount point)
 * - Network stats (bytes in/out)
 * - Process info (top consumers)
 * - macOS-specific: thermal, battery, uptime
 *
 * Tools:
 * - system_monitor: Get system metrics (cpu, memory, disk, network, process, all)
 * - system_health_check: Quick health assessment with alerts
 *
 * Hooks:
 * - agent_start: Log initial system state
 *
 * Data collected via Node.js os module + macOS system_profiler/top/df commands.
 */

import { execSync } from 'node:child_process';
import { cpus, totalmem, freemem, uptime, hostname, platform, arch, loadavg, networkInterfaces } from 'node:os';
import type { JarvisPluginDefinition } from '../types.js';

/** Timeout for shell commands (e.g. df, ps, sysctl) in milliseconds */
const EXEC_TIMEOUT_MS = 5000;
/** CPU load threshold multiplier — critical */
const CPU_LOAD_CRITICAL = 0.9;
/** CPU load threshold multiplier — warning */
const CPU_LOAD_WARNING = 0.7;
/** Memory usage threshold — critical (percent) */
const MEMORY_CRITICAL_PCT = 90;
/** Memory usage threshold — warning (percent) */
const MEMORY_WARNING_PCT = 75;
/** Disk usage threshold — critical (percent) */
const DISK_CRITICAL_PCT = 90;
/** Disk usage threshold — warning (percent) */
const DISK_WARNING_PCT = 80;

// ─── Types ────────────────────────────────────────────────────────────

interface CpuMetrics {
  cores: number;
  model: string;
  loadAvg: [number, number, number];
  usagePercent: number;
  perCore: Array<{ user: number; system: number; idle: number }>;
}

interface MemoryMetrics {
  totalGB: number;
  usedGB: number;
  freeGB: number;
  usagePercent: number;
  swapTotalGB: number;
  swapUsedGB: number;
}

interface DiskMetrics {
  mounts: Array<{
    filesystem: string;
    mount: string;
    totalGB: number;
    usedGB: number;
    freeGB: number;
    usagePercent: number;
  }>;
}

interface NetworkMetrics {
  interfaces: Array<{
    name: string;
    address: string;
    family: string;
    mac: string;
    internal: boolean;
  }>;
  connections?: number;
}

interface ProcessMetrics {
  topCpu: Array<{ pid: number; name: string; cpu: number; mem: number }>;
  topMem: Array<{ pid: number; name: string; cpu: number; mem: number }>;
  totalProcesses: number;
}

interface SystemOverview {
  hostname: string;
  platform: string;
  arch: string;
  uptime: string;
  uptimeSeconds: number;
  nodeVersion: string;
  timestamp: string;
}

interface HealthAlert {
  level: 'ok' | 'warning' | 'critical';
  component: string;
  message: string;
  value: number;
  threshold: number;
}

// ─── Metric Collectors ────────────────────────────────────────────────

function getCpuMetrics(): CpuMetrics {
  const cpuInfo = cpus();
  const model = cpuInfo[0]?.model ?? 'unknown';
  const cores = cpuInfo.length;
  const load = loadavg() as [number, number, number];

  // Calculate per-core usage from cpu times
  const perCore = cpuInfo.map(core => {
    const total = core.times.user + core.times.nice + core.times.sys + core.times.idle + core.times.irq;
    const idle = core.times.idle;
    const used = total - idle;
    return {
      user: Math.round((core.times.user / total) * 100),
      system: Math.round((core.times.sys / total) * 100),
      idle: Math.round((idle / total) * 100),
    };
  });

  // Average usage across cores
  const avgUsage = perCore.reduce((sum, c) => sum + (100 - c.idle), 0) / perCore.length;

  return {
    cores,
    model: model.trim(),
    loadAvg: load,
    usagePercent: Math.round(avgUsage),
    perCore,
  };
}

function getMemoryMetrics(): MemoryMetrics {
  const totalBytes = totalmem();
  const freeBytes = freemem();
  const usedBytes = totalBytes - freeBytes;

  // Get swap info on macOS
  let swapTotal = 0;
  let swapUsed = 0;
  if (platform() === 'darwin') {
    try {
      const swapInfo = execSync('sysctl -n vm.swapusage', { timeout: EXEC_TIMEOUT_MS }).toString().trim();
      // Format: "total = 2048.00M  used = 1024.00M  free = 1024.00M  (encrypted)"
      const totalMatch = swapInfo.match(/total\s*=\s*([\d.]+)M/);
      const usedMatch = swapInfo.match(/used\s*=\s*([\d.]+)M/);
      if (totalMatch) swapTotal = parseFloat(totalMatch[1]) / 1024;
      if (usedMatch) swapUsed = parseFloat(usedMatch[1]) / 1024;
    } catch { /* ignore */ }
  }

  return {
    totalGB: round2(totalBytes / (1024 ** 3)),
    usedGB: round2(usedBytes / (1024 ** 3)),
    freeGB: round2(freeBytes / (1024 ** 3)),
    usagePercent: Math.round((usedBytes / totalBytes) * 100),
    swapTotalGB: round2(swapTotal),
    swapUsedGB: round2(swapUsed),
  };
}

function getDiskMetrics(): DiskMetrics {
  const mounts: DiskMetrics['mounts'] = [];

  try {
    const dfOutput = execSync('df -g 2>/dev/null || df -BG 2>/dev/null', { timeout: EXEC_TIMEOUT_MS }).toString().trim();
    const lines = dfOutput.split('\n').slice(1); // Skip header

    for (const line of lines) {
      const parts = line.split(/\s+/);
      if (parts.length < 6) continue;

      const filesystem = parts[0];
      // Skip pseudo-filesystems
      if (filesystem.startsWith('devfs') || filesystem.startsWith('map ') || filesystem === 'none') continue;

      const totalGB = parseInt(parts[1]) || 0;
      const usedGB = parseInt(parts[2]) || 0;
      const freeGB = parseInt(parts[3]) || 0;
      const usageStr = parts[4];
      const mount = parts.slice(5).join(' ');

      // Only show real mounts
      if (mount.startsWith('/private/var/') && !mount.includes('vm')) continue;
      if (totalGB === 0) continue;

      mounts.push({
        filesystem,
        mount,
        totalGB,
        usedGB,
        freeGB,
        usagePercent: parseInt(usageStr) || 0,
      });
    }
  } catch { /* ignore */ }

  return { mounts };
}

function getNetworkMetrics(): NetworkMetrics {
  const ifaces = networkInterfaces();
  const interfaces: NetworkMetrics['interfaces'] = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' || addr.family === 'IPv6') {
        interfaces.push({
          name,
          address: addr.address,
          family: addr.family,
          mac: addr.mac,
          internal: addr.internal,
        });
      }
    }
  }

  // Get connection count on macOS
  let connections: number | undefined;
  if (platform() === 'darwin') {
    try {
      const netstat = execSync('netstat -an 2>/dev/null | grep ESTABLISHED | wc -l', { timeout: EXEC_TIMEOUT_MS }).toString().trim();
      connections = parseInt(netstat) || 0;
    } catch { /* ignore */ }
  }

  return { interfaces, connections };
}

function getProcessMetrics(): ProcessMetrics {
  const topCpu: ProcessMetrics['topCpu'] = [];
  const topMem: ProcessMetrics['topMem'] = [];
  let totalProcesses = 0;

  if (platform() === 'darwin') {
    try {
      // Get top CPU consumers
      const psOutput = execSync(
        'ps -Arcww -o pid,pcpu,pmem,comm | head -11',
        { timeout: EXEC_TIMEOUT_MS },
      ).toString().trim();

      const lines = psOutput.split('\n').slice(1); // Skip header
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        const pid = parseInt(parts[0]);
        const cpu = parseFloat(parts[1]);
        const mem = parseFloat(parts[2]);
        const name = parts.slice(3).join(' ');
        topCpu.push({ pid, name, cpu, mem });
      }

      // Get top memory consumers
      const memOutput = execSync(
        'ps -Amcww -o pid,pcpu,pmem,comm | head -11',
        { timeout: EXEC_TIMEOUT_MS },
      ).toString().trim();

      const memLines = memOutput.split('\n').slice(1);
      for (const line of memLines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 4) continue;
        topMem.push({
          pid: parseInt(parts[0]),
          cpu: parseFloat(parts[1]),
          mem: parseFloat(parts[2]),
          name: parts.slice(3).join(' '),
        });
      }

      // Total process count
      const countOutput = execSync('ps -Ae | wc -l', { timeout: EXEC_TIMEOUT_MS }).toString().trim();
      totalProcesses = parseInt(countOutput) || 0;
    } catch { /* ignore */ }
  }

  return { topCpu, topMem, totalProcesses };
}

function getSystemOverview(): SystemOverview {
  const uptimeSecs = uptime();
  const hours = Math.floor(uptimeSecs / 3600);
  const minutes = Math.floor((uptimeSecs % 3600) / 60);
  const days = Math.floor(hours / 24);

  return {
    hostname: hostname(),
    platform: `${platform()} ${arch()}`,
    arch: arch(),
    uptime: days > 0 ? `${days}d ${hours % 24}h ${minutes}m` : `${hours}h ${minutes}m`,
    uptimeSeconds: Math.round(uptimeSecs),
    nodeVersion: process.version,
    timestamp: new Date().toISOString(),
  };
}

function getMacOSThermal(): string {
  if (platform() !== 'darwin') return 'N/A (not macOS)';
  try {
    const thermal = execSync('pmset -g therm 2>/dev/null', { timeout: EXEC_TIMEOUT_MS }).toString().trim();
    if (thermal.includes('CPU_Speed_Limit')) {
      const match = thermal.match(/CPU_Speed_Limit\s*=\s*(\d+)/);
      if (match) {
        const limit = parseInt(match[1]);
        if (limit === 100) return 'Normal (no throttling)';
        return `Throttled to ${limit}%`;
      }
    }
    return 'Normal';
  } catch {
    return 'Unknown';
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ─── Health Check ─────────────────────────────────────────────────────

function runHealthCheck(): { status: 'healthy' | 'warning' | 'critical'; alerts: HealthAlert[] } {
  const alerts: HealthAlert[] = [];
  const mem = getMemoryMetrics();
  const disk = getDiskMetrics();
  const cpu = getCpuMetrics();

  // CPU
  if (cpu.loadAvg[0] > cpu.cores * CPU_LOAD_CRITICAL) {
    alerts.push({
      level: 'critical',
      component: 'CPU',
      message: `Load average ${cpu.loadAvg[0].toFixed(1)} exceeds ${cpu.cores} cores * ${CPU_LOAD_CRITICAL}`,
      value: cpu.loadAvg[0],
      threshold: cpu.cores * CPU_LOAD_CRITICAL,
    });
  } else if (cpu.loadAvg[0] > cpu.cores * CPU_LOAD_WARNING) {
    alerts.push({
      level: 'warning',
      component: 'CPU',
      message: `Load average ${cpu.loadAvg[0].toFixed(1)} is high (${cpu.cores} cores)`,
      value: cpu.loadAvg[0],
      threshold: cpu.cores * CPU_LOAD_WARNING,
    });
  } else {
    alerts.push({
      level: 'ok',
      component: 'CPU',
      message: `Load average ${cpu.loadAvg[0].toFixed(1)} / ${cpu.cores} cores`,
      value: cpu.loadAvg[0],
      threshold: cpu.cores * CPU_LOAD_WARNING,
    });
  }

  // Memory
  if (mem.usagePercent > MEMORY_CRITICAL_PCT) {
    alerts.push({
      level: 'critical',
      component: 'Memory',
      message: `${mem.usagePercent}% used (${mem.usedGB}GB / ${mem.totalGB}GB)`,
      value: mem.usagePercent,
      threshold: MEMORY_CRITICAL_PCT,
    });
  } else if (mem.usagePercent > MEMORY_WARNING_PCT) {
    alerts.push({
      level: 'warning',
      component: 'Memory',
      message: `${mem.usagePercent}% used (${mem.usedGB}GB / ${mem.totalGB}GB)`,
      value: mem.usagePercent,
      threshold: MEMORY_WARNING_PCT,
    });
  } else {
    alerts.push({
      level: 'ok',
      component: 'Memory',
      message: `${mem.usagePercent}% used (${mem.freeGB}GB free)`,
      value: mem.usagePercent,
      threshold: MEMORY_WARNING_PCT,
    });
  }

  // Disk
  for (const mount of disk.mounts) {
    if (mount.usagePercent > DISK_CRITICAL_PCT) {
      alerts.push({
        level: 'critical',
        component: `Disk ${mount.mount}`,
        message: `${mount.usagePercent}% used (${mount.freeGB}GB free)`,
        value: mount.usagePercent,
        threshold: DISK_CRITICAL_PCT,
      });
    } else if (mount.usagePercent > DISK_WARNING_PCT) {
      alerts.push({
        level: 'warning',
        component: `Disk ${mount.mount}`,
        message: `${mount.usagePercent}% used (${mount.freeGB}GB free)`,
        value: mount.usagePercent,
        threshold: DISK_WARNING_PCT,
      });
    } else {
      alerts.push({
        level: 'ok',
        component: `Disk ${mount.mount}`,
        message: `${mount.usagePercent}% used (${mount.freeGB}GB free)`,
        value: mount.usagePercent,
        threshold: DISK_WARNING_PCT,
      });
    }
  }

  // Overall status
  const hasCritical = alerts.some(a => a.level === 'critical');
  const hasWarning = alerts.some(a => a.level === 'warning');
  const status = hasCritical ? 'critical' : hasWarning ? 'warning' : 'healthy';

  return { status, alerts };
}

// ─── Formatters ───────────────────────────────────────────────────────

function formatCpuReport(cpu: CpuMetrics): string {
  const lines = [
    `CPU: ${cpu.model}`,
    `Cores: ${cpu.cores}`,
    `Average Usage: ${cpu.usagePercent}%`,
    `Load Average: ${cpu.loadAvg.map(l => l.toFixed(2)).join(' / ')} (1m/5m/15m)`,
    '',
    'Per-Core Usage:',
  ];

  for (let i = 0; i < Math.min(cpu.perCore.length, 16); i++) {
    const c = cpu.perCore[i];
    const bar = buildBar(100 - c.idle, 20);
    lines.push(`  Core ${i.toString().padStart(2, ' ')}: [${bar}] ${(100 - c.idle).toString().padStart(3, ' ')}% (usr: ${c.user}%, sys: ${c.system}%)`);
  }
  if (cpu.perCore.length > 16) {
    lines.push(`  ... and ${cpu.perCore.length - 16} more cores`);
  }

  return lines.join('\n');
}

function formatMemoryReport(mem: MemoryMetrics): string {
  const bar = buildBar(mem.usagePercent, 30);
  return [
    `Memory Usage: [${bar}] ${mem.usagePercent}%`,
    `Total: ${mem.totalGB} GB`,
    `Used:  ${mem.usedGB} GB`,
    `Free:  ${mem.freeGB} GB`,
    mem.swapTotalGB > 0 ? `Swap:  ${mem.swapUsedGB} / ${mem.swapTotalGB} GB` : 'Swap: N/A',
  ].join('\n');
}

function formatDiskReport(disk: DiskMetrics): string {
  if (disk.mounts.length === 0) return 'No disk info available.';

  const lines = ['Disk Usage:'];
  for (const m of disk.mounts) {
    const bar = buildBar(m.usagePercent, 20);
    lines.push(`  ${m.mount.padEnd(20)} [${bar}] ${m.usagePercent.toString().padStart(3)}%  (${m.usedGB}/${m.totalGB} GB)`);
  }
  return lines.join('\n');
}

function formatNetworkReport(net: NetworkMetrics): string {
  const lines = ['Network Interfaces:'];
  const external = net.interfaces.filter(i => !i.internal && i.family === 'IPv4');

  for (const iface of external) {
    lines.push(`  ${iface.name.padEnd(10)} ${iface.address.padEnd(16)} (${iface.mac})`);
  }
  if (net.connections !== undefined) {
    lines.push(`\nActive connections: ${net.connections}`);
  }
  return lines.join('\n');
}

function formatProcessReport(proc: ProcessMetrics): string {
  const lines = [
    `Total Processes: ${proc.totalProcesses}`,
    '',
    'Top CPU:',
  ];

  for (const p of proc.topCpu.slice(0, 8)) {
    lines.push(`  ${p.pid.toString().padStart(6)}  ${p.cpu.toFixed(1).padStart(5)}% CPU  ${p.mem.toFixed(1).padStart(5)}% MEM  ${p.name}`);
  }

  lines.push('');
  lines.push('Top Memory:');
  for (const p of proc.topMem.slice(0, 8)) {
    lines.push(`  ${p.pid.toString().padStart(6)}  ${p.cpu.toFixed(1).padStart(5)}% CPU  ${p.mem.toFixed(1).padStart(5)}% MEM  ${p.name}`);
  }

  return lines.join('\n');
}

function buildBar(percent: number, width: number): string {
  const filled = Math.round((percent / 100) * width);
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

// ─── Plugin ───────────────────────────────────────────────────────────

export function createSystemMonitorPlugin(): JarvisPluginDefinition {
  return {
    id: 'jarvis-system-monitor',
    name: 'System Monitor',
    description: 'Real-time CPU, memory, disk, and network monitoring',
    version: '1.0.0',

    register(api) {
      const log = api.logger;

      // ─── Tool: system_monitor ─────────────────────────────────

      api.registerTool({
        definition: {
          name: 'system_monitor',
          description: [
            'Get real-time system metrics for the current machine.',
            'Returns CPU, memory, disk, network, and process information.',
            '',
            'Sections:',
            '  cpu      — CPU model, core count, load average, per-core usage',
            '  memory   — RAM/swap total/used/free with percentage',
            '  disk     — Per-mount disk usage with bar charts',
            '  network  — Network interfaces, IPs, active connections',
            '  process  — Top CPU/memory consuming processes',
            '  thermal  — macOS thermal throttling status',
            '  overview — Hostname, platform, uptime, Node version',
            '  all      — Everything combined',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {
              section: {
                type: 'string',
                enum: ['cpu', 'memory', 'disk', 'network', 'process', 'thermal', 'overview', 'all'],
                description: 'Which metrics section to retrieve. Default: all',
              },
            },
          },
        },
        execute: async (params) => {
          const section = (params.section as string) || 'all';
          const parts: string[] = [];

          const overview = getSystemOverview();

          if (section === 'all' || section === 'overview') {
            parts.push([
              `═══ System Overview ═══`,
              `Host: ${overview.hostname}`,
              `Platform: ${overview.platform}`,
              `Uptime: ${overview.uptime}`,
              `Node: ${overview.nodeVersion}`,
              `Time: ${overview.timestamp}`,
            ].join('\n'));
          }

          if (section === 'all' || section === 'cpu') {
            parts.push(`═══ CPU ═══\n${formatCpuReport(getCpuMetrics())}`);
          }

          if (section === 'all' || section === 'memory') {
            parts.push(`═══ Memory ═══\n${formatMemoryReport(getMemoryMetrics())}`);
          }

          if (section === 'all' || section === 'disk') {
            parts.push(`═══ Disk ═══\n${formatDiskReport(getDiskMetrics())}`);
          }

          if (section === 'all' || section === 'network') {
            parts.push(`═══ Network ═══\n${formatNetworkReport(getNetworkMetrics())}`);
          }

          if (section === 'all' || section === 'process') {
            parts.push(`═══ Processes ═══\n${formatProcessReport(getProcessMetrics())}`);
          }

          if (section === 'all' || section === 'thermal') {
            parts.push(`═══ Thermal ═══\n${getMacOSThermal()}`);
          }

          return { type: 'text', content: parts.join('\n\n') };
        },
      });

      // ─── Tool: system_health_check ────────────────────────────

      api.registerTool({
        definition: {
          name: 'system_health_check',
          description: [
            'Quick system health check with alerts.',
            'Returns OK/WARNING/CRITICAL status for CPU, memory, and disk.',
            'Use this before running resource-intensive tasks.',
          ].join('\n'),
          input_schema: {
            type: 'object',
            properties: {},
          },
        },
        execute: async () => {
          const health = runHealthCheck();
          const overview = getSystemOverview();

          const statusIcon = health.status === 'healthy' ? '✅' : health.status === 'warning' ? '⚠️' : '🔴';
          const lines = [
            `${statusIcon} System Health: ${health.status.toUpperCase()}`,
            `Host: ${overview.hostname} | Uptime: ${overview.uptime}`,
            '',
          ];

          for (const alert of health.alerts) {
            const icon = alert.level === 'ok' ? '✅' : alert.level === 'warning' ? '⚠️' : '🔴';
            lines.push(`  ${icon} ${alert.component}: ${alert.message}`);
          }

          return { type: 'text', content: lines.join('\n') };
        },
      });

      // ─── Hooks ────────────────────────────────────────────────

      api.on('agent_start', (event) => {
        const mem = getMemoryMetrics();
        const cpu = getCpuMetrics();
        log.info(
          `[system-monitor] Agent ${event.agentId} starting on ${event.hostname} — ` +
          `CPU: ${cpu.cores} cores, ${cpu.loadAvg[0].toFixed(1)} load | ` +
          `Memory: ${mem.usedGB}/${mem.totalGB}GB (${mem.usagePercent}%)`
        );
      });

      // ─── Prompt Section ───────────────────────────────────────

      api.registerPromptSection({
        title: 'System Monitoring',
        priority: 3,
        content: [
          '### System Monitor',
          '',
          'Use `system_monitor` to check machine resources:',
          '- CPU usage, load average, per-core stats',
          '- Memory (RAM + swap) usage',
          '- Disk space per mount point',
          '- Network interfaces and connections',
          '- Top CPU/memory consuming processes',
          '',
          'Use `system_health_check` for a quick health assessment before heavy tasks.',
        ].join('\n'),
      });

      log.info('[system-monitor] System Monitor plugin registered with 2 tools + 1 hook + prompt section');
    },
  };
}
