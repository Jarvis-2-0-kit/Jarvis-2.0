/**
 * Obsidian Plugin — Integrates with Obsidian vault via the Local REST API.
 *
 * Registers 6 tools:
 * - obsidian_search: Search vault by text query
 * - obsidian_read: Read a specific note
 * - obsidian_write: Create or overwrite a note
 * - obsidian_list: List files in the vault
 * - obsidian_append: Append content to a note
 * - obsidian_daily: Interact with today's daily note
 *
 * Requires:
 * - Obsidian running with Local REST API plugin
 *   (https://github.com/coddingtonbear/obsidian-local-rest-api)
 * - OBSIDIAN_API_KEY env var or pluginConfig.apiKey
 */

import type { JarvisPluginDefinition } from '../types.js';

// ─── Constants ────────────────────────────────────────────────────────

const MAX_NOTE_SIZE = 50_000;
const REQUEST_TIMEOUT = 10_000;

// ─── Obsidian REST API Client ─────────────────────────────────────────

interface SearchMatch {
  match: { start: number; end: number };
  context: string;
}

interface SearchResult {
  filename: string;
  score?: number;
  matches: SearchMatch[];
}

class ObsidianAPI {
  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/$/, '');
  }

  // Tradeoff: NODE_TLS_REJECT_UNAUTHORIZED is process-wide, so there is a
  // small race window where concurrent requests in other parts of the process
  // could also skip TLS verification.  The proper fix would be to pass a
  // custom https.Agent (via undici's `dispatcher` option), but that requires
  // an undici dependency which may not be available.  The save/restore in
  // try/finally keeps the window as narrow as possible.
  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const url = new URL(this.baseUrl);
    const isLocalhost = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    const originalTLS = process.env['NODE_TLS_REJECT_UNAUTHORIZED'];

    if (isLocalhost) {
      process.env['NODE_TLS_REJECT_UNAUTHORIZED'] = '0';
    }

    try {
      return await fetch(`${this.baseUrl}${path}`, {
        ...init,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...((init.headers as Record<string, string>) ?? {}),
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });
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

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetch('/');
      return res.ok;
    } catch {
      return false;
    }
  }

  async readNote(filename: string): Promise<string> {
    const encoded = filename.split('/').map(encodeURIComponent).join('/');
    const res = await this.fetch(`/vault/${encoded}`, {
      headers: { Accept: 'text/markdown' },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  async writeNote(filename: string, content: string): Promise<void> {
    const encoded = filename.split('/').map(encodeURIComponent).join('/');
    const res = await this.fetch(`/vault/${encoded}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'text/markdown' },
      body: content,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }

  async appendNote(filename: string, content: string): Promise<void> {
    const encoded = filename.split('/').map(encodeURIComponent).join('/');
    const res = await this.fetch(`/vault/${encoded}`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: content,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }

  async listFiles(path?: string): Promise<{ files: string[] }> {
    const encoded = path ? path.split('/').map(encodeURIComponent).join('/') + '/' : '';
    const res = await this.fetch(`/vault/${encoded}`, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<{ files: string[] }>;
  }

  async search(query: string, contextLength = 100): Promise<SearchResult[]> {
    const params = new URLSearchParams({
      query,
      contextLength: String(contextLength),
    });
    const res = await this.fetch(`/search/simple/?${params}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.json() as Promise<SearchResult[]>;
  }

  async getDailyNote(): Promise<string> {
    const res = await this.fetch('/periodic/daily/', {
      headers: { Accept: 'text/markdown' },
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
    return res.text();
  }

  async createDailyNote(content = ''): Promise<void> {
    const res = await this.fetch('/periodic/daily/', {
      method: 'POST',
      headers: { 'Content-Type': 'text/markdown' },
      body: content,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }

  async appendToDaily(content: string, heading?: string): Promise<void> {
    const headers: Record<string, string> = {
      'Content-Type': 'text/markdown',
      Operation: 'append',
    };
    if (heading) {
      headers['Target-Type'] = 'heading';
      headers['Target'] = encodeURIComponent(heading);
      headers['Create-Target-If-Missing'] = 'true';
    }
    const res = await this.fetch('/periodic/daily/', {
      method: 'PATCH',
      headers,
      body: content,
    });
    if (!res.ok) {
      throw new Error(`${res.status} ${res.statusText}`);
    }
  }
}

// ─── Plugin ───────────────────────────────────────────────────────────

export function createObsidianPlugin(): JarvisPluginDefinition {
  return {
    id: 'jarvis-obsidian',
    name: 'Obsidian Integration',
    description: 'Read, write, search, and manage notes in your Obsidian vault via the Local REST API',
    version: '1.0.0',

    register(api) {
      const obsidianUrl = (api.pluginConfig['apiUrl'] as string)
        ?? process.env['OBSIDIAN_API_URL']
        ?? 'https://127.0.0.1:27124';

      const obsidianApiKey = (api.pluginConfig['apiKey'] as string)
        ?? process.env['OBSIDIAN_API_KEY']
        ?? '';

      if (!obsidianApiKey) {
        api.logger.warn('Obsidian API key not configured. Set OBSIDIAN_API_KEY env var or pluginConfig.apiKey');
      }

      const client = new ObsidianAPI(obsidianUrl, obsidianApiKey);

      // ─── Error handling wrapper ───
      type ToolResult = { type: 'text' | 'error'; content: string; metadata?: Record<string, unknown> };
      const wrap = (fn: (params: Record<string, unknown>) => Promise<ToolResult>) =>
        async (params: Record<string, unknown>): Promise<ToolResult> => {
          if (!obsidianApiKey) {
            return {
              type: 'error',
              content: 'Obsidian API key not configured. Set OBSIDIAN_API_KEY environment variable or configure pluginConfig.apiKey for the jarvis-obsidian plugin.',
            };
          }
          try {
            return await fn(params);
          } catch (err) {
            const msg = (err as Error).message;
            if (msg.includes('ECONNREFUSED') || msg.includes('fetch failed') || msg.includes('UND_ERR')) {
              return { type: 'error', content: `Cannot connect to Obsidian at ${obsidianUrl}. Is Obsidian running with the Local REST API plugin enabled?` };
            }
            if (msg.includes('401') || msg.includes('Unauthorized')) {
              return { type: 'error', content: 'Obsidian API returned 401 Unauthorized. Check that your API key is correct.' };
            }
            if (msg.includes('404')) {
              return { type: 'error', content: `Not found. The note or path does not exist in the Obsidian vault. Use obsidian_search or obsidian_list to find the correct path.` };
            }
            return { type: 'error', content: `Obsidian API error: ${msg}` };
          }
        };

      // ─── obsidian_search ───
      api.registerTool({
        definition: {
          name: 'obsidian_search',
          description: 'Search your Obsidian vault for notes matching a text query. Returns matching filenames with surrounding context snippets.',
          input_schema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'Text search query — searches across all notes in the vault' },
              context_length: { type: 'number', description: 'Characters of context around each match (default: 100)' },
            },
            required: ['query'],
          },
        },
        execute: wrap(async (params) => {
          const query = params['query'] as string;
          const contextLen = (params['context_length'] as number) ?? 100;

          const results = await client.search(query, contextLen);
          if (results.length === 0) {
            return { type: 'text', content: `No matches for "${query}" in the Obsidian vault.` };
          }

          const lines: string[] = [`Found ${results.length} note(s) matching "${query}":\n`];
          for (const r of results.slice(0, 20)) {
            lines.push(`### ${r.filename}`);
            for (const m of (r.matches ?? []).slice(0, 5)) {
              lines.push(`  ...${m.context.trim()}...`);
            }
            lines.push('');
          }

          return { type: 'text', content: lines.join('\n') };
        }),
      });

      // ─── obsidian_read ───
      api.registerTool({
        definition: {
          name: 'obsidian_read',
          description: 'Read the full content of a note from your Obsidian vault. Provide the filename including path relative to vault root (e.g., "Projects/my-project.md").',
          input_schema: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Path to note relative to vault root (e.g., "Projects/my-project.md")' },
            },
            required: ['filename'],
          },
        },
        execute: wrap(async (params) => {
          const filename = params['filename'] as string;
          let content = await client.readNote(filename);

          if (content.length > MAX_NOTE_SIZE) {
            content = content.slice(0, MAX_NOTE_SIZE) + `\n\n--- [Truncated: ${content.length} chars, showing first ${MAX_NOTE_SIZE}] ---`;
          }

          return { type: 'text', content, metadata: { filename, length: content.length } };
        }),
      });

      // ─── obsidian_write ───
      api.registerTool({
        definition: {
          name: 'obsidian_write',
          description: 'Create or overwrite a note in your Obsidian vault. WARNING: completely replaces the note if it exists. Use obsidian_append to add to an existing note.',
          input_schema: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Path for the note (e.g., "Projects/new-idea.md"). Folders are created automatically.' },
              content: { type: 'string', description: 'Full Markdown content for the note' },
            },
            required: ['filename', 'content'],
          },
        },
        execute: wrap(async (params) => {
          const filename = params['filename'] as string;
          const content = params['content'] as string;

          await client.writeNote(filename, content);
          return { type: 'text', content: `Note written: ${filename} (${content.length} chars)` };
        }),
      });

      // ─── obsidian_list ───
      api.registerTool({
        definition: {
          name: 'obsidian_list',
          description: 'List files and folders in your Obsidian vault. Optionally provide a subfolder path to list only that directory.',
          input_schema: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Subfolder path to list (e.g., "Projects/"). Omit for vault root.' },
            },
          },
        },
        execute: wrap(async (params) => {
          const path = params['path'] as string | undefined;
          const result = await client.listFiles(path);
          const files = result.files ?? [];

          if (files.length === 0) {
            return { type: 'text', content: path ? `No files found in "${path}".` : 'Vault is empty.' };
          }

          const header = path ? `Files in "${path}" (${files.length}):` : `Vault root (${files.length} items):`;
          return { type: 'text', content: `${header}\n\n${files.map((f) => `- ${f}`).join('\n')}` };
        }),
      });

      // ─── obsidian_append ───
      api.registerTool({
        definition: {
          name: 'obsidian_append',
          description: 'Append content to the end of an existing note. Useful for logs, journals, and running notes without overwriting existing content.',
          input_schema: {
            type: 'object',
            properties: {
              filename: { type: 'string', description: 'Path to the note to append to (e.g., "Journal/log.md")' },
              content: { type: 'string', description: 'Markdown content to append' },
            },
            required: ['filename', 'content'],
          },
        },
        execute: wrap(async (params) => {
          const filename = params['filename'] as string;
          const content = params['content'] as string;

          await client.appendNote(filename, content);
          return { type: 'text', content: `Appended ${content.length} chars to ${filename}` };
        }),
      });

      // ─── obsidian_daily ───
      api.registerTool({
        definition: {
          name: 'obsidian_daily',
          description: 'Interact with today\'s daily note in Obsidian. Read, create, or append content. Perfect for logging activity and session summaries.',
          input_schema: {
            type: 'object',
            properties: {
              action: { type: 'string', enum: ['read', 'append', 'create'], description: 'Action: read, append, or create' },
              content: { type: 'string', description: 'Content for append/create actions' },
              heading: { type: 'string', description: 'Target heading for append (e.g., "## Notes"). If omitted, appends to the end.' },
            },
            required: ['action'],
          },
        },
        execute: wrap(async (params) => {
          const action = params['action'] as string;

          switch (action) {
            case 'read': {
              let content = await client.getDailyNote();
              if (content.length > MAX_NOTE_SIZE) {
                content = content.slice(0, MAX_NOTE_SIZE) + '\n\n--- [Truncated] ---';
              }
              return { type: 'text', content: content || '(Daily note is empty)' };
            }
            case 'create': {
              const content = (params['content'] as string) ?? '';
              await client.createDailyNote(content);
              return { type: 'text', content: 'Daily note created.' };
            }
            case 'append': {
              const content = params['content'] as string;
              if (!content) return { type: 'error', content: 'Content is required for append action.' };
              const heading = params['heading'] as string | undefined;
              await client.appendToDaily(content, heading);
              return { type: 'text', content: `Appended to daily note${heading ? ` under "${heading}"` : ''}.` };
            }
            default:
              return { type: 'error', content: `Unknown action: ${action}. Use read, append, or create.` };
          }
        }),
      });

      // ─── Prompt section ───
      api.registerPromptSection({
        title: 'Obsidian Knowledge Base',
        priority: 85,
        content: [
          'You have direct access to the user\'s Obsidian vault via the Local REST API.',
          '',
          'Available tools:',
          '- `obsidian_search` — Search the vault by text query',
          '- `obsidian_read` — Read a specific note\'s full content',
          '- `obsidian_write` — Create or overwrite a note (use with care)',
          '- `obsidian_list` — Browse vault structure and files',
          '- `obsidian_append` — Add content to the end of an existing note',
          '- `obsidian_daily` — Read, create, or append to today\'s daily note',
          '',
          'Best practices:',
          '- Search before creating to avoid duplicate notes',
          '- Use obsidian_append instead of obsidian_write when adding to existing notes',
          '- Log important outcomes to the daily note via obsidian_daily',
          '- Obsidian notes use Markdown with [[wikilinks]] and #tags',
          '- Respect existing folder structure and naming conventions',
        ].join('\n'),
      });

      api.logger.info(`Obsidian plugin registered — 6 tools + prompt section (API: ${obsidianUrl})`);
    },
  };
}
