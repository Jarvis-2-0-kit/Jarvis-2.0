/**
 * Marketing Engine Plugin v4 — Full Marketing Machine Brain.
 *
 * Provides:
 * - `marketing_db` tool: SQLite wrapper (init / query / execute / insert / export)
 * - System prompt loaded from NAS: config/marketing-hub-prompt.md
 *
 * The heavy lifting (12 agents, media pipeline, social automation, viral engine,
 * email automation, lead generation, self-learning) lives in the prompt.
 * This plugin provides the database tool (12 tables) and prompt injection.
 */

import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join } from 'node:path';
import type { AgentTool, ToolResult, ToolContext } from '@jarvis/tools';
import type { JarvisPluginDefinition } from '../types.js';

// ─── Constants ───────────────────────────────────────────────────────

const PLUGIN_ID = 'marketing-engine';
const PLUGIN_NAME = 'Marketing Engine';
const DB_RELATIVE_PATH = 'marketing/marketing.db';
const PROMPT_RELATIVE_PATH = 'config/marketing-hub-prompt.md';
const SQLITE_TIMEOUT_MS = 10_000;

// ─── SQL Schema (matches prompt) ─────────────────────────────────────

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS trends (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  source_url TEXT,
  confidence TEXT DEFAULT 'medium',
  impact TEXT DEFAULT 'medium',
  actionable INTEGER DEFAULT 0,
  action_taken TEXT,
  discovered_at TEXT DEFAULT (datetime('now')),
  expires_at TEXT
);

CREATE TABLE IF NOT EXISTS viral_tracker (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  product TEXT,
  content_type TEXT NOT NULL,
  hook TEXT NOT NULL,
  description TEXT,
  engagement_count INTEGER,
  engagement_rate REAL,
  views INTEGER,
  shares INTEGER,
  completion_rate REAL,
  source_url TEXT,
  why_viral TEXT,
  hook_type TEXT,
  sound_used TEXT,
  replicable INTEGER DEFAULT 0,
  our_version TEXT,
  tracked_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS competitors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  name TEXT NOT NULL,
  website TEXT,
  description TEXT,
  strengths TEXT,
  weaknesses TEXT,
  pricing TEXT,
  funding TEXT,
  market_position TEXT,
  social_followers TEXT,
  content_strategy TEXT,
  last_move TEXT,
  our_advantage TEXT,
  threat_level TEXT DEFAULT 'medium',
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audience_insights (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  segment TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  insight TEXT NOT NULL,
  source TEXT,
  source_url TEXT,
  confidence TEXT DEFAULT 'medium',
  actionable INTEGER DEFAULT 0,
  action_taken TEXT,
  discovered_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS content_library (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  platform TEXT NOT NULL,
  content_type TEXT NOT NULL,
  title TEXT,
  hook TEXT,
  body TEXT NOT NULL,
  cta TEXT,
  hashtags TEXT,
  media_asset_id INTEGER,
  status TEXT DEFAULT 'draft',
  scheduled_at TEXT,
  published_at TEXT,
  engagement_rate REAL,
  impressions INTEGER,
  reach INTEGER,
  clicks INTEGER,
  shares INTEGER,
  saves INTEGER,
  conversions INTEGER,
  performance_notes TEXT,
  ab_variant TEXT,
  ab_winner INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  company_name TEXT,
  contact_name TEXT,
  email TEXT,
  phone TEXT,
  linkedin_url TEXT,
  website TEXT,
  industry TEXT,
  company_size TEXT,
  location TEXT,
  current_solution TEXT,
  pain_signals TEXT,
  tech_stack TEXT,
  lead_source TEXT,
  score INTEGER DEFAULT 0,
  score_breakdown TEXT,
  status TEXT DEFAULT 'new',
  outreach_channel TEXT,
  outreach_history TEXT,
  notes TEXT,
  last_contact_at TEXT,
  next_action TEXT,
  next_action_date TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT DEFAULT 'planning',
  goal TEXT,
  target_audience TEXT,
  channels TEXT,
  budget REAL DEFAULT 0,
  spent REAL DEFAULT 0,
  impressions INTEGER DEFAULT 0,
  clicks INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  revenue REAL DEFAULT 0,
  roi REAL,
  roas REAL,
  cac REAL,
  start_date TEXT,
  end_date TEXT,
  learnings TEXT,
  auto_killed INTEGER DEFAULT 0,
  auto_scaled INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS market_data (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  metric_name TEXT NOT NULL,
  metric_value TEXT NOT NULL,
  unit TEXT,
  source TEXT,
  source_url TEXT,
  period TEXT,
  confidence TEXT DEFAULT 'medium',
  notes TEXT,
  collected_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chatbot_kb (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  bot TEXT NOT NULL,
  category TEXT NOT NULL,
  question TEXT,
  answer TEXT NOT NULL,
  tags TEXT,
  priority INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS performance_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT,
  agent TEXT NOT NULL,
  action_type TEXT NOT NULL,
  description TEXT NOT NULL,
  metric_name TEXT,
  metric_before REAL,
  metric_after REAL,
  change_percent REAL,
  success INTEGER,
  learning TEXT,
  logged_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS media_assets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  tool_used TEXT NOT NULL,
  prompt TEXT,
  style TEXT,
  dimensions TEXT,
  duration_sec REAL,
  output_path TEXT NOT NULL,
  thumbnail_path TEXT,
  file_size_mb REAL,
  quality_score INTEGER,
  status TEXT DEFAULT 'generated',
  used_in_content_ids TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS email_campaigns (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  sequence_type TEXT NOT NULL,
  provider TEXT DEFAULT 'brevo',
  status TEXT DEFAULT 'draft',
  total_recipients INTEGER DEFAULT 0,
  emails_sent INTEGER DEFAULT 0,
  unique_opens INTEGER DEFAULT 0,
  open_rate REAL,
  unique_clicks INTEGER DEFAULT 0,
  click_rate REAL,
  replies INTEGER DEFAULT 0,
  reply_rate REAL,
  unsubscribes INTEGER DEFAULT 0,
  unsubscribe_rate REAL,
  bounces INTEGER DEFAULT 0,
  conversions INTEGER DEFAULT 0,
  conversion_rate REAL,
  revenue_attributed REAL DEFAULT 0,
  ab_test_subject_a TEXT,
  ab_test_subject_b TEXT,
  ab_winner TEXT,
  sequence_emails TEXT,
  segment_criteria TEXT,
  started_at TEXT,
  completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);
`.trim();

// ─── Helpers ─────────────────────────────────────────────────────────

function getDbPath(nasPath: string): string {
  return join(nasPath, DB_RELATIVE_PATH);
}

function ensureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Escape a value for safe SQLite string literal insertion.
 * Doubles single quotes (SQL standard) and wraps in single quotes.
 * NULL values return the SQL keyword NULL (unquoted).
 */
function sqlEscape(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? '1' : '0';
  const str = String(value);
  return `'${str.replace(/'/g, "''")}'`;
}

/**
 * Run a sqlite3 command and return stdout.
 * SQL is piped via stdin (not shell args) to prevent shell injection.
 * Uses -json for SELECT queries, -bail for DDL/DML.
 */
function runSqlite3(dbPath: string, sql: string, jsonMode: boolean): string {
  ensureDir(join(dbPath, '..'));
  const args = jsonMode ? ['-json'] : ['-bail'];
  const result = execSync(
    `sqlite3 ${args.join(' ')} "${dbPath}"`,
    {
      input: sql,
      encoding: 'utf-8',
      timeout: SQLITE_TIMEOUT_MS,
      maxBuffer: 5 * 1024 * 1024,
    },
  );
  return result.trim();
}

// ─── Tool: marketing_db ──────────────────────────────────────────────

function createMarketingDbTool(nasPath: string): AgentTool {
  const dbPath = getDbPath(nasPath);

  return {
    definition: {
      name: 'marketing_db',
      description:
        'SQLite database for the Marketing Hub v4 brain. 12 tables: trends, viral_tracker, competitors, audience_insights, content_library, leads, campaigns, market_data, chatbot_kb, performance_log, media_assets, email_campaigns. Actions: init (create all 12 tables), query (SELECT → JSON), execute (INSERT/UPDATE/DELETE), insert (safe parameterized INSERT), export (table → markdown).',
      input_schema: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['init', 'query', 'execute', 'insert', 'export'],
            description:
              'init = create tables | query = SELECT → JSON | execute = raw INSERT/UPDATE/DELETE | insert = safe parameterized INSERT (auto-escapes values) | export = table → markdown',
          },
          sql: {
            type: 'string',
            description: 'SQL statement (for query/execute). Use doubled single quotes (\'\') for apostrophes in strings.',
          },
          table: {
            type: 'string',
            description: 'Table name (for insert/export)',
          },
          data: {
            type: 'object',
            description: 'Key-value pairs to INSERT (for insert action). Values are auto-escaped — safe for any string content including quotes, URLs, HTML.',
          },
          where: {
            type: 'string',
            description: 'Optional WHERE clause for export (without the WHERE keyword)',
          },
        },
        required: ['action'],
      },
    },

    async execute(
      params: Record<string, unknown>,
      _context: ToolContext,
    ): Promise<ToolResult> {
      const action = params.action as string;

      try {
        switch (action) {
          // ── Init: create all 12 tables ──
          case 'init': {
            runSqlite3(dbPath, SCHEMA_SQL, false);
            // Verify tables were created
            const tables = runSqlite3(dbPath, ".tables", false);
            return {
              type: 'text',
              content: `Database initialized at ${dbPath}\n\nTables created:\n${tables}`,
              metadata: { dbPath, tables: tables.split(/\s+/).filter(Boolean) },
            };
          }

          // ── Query: SELECT → JSON ──
          case 'query': {
            const sql = params.sql as string;
            if (!sql) {
              return { type: 'error', content: 'Missing required parameter: sql' };
            }
            if (!sql.trim().toUpperCase().startsWith('SELECT')) {
              return {
                type: 'error',
                content: 'Query action only supports SELECT statements. Use "execute" for INSERT/UPDATE/DELETE.',
              };
            }
            const result = runSqlite3(dbPath, sql, true);
            if (!result) {
              return { type: 'text', content: '[]', metadata: { rowCount: 0 } };
            }
            let rows: unknown[];
            try {
              rows = JSON.parse(result);
            } catch {
              return { type: 'text', content: result };
            }
            return {
              type: 'text',
              content: JSON.stringify(rows, null, 2),
              metadata: { rowCount: Array.isArray(rows) ? rows.length : 0 },
            };
          }

          // ── Execute: raw INSERT/UPDATE/DELETE (caller must escape) ──
          case 'execute': {
            const sql = params.sql as string;
            if (!sql) {
              return { type: 'error', content: 'Missing required parameter: sql' };
            }
            const upper = sql.trim().toUpperCase();
            if (upper.startsWith('SELECT')) {
              return {
                type: 'error',
                content: 'Execute action does not support SELECT. Use "query" instead.',
              };
            }
            runSqlite3(dbPath, sql, false);
            // Get affected rows count
            const changes = runSqlite3(dbPath, 'SELECT changes() as affected_rows;', true);
            let affectedRows = 0;
            try {
              const parsed = JSON.parse(changes);
              affectedRows = parsed[0]?.affected_rows ?? 0;
            } catch { /* ignore */ }
            return {
              type: 'text',
              content: `Executed successfully. Rows affected: ${affectedRows}`,
              metadata: { affectedRows },
            };
          }

          // ── Insert: safe parameterized INSERT (auto-escapes all values) ──
          case 'insert': {
            const table = params.table as string;
            const data = params.data as Record<string, unknown> | undefined;
            if (!table) {
              return { type: 'error', content: 'Missing required parameter: table' };
            }
            if (!data || typeof data !== 'object' || Object.keys(data).length === 0) {
              return { type: 'error', content: 'Missing or empty required parameter: data (object with column: value pairs)' };
            }
            // Sanitize table name
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
              return { type: 'error', content: 'Invalid table name — only alphanumeric and underscores allowed' };
            }
            const columns = Object.keys(data);
            // Sanitize column names
            for (const col of columns) {
              if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
                return { type: 'error', content: `Invalid column name: ${col}` };
              }
            }
            const values = columns.map((col) => sqlEscape(data[col]));
            const sql = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${values.join(', ')});`;
            runSqlite3(dbPath, sql, false);
            // Get the last inserted row ID
            const lastId = runSqlite3(dbPath, 'SELECT last_insert_rowid() as id;', true);
            let insertedId = 0;
            try {
              const parsed = JSON.parse(lastId);
              insertedId = parsed[0]?.id ?? 0;
            } catch { /* ignore */ }
            return {
              type: 'text',
              content: `Inserted into "${table}" successfully. Row ID: ${insertedId}`,
              metadata: { table, insertedId },
            };
          }

          // ── Export: table → markdown ──
          case 'export': {
            const table = params.table as string;
            if (!table) {
              return { type: 'error', content: 'Missing required parameter: table' };
            }
            // Sanitize table name (only allow alphanumeric + underscore)
            if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
              return { type: 'error', content: 'Invalid table name' };
            }
            const where = params.where as string | undefined;
            const whereClause = where ? ` WHERE ${where}` : '';
            const sql = `SELECT * FROM ${table}${whereClause} ORDER BY id DESC LIMIT 100;`;
            const result = runSqlite3(dbPath, sql, true);
            if (!result) {
              return { type: 'text', content: `Table "${table}" is empty.` };
            }
            let rows: Record<string, unknown>[];
            try {
              rows = JSON.parse(result);
            } catch {
              return { type: 'text', content: result };
            }
            if (rows.length === 0) {
              return { type: 'text', content: `Table "${table}" is empty.` };
            }
            // Build markdown table
            const columns = Object.keys(rows[0]);
            const header = `| ${columns.join(' | ')} |`;
            const separator = `| ${columns.map(() => '---').join(' | ')} |`;
            const body = rows
              .map(
                (row) =>
                  `| ${columns.map((col) => {
                    const val = row[col];
                    if (val === null || val === undefined) return '';
                    const str = String(val);
                    // Truncate long values in table display
                    return str.length > 80 ? str.slice(0, 77) + '...' : str;
                  }).join(' | ')} |`,
              )
              .join('\n');
            const markdown = `## ${table} (${rows.length} rows)\n\n${header}\n${separator}\n${body}`;
            return {
              type: 'text',
              content: markdown,
              metadata: { table, rowCount: rows.length },
            };
          }

          default:
            return {
              type: 'error',
              content: `Unknown action: ${action}. Valid actions: init, query, execute, export`,
            };
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        return { type: 'error', content: `marketing_db error: ${msg}` };
      }
    },
  };
}

// ─── Load prompt from NAS file ───────────────────────────────────────

function loadPromptContent(nasPath: string): string {
  const promptPath = join(nasPath, PROMPT_RELATIVE_PATH);
  try {
    if (existsSync(promptPath)) {
      return readFileSync(promptPath, 'utf-8');
    }
  } catch { /* fall through to fallback */ }

  // Fallback: minimal prompt if file missing
  return `# Marketing Hub v4

You are an autonomous marketing machine running a 12-agent marketing agency.
Your brain is a SQLite database — use the \`marketing_db\` tool to store and query all marketing intelligence.

## Core Principles
1. Research-first: Always \`web_search\` before creating content or strategy.
2. Revenue-obsessed: Every action must trace back to revenue.
3. Self-improving: Log performance, review learnings, adapt.
4. Data-driven: Store everything in SQLite. Query before creating.

## Quick Start
Run \`init database\` to set up the SQLite brain, then \`full sprint\` for a complete marketing cycle.

> Full prompt file missing at: ${promptPath}
> Place the complete marketing-hub-prompt.md there for full capabilities.`;
}

// ─── Plugin Definition ───────────────────────────────────────────────

export function createMarketingEnginePlugin(): JarvisPluginDefinition {
  return {
    id: PLUGIN_ID,
    name: PLUGIN_NAME,
    description: 'Full marketing machine: 12 agents, media pipeline, social automation, viral engine, email, leads, self-learning. SQLite brain with 12 tables.',
    version: '4.0.0',

    register(api) {
      const nasPath = api.config.nasPath;

      // ── Register marketing_db tool ──
      api.registerTool(createMarketingDbTool(nasPath));

      // ── Register system prompt from NAS file ──
      // Priority 95 = highest among all plugins (memory=90, obsidian=85, voice=50).
      // This is intentional: Marketing Hub IS agent-johny's core identity.
      // If this agent ever needs non-marketing tasks, lower to ~7 to sit below memory/obsidian.
      const promptContent = loadPromptContent(nasPath);
      api.registerPromptSection({
        title: 'Marketing Hub v4',
        content: promptContent,
        priority: 95,
      });

      api.logger.info('Marketing Engine v4 loaded', {
        dbPath: getDbPath(nasPath),
        promptSource: existsSync(join(nasPath, PROMPT_RELATIVE_PATH)) ? 'nas-file' : 'fallback',
      });
    },
  };
}
