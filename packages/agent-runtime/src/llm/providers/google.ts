import { createLogger } from '@jarvis/shared';
import type {
  LLMProvider, ChatRequest, ChatResponse, ChatChunk,
  ModelInfo, ContentBlock, Message,
} from '../types.js';

const log = createLogger('llm:google');

const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/** Timeout for non-streaming chat requests (5 minutes) */
const CHAT_TIMEOUT_MS = 300_000;
/** Timeout for streaming chat requests (10 minutes) */
const STREAM_TIMEOUT_MS = 600_000;

const MODELS: ModelInfo[] = [
  { id: 'gemini-2.0-flash', name: 'Gemini 2.0 Flash', provider: 'google', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsVision: true, costPerInputToken: 0.075 / 1e6, costPerOutputToken: 0.3 / 1e6 },
  { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash Lite', provider: 'google', contextWindow: 1048576, maxOutputTokens: 8192, supportsTools: true, supportsVision: true, costPerInputToken: 0.0375 / 1e6, costPerOutputToken: 0.15 / 1e6 },
  { id: 'gemini-2.5-pro-preview-05-06', name: 'Gemini 2.5 Pro', provider: 'google', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsVision: true, costPerInputToken: 1.25 / 1e6, costPerOutputToken: 10 / 1e6 },
  { id: 'gemini-2.5-flash-preview-05-20', name: 'Gemini 2.5 Flash', provider: 'google', contextWindow: 1048576, maxOutputTokens: 65536, supportsTools: true, supportsVision: true, costPerInputToken: 0.15 / 1e6, costPerOutputToken: 0.6 / 1e6 },
];

export class GoogleProvider implements LLMProvider {
  readonly id = 'google';
  readonly name = 'Google AI';

  constructor(private apiKey: string) {}

  isAvailable(): boolean {
    return !!this.apiKey;
  }

  listModels(): ModelInfo[] {
    return MODELS;
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const url = `${GEMINI_API_URL}/${request.model}:generateContent`;
    const body = this.buildRequestBody(request);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CHAT_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Google AI API error ${response.status}: ${errorText}`);
    }

    const data = await response.json() as GeminiResponse;
    return this.parseResponse(data, request.model);
  }

  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const url = `${GEMINI_API_URL}/${request.model}:streamGenerateContent?alt=sse`;
    const body = this.buildRequestBody(request);

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.apiKey },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(STREAM_TIMEOUT_MS),
    });

    if (!response.ok) {
      const errorText = await response.text();
      yield { type: 'error', error: `Google AI API error ${response.status}: ${errorText}` };
      return;
    }

    const reader = response.body?.getReader();
    if (!reader) return;

    const decoder = new TextDecoder();
    let buffer = '';
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
    let toolCallCounter = 0;

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
            const event = JSON.parse(jsonStr) as GeminiStreamChunk;
            const candidate = event.candidates?.[0];
            if (!candidate?.content) continue;

            for (const part of candidate.content.parts ?? []) {
              // Text content
              if (part.text) {
                yield { type: 'text_delta', text: part.text };
              }

              // Function calls
              if (part.functionCall) {
                const idx = toolCallCounter++;
                const id = `call_${idx}`;
                const argsStr = JSON.stringify(part.functionCall.args ?? {});
                toolCalls.set(idx, { id, name: part.functionCall.name, arguments: argsStr });

                yield { type: 'tool_use_start', toolCall: { id, name: part.functionCall.name, input: '' } };
                yield { type: 'tool_use_delta', toolCall: { id, name: part.functionCall.name, input: argsStr } };
                yield { type: 'tool_use_end', toolCall: { id, name: part.functionCall.name, input: argsStr } };
              }
            }

            // Finish
            if (candidate.finishReason) {
              yield {
                type: 'message_end',
                stopReason: mapFinishReason(candidate.finishReason),
                usage: event.usageMetadata ? {
                  inputTokens: event.usageMetadata.promptTokenCount ?? 0,
                  outputTokens: event.usageMetadata.candidatesTokenCount ?? 0,
                  totalTokens: event.usageMetadata.totalTokenCount ?? 0,
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

  private buildRequestBody(request: ChatRequest): Record<string, unknown> {
    const contents = this.convertMessages(request.messages);
    const body: Record<string, unknown> = { contents };

    // System instruction
    if (request.system) {
      body['systemInstruction'] = { parts: [{ text: request.system }] };
    }

    // Generation config
    const genConfig: Record<string, unknown> = {};
    if (request.max_tokens) genConfig['maxOutputTokens'] = request.max_tokens;
    if (request.temperature !== undefined) genConfig['temperature'] = request.temperature;
    if (request.stop_sequences) genConfig['stopSequences'] = request.stop_sequences;
    if (Object.keys(genConfig).length > 0) body['generationConfig'] = genConfig;

    // Tools
    if (request.tools && request.tools.length > 0) {
      body['tools'] = [{
        functionDeclarations: request.tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.input_schema,
        })),
      }];
    }

    return body;
  }

  private convertMessages(messages: Message[]): GeminiContent[] {
    const contents: GeminiContent[] = [];

    for (const msg of messages) {
      if (msg.role === 'system') continue; // Handled via systemInstruction

      const role = msg.role === 'assistant' ? 'model' : 'user';

      if (typeof msg.content === 'string') {
        contents.push({ role, parts: [{ text: msg.content }] });
        continue;
      }

      const parts: GeminiPart[] = [];
      for (const block of msg.content) {
        switch (block.type) {
          case 'text':
            parts.push({ text: block.text });
            break;
          case 'image':
            parts.push({
              inlineData: { mimeType: block.mediaType, data: block.data },
            });
            break;
          case 'tool_use':
            parts.push({
              functionCall: { name: block.name, args: block.input },
            });
            break;
          case 'tool_result':
            parts.push({
              functionResponse: {
                name: block.tool_use_id,
                response: { result: typeof block.content === 'string' ? block.content : JSON.stringify(block.content) },
              },
            });
            break;
        }
      }

      if (parts.length > 0) {
        contents.push({ role, parts });
      }
    }

    return contents;
  }

  private parseResponse(data: GeminiResponse, model: string): ChatResponse {
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid Gemini response: expected an object');
    }
    const candidate = data.candidates?.[0];
    const content: ContentBlock[] = [];
    let toolCallCounter = 0;

    for (const part of candidate?.content?.parts ?? []) {
      if (part.text) {
        content.push({ type: 'text', text: part.text });
      }
      if (part.functionCall) {
        content.push({
          type: 'tool_use',
          id: `call_${toolCallCounter++}`,
          name: part.functionCall.name,
          input: (part.functionCall.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    return {
      content,
      stopReason: mapFinishReason(candidate?.finishReason),
      usage: {
        inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
        outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: data.usageMetadata?.totalTokenCount ?? 0,
      },
      model,
    };
  }
}

function mapFinishReason(reason?: string): ChatResponse['stopReason'] {
  switch (reason) {
    case 'STOP': return 'end_turn';
    case 'MAX_TOKENS': return 'max_tokens';
    case 'SAFETY':
    case 'RECITATION':
    case 'OTHER': return 'end_turn';
    default: return 'end_turn';
  }
}

// Gemini API types
interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: unknown };
}

interface GeminiContent {
  role: string;
  parts: GeminiPart[];
}

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}

interface GeminiStreamChunk {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; totalTokenCount?: number };
}
