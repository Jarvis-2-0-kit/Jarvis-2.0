import { createLogger } from '@jarvis/shared';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';
import { ExecTool } from '../exec.js';

const log = createLogger('tool:web-maintenance');

const exec = new ExecTool();

/**
 * Web deployment tool.
 * Handles deploying to Vercel, Netlify, or via git push.
 */
export class DeployTool implements AgentTool {
  definition = {
    name: 'deploy',
    description: 'Deploy web applications to hosting platforms (Vercel, Netlify) or via git push. Supports preview and production deployments.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['vercel_deploy', 'vercel_promote', 'netlify_deploy', 'git_push', 'status'],
          description: 'Deployment action',
        },
        project_path: { type: 'string', description: 'Path to the project' },
        production: { type: 'boolean', description: 'Deploy to production (default: false = preview)' },
        branch: { type: 'string', description: 'Git branch to push (for git_push)' },
        remote: { type: 'string', description: 'Git remote (default: origin)' },
      },
      required: ['action'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as string;
    const projectPath = (params['project_path'] as string) || context.workspacePath;
    const production = params['production'] as boolean ?? false;
    const ctx = { ...context, cwd: projectPath };

    switch (action) {
      case 'vercel_deploy': {
        const prodFlag = production ? '--prod' : '';
        return exec.execute({
          command: `cd "${projectPath}" && npx vercel ${prodFlag} --yes`,
          timeout: 300_000,
        }, ctx);
      }

      case 'vercel_promote':
        return exec.execute({
          command: `cd "${projectPath}" && npx vercel promote --yes`,
          timeout: 60_000,
        }, ctx);

      case 'netlify_deploy': {
        const prodFlag = production ? '--prod' : '';
        return exec.execute({
          command: `cd "${projectPath}" && npx netlify deploy ${prodFlag} --build`,
          timeout: 300_000,
        }, ctx);
      }

      case 'git_push': {
        const branch = (params['branch'] as string) || 'main';
        const remote = (params['remote'] as string) || 'origin';
        return exec.execute({
          command: `cd "${projectPath}" && git push ${remote} ${branch}`,
          timeout: 120_000,
        }, ctx);
      }

      case 'status':
        return exec.execute({
          command: `cd "${projectPath}" && (npx vercel ls --limit 5 2>/dev/null || echo "Vercel not available") && echo "---" && (npx netlify status 2>/dev/null || echo "Netlify not available")`,
          timeout: 30_000,
        }, ctx);

      default:
        return createErrorResult(`Unknown deploy action: ${action}`);
    }
  }
}

/**
 * Website monitoring and health check tool.
 */
export class MonitoringTool implements AgentTool {
  definition = {
    name: 'monitor',
    description: 'Monitor website health: uptime checks, response time, SSL certificate status, and basic performance metrics.',
    input_schema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: ['health_check', 'ssl_check', 'performance', 'dns_check'],
          description: 'Monitoring action',
        },
        url: { type: 'string', description: 'URL to check' },
        urls: { type: 'array', items: { type: 'string' }, description: 'Multiple URLs to check' },
      },
      required: ['action'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as string;
    const url = params['url'] as string;
    const urls = (params['urls'] as string[]) ?? (url ? [url] : []);

    if (urls.length === 0) return createErrorResult('Provide url or urls parameter');

    switch (action) {
      case 'health_check':
        return this.healthCheck(urls);
      case 'ssl_check':
        return this.sslCheck(urls);
      case 'performance':
        return this.performanceCheck(urls);
      case 'dns_check':
        if (!url) return createErrorResult('dns_check requires a single url');
        return exec.execute({ command: `dig +short ${new URL(url).hostname}` }, context);
      default:
        return createErrorResult(`Unknown monitor action: ${action}`);
    }
  }

  private async healthCheck(urls: string[]): Promise<ToolResult> {
    const results: string[] = [];

    for (const url of urls) {
      try {
        const start = Date.now();
        const response = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(10_000),
        });
        const elapsed = Date.now() - start;
        const status = response.ok ? 'UP' : 'DOWN';
        results.push(`${status} ${url} - ${response.status} (${elapsed}ms)`);
      } catch (err) {
        results.push(`DOWN ${url} - ${(err as Error).message}`);
      }
    }

    return createToolResult(`Health Check:\n${results.join('\n')}`);
  }

  private async sslCheck(urls: string[]): Promise<ToolResult> {
    const results: string[] = [];

    for (const url of urls) {
      try {
        const hostname = new URL(url).hostname;
        // Use openssl to check certificate
        const result = await new Promise<string>((resolve) => {
          const { spawn } = require('node:child_process') as typeof import('node:child_process');
          const proc = spawn('bash', ['-c', `echo | openssl s_client -connect ${hostname}:443 -servername ${hostname} 2>/dev/null | openssl x509 -noout -dates -subject 2>/dev/null`]);
          let output = '';
          proc.stdout.on('data', (d: Buffer) => { output += d.toString(); });
          proc.stderr.on('data', (d: Buffer) => { output += d.toString(); });
          proc.on('close', () => resolve(output));
        });

        results.push(`${hostname}:\n${result.trim()}`);
      } catch (err) {
        results.push(`${url}: SSL check failed - ${(err as Error).message}`);
      }
    }

    return createToolResult(`SSL Certificate Check:\n${results.join('\n\n')}`);
  }

  private async performanceCheck(urls: string[]): Promise<ToolResult> {
    const results: string[] = [];

    for (const url of urls) {
      try {
        // Simple timing test - multiple requests
        const times: number[] = [];
        for (let i = 0; i < 3; i++) {
          const start = Date.now();
          await fetch(url, { signal: AbortSignal.timeout(15_000) });
          times.push(Date.now() - start);
        }

        const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
        const min = Math.min(...times);
        const max = Math.max(...times);

        results.push(`${url}:\n  Avg: ${avg}ms | Min: ${min}ms | Max: ${max}ms`);
      } catch (err) {
        results.push(`${url}: Performance check failed - ${(err as Error).message}`);
      }
    }

    return createToolResult(`Performance (3 requests each):\n${results.join('\n')}`);
  }
}

/**
 * SEO audit tool - basic on-page SEO checks.
 */
export class SeoTool implements AgentTool {
  definition = {
    name: 'seo_audit',
    description: 'Perform basic SEO audit on a web page: check meta tags, headings, images, links, and common SEO issues.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to audit' },
      },
      required: ['url'],
    },
  };

  async execute(params: Record<string, unknown>, context: ToolContext): Promise<ToolResult> {
    const url = params['url'] as string;
    if (!url) return createErrorResult('Missing required parameter: url');

    try {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Jarvis-SEO-Auditor/1.0' },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        return createErrorResult(`Failed to fetch ${url}: ${response.status}`);
      }

      const html = await response.text();
      const issues: string[] = [];
      const info: string[] = [];

      // Title check
      const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
      if (!titleMatch) {
        issues.push('MISSING: <title> tag');
      } else {
        const title = titleMatch[1]?.trim() ?? '';
        info.push(`Title: "${title}" (${title.length} chars)`);
        if (title.length < 30) issues.push('WARNING: Title too short (< 30 chars)');
        if (title.length > 60) issues.push('WARNING: Title too long (> 60 chars)');
      }

      // Meta description
      const descMatch = html.match(/<meta[^>]*name="description"[^>]*content="([^"]*)"[^>]*>/i)
        ?? html.match(/<meta[^>]*content="([^"]*)"[^>]*name="description"[^>]*>/i);
      if (!descMatch) {
        issues.push('MISSING: Meta description');
      } else {
        const desc = descMatch[1] ?? '';
        info.push(`Description: "${desc.slice(0, 80)}..." (${desc.length} chars)`);
        if (desc.length < 120) issues.push('WARNING: Meta description too short (< 120 chars)');
        if (desc.length > 160) issues.push('WARNING: Meta description too long (> 160 chars)');
      }

      // Heading structure
      const h1Count = (html.match(/<h1[\s>]/gi) ?? []).length;
      const h2Count = (html.match(/<h2[\s>]/gi) ?? []).length;
      info.push(`Headings: ${h1Count} H1, ${h2Count} H2`);
      if (h1Count === 0) issues.push('MISSING: No H1 tag');
      if (h1Count > 1) issues.push('WARNING: Multiple H1 tags');

      // Images without alt
      const imgTotal = (html.match(/<img[\s>]/gi) ?? []).length;
      const imgNoAlt = (html.match(/<img(?![^>]*alt=)[^>]*>/gi) ?? []).length;
      info.push(`Images: ${imgTotal} total, ${imgNoAlt} without alt text`);
      if (imgNoAlt > 0) issues.push(`WARNING: ${imgNoAlt} images missing alt text`);

      // Canonical
      const hasCanonical = /<link[^>]*rel="canonical"[^>]*>/i.test(html);
      if (!hasCanonical) issues.push('MISSING: Canonical URL');

      // Open Graph
      const hasOG = /<meta[^>]*property="og:/i.test(html);
      if (!hasOG) issues.push('MISSING: Open Graph tags');

      // Viewport
      const hasViewport = /<meta[^>]*name="viewport"[^>]*>/i.test(html);
      if (!hasViewport) issues.push('WARNING: No viewport meta tag (mobile-unfriendly)');

      const score = Math.max(0, 100 - issues.length * 10);

      return createToolResult(
        `SEO Audit: ${url}\nScore: ${score}/100\n\n` +
        `Info:\n${info.map((i) => `  ${i}`).join('\n')}\n\n` +
        `Issues (${issues.length}):\n${issues.length > 0 ? issues.map((i) => `  - ${i}`).join('\n') : '  None found!'}`,
      );
    } catch (err) {
      return createErrorResult(`SEO audit failed: ${(err as Error).message}`);
    }
  }
}
