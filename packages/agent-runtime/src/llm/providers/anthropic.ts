import { createLogger } from '@jarvis/shared';
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatChunk,
  ModelInfo, ContentBlock, TokenUsage, Message,
} from '../types.js';

const log = createLogger('llm:anthropic');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const MODELS: ModelInfo[] = [
  { id: 'claude-opus-4-20250514', name: 'Claude Opus 4', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 32000, supportsTools: true, supportsVision: true, costPerInputToken: 15 / 1e6, costPerOutputToken: 75 / 1e6 },
  { id: 'claude-sonnet-4-20250514', name: 'Claude Sonnet 4', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 16000, supportsTools: true, supportsVision: true, costPerInputToken: 3 / 1e6, costPerOutputToken: 15 / 1e6 },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5', provider: 'anthropic', contextWindow: 200000, maxOutputTokens: 8192, supportsTools: true, supportsVision: true, costPerInputToken: 0.8 / 1e6, costPerOutputToken: 4 / 1e6 },
];

export class AnthropicProvider implements LLMProvider {
  id = 'anthropic';
  name = 'Anthropic';

  constructor(private apiKey: string) {}

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  listModels(): ModelInfo[] {
    return MODELS;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false);
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Anthropic API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as AnthropicResponse;
    return this.parseResponse(data);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const body = this.buildRequestBody(request, true);
    const response = await fetch(ANTHROPIC_API_URL, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Anthropic API error ${response.status}: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    let currentToolId = '';
    let currentToolName = '';
    let currentToolInput = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const jsonStr = line.slice(6).trim();
          if (!jsonStr || jsonStr === '[DONE]') continue;

          try {
            const event = JSON.parse(jsonStr) as AnthropicStreamEvent;

            switch (event.type) {
              case 'content_block_start':
                if (event.content_block?.type === 'tool_use') {
                  currentToolId = event.content_block.id ?? '';
                  currentToolName = event.content_block.name ?? '';
                  currentToolInput = '';
                  yield { type: 'tool_use_start', toolCall: { id: currentToolId, name: currentToolName, input: '' } };
                }
                break;

              case 'content_block_delta':
                if (event.delta?.type === 'text_delta' && event.delta.text) {
                  yield { type: 'text_delta', text: event.delta.text };
                } else if (event.delta?.type === 'input_json_delta' && event.delta.partial_json) {
                  currentToolInput += event.delta.partial_json;
                  yield { type: 'tool_use_delta', toolCall: { id: currentToolId, name: currentToolName, input: currentToolInput } };
                }
                break;

              case 'content_block_stop':
                if (currentToolId) {
                  yield { type: 'tool_use_end', toolCall: { id: currentToolId, name: currentToolName, input: currentToolInput } };
                  currentToolId = '';
                  currentToolName = '';
                  currentToolInput = '';
                }
                break;

              case 'message_delta':
                yield {
                  type: 'message_end',
                  stopReason: mapStopReason(event.delta?.stop_reason),
                  usage: event.usage ? {
                    inputTokens: 0,
                    outputTokens: event.usage.output_tokens ?? 0,
                    totalTokens: event.usage.output_tokens ?? 0,
                  } : undefined,
                };
                break;

              case 'message_start':
                // Initial usage info
                if (event.message?.usage) {
                  yield {
                    type: 'message_end',
                    usage: {
                      inputTokens: event.message.usage.input_tokens ?? 0,
                      outputTokens: 0,
                      cacheReadTokens: event.message.usage.cache_read_input_tokens,
                      cacheWriteTokens: event.message.usage.cache_creation_input_tokens,
                      totalTokens: event.message.usage.input_tokens ?? 0,
                    },
                  };
                }
                break;
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

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
  }

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const messages = request.messages
      .filter((m) => m.role !== 'system')
      .map((m) => this.convertMessage(m));

    const body: Record<string, unknown> = {
      model: request.model,
      messages,
      max_tokens: request.max_tokens ?? 8192,
      stream,
    };

    if (request.system) {
      body['system'] = request.system;
    }

    if (request.temperature !== undefined) {
      body['temperature'] = request.temperature;
    }

    if (request.tools && request.tools.length > 0) {
      body['tools'] = request.tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      }));
    }

    if (request.stop_sequences) {
      body['stop_sequences'] = request.stop_sequences;
    }

    return body;
  }

  private convertMessage(msg: Message): Record<string, unknown> {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    const blocks = msg.content.map((block) => {
      switch (block.type) {
        case 'text':
          return { type: 'text', text: block.text };
        case 'image':
          return {
            type: 'image',
            source: { type: 'base64', media_type: block.mediaType, data: block.data },
          };
        case 'tool_use':
          return { type: 'tool_use', id: block.id, name: block.name, input: block.input };
        case 'tool_result': {
          // Convert tool_result content: can be string or array of content blocks (e.g., images)
          let resultContent: unknown;
          if (typeof block.content === 'string') {
            resultContent = block.content;
          } else if (Array.isArray(block.content)) {
            // Convert nested content blocks to Anthropic format
            resultContent = block.content.map((inner) => {
              if (inner.type === 'image') {
                return {
                  type: 'image',
                  source: { type: 'base64', media_type: inner.mediaType, data: inner.data },
                };
              }
              if (inner.type === 'text') {
                return { type: 'text', text: inner.text };
              }
              return inner;
            });
          } else {
            resultContent = JSON.stringify(block.content);
          }
          return {
            type: 'tool_result',
            tool_use_id: block.tool_use_id,
            content: resultContent,
            is_error: block.is_error,
          };
        }
        default:
          return block;
      }
    });

    return { role: msg.role, content: blocks };
  }

  private parseResponse(data: AnthropicResponse): ChatResponse {
    const content: ContentBlock[] = (data.content ?? []).map((block) => {
      if (block.type === 'text') return { type: 'text', text: block.text ?? '' };
      if (block.type === 'tool_use') return {
        type: 'tool_use',
        id: block.id ?? '',
        name: block.name ?? '',
        input: (block.input ?? {}) as Record<string, unknown>,
      };
      return { type: 'text', text: '' };
    });

    return {
      content,
      stopReason: mapStopReason(data.stop_reason),
      usage: {
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
        cacheReadTokens: data.usage?.cache_read_input_tokens,
        cacheWriteTokens: data.usage?.cache_creation_input_tokens,
        totalTokens: (data.usage?.input_tokens ?? 0) + (data.usage?.output_tokens ?? 0),
      },
      model: data.model ?? '',
    };
  }
}

function mapStopReason(reason?: string): ChatResponse['stopReason'] {
  switch (reason) {
    case 'end_turn': return 'end_turn';
    case 'tool_use': return 'tool_use';
    case 'max_tokens': return 'max_tokens';
    case 'stop_sequence': return 'stop_sequence';
    default: return 'end_turn';
  }
}

// Anthropic API types (internal)
interface AnthropicResponse {
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  stop_reason?: string;
  usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number };
  model?: string;
}

interface AnthropicStreamEvent {
  type: string;
  content_block?: { type: string; id?: string; name?: string; text?: string };
  delta?: { type: string; text?: string; partial_json?: string; stop_reason?: string };
  usage?: { output_tokens?: number };
  message?: { usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } };
}
