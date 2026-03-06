import { createLogger } from '@jarvis/shared';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const log = createLogger('monitoring:daily-summary');

export interface DailySummaryConfig {
  nasBasePath: string;
  obsidianApiUrl?: string;
  obsidianApiKey?: string;
  summaryHour: number;  // 0-23
  summaryMinute: number; // 0-59
}

export interface HealthSnapshot {
  agents: Array<{
    id: string;
    role: string;
    status: string;
    alive: boolean;
  }>;
  infrastructure: {
    nats: boolean;
    redis: boolean;
    nas: { mounted: boolean };
  };
}

export interface CostBreakdown {
  byAgent: Record<string, { calls: number; tokens: number; costUsd: number }>;
  total: { calls: number; tokens: number; costUsd: number };
}

/**
 * DailySummaryScheduler — generates end-of-day Markdown summaries,
 * saves to NAS and optionally appends to Obsidian daily note.
 */
export class DailySummaryScheduler {
  private interval: ReturnType<typeof setInterval> | null = null;
  private lastGeneratedDate: string | null = null;

  constructor(
    private readonly config: DailySummaryConfig,
    private readonly getHealth: () => Promise<HealthSnapshot>,
    private readonly getCosts: () => CostBreakdown,
  ) {}

  start(): void {
    // Check every 60s if it's time to generate
    this.interval = setInterval(() => {
      this.checkAndGenerate().catch((err) => {
        log.error(`Daily summary check error: ${(err as Error).message}`);
      });
    }, 60_000);
    log.info(`Daily summary scheduler started (${this.config.summaryHour}:${String(this.config.summaryMinute).padStart(2, '0')})`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
  }

  private async checkAndGenerate(): Promise<void> {
    const now = new Date();
    if (now.getHours() !== this.config.summaryHour || now.getMinutes() !== this.config.summaryMinute) return;

    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    if (this.lastGeneratedDate === dateStr) return; // already generated today
    this.lastGeneratedDate = dateStr;

    log.info(`Generating daily summary for ${dateStr}`);
    const md = await this.generateSummary(dateStr);
    await this.saveToNas(dateStr, md);
    await this.appendToObsidian(md);
    log.info(`Daily summary saved for ${dateStr}`);
  }

  /** Generate markdown summary — also callable via RPC */
  async generateSummary(date?: string): Promise<string> {
    const dateStr = date ?? new Date().toISOString().slice(0, 10);
    const health = await this.getHealth();
    const costs = this.getCosts();

    const lines: string[] = [];
    lines.push(`## Jarvis Daily Summary: ${dateStr}`);
    lines.push('');

    // Agent Status
    lines.push('### Agent Status');
    if (health.agents.length === 0) {
      lines.push('- No agents registered');
    } else {
      for (const agent of health.agents) {
        const statusIcon = agent.alive ? 'online' : 'offline';
        lines.push(`- ${agent.id} (${agent.role}): ${statusIcon}`);
      }
    }
    lines.push('');

    // Metrics
    lines.push('### Metrics');
    const totalCalls = costs.total.calls;
    const totalTokens = costs.total.tokens;
    const totalCost = costs.total.costUsd;
    lines.push(`- Total LLM calls: ${totalCalls}`);
    lines.push(`- Total tokens: ${totalTokens.toLocaleString()}`);
    lines.push(`- Estimated cost: $${totalCost.toFixed(2)}`);
    lines.push('');

    // Cost by Agent
    const agentEntries = Object.entries(costs.byAgent);
    if (agentEntries.length > 0) {
      lines.push('### Cost by Agent');
      for (const [agentId, data] of agentEntries) {
        lines.push(`- ${agentId}: ${data.calls} calls, $${data.costUsd.toFixed(2)}`);
      }
      lines.push('');
    }

    // Infrastructure
    lines.push('### Infrastructure');
    lines.push(`- NATS: ${health.infrastructure.nats ? 'connected' : 'down'}`);
    lines.push(`- Redis: ${health.infrastructure.redis ? 'connected' : 'down'}`);
    lines.push(`- NAS: ${health.infrastructure.nas.mounted ? 'mounted' : 'unmounted'}`);
    lines.push('');

    return lines.join('\n');
  }

  private async saveToNas(date: string, md: string): Promise<void> {
    const dir = join(this.config.nasBasePath, 'knowledge', 'summaries');
    try {
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${date}.md`), md, 'utf-8');
    } catch (err) {
      log.error(`Failed to save summary to NAS: ${(err as Error).message}`);
    }
  }

  private async appendToObsidian(md: string): Promise<void> {
    if (!this.config.obsidianApiUrl || !this.config.obsidianApiKey) return;

    const url = new URL(this.config.obsidianApiUrl);
    const isLocalhost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    const originalTLS = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];

    if (isLocalhost) {
      process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    }

    try {
      const res = await fetch(`${this.config.obsidianApiUrl}/periodic/daily/`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${this.config.obsidianApiKey}`,
          'Content-Type': 'text/markdown',
          Operation: 'append',
          'Target-Type': 'heading',
          Target: encodeURIComponent('Jarvis Summary'),
          'Create-Target-If-Missing': 'true',
        },
        body: `\n${md}`,
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) {
        log.warn(`Obsidian append failed: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      log.warn(`Obsidian append error: ${(err as Error).message}`);
    } finally {
      if (isLocalhost) {
        if (originalTLS === undefined) {
          delete process.env['NODE_TLS_REJECT_UNAUTHORIZED'];
        } else {
          process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = originalTLS;
        }
      }
    }
  }
}
