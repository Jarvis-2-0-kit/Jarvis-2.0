/**
 * Core LLM types for Jarvis 2.0
 * Adapted from OpenClaw's streaming patterns but with our own implementation.
 */

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string | ContentBlock[];
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock;

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageBlock {
  type: 'image';
  data: string;
  mediaType: 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp';
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export interface ChatRequest {
  model: string;
  messages: Message[];
  system?: string;
  tools?: ToolDefinition[];
  temperature?: number;
  max_tokens?: number;
  stop_sequences?: string[];
  stream: boolean;
}

export interface ChatChunk {
  type: 'text_delta' | 'tool_use_start' | 'tool_use_delta' | 'tool_use_end' | 'message_end' | 'error';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    input: string; // JSON string, accumulated
  };
  usage?: TokenUsage;
  stopReason?: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  error?: string;
}

export interface ChatResponse {
  content: ContentBlock[];
  stopReason: 'end_turn' | 'tool_use' | 'max_tokens' | 'stop_sequence';
  usage: TokenUsage;
  model: string;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens: number;
}

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsTools: boolean;
  supportsVision: boolean;
  costPerInputToken?: number;
  costPerOutputToken?: number;
}

export interface LLMProvider {
  id: string;
  name: string;

  /** Send a chat request and get a complete response */
  chat(request: ChatRequest): Promise<ChatResponse>;

  /** Send a chat request and stream chunks */
  chatStream(request: ChatRequest): AsyncIterable<ChatChunk>;

  /** List available models */
  listModels(): ModelInfo[];

  /** Check if provider is available (has API key etc.) */
  isAvailable(): boolean;
}

/** Usage accumulator for tracking costs across multiple calls */
export interface UsageAccumulator {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  totalCost: number;
  callCount: number;
}

export function createUsageAccumulator(): UsageAccumulator {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    totalCost: 0,
    callCount: 0,
  };
}

export function mergeUsage(acc: UsageAccumulator, usage: TokenUsage): void {
  acc.inputTokens += usage.inputTokens;
  acc.outputTokens += usage.outputTokens;
  acc.cacheReadTokens += usage.cacheReadTokens ?? 0;
  acc.cacheWriteTokens += usage.cacheWriteTokens ?? 0;
  acc.totalTokens += usage.totalTokens;
  acc.callCount++;
}
