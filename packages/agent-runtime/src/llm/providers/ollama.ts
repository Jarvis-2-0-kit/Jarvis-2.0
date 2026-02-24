import { createLogger } from '@jarvis/shared';
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatChunk,
  ModelInfo, ContentBlock, Message,
} from '../types.js';

const log = createLogger('llm:ollama');

const DEFAULT_OLLAMA_URL = 'http://localhost:11434';

export class OllamaProvider implements LLMProvider {
  id = 'ollama';
  name = 'Ollama (Local)';

  constructor(private baseUrl: string = DEFAULT_OLLAMA_URL) {}

  isAvailable(): boolean {
    return true; // Always "available" - actual connectivity checked at runtime
  }

  listModels(): ModelInfo[] {
    // Static fallback — dynamic discovery via fetchModels()
    return [];
  }

  /** Dynamically fetch installed models from Ollama server */
  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
      if (!response.ok) return [];
      const data = await response.json() as OllamaTagsResponse;
      return (data.models ?? []).map((m) => ({
        id: m.name,
        name: m.name,
        provider: 'ollama',
        contextWindow: 32768,
        maxOutputTokens: 8192,
        supportsTools: true,
        supportsVision: m.name.includes('llava') || m.name.includes('vision'),
      }));
    } catch {
      log.warn('Failed to fetch Ollama models - server may be offline');
      return [];
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Ollama API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as OllamaResponse;
    return this.parseResponse(data, request.model);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const body = this.buildRequestBody(request, true);
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Ollama API error ${response.status}: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let toolCallCounter = 0;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;

          try {
            const chunk = JSON.parse(line) as OllamaStreamChunk;

            // Text content
            if (chunk.message?.content) {
              yield { type: 'text_delta', text: chunk.message.content };
            }

            // Tool calls (Ollama returns them as complete objects)
            if (chunk.message?.tool_calls) {
              for (const tc of chunk.message.tool_calls) {
                const id = `call_${toolCallCounter++}`;
                const argsStr = JSON.stringify(tc.function?.arguments ?? {});
                yield { type: 'tool_use_start', toolCall: { id, name: tc.function?.name ?? '', input: '' } };
                yield { type: 'tool_use_delta', toolCall: { id, name: tc.function?.name ?? '', input: argsStr } };
                yield { type: 'tool_use_end', toolCall: { id, name: tc.function?.name ?? '', input: argsStr } };
              }
            }

            // Done
            if (chunk.done) {
              yield {
                type: 'message_end',
                stopReason: chunk.message?.tool_calls ? 'tool_use' : 'end_turn',
                usage: {
                  inputTokens: chunk.prompt_eval_count ?? 0,
                  outputTokens: chunk.eval_count ?? 0,
                  totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
                },
              };
            }
          } catch {
            // Skip malformed JSON
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const messages = request.messages.map((m) => this.convertMessage(m, request.system));

    if (request.system) {
      messages.unshift({ role: 'system', content: request.system });
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      stream,
    };

    const options: Record<string, unknown> = {};
    if (request.temperature !== undefined) options['temperature'] = request.temperature;
    if (request.max_tokens) options['num_predict'] = request.max_tokens;
    if (request.stop_sequences) options['stop'] = request.stop_sequences;
    if (Object.keys(options).length > 0) body['options'] = options;

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => ({
        type: 'function',
        function: {
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        },
      }));
    }

    return body;
  }

  private convertMessage(msg: Message, _system?: string): Record<string, unknown> {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    // Ollama uses OpenAI-compatible format
    const toolResults = msg.content.filter((b) => b.type === 'tool_result');
    if (toolResults.length > 0) {
      return {
        role: 'tool',
        content: typeof toolResults[0]!.content === 'string'
          ? toolResults[0]!.content
          : JSON.stringify(toolResults[0]!.content),
      };
    }

    const toolUses = msg.content.filter((b) => b.type === 'tool_use');
    if (toolUses.length > 0) {
      const textBlocks = msg.content.filter((b) => b.type === 'text');
      return {
        role: 'assistant',
        content: textBlocks.length > 0 ? textBlocks.map((b) => (b as { text: string }).text).join('') : '',
        tool_calls: toolUses.map((b) => ({
          id: (b as { id: string }).id,
          type: 'function',
          function: {
            name: (b as { name: string }).name,
            arguments: JSON.stringify((b as { input: unknown }).input),
          },
        })),
      };
    }

    const content = msg.content.map((b) => (b as { text: string }).text).join('');
    return { role: msg.role, content };
  }

  private parseResponse(data: OllamaResponse, model: string): ChatResponse {
    const content: ContentBlock[] = [];
    let toolCallCounter = 0;

    if (data.message?.content) {
      content.push({ type: 'text', text: data.message.content });
    }

    if (data.message?.tool_calls) {
      for (const tc of data.message.tool_calls) {
        content.push({
          type: 'tool_use',
          id: `call_${toolCallCounter++}`,
          name: tc.function?.name ?? '',
          input: (tc.function?.arguments ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      stopReason: data.message?.tool_calls ? 'tool_use' : 'end_turn',
      usage: {
        inputTokens: data.prompt_eval_count ?? 0,
        outputTokens: data.eval_count ?? 0,
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
      model,
    };
  }
}

// Ollama API types
interface OllamaTagsResponse {
  models?: Array<{ name: string; modified_at?: string; size?: number }>;
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: unknown };
}

interface OllamaResponse {
  message?: { role?: string; content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaStreamChunk {
  message?: { role?: string; content?: string; tool_calls?: OllamaToolCall[] };
  done?: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
