import { readFile, writeFile, appendFile, readdir, mkdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { createLogger, type AgentId } from '@jarvis/shared';
import type { Message, TokenUsage } from '../llm/types.js';

const log = createLogger('agent:sessions');

export interface SessionEntry {
  timestamp: number;
  type: 'message' | 'tool_call' | 'tool_result' | 'usage' | 'meta';
  role?: 'user' | 'assistant' | 'system';
  content?: unknown;
  toolName?: string;
  toolId?: string;
  usage?: TokenUsage;
  meta?: Record<string, unknown>;
}

export interface SessionInfo {
  id: string;
  agentId: string;
  taskId?: string;
  startedAt: number;
  lastActivity: number;
  messageCount: number;
  totalTokens: number;
}

/**
 * SessionManager - Persists agent sessions as JSONL files on NAS.
 * Adapted from OpenClaw's session format.
 *
 * File format: /sessions/{agentId}/{sessionId}.jsonl
 * Each line is a JSON SessionEntry.
 */
export class SessionManager {
  private sessionsDir: string;
  private agentId: string;

  constructor(nasPath: string, agentId: AgentId) {
    this.agentId = agentId;
    this.sessionsDir = join(nasPath, 'sessions', agentId);
  }

  /** Ensure sessions directory exists */
  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    log.info(`Sessions dir: ${this.sessionsDir}`);
  }

  /** Create a new session, returns session ID */
  async createSession(taskId?: string): Promise<string> {
    const sessionId = `${this.agentId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const filePath = this.getSessionPath(sessionId);

    // Write initial meta entry
    await this.appendEntry(filePath, {
      timestamp: Date.now(),
      type: 'meta',
      meta: {
        sessionId,
        agentId: this.agentId,
        taskId,
        startedAt: Date.now(),
      },
    });

    log.info(`Created session: ${sessionId}`);
    return sessionId;
  }

  /** Append a message to the session */
  async appendMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: unknown): Promise<void> {
    await this.appendEntry(this.getSessionPath(sessionId), {
      timestamp: Date.now(),
      type: 'message',
      role,
      content,
    });
  }

  /** Append a tool call to the session */
  async appendToolCall(sessionId: string, toolName: string, toolId: string, input: unknown): Promise<void> {
    await this.appendEntry(this.getSessionPath(sessionId), {
      timestamp: Date.now(),
      type: 'tool_call',
      toolName,
      toolId,
      content: input,
    });
  }

  /** Append a tool result to the session */
  async appendToolResult(sessionId: string, toolId: string, result: unknown): Promise<void> {
    await this.appendEntry(this.getSessionPath(sessionId), {
      timestamp: Date.now(),
      type: 'tool_result',
      toolId,
      content: result,
    });
  }

  /** Append usage info to the session */
  async appendUsage(sessionId: string, usage: TokenUsage): Promise<void> {
    await this.appendEntry(this.getSessionPath(sessionId), {
      timestamp: Date.now(),
      type: 'usage',
      usage,
    });
  }

  /** Load full session from JSONL file */
  async loadSession(sessionId: string): Promise<SessionEntry[]> {
    const filePath = this.getSessionPath(sessionId);
    try {
      const content = await readFile(filePath, 'utf-8');
      return content
        .split('\n')
        .filter((line) => line.trim())
        .map((line) => JSON.parse(line) as SessionEntry);
    } catch {
      return [];
    }
  }

  /** Reconstruct messages array from session for LLM context */
  async loadMessagesForContext(sessionId: string): Promise<Message[]> {
    const entries = await this.loadSession(sessionId);
    const messages: Message[] = [];

    // Collect tool_result entries by toolId for reconstruction
    const toolResults = new Map<string, SessionEntry>();
    for (const entry of entries) {
      if (entry.type === 'tool_result' && entry.toolId) {
        toolResults.set(entry.toolId, entry);
      }
    }

    for (const entry of entries) {
      if (entry.type === 'message' && entry.role && entry.content) {
        if (typeof entry.content === 'string') {
          messages.push({ role: entry.role, content: entry.content });
        } else {
          messages.push({ role: entry.role, content: entry.content as Message['content'] });

          // If this assistant message contains tool_use blocks, inject the matching
          // tool_result user message right after (Anthropic API requires this)
          if (entry.role === 'assistant' && Array.isArray(entry.content)) {
            const toolUseBlocks = (entry.content as Array<{ type: string; id?: string }>)
              .filter((b) => b.type === 'tool_use' && b.id);

            if (toolUseBlocks.length > 0) {
              const resultBlocks: Array<{ type: 'tool_result'; tool_use_id: string; content: string; is_error?: boolean }> = [];
              for (const tu of toolUseBlocks) {
                const result = toolResults.get(tu.id!);
                resultBlocks.push({
                  type: 'tool_result',
                  tool_use_id: tu.id!,
                  content: result ? (typeof result.content === 'string' ? result.content : JSON.stringify(result.content)) : '(result not found)',
                  is_error: result ? (result.meta?.['is_error'] as boolean ?? false) : true,
                });
              }
              messages.push({ role: 'user', content: resultBlocks as unknown as Message['content'] });
            }
          }
        }
      }
    }

    return messages;
  }

  /** List all sessions for this agent */
  async listSessions(): Promise<SessionInfo[]> {
    try {
      const files = await readdir(this.sessionsDir);
      const sessions: SessionInfo[] = [];

      for (const file of files) {
        if (!file.endsWith('.jsonl')) continue;
        const sessionId = file.replace('.jsonl', '');

        try {
          const entries = await this.loadSession(sessionId);
          const meta = entries.find((e) => e.type === 'meta');
          const messageCount = entries.filter((e) => e.type === 'message').length;
          const totalTokens = entries
            .filter((e) => e.type === 'usage')
            .reduce((sum, e) => sum + (e.usage?.totalTokens ?? 0), 0);

          sessions.push({
            id: sessionId,
            agentId: this.agentId,
            taskId: (meta?.meta?.['taskId'] as string) ?? undefined,
            startedAt: (meta?.meta?.['startedAt'] as number) ?? meta?.timestamp ?? 0,
            lastActivity: entries[entries.length - 1]?.timestamp ?? 0,
            messageCount,
            totalTokens,
          });
        } catch {
          // Skip corrupt sessions
        }
      }

      return sessions.sort((a, b) => b.lastActivity - a.lastActivity);
    } catch {
      return [];
    }
  }

  /** Compact a session by summarizing older messages */
  async compactSession(sessionId: string, summaryModel?: string): Promise<void> {
    const entries = await this.loadSession(sessionId);
    const messageEntries = entries.filter((e) => e.type === 'message');

    if (messageEntries.length < 20) return; // Only compact long sessions

    // Keep last 10 messages, summarize the rest
    const toKeep = entries.slice(-15);
    const toSummarize = messageEntries.slice(0, -10);

    // Build summary text from older messages
    const summaryParts = toSummarize.map((e) => {
      const content = typeof e.content === 'string' ? e.content : JSON.stringify(e.content);
      return `[${e.role}]: ${content?.slice(0, 200)}`;
    });

    const summaryEntry: SessionEntry = {
      timestamp: Date.now(),
      type: 'meta',
      meta: {
        compacted: true,
        originalMessageCount: messageEntries.length,
        summary: `Session compacted. Previous ${toSummarize.length} messages summarized:\n${summaryParts.join('\n')}`,
      },
    };

    // Rewrite the file
    const filePath = this.getSessionPath(sessionId);
    const newEntries = [summaryEntry, ...toKeep];
    const content = newEntries.map((e) => JSON.stringify(e)).join('\n') + '\n';
    await writeFile(filePath, content, 'utf-8');

    log.info(`Compacted session ${sessionId}: ${entries.length} -> ${newEntries.length} entries`);
  }

  private getSessionPath(sessionId: string): string {
    return join(this.sessionsDir, `${sessionId}.jsonl`);
  }

  private async appendEntry(filePath: string, entry: SessionEntry): Promise<void> {
    await appendFile(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  }
}
