/**
 * ClaudeCliProvider — Uses `claude` CLI subprocess as LLM backend.
 *
 * Bills to Claude Max subscription (no API key costs).
 * Spawns `claude -p` for each turn, parses JSON output.
 *
 * Tool handling: Injects tool definitions into the prompt and uses
 * structured JSON output to parse tool calls. When Claude wants to
 * call a tool, it outputs a specific JSON format that we parse into
 * ToolUseBlock objects.
 */
import { createLogger } from '@jarvis/shared';
import { execFile, execSync, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatChunk,
  ModelInfo, ContentBlock, Message, ToolDefinition,
} from '../types.js';

const execFileAsync = promisify(execFile);
const log = createLogger('llm:claude-cli');

/** Resolve claude binary path — check common locations */
function resolveClaudeBin(): string {
  if (process.env['CLAUDE_BIN']) return process.env['CLAUDE_BIN'];

  // Try `which claude` first
  try {
    const bin = execSync('which claude', { encoding: 'utf-8', timeout: 3000, env: { ...process.env, CLAUDECODE: '' } }).trim();
    if (bin) return bin;
  } catch { /* ignore */ }

  // Common NVM / Homebrew locations
  const candidates = [
    `${process.env['HOME']}/.nvm/versions/node/${process.version}/bin/claude`,
    '/usr/local/bin/claude',
    '/opt/homebrew/bin/claude',
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return 'claude'; // fallback
}

const CLAUDE_BIN = resolveClaudeBin();

const MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-6', name: 'Claude Opus 4.6 (CLI)', provider: 'claude-cli', contextWindow: 200000, maxOutputTokens: 32000, supportsTools: true, supportsVision: false, costPerInputToken: 0, costPerOutputToken: 0 },
  { id: 'claude-sonnet-4-6', name: 'Claude Sonnet 4.6 (CLI)', provider: 'claude-cli', contextWindow: 200000, maxOutputTokens: 64000, supportsTools: true, supportsVision: false, costPerInputToken: 0, costPerOutputToken: 0 },
];

/** Check if `claude` CLI is available */
function isClaudeAvailable(): boolean {
  try {
    const version = execSync(`"${CLAUDE_BIN}" --version`, { encoding: 'utf-8', timeout: 5000, env: { ...process.env, CLAUDECODE: '' } }).trim();
    log.info(`Claude CLI found: ${CLAUDE_BIN} (${version})`);
    return true;
  } catch (err) {
    log.warn(`Claude CLI check failed (${CLAUDE_BIN}): ${(err as Error).message?.slice(0, 100)}`);
    return false;
  }
}

/**
 * Convert multi-turn messages into a single prompt string for `claude -p`.
 * Includes system prompt, tool definitions, and conversation history.
 */
function buildPrompt(request: ChatRequest): string {
  const parts: string[] = [];

  // System prompt
  if (request.system) {
    parts.push(request.system);
  }

  // Tool definitions (injected into prompt for subprocess mode)
  if (request.tools && request.tools.length > 0) {
    parts.push(buildToolPrompt(request.tools));
  }

  // Conversation history
  for (const msg of request.messages) {
    if (msg.role === 'system') continue;

    if (typeof msg.content === 'string') {
      parts.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${msg.content}`);
    } else {
      // Handle content blocks
      const textParts = msg.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text);

      const toolResults = msg.content
        .filter((b) => b.type === 'tool_result')
        .map((b) => {
          const tr = b as { tool_use_id: string; content: unknown; is_error?: boolean };
          const content = typeof tr.content === 'string' ? tr.content : JSON.stringify(tr.content);
          return `[Tool Result for ${tr.tool_use_id}]: ${tr.is_error ? 'ERROR: ' : ''}${content}`;
        });

      const allText = [...textParts, ...toolResults].join('\n');
      if (allText) {
        parts.push(`${msg.role === 'user' ? 'Human' : 'Assistant'}: ${allText}`);
      }
    }
  }

  return parts.join('\n\n');
}

/**
 * Build tool definition prompt section.
 * Instructs Claude to output tool calls in a parseable JSON format.
 */
function buildToolPrompt(tools: ToolDefinition[]): string {
  const toolDefs = tools.map((t) => {
    const params = t.input_schema.properties
      ? Object.entries(t.input_schema.properties as Record<string, { type?: string; description?: string }>)
          .map(([name, schema]) => `    - ${name} (${schema.type || 'any'}): ${schema.description || ''}`)
          .join('\n')
      : '    (no parameters)';
    const required = (t.input_schema.required as string[]) || [];
    return `  ${t.name}: ${t.description}\n    Required: [${required.join(', ')}]\n${params}`;
  }).join('\n\n');

  return `## Available Tools

You have access to the following tools. To call a tool, output a JSON block wrapped in <tool_call> tags:

<tool_call>
{"name": "tool_name", "input": {"param1": "value1"}}
</tool_call>

You may call multiple tools by outputting multiple <tool_call> blocks.
After outputting tool calls, STOP and wait for results.
If you don't need any tools, just respond with text normally.

Tools:
${toolDefs}`;
}

/**
 * Parse tool calls from Claude's text response.
 * Looks for <tool_call>...</tool_call> blocks.
 */
function parseToolCalls(text: string): { textContent: string; toolCalls: Array<{ name: string; input: Record<string, unknown> }> } {
  const toolCalls: Array<{ name: string; input: Record<string, unknown> }> = [];
  let textContent = text;

  const regex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;

  while ((match = regex.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(match[1]) as { name: string; input: Record<string, unknown> };
      if (parsed.name) {
        toolCalls.push({ name: parsed.name, input: parsed.input || {} });
      }
    } catch (err) {
      log.warn(`Failed to parse tool call: ${(err as Error).message}`);
    }
    // Remove tool call from text content
    textContent = textContent.replace(match[0], '').trim();
  }

  return { textContent, toolCalls };
}

export class ClaudeCliProvider implements LLMProvider {
  id = 'claude-cli';
  name = 'Claude CLI (Max)';
  private available: boolean;

  constructor() {
    this.available = isClaudeAvailable();
    if (this.available) {
      log.info('Claude CLI provider initialized (Max subscription)');
    } else {
      log.warn('Claude CLI not found — provider unavailable');
    }
  }

  isAvailable(): boolean {
    return this.available;
  }

  listModels(): ModelInfo[] {
    return this.available ? MODELS : [];
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    if (!this.available) throw new Error('Claude CLI not available');

    const prompt = buildPrompt(request);
    const model = request.model || 'claude-opus-4-6';

    log.info(`Calling claude -p (model: ${model}, prompt: ${prompt.length} chars)`);

    try {
      // Use spawn to pass prompt via stdin
      const response = await new Promise<string>((resolve, reject) => {
        const child = spawn(CLAUDE_BIN, [
          '-p',
          '--output-format', 'json',
          '--model', model,
          '--no-session-persistence',
          '--dangerously-skip-permissions',
        ], {
          env: { ...process.env, CLAUDECODE: '' },
          timeout: 600_000,
        });

        let stdout = '';
        let stderr = '';

        child.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

        child.on('close', (code: number) => {
          if (code === 0 || stdout.trim()) {
            resolve(stdout);
          } else {
            reject(new Error(`Claude CLI exited with code ${code}: ${stderr.slice(0, 500)}`));
          }
        });

        child.on('error', (err: Error) => reject(err));

        // Write prompt to stdin and close
        child.stdin.write(prompt);
        child.stdin.end();
      });

      const stdout = response;

      const result = JSON.parse(stdout) as {
        result?: string;
        is_error?: boolean;
        usage?: {
          input_tokens?: number;
          output_tokens?: number;
          cache_read_input_tokens?: number;
          cache_creation_input_tokens?: number;
        };
        modelUsage?: Record<string, {
          inputTokens?: number;
          outputTokens?: number;
          cacheReadInputTokens?: number;
          cacheCreationInputTokens?: number;
        }>;
        total_cost_usd?: number;
        stop_reason?: string;
      };

      if (result.is_error) {
        throw new Error(`Claude CLI error: ${result.result || 'unknown error'}`);
      }

      const responseText = result.result || '';

      // Parse tool calls from response
      const { textContent, toolCalls } = parseToolCalls(responseText);
      const hasToolCalls = toolCalls.length > 0;

      // Build content blocks
      const content: ContentBlock[] = [];

      if (textContent) {
        content.push({ type: 'text', text: textContent });
      }

      for (const tc of toolCalls) {
        content.push({
          type: 'tool_use',
          id: `cli-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          name: tc.name,
          input: tc.input,
        });
      }

      if (content.length === 0) {
        content.push({ type: 'text', text: '(empty response)' });
      }

      // Extract usage from modelUsage (more detailed) or top-level usage
      const modelKey = Object.keys(result.modelUsage || {})[0];
      const mu = modelKey ? result.modelUsage![modelKey] : undefined;

      const usage = {
        inputTokens: mu?.inputTokens ?? result.usage?.input_tokens ?? 0,
        outputTokens: mu?.outputTokens ?? result.usage?.output_tokens ?? 0,
        cacheReadTokens: mu?.cacheReadInputTokens ?? result.usage?.cache_read_input_tokens ?? 0,
        cacheWriteTokens: mu?.cacheCreationInputTokens ?? result.usage?.cache_creation_input_tokens ?? 0,
        totalTokens: (mu?.inputTokens ?? 0) + (mu?.outputTokens ?? 0),
      };

      log.info(`Claude CLI response: ${responseText.length} chars, ${toolCalls.length} tool calls, ${usage.totalTokens} tokens, cost: $${result.total_cost_usd?.toFixed(4) ?? '?'}`);

      return {
        content,
        stopReason: hasToolCalls ? 'tool_use' : 'end_turn',
        usage,
        model,
      };
    } catch (err) {
      const errMsg = (err as Error).message;
      if (errMsg.includes('TIMEOUT') || errMsg.includes('timed out')) {
        throw new Error('Claude CLI timed out (600s)');
      }
      throw new Error(`Claude CLI failed: ${errMsg}`);
    }
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    // For streaming, we just call chat() and yield the result as a single chunk
    // True streaming would require --output-format stream-json with child_process.spawn
    try {
      const response = await this.chat(request);

      for (const block of response.content) {
        if (block.type === 'text') {
          yield { type: 'text_delta', text: (block as { text: string }).text };
        } else if (block.type === 'tool_use') {
          const tu = block as { id: string; name: string; input: Record<string, unknown> };
          yield { type: 'tool_use_start', toolCall: { id: tu.id, name: tu.name, input: '' } };
          yield { type: 'tool_use_delta', toolCall: { id: tu.id, name: tu.name, input: JSON.stringify(tu.input) } };
          yield { type: 'tool_use_end', toolCall: { id: tu.id, name: tu.name, input: JSON.stringify(tu.input) } };
        }
      }

      yield {
        type: 'message_end',
        stopReason: response.stopReason,
        usage: response.usage,
      };
    } catch (err) {
      yield { type: 'error', error: (err as Error).message };
    }
  }
}
