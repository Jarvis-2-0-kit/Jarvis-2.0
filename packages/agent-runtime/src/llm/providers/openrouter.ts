import { createLogger } from '@jarvis/shared';
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatChunk,
  ModelInfo, ContentBlock, Message,
} from '../types.js';

const log = createLogger('llm:openrouter');

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/**
 * OpenRouter aggregator - uses OpenAI-compatible API format.
 * Supports 200+ models from all providers.
 */
export class OpenRouterProvider implements LLMProvider {
  id = 'openrouter';
  name = 'OpenRouter';

  private cachedModels: ModelInfo[] | null = null;

  constructor(
    private apiKey: string,
    private siteUrl: string = '',
    private siteName: string = 'Jarvis 2.0',
  ) {}

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  listModels(): ModelInfo[] {
    // Return cached or empty — use fetchModels() for dynamic list
    return this.cachedModels ?? [];
  }

  /** Fetch available models from OpenRouter API */
  async fetchModels(): Promise<ModelInfo[]> {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/models', {
        headers: this.getHeaders(),
      });
      if (!response.ok) return [];
      const data = await response.json() as OpenRouterModelsResponse;

      this.cachedModels = (data.data ?? []).map((m) => ({
        id: m.id,
        name: m.name ?? m.id,
        provider: 'openrouter',
        contextWindow: m.context_length ?? 4096,
        maxOutputTokens: m.top_provider?.max_completion_tokens ?? 4096,
        supportsTools: true,
        supportsVision: m.architecture?.modality?.includes('image') ?? false,
        costPerInputToken: parseFloat(m.pricing?.prompt ?? '0'),
        costPerOutputToken: parseFloat(m.pricing?.completion ?? '0'),
      }));

      return this.cachedModels;
    } catch {
      log.warn('Failed to fetch OpenRouter models');
      return [];
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const body = this.buildRequestBody(request, false);
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenRouter API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as OpenRouterResponse;
    return this.parseResponse(data);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const body = this.buildRequestBody(request, true);
    const response = await fetch(OPENROUTER_API_URL, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `OpenRouter API error ${response.status}: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();

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
            const event = JSON.parse(jsonStr) as OpenRouterStreamChunk;
            const choice = event.choices?.[0];
            if (!choice) continue;

            const delta = choice.delta;

            if (delta?.content) {
              yield { type: 'text_delta', text: delta.content };
            }

            if (delta?.tool_calls) {
              for (const tc of delta.tool_calls) {
                const idx = tc.index ?? 0;
                if (!toolCalls.has(idx)) {
                  toolCalls.set(idx, { id: tc.id ?? '', name: tc.function?.name ?? '', arguments: '' });
                  yield {
                    type: 'tool_use_start',
                    toolCall: { id: tc.id ?? '', name: tc.function?.name ?? '', input: '' },
                  };
                }

                const existing = toolCalls.get(idx)!;
                if (tc.id) existing.id = tc.id;
                if (tc.function?.name) existing.name = tc.function.name;
                if (tc.function?.arguments) {
                  existing.arguments += tc.function.arguments;
                  yield {
                    type: 'tool_use_delta',
                    toolCall: { id: existing.id, name: existing.name, input: existing.arguments },
                  };
                }
              }
            }

            if (choice.finish_reason) {
              for (const [, tc] of toolCalls) {
                yield {
                  type: 'tool_use_end',
                  toolCall: { id: tc.id, name: tc.name, input: tc.arguments },
                };
              }
              toolCalls.clear();

              yield {
                type: 'message_end',
                stopReason: mapFinishReason(choice.finish_reason),
                usage: event.usage ? {
                  inputTokens: event.usage.prompt_tokens ?? 0,
                  outputTokens: event.usage.completion_tokens ?? 0,
                  totalTokens: event.usage.total_tokens ?? 0,
                } : undefined,
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

  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
    };
    if (this.siteUrl) headers['HTTP-Referer'] = this.siteUrl;
    if (this.siteName) headers['X-Title'] = this.siteName;
    return headers;
  }

  private buildRequestBody(request: ChatRequest, stream: boolean): Record<string, unknown> {
    const messages = request.messages.map((m) => this.convertMessage(m));
    if (request.system) {
      messages.unshift({ role: 'system', content: request.system });
    }

    const body: Record<string, unknown> = {
      model: request.model,
      messages: messages.filter((m) => m.role !== 'system' || messages[0] === m),
      stream,
    };

    if (stream) {
      body['stream_options'] = { include_usage: true };
    }

    if (request.max_tokens) body['max_tokens'] = request.max_tokens;
    if (request.temperature !== undefined) body['temperature'] = request.temperature;
    if (request.stop_sequences) body['stop'] = request.stop_sequences;

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

  private convertMessage(msg: Message): Record<string, unknown> {
    if (typeof msg.content === 'string') {
      return { role: msg.role, content: msg.content };
    }

    const toolResults = msg.content.filter((b) => b.type === 'tool_result');
    if (toolResults.length > 0) {
      return {
        role: 'tool',
        tool_call_id: (toolResults[0] as { tool_use_id: string }).tool_use_id,
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
        content: textBlocks.length > 0 ? textBlocks.map((b) => (b as { text: string }).text).join('') : null,
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

  private parseResponse(data: OpenRouterResponse): ChatResponse {
    const choice = data.choices?.[0];
    const message = choice?.message;
    const content: ContentBlock[] = [];

    if (message?.content) {
      content.push({ type: 'text', text: message.content });
    }

    if (message?.tool_calls) {
      for (const tc of message.tool_calls) {
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(tc.function?.arguments ?? '{}') as Record<string, unknown>;
        } catch { /* empty */ }

        content.push({
          type: 'tool_use',
          id: tc.id ?? '',
          name: tc.function?.name ?? '',
          input,
        });
      }
    }

    return {
      content,
      stopReason: mapFinishReason(choice?.finish_reason),
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
      },
      model: data.model ?? '',
    };
  }
}

function mapFinishReason(reason?: string): ChatResponse['stopReason'] {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'tool_calls': return 'tool_use';
    case 'length': return 'max_tokens';
    default: return 'end_turn';
  }
}

// OpenRouter API types (OpenAI-compatible)
interface OpenRouterModelsResponse {
  data?: Array<{
    id: string;
    name?: string;
    context_length?: number;
    pricing?: { prompt?: string; completion?: string };
    top_provider?: { max_completion_tokens?: number };
    architecture?: { modality?: string };
  }>;
}

interface OpenRouterResponse {
  choices?: Array<{
    message?: { content?: string; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: string } }> };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  model?: string;
}

interface OpenRouterStreamChunk {
  choices?: Array<{
    delta?: {
      content?: string;
      tool_calls?: Array<{ index?: number; id?: string; function?: { name?: string; arguments?: string } }>;
    };
    finish_reason?: string;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
}
