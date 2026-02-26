/**
 * Cron Scheduler Tool
 *
 * General-purpose scheduled task system for Jarvis agents.
 * Stores jobs as JSON on NAS, runs a tick-based scheduler.
 *
 * Features:
 *   - Cron expression support (via cron-parser-like logic)
 *   - One-shot (at specific time) and recurring (cron) jobs
 *   - Job history tracking
 *   - NATS-based job dispatch to agents
 *   - Persistence on NAS
 */

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';

// ─── Types ───────────────────────────────────────────────────────────

export interface CronSchedulerConfig {
  /** Path to NAS jobs directory */
  jobsDir?: string;
  /** Interval for checking jobs (ms, default: 60000) */
  tickInterval?: number;
  /** Callback when a job fires */
  onJobFire?: (job: ScheduledJob) => Promise<void>;
}

export interface ScheduledJob {
  id: string;
  name: string;
  description?: string;
  /** Cron expression (e.g., "0 9 * * 1-5" = 9AM weekdays) */
  cron?: string;
  /** ISO datetime for one-shot execution */
  at?: string;
  /** Which agent should handle this */
  targetAgent?: string;
  /** Task instruction to send to agent */
  taskInstruction: string;
  /** Priority (1-10) */
  priority?: number;
  /** Whether job is active */
  enabled: boolean;
  /** Created timestamp */
  createdAt: string;
  /** Last execution time */
  lastRun?: string;
  /** Next scheduled execution */
  nextRun?: string;
  /** Number of times executed */
  runCount: number;
  /** Tags for organization */
  tags?: string[];
  /** Max executions (0 = unlimited) */
  maxRuns?: number;
}

interface JobExecution {
  jobId: string;
  executedAt: string;
  status: 'dispatched' | 'completed' | 'failed';
  result?: string;
}

type CronAction = 'list' | 'create' | 'delete' | 'enable' | 'disable' | 'update' | 'history' | 'next' | 'run_now';

// ─── Cron expression parser ──────────────────────────────────────────

interface CronFields {
  minute: number[];
  hour: number[];
  dayOfMonth: number[];
  month: number[];
  dayOfWeek: number[];
}

function parseRange(field: string, min: number, max: number): number[] {
  const values: number[] = [];

  for (const part of field.split(',')) {
    if (part === '*') {
      for (let i = min; i <= max; i++) values.push(i);
    } else if (part.includes('/')) {
      const [range, stepStr] = part.split('/');
      const step = parseInt(stepStr!, 10);
      let start = min;
      let end = max;
      if (range !== '*') {
        if (range!.includes('-')) {
          [start, end] = range!.split('-').map((n) => parseInt(n, 10)) as [number, number];
        } else {
          start = parseInt(range!, 10);
        }
      }
      for (let i = start; i <= end; i += step) values.push(i);
    } else if (part.includes('-')) {
      const [start, end] = part.split('-').map((n) => parseInt(n, 10)) as [number, number];
      for (let i = start; i <= end; i++) values.push(i);
    } else {
      values.push(parseInt(part, 10));
    }
  }

  return [...new Set(values)].sort((a, b) => a - b);
}

function parseCron(expression: string): CronFields {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression "${expression}" — expected 5 fields (minute hour dayOfMonth month dayOfWeek)`);
  }

  return {
    minute: parseRange(parts[0]!, 0, 59),
    hour: parseRange(parts[1]!, 0, 23),
    dayOfMonth: parseRange(parts[2]!, 1, 31),
    month: parseRange(parts[3]!, 1, 12),
    dayOfWeek: parseRange(parts[4]!, 0, 6), // 0=Sun
  };
}

function getNextCronDate(expression: string, after: Date = new Date()): Date {
  const fields = parseCron(expression);
  const date = new Date(after);
  date.setSeconds(0, 0);
  date.setMinutes(date.getMinutes() + 1);

  // Brute force search — check each minute up to 1 year
  const maxIterations = 525600; // minutes in a year
  for (let i = 0; i < maxIterations; i++) {
    if (
      fields.month.includes(date.getMonth() + 1) &&
      fields.dayOfMonth.includes(date.getDate()) &&
      fields.dayOfWeek.includes(date.getDay()) &&
      fields.hour.includes(date.getHours()) &&
      fields.minute.includes(date.getMinutes())
    ) {
      return date;
    }
    date.setMinutes(date.getMinutes() + 1);
  }

  throw new Error(`No matching time found for "${expression}" within the next year`);
}

function matchesCron(expression: string, date: Date): boolean {
  const fields = parseCron(expression);
  return (
    fields.minute.includes(date.getMinutes()) &&
    fields.hour.includes(date.getHours()) &&
    fields.dayOfMonth.includes(date.getDate()) &&
    fields.month.includes(date.getMonth() + 1) &&
    fields.dayOfWeek.includes(date.getDay())
  );
}

function describeCron(expression: string): string {
  const parts = expression.trim().split(/\s+/);
  if (parts.length !== 5) return expression;

  const [min, hour, dom, month, dow] = parts;

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  const parts_desc: string[] = [];

  if (min === '0' && hour !== '*') {
    parts_desc.push(`At ${hour}:00`);
  } else if (min !== '*' && hour !== '*') {
    parts_desc.push(`At ${hour}:${min!.padStart(2, '0')}`);
  } else if (min !== '*') {
    parts_desc.push(`At minute ${min}`);
  }

  if (dow !== '*') {
    const days = parseRange(dow!, 0, 6).map((d) => dayNames[d]).join(', ');
    parts_desc.push(`on ${days}`);
  }

  if (dom !== '*') {
    parts_desc.push(`on day ${dom}`);
  }

  if (month !== '*') {
    const months = parseRange(month!, 1, 12).map((m) => monthNames[m - 1]).join(', ');
    parts_desc.push(`in ${months}`);
  }

  return parts_desc.join(' ') || `Every minute matching: ${expression}`;
}

// ─── Scheduler engine ────────────────────────────────────────────────

export class CronScheduler {
  private jobsDir: string;
  private tickInterval: number;
  private onJobFire?: (job: ScheduledJob) => Promise<void>;
  private timer?: ReturnType<typeof setInterval>;
  private jobs: Map<string, ScheduledJob> = new Map();
  private history: JobExecution[] = [];

  constructor(config: CronSchedulerConfig = {}) {
    this.jobsDir = config.jobsDir || '/tmp/jarvis-cron-jobs';
    this.tickInterval = config.tickInterval || 60_000;
    this.onJobFire = config.onJobFire;
  }

  async start(): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
    await this.loadJobs();
    this.updateNextRuns();

    this.timer = setInterval(() => this.tick(), this.tickInterval);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async loadJobs(): Promise<void> {
    try {
      const files = await readdir(this.jobsDir);
      for (const file of files) {
        if (!file.endsWith('.json') || file === 'history.json') continue;
        try {
          const content = await readFile(join(this.jobsDir, file), 'utf-8');
          const job = JSON.parse(content) as ScheduledJob;
          this.jobs.set(job.id, job);
        } catch {
          // Skip corrupted files
        }
      }

      // Load history
      try {
        const histContent = await readFile(join(this.jobsDir, 'history.json'), 'utf-8');
        this.history = JSON.parse(histContent) as JobExecution[];
      } catch {
        this.history = [];
      }
    } catch {
      // Jobs dir doesn't exist yet
    }
  }

  private updateNextRuns(): void {
    const now = new Date();
    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;

      if (job.cron) {
        try {
          const next = getNextCronDate(job.cron, now);
          job.nextRun = next.toISOString();
        } catch {
          // Invalid cron
        }
      } else if (job.at) {
        const atDate = new Date(job.at);
        if (atDate > now) {
          job.nextRun = job.at;
        } else {
          job.nextRun = undefined;
          job.enabled = false; // One-shot already passed
        }
      }
    }
  }

  private async tick(): Promise<void> {
    const now = new Date();
    now.setSeconds(0, 0);

    for (const job of this.jobs.values()) {
      if (!job.enabled) continue;
      if (job.maxRuns && job.runCount >= job.maxRuns) {
        job.enabled = false;
        await this.saveJob(job);
        continue;
      }

      let shouldFire = false;

      if (job.cron) {
        shouldFire = matchesCron(job.cron, now);
      } else if (job.at) {
        const atDate = new Date(job.at);
        shouldFire = Math.abs(atDate.getTime() - now.getTime()) < this.tickInterval;
      }

      if (shouldFire) {
        job.lastRun = now.toISOString();
        job.runCount++;

        // One-shot jobs auto-disable
        if (job.at && !job.cron) {
          job.enabled = false;
        }

        // Update next run for recurring
        if (job.cron) {
          try {
            const next = getNextCronDate(job.cron, now);
            job.nextRun = next.toISOString();
          } catch {
            // ignore
          }
        }

        // Record execution
        const execution: JobExecution = {
          jobId: job.id,
          executedAt: now.toISOString(),
          status: 'dispatched',
        };
        this.history.push(execution);
        if (this.history.length > 1000) this.history = this.history.slice(-500);

        await this.saveJob(job);
        await this.saveHistory();

        // Fire callback
        if (this.onJobFire) {
          try {
            await this.onJobFire(job);
          } catch {
            execution.status = 'failed';
          }
        }
      }
    }
  }

  private async saveJob(job: ScheduledJob): Promise<void> {
    await mkdir(this.jobsDir, { recursive: true });
    await writeFile(join(this.jobsDir, `${job.id}.json`), JSON.stringify(job, null, 2));
  }

  private async saveHistory(): Promise<void> {
    await writeFile(join(this.jobsDir, 'history.json'), JSON.stringify(this.history, null, 2));
  }

  async deleteJob(id: string): Promise<void> {
    this.jobs.delete(id);
    try {
      const { unlink } = await import('node:fs/promises');
      await unlink(join(this.jobsDir, `${id}.json`));
    } catch {
      // Already deleted
    }
  }

  // ── Public API ──

  getJobs(): ScheduledJob[] {
    return Array.from(this.jobs.values());
  }

  getJob(id: string): ScheduledJob | undefined {
    return this.jobs.get(id);
  }

  async createJob(params: Partial<ScheduledJob> & { taskInstruction: string; name: string }): Promise<ScheduledJob> {
    const job: ScheduledJob = {
      id: params.id || randomUUID().slice(0, 8),
      name: params.name,
      description: params.description,
      cron: params.cron,
      at: params.at,
      targetAgent: params.targetAgent,
      taskInstruction: params.taskInstruction,
      priority: params.priority || 5,
      enabled: params.enabled !== false,
      createdAt: new Date().toISOString(),
      runCount: 0,
      tags: params.tags,
      maxRuns: params.maxRuns,
    };

    // Validate cron if provided
    if (job.cron) {
      parseCron(job.cron); // throws on invalid
      try {
        const next = getNextCronDate(job.cron);
        job.nextRun = next.toISOString();
      } catch {
        // ignore
      }
    }

    if (job.at) {
      const atDate = new Date(job.at);
      if (isNaN(atDate.getTime())) throw new Error(`Invalid "at" datetime: ${job.at}`);
      job.nextRun = job.at;
    }

    this.jobs.set(job.id, job);
    await this.saveJob(job);
    return job;
  }

  async updateJob(id: string, updates: Partial<ScheduledJob>): Promise<ScheduledJob | undefined> {
    const job = this.jobs.get(id);
    if (!job) return undefined;

    Object.assign(job, updates);
    if (updates.cron) {
      parseCron(updates.cron);
      try {
        job.nextRun = getNextCronDate(updates.cron).toISOString();
      } catch {
        // ignore
      }
    }

    await this.saveJob(job);
    return job;
  }

  getHistory(jobId?: string, limit: number = 50): JobExecution[] {
    let filtered = this.history;
    if (jobId) {
      filtered = filtered.filter((e) => e.jobId === jobId);
    }
    return filtered.slice(-limit);
  }
}

// ─── Tool class ──────────────────────────────────────────────────────

export class CronSchedulerTool implements AgentTool {
  private scheduler: CronScheduler;

  definition = {
    name: 'cron',
    description:
      'Schedule recurring and one-shot tasks. Actions: list (show all jobs), create (new job with cron expression or specific datetime), delete (remove job), enable/disable (toggle job), update (modify job), history (execution log), next (show upcoming executions), run_now (trigger job immediately).\n\nCron format: "minute hour dayOfMonth month dayOfWeek" (e.g., "0 9 * * 1-5" = 9AM weekdays, "*/30 * * * *" = every 30 min, "0 0 1 * *" = midnight on 1st of month).',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['list', 'create', 'delete', 'enable', 'disable', 'update', 'history', 'next', 'run_now'],
          description: 'Action to perform',
        },
        job_id: {
          type: 'string',
          description: 'Job ID (for delete, enable, disable, update, history, run_now)',
        },
        name: {
          type: 'string',
          description: 'Job name (for create)',
        },
        description: {
          type: 'string',
          description: 'Job description (for create)',
        },
        cron: {
          type: 'string',
          description: 'Cron expression for recurring jobs (e.g., "0 9 * * 1-5")',
        },
        at: {
          type: 'string',
          description: 'ISO datetime for one-shot jobs (e.g., "2025-01-15T14:30:00Z")',
        },
        target_agent: {
          type: 'string',
          description: 'Agent to handle the task (e.g., agent-smith, agent-johny)',
        },
        task_instruction: {
          type: 'string',
          description: 'Task instruction text to send to agent when job fires',
        },
        priority: {
          type: 'number',
          description: 'Priority 1-10 (default: 5)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for organization',
        },
        max_runs: {
          type: 'number',
          description: 'Max executions (0 = unlimited)',
        },
        updates: {
          type: 'object',
          description: 'Fields to update (for update action)',
        },
        limit: {
          type: 'number',
          description: 'Max history entries (default: 50)',
        },
      },
      required: ['action'],
    },
  };

  constructor(config: CronSchedulerConfig = {}) {
    this.scheduler = new CronScheduler(config);
  }

  getScheduler(): CronScheduler {
    return this.scheduler;
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as CronAction;

    try {
      switch (action) {
        case 'list': {
          const jobs = this.scheduler.getJobs();
          if (jobs.length === 0) {
            return createToolResult('No scheduled jobs. Use action "create" to add one.');
          }

          const lines = jobs.map((job) => {
            const status = job.enabled ? '✅ Active' : '⏸ Disabled';
            const schedule = job.cron ? describeCron(job.cron) : `Once at ${job.at}`;
            const next = job.nextRun ? new Date(job.nextRun).toLocaleString() : 'N/A';
            const lastRun = job.lastRun ? new Date(job.lastRun).toLocaleString() : 'Never';
            const target = job.targetAgent || 'any';
            const tags = job.tags?.length ? ` [${job.tags.join(', ')}]` : '';

            return [
              `─── ${job.name} (${job.id}) ${status}${tags}`,
              `    📅 ${schedule}`,
              `    ⏭ Next: ${next}`,
              `    🔄 Runs: ${job.runCount}${job.maxRuns ? `/${job.maxRuns}` : ''} | Last: ${lastRun}`,
              `    🤖 Agent: ${target} | Priority: ${job.priority || 5}`,
              `    📝 ${job.taskInstruction.slice(0, 100)}${job.taskInstruction.length > 100 ? '...' : ''}`,
            ].join('\n');
          });

          return createToolResult(`Scheduled Jobs (${jobs.length}):\n\n${lines.join('\n\n')}`);
        }

        case 'create': {
          const name = params['name'] as string;
          const taskInstruction = params['task_instruction'] as string;
          if (!name || !taskInstruction) {
            return createErrorResult('create requires "name" and "task_instruction" parameters.');
          }
          if (!params['cron'] && !params['at']) {
            return createErrorResult('create requires either "cron" (recurring) or "at" (one-shot) parameter.');
          }

          const job = await this.scheduler.createJob({
            name,
            description: params['description'] as string,
            cron: params['cron'] as string,
            at: params['at'] as string,
            targetAgent: params['target_agent'] as string,
            taskInstruction,
            priority: params['priority'] as number,
            tags: params['tags'] as string[],
            maxRuns: params['max_runs'] as number,
          });

          const schedule = job.cron ? describeCron(job.cron) : `Once at ${job.at}`;
          return createToolResult(
            `✅ Job created: ${job.name} (${job.id})\n📅 ${schedule}\n⏭ Next run: ${job.nextRun ? new Date(job.nextRun).toLocaleString() : 'N/A'}`,
          );
        }

        case 'delete': {
          const jobId = params['job_id'] as string;
          if (!jobId) return createErrorResult('delete requires "job_id"');
          const job = this.scheduler.getJob(jobId);
          if (!job) return createErrorResult(`Job not found: ${jobId}`);
          await this.scheduler.deleteJob(jobId);
          return createToolResult(`🗑 Job deleted: ${job.name} (${jobId})`);
        }

        case 'enable': {
          const jobId = params['job_id'] as string;
          if (!jobId) return createErrorResult('enable requires "job_id"');
          const job = await this.scheduler.updateJob(jobId, { enabled: true });
          if (!job) return createErrorResult(`Job not found: ${jobId}`);
          return createToolResult(`✅ Job enabled: ${job.name} (${jobId})`);
        }

        case 'disable': {
          const jobId = params['job_id'] as string;
          if (!jobId) return createErrorResult('disable requires "job_id"');
          const job = await this.scheduler.updateJob(jobId, { enabled: false });
          if (!job) return createErrorResult(`Job not found: ${jobId}`);
          return createToolResult(`⏸ Job disabled: ${job.name} (${jobId})`);
        }

        case 'update': {
          const jobId = params['job_id'] as string;
          const updates = params['updates'] as Record<string, unknown>;
          if (!jobId || !updates) return createErrorResult('update requires "job_id" and "updates"');
          const job = await this.scheduler.updateJob(jobId, updates as Partial<ScheduledJob>);
          if (!job) return createErrorResult(`Job not found: ${jobId}`);
          return createToolResult(`📝 Job updated: ${job.name} (${jobId})`);
        }

        case 'history': {
          const jobId = params['job_id'] as string;
          const limit = (params['limit'] as number) || 50;
          const entries = this.scheduler.getHistory(jobId, limit);

          if (entries.length === 0) {
            return createToolResult('No execution history.');
          }

          const lines = entries.map((e) => {
            const time = new Date(e.executedAt).toLocaleString();
            const statusIcon = e.status === 'completed' ? '✅' : e.status === 'failed' ? '❌' : '📤';
            return `  ${statusIcon} [${time}] Job: ${e.jobId} — ${e.status}${e.result ? ` — ${e.result.slice(0, 80)}` : ''}`;
          });

          return createToolResult(`Execution History (${entries.length} entries):\n\n${lines.join('\n')}`);
        }

        case 'next': {
          const jobs = this.scheduler.getJobs().filter((j) => j.enabled && j.nextRun);
          const sorted = jobs.sort((a, b) => new Date(a.nextRun!).getTime() - new Date(b.nextRun!).getTime());

          if (sorted.length === 0) {
            return createToolResult('No upcoming scheduled jobs.');
          }

          const lines = sorted.slice(0, 20).map((job) => {
            const next = new Date(job.nextRun!);
            const diff = next.getTime() - Date.now();
            const hours = Math.floor(diff / 3600000);
            const mins = Math.floor((diff % 3600000) / 60000);
            const timeStr = hours > 0 ? `in ${hours}h ${mins}m` : `in ${mins}m`;
            return `  ⏭ ${next.toLocaleString()} (${timeStr}) — ${job.name} → ${job.targetAgent || 'any'}`;
          });

          return createToolResult(`Upcoming Jobs:\n\n${lines.join('\n')}`);
        }

        case 'run_now': {
          const jobId = params['job_id'] as string;
          if (!jobId) return createErrorResult('run_now requires "job_id"');
          const job = this.scheduler.getJob(jobId);
          if (!job) return createErrorResult(`Job not found: ${jobId}`);

          // Directly fire the callback
          job.lastRun = new Date().toISOString();
          job.runCount++;

          if (this.scheduler['onJobFire']) {
            await this.scheduler['onJobFire'](job);
          }

          return createToolResult(`🚀 Job fired immediately: ${job.name} (${jobId})\nTask: ${job.taskInstruction}`);
        }

        default:
          return createErrorResult(`Unknown action: ${action}`);
      }
    } catch (err) {
      return createErrorResult(`Cron scheduler error: ${(err as Error).message}`);
    }
  }
}
