/**
 * Memory Plugin — Provides long-term memory via file-based storage.
 * Inspired by OpenClaw's memory-core plugin.
 *
 * Registers:
 * - memory_search tool: Search memory files for relevant context
 * - memory_save tool: Save important information to memory
 * - before_prompt_build hook: Auto-inject relevant memories into context
 * - session_end hook: Auto-capture session highlights
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

export function createMemoryPlugin(): JarvisPluginDefinition {
  return {
    id: 'jarvis-memory',
    name: 'Memory & Continuity',
    description: 'Long-term memory via file-based storage on NAS',
    version: '1.0.0',

    register(api) {
      const memoryDir = join(api.config.nasPath, 'knowledge', 'memory');
      const memoryFile = join(api.config.nasPath, 'knowledge', 'MEMORY.md');

      // Ensure directories exist
      try {
        mkdirSync(memoryDir, { recursive: true });
      } catch { /* exists */ }

      // ─── memory_search tool ───
      api.registerTool({
        definition: {
          name: 'memory_search',
          description: 'Search your long-term memory for relevant information. Searches MEMORY.md and daily notes in memory/ directory. Use this when you need context from past sessions or want to remember decisions, lessons learned, or important facts.',
          input_schema: {
            type: 'object',
            properties: {
              query: {
                type: 'string',
                description: 'Search query - keywords or topic to find in memory',
              },
              max_results: {
                type: 'number',
                description: 'Maximum number of matching lines to return (default: 20)',
              },
            },
            required: ['query'],
          },
        },

        async execute(params) {
          const { query, max_results = 20 } = params as { query: string; max_results?: number };
          const queryLower = query.toLowerCase();
          const results: string[] = [];

          // Search MEMORY.md
          if (existsSync(memoryFile)) {
            const content = readFileSync(memoryFile, 'utf-8');
            const lines = content.split('\n');
            for (const line of lines) {
              if (line.toLowerCase().includes(queryLower)) {
                results.push(`[MEMORY.md] ${line.trim()}`);
              }
            }
          }

          // Search daily notes
          if (existsSync(memoryDir)) {
            const files = readdirSync(memoryDir)
              .filter(f => f.endsWith('.md'))
              .sort()
              .reverse() // newest first
              .slice(0, 30); // last 30 files

            for (const file of files) {
              const filePath = join(memoryDir, file);
              try {
                const content = readFileSync(filePath, 'utf-8');
                const lines = content.split('\n');
                for (const line of lines) {
                  if (line.toLowerCase().includes(queryLower)) {
                    results.push(`[${file}] ${line.trim()}`);
                  }
                }
              } catch { /* skip */ }
            }
          }

          const trimmed = results.slice(0, max_results);
          if (trimmed.length === 0) {
            return {
              type: 'text' as const,
              content: `No memory matches for "${query}". MEMORY.md has ${existsSync(memoryFile) ? readFileSync(memoryFile, 'utf-8').split('\n').length : 0} lines.`,
            };
          }

          return {
            type: 'text' as const,
            content: `Found ${trimmed.length} memory matches for "${query}":\n\n${trimmed.join('\n')}`,
          };
        },
      });

      // ─── memory_save tool ───
      api.registerTool({
        definition: {
          name: 'memory_save',
          description: 'Save important information to long-term memory. Use this to remember decisions, lessons learned, user preferences, project configurations, and other important facts that should persist across sessions.',
          input_schema: {
            type: 'object',
            properties: {
              content: {
                type: 'string',
                description: 'The information to remember (Markdown format)',
              },
              category: {
                type: 'string',
                description: 'Category: "core" (MEMORY.md) or "daily" (daily note). Default: "core"',
              },
            },
            required: ['content'],
          },
        },

        async execute(params) {
          const { content, category = 'core' } = params as { content: string; category?: string };
          const timestamp = new Date().toISOString();

          if (category === 'daily') {
            // Append to daily note
            const dateStr = new Date().toISOString().split('T')[0];
            const dailyPath = join(memoryDir, `${dateStr}.md`);
            const header = existsSync(dailyPath) ? '' : `# Daily Notes: ${dateStr}\n\n`;
            const entry = `${header}## ${timestamp}\n${content}\n\n`;

            try {
              const existing = existsSync(dailyPath) ? readFileSync(dailyPath, 'utf-8') : '';
              writeFileSync(dailyPath, existing + entry);
            } catch (err) {
              return { type: 'error' as const, content: `Failed to save daily note: ${(err as Error).message}` };
            }
          } else {
            // Append to MEMORY.md
            const entry = `\n## [${timestamp}]\n${content}\n`;

            try {
              const existing = existsSync(memoryFile) ? readFileSync(memoryFile, 'utf-8') : '# MEMORY\n\nLong-term memory for Jarvis 2.0 agents.\n';
              writeFileSync(memoryFile, existing + entry);
            } catch (err) {
              return { type: 'error' as const, content: `Failed to save memory: ${(err as Error).message}` };
            }
          }

          return {
            type: 'text' as const,
            content: `Memory saved to ${category === 'daily' ? 'daily note' : 'MEMORY.md'} at ${timestamp}`,
          };
        },
      });

      // ─── System prompt section ───
      api.registerPromptSection({
        title: 'Memory',
        priority: 90,
        content: `You have memory tools: \`memory_search\` to recall past information and \`memory_save\` to remember important facts.
Use memory proactively:
- Before starting complex tasks: search memory for related past work
- After important decisions: save the decision and reasoning
- When you learn something new: save it for future sessions
- "Mental notes" don't survive restarts — write things down!`,
      });

      api.logger.info('Memory plugin registered with 2 tools + prompt section');
    },
  };
}
