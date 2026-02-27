/**
 * iMessage Integration Tool
 *
 * Sends and reads iMessages on macOS via AppleScript.
 * Supports: send message, read conversations, search messages, get unread count.
 *
 * macOS-only — requires Messages.app and AppleScript permissions.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AgentTool, ToolContext, ToolResult } from '../base.js';
import { createToolResult, createErrorResult } from '../base.js';
import { getAuditLogger } from '@jarvis/shared';

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────────────

export interface IMessageConfig {
  /** Max messages to retrieve per conversation (default: 50) */
  readonly maxMessages?: number;
  /** Whether to allow sending (default: true) */
  readonly allowSend?: boolean;
  /** Phone numbers that don't require confirmation */
  readonly trustedNumbers?: string[];
  /** Whether to require confirmation for sending (default: true) */
  readonly requireConfirmation?: boolean;
  /** Confirmation callback - must return true to allow sending */
  readonly confirmSend?: (to: string, message: string) => Promise<boolean>;
}

type IMessageAction = 'send' | 'read' | 'search' | 'unread' | 'conversations';

// ─── AppleScript helpers ─────────────────────────────────────────────

function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function escapeSql(str: string): string {
  return str.replace(/'/g, "''");
}

function escapeSqlLike(str: string): string {
  return escapeSql(str).replace(/%/g, '\\%').replace(/_/g, '\\_');
}

// ─── Input validation ─────────────────────────────────────────────────

const PHONE_NUMBER_PATTERN = /^\+?[\d\s\-\(\)]{7,20}$/;
const MAX_MESSAGE_LENGTH = 10000;

async function runAppleScript(script: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync('osascript', ['-e', script], {
      timeout: 30_000,
      maxBuffer: 1024 * 1024,
    });
    return stdout.trim();
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes('not allowed assistive access') || msg.includes('not authorized')) {
      throw new Error('Messages.app AppleScript access denied. Grant permission in System Preferences → Security & Privacy → Privacy → Automation.');
    }
    throw err;
  }
}

// ─── Core functions ──────────────────────────────────────────────────

async function sendMessage(to: string, text: string, service: 'iMessage' | 'SMS' = 'iMessage'): Promise<string> {
  const escapedTo = escapeAppleScript(to);
  const escapedText = escapeAppleScript(text);
  const script = `
    tell application "Messages"
      set targetService to 1st service whose service type = ${service === 'iMessage' ? 'iMessage' : 'SMS'}
      set targetBuddy to buddy "${escapedTo}" of targetService
      send "${escapedText}" to targetBuddy
    end tell
    return "sent"
  `;
  await runAppleScript(script);
  return `Message sent to ${to} via ${service}`;
}

async function readConversation(contact: string, limit: number = 20): Promise<string> {
  // Use sqlite3 to read from Messages database (faster + more reliable than AppleScript)
  const dbPath = '~/Library/Messages/chat.db';
  const query = `
    SELECT
      m.text,
      m.is_from_me,
      datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as msg_date
    FROM message m
    JOIN chat_message_join cmj ON m.ROWID = cmj.message_id
    JOIN chat c ON cmj.chat_id = c.ROWID
    WHERE c.chat_identifier LIKE '%${escapeSqlLike(contact)}%' ESCAPE '\\'
    ORDER BY m.date DESC
    LIMIT ${Number(limit)}
  `;

  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-separator', ' | ',
      `${process.env['HOME']}/Library/Messages/chat.db`,
      query,
    ], { timeout: 10_000 });

    if (!stdout.trim()) {
      return `No messages found for contact: ${contact}`;
    }

    const lines = stdout.trim().split('\n').reverse();
    const formatted = lines.map((line) => {
      const parts = line.split(' | ');
      const date = parts[2] || '';
      const fromMe = parts[1]?.trim() === '1';
      const text = parts[0] || '';
      return `[${date}] ${fromMe ? 'ME' : contact}: ${text}`;
    });

    return `Conversation with ${contact} (last ${lines.length} messages):\n\n${formatted.join('\n')}`;
  } catch {
    // Fallback to AppleScript if sqlite3 fails
    const script = `
      tell application "Messages"
        set output to ""
        repeat with aChat in chats
          if name of aChat contains "${escapeAppleScript(contact)}" then
            set msgs to messages of aChat
            set msgCount to count of msgs
            set startIdx to msgCount - ${limit}
            if startIdx < 1 then set startIdx to 1
            repeat with i from startIdx to msgCount
              set msg to item i of msgs
              set output to output & (date sent of msg as string) & " | " & (sender of msg as string) & " | " & (text of msg) & linefeed
            end repeat
          end if
        end repeat
        return output
      end tell
    `;
    const result = await runAppleScript(script);
    return result || `No messages found for ${contact}`;
  }
}

async function searchMessages(query: string, limit: number = 20): Promise<string> {
  const sqlQuery = `
    SELECT
      m.text,
      m.is_from_me,
      h.id as contact,
      datetime(m.date/1000000000 + 978307200, 'unixepoch', 'localtime') as msg_date
    FROM message m
    LEFT JOIN handle h ON m.handle_id = h.ROWID
    WHERE m.text LIKE '%${escapeSqlLike(query)}%' ESCAPE '\\'
    ORDER BY m.date DESC
    LIMIT ${Number(limit)}
  `;

  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-separator', ' | ',
      `${process.env['HOME']}/Library/Messages/chat.db`,
      sqlQuery,
    ], { timeout: 10_000 });

    if (!stdout.trim()) {
      return `No messages matching "${query}"`;
    }

    const lines = stdout.trim().split('\n');
    const formatted = lines.map((line) => {
      const parts = line.split(' | ');
      const text = parts[0] || '';
      const fromMe = parts[1]?.trim() === '1';
      const contact = parts[2] || 'unknown';
      const date = parts[3] || '';
      return `[${date}] ${fromMe ? 'ME → ' + contact : contact}: ${text}`;
    });

    return `Search results for "${query}" (${lines.length} matches):\n\n${formatted.join('\n')}`;
  } catch {
    return `Search failed — Messages database may be locked or inaccessible.`;
  }
}

async function getUnreadCount(): Promise<string> {
  const script = `
    tell application "System Events"
      set badgeCount to 0
      try
        tell process "Messages"
          set badgeCount to value of attribute "AXBadge" of (first menu bar item of menu bar 2 whose name is "Messages")
        end tell
      end try
      return badgeCount as string
    end tell
  `;

  try {
    const count = await runAppleScript(script);
    return `Unread messages: ${count || '0'}`;
  } catch {
    // Alternative: check via sqlite
    const sqlQuery = `
      SELECT COUNT(*) FROM message WHERE is_read = 0 AND is_from_me = 0
    `;
    try {
      const { stdout } = await execFileAsync('sqlite3', [
        `${process.env['HOME']}/Library/Messages/chat.db`,
        sqlQuery,
      ], { timeout: 5_000 });
      return `Unread messages: ${stdout.trim()}`;
    } catch {
      return 'Could not determine unread count.';
    }
  }
}

async function listConversations(limit: number = 30): Promise<string> {
  const sqlQuery = `
    SELECT
      c.chat_identifier,
      c.display_name,
      datetime(MAX(m.date)/1000000000 + 978307200, 'unixepoch', 'localtime') as last_msg,
      COUNT(m.ROWID) as msg_count
    FROM chat c
    JOIN chat_message_join cmj ON c.ROWID = cmj.chat_id
    JOIN message m ON cmj.message_id = m.ROWID
    GROUP BY c.ROWID
    ORDER BY MAX(m.date) DESC
    LIMIT ${Number(limit)}
  `;

  try {
    const { stdout } = await execFileAsync('sqlite3', [
      '-separator', ' | ',
      `${process.env['HOME']}/Library/Messages/chat.db`,
      sqlQuery,
    ], { timeout: 10_000 });

    if (!stdout.trim()) {
      return 'No conversations found.';
    }

    const lines = stdout.trim().split('\n');
    const formatted = lines.map((line, i) => {
      const parts = line.split(' | ');
      const id = parts[0] || '';
      const name = parts[1] || id;
      const lastMsg = parts[2] || '';
      const count = parts[3] || '0';
      return `${i + 1}. ${name || id} — ${count} msgs, last: ${lastMsg}`;
    });

    return `Recent conversations (${lines.length}):\n\n${formatted.join('\n')}`;
  } catch {
    return 'Could not list conversations — Messages database may be locked.';
  }
}

// ─── Tool class ──────────────────────────────────────────────────────

export class IMessageTool implements AgentTool {
  private config: IMessageConfig;

  definition = {
    name: 'imessage',
    description: 'Send and read iMessages on macOS. Actions: send (send a message), read (read conversation with contact), search (search messages), unread (get unread count), conversations (list recent conversations).',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['send', 'read', 'search', 'unread', 'conversations'],
          description: 'Action to perform',
        },
        to: {
          type: 'string',
          description: 'Phone number or email of recipient (for send action)',
        },
        message: {
          type: 'string',
          description: 'Message text to send (for send action)',
        },
        contact: {
          type: 'string',
          description: 'Contact identifier — phone number or email (for read action)',
        },
        query: {
          type: 'string',
          description: 'Search query (for search action)',
        },
        service: {
          type: 'string',
          enum: ['iMessage', 'SMS'],
          description: 'Service type for send (default: iMessage)',
        },
        limit: {
          type: 'number',
          description: 'Max messages to retrieve (default: 20)',
        },
      },
      required: ['action'],
    },
  };

  constructor(config: IMessageConfig = {}) {
    this.config = config;
  }

  async execute(params: Record<string, unknown>, _context: ToolContext): Promise<ToolResult> {
    const action = params['action'] as IMessageAction;
    const limit = Math.min((params['limit'] as number) || 20, this.config.maxMessages || 50);

    if (process.platform !== 'darwin') {
      return createErrorResult('iMessage tool is macOS-only. Current platform: ' + process.platform);
    }

    switch (action) {
      case 'send': {
        if (this.config.allowSend === false) {
          return createErrorResult('Sending messages is disabled in configuration.');
        }
        const to = params['to'] as string;
        const message = params['message'] as string;
        if (!to || !message) {
          return createErrorResult('send action requires "to" and "message" parameters.');
        }

        // Input validation: phone number format
        if (!PHONE_NUMBER_PATTERN.test(to) && !to.includes('@')) {
          return createErrorResult(
            `Invalid recipient "${to}". Must be a phone number (7-20 digits, optional +) or email address.`
          );
        }

        // Input validation: message length
        if (message.length > MAX_MESSAGE_LENGTH) {
          return createErrorResult(
            `Message too long (${message.length} chars). Maximum allowed: ${MAX_MESSAGE_LENGTH} characters.`
          );
        }

        // Confirmation gate
        const isTrusted = this.config.trustedNumbers?.includes(to) ?? false;
        if (this.config.requireConfirmation !== false && !isTrusted) {
          if (this.config.confirmSend) {
            const confirmed = await this.config.confirmSend(to, message);
            if (!confirmed) {
              return createErrorResult('Message send was rejected by confirmation callback.');
            }
          } else {
            // No callback available — log a warning but proceed
            getAuditLogger().logEvent('imessage.send.unconfirmed', 'imessage-tool', {
              to,
              messageLength: message.length,
              warning: 'No confirmation callback configured; sending without explicit confirmation.',
            });
          }
        }

        // Audit log the send attempt
        getAuditLogger().logEvent('imessage.send', 'imessage-tool', {
          to,
          messageLength: message.length,
        });

        const service = (params['service'] as 'iMessage' | 'SMS') || 'iMessage';
        const result = await sendMessage(to, message, service);
        return createToolResult(result);
      }

      case 'read': {
        const contact = params['contact'] as string;
        if (!contact) {
          return createErrorResult('read action requires "contact" parameter.');
        }
        const result = await readConversation(contact, limit);
        return createToolResult(result);
      }

      case 'search': {
        const query = params['query'] as string;
        if (!query) {
          return createErrorResult('search action requires "query" parameter.');
        }
        const result = await searchMessages(query, limit);
        return createToolResult(result);
      }

      case 'unread': {
        const result = await getUnreadCount();
        return createToolResult(result);
      }

      case 'conversations': {
        const result = await listConversations(limit);
        return createToolResult(result);
      }

      default:
        return createErrorResult(`Unknown action: ${action}. Use: send, read, search, unread, conversations`);
    }
  }
}
