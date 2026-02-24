/**
 * Auto-Save Plugin — Automatically saves artifacts and session highlights.
 *
 * Registers:
 * - after_tool_call hook: Detect file creation and log artifacts
 * - task_completed hook: Create a summary of what was accomplished
 * - agent_start hook: Log agent start events
 */

import { existsSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { JarvisPluginDefinition } from '../types.js';

export function createAutoSavePlugin(): JarvisPluginDefinition {
  return {
    id: 'jarvis-auto-save',
    name: 'Auto-Save & Artifacts',
    description: 'Automatically logs artifacts, session highlights, and task completions',
    version: '1.0.0',

    register(api) {
      const artifactsLog = join(api.config.nasPath, 'workspace', 'artifacts-log.jsonl');
      const activityLog = join(api.config.nasPath, 'logs', 'activity.jsonl');

      // Ensure directories
      try {
        mkdirSync(join(api.config.nasPath, 'workspace'), { recursive: true });
        mkdirSync(join(api.config.nasPath, 'logs'), { recursive: true });
      } catch { /* exists */ }

      // Helper to append JSONL
      const appendJsonl = (path: string, data: Record<string, unknown>) => {
        try {
          const existing = existsSync(path) ? readFileSync(path, 'utf-8') : '';
          writeFileSync(path, existing + JSON.stringify(data) + '\n');
        } catch { /* ignore */ }
      };

      // ─── Track file artifacts ───
      api.on('after_tool_call', (event) => {
        // Track file creation/modification
        if (event.toolName === 'write' || event.toolName === 'edit') {
          const filePath = (event.input as Record<string, unknown>).path ??
                          (event.input as Record<string, unknown>).file_path;
          if (filePath && event.result.type !== 'error') {
            appendJsonl(artifactsLog, {
              timestamp: new Date().toISOString(),
              agentId: api.config.agentId,
              action: event.toolName,
              file: filePath,
            });
          }
        }

        // Track exec commands that produce output
        if (event.toolName === 'exec' && event.result.type !== 'error') {
          const command = (event.input as Record<string, unknown>).command;
          if (typeof command === 'string' && command.length > 0) {
            appendJsonl(activityLog, {
              timestamp: new Date().toISOString(),
              agentId: api.config.agentId,
              type: 'exec',
              command: command.slice(0, 200),
              elapsed: event.elapsed,
            });
          }
        }
      });

      // ─── Log task completions ───
      api.on('task_completed', (event) => {
        appendJsonl(activityLog, {
          timestamp: new Date().toISOString(),
          agentId: api.config.agentId,
          type: 'task_completed',
          taskId: event.taskId,
          outputPreview: event.output.slice(0, 500),
          artifacts: event.artifacts,
        });
        api.logger.info(`Task ${event.taskId} logged with ${event.artifacts.length} artifacts`);
      });

      // ─── Log agent starts ───
      api.on('agent_start', (event) => {
        appendJsonl(activityLog, {
          timestamp: new Date().toISOString(),
          agentId: event.agentId,
          type: 'agent_start',
          role: event.role,
          hostname: event.hostname,
        });
      });

      api.logger.info('Auto-save plugin registered with 3 hooks');
    },
  };
}
