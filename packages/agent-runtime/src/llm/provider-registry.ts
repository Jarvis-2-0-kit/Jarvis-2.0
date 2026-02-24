import { createLogger } from '@jarvis/shared';
import type { LLMProvider, ModelInfo, ChatRequest, ChatResponse, ChatChunk } from './types.js';
import { AnthropicProvider } from './providers/anthropic.js';
import { OpenAIProvider } from './providers/openai.js';
import { GoogleProvider } from './providers/google.js';
import { OllamaProvider } from './providers/ollama.js';
import { OpenRouterProvider } from './providers/openrouter.js';

const log = createLogger('llm:registry');

export interface ProviderRegistryConfig {
  anthropicApiKey?: string;
  openaiApiKey?: string;
  googleApiKey?: string;
  ollamaBaseUrl?: string;
  openrouterApiKey?: string;
  openrouterSiteUrl?: string;
  defaultProvider?: string;
  defaultModel?: string;
}

/**
 * ProviderRegistry - Central registry for all LLM providers.
 * Handles provider initialization, model resolution, and failover.
 */
export class ProviderRegistry {
  private providers = new Map<string, LLMProvider>();
  private modelProviderMap = new Map<string, string>(); // modelId -> providerId
  private defaultProvider: string;
  private defaultModel: string;

  constructor(config: ProviderRegistryConfig) {
    this.defaultProvider = config.defaultProvider ?? 'anthropic';
    this.defaultModel = config.defaultModel ?? 'claude-sonnet-4-6';

    // Initialize providers based on available keys
    if (config.anthropicApiKey) {
      this.registerProvider(new AnthropicProvider(config.anthropicApiKey));
    }
    if (config.openaiApiKey) {
      this.registerProvider(new OpenAIProvider(config.openaiApiKey));
    }
    if (config.googleApiKey) {
      this.registerProvider(new GoogleProvider(config.googleApiKey));
    }
    if (config.ollamaBaseUrl) {
      this.registerProvider(new OllamaProvider(config.ollamaBaseUrl));
    }
    if (config.openrouterApiKey) {
      this.registerProvider(new OpenRouterProvider(
        config.openrouterApiKey,
        config.openrouterSiteUrl,
      ));
    }

    log.info(`Initialized with ${this.providers.size} providers`);
  }

  registerProvider(provider: LLMProvider): void {
    this.providers.set(provider.id, provider);
    for (const model of provider.listModels()) {
      this.modelProviderMap.set(model.id, provider.id);
    }
    log.info(`Registered provider: ${provider.name} (${provider.id})`);
  }

  getProvider(id: string): LLMProvider | undefined {
    return this.providers.get(id);
  }

  getDefaultProvider(): LLMProvider | undefined {
    return this.providers.get(this.defaultProvider);
  }

  getDefaultModel(): string {
    return this.defaultModel;
  }

  /** Resolve provider for a given model ID */
  resolveProvider(modelId: string): LLMProvider | undefined {
    const providerId = this.modelProviderMap.get(modelId);
    if (providerId) return this.providers.get(providerId);

    // Heuristic: guess provider from model name
    if (modelId.startsWith('claude-')) return this.providers.get('anthropic');
    if (modelId.startsWith('gpt-') || modelId.startsWith('o1') || modelId.startsWith('o3') || modelId.startsWith('o4')) return this.providers.get('openai');
    if (modelId.startsWith('gemini-')) return this.providers.get('google');
    if (modelId.includes('/')) return this.providers.get('openrouter'); // e.g. "meta-llama/llama-3.1-70b"

    // Fallback: try Ollama for unknown models
    return this.providers.get('ollama');
  }

  /** Get model info by ID */
  getModelInfo(modelId: string): ModelInfo | undefined {
    for (const provider of this.providers.values()) {
      const model = provider.listModels().find((m) => m.id === modelId);
      if (model) return model;
    }
    return undefined;
  }

  /** List all available models across all providers */
  listAllModels(): ModelInfo[] {
    const models: ModelInfo[] = [];
    for (const provider of this.providers.values()) {
      if (provider.isAvailable()) {
        models.push(...provider.listModels());
      }
    }
    return models;
  }

  /** List all registered providers */
  listProviders(): Array<{ id: string; name: string; available: boolean; modelCount: number }> {
    return Array.from(this.providers.values()).map((p) => ({
      id: p.id,
      name: p.name,
      available: p.isAvailable(),
      modelCount: p.listModels().length,
    }));
  }

  /** Send chat request, auto-resolving provider from model ID */
  async chat(request: ChatRequest): Promise<ChatResponse> {
    const model = request.model || this.defaultModel;
    const provider = this.resolveProvider(model);
    if (!provider) throw new Error(`No provider found for model: ${model}`);
    if (!provider.isAvailable()) throw new Error(`Provider ${provider.id} is not available`);

    return provider.chat({ ...request, model });
  }

  /** Stream chat, auto-resolving provider from model ID */
  async *chatStream(request: ChatRequest): AsyncIterable<ChatChunk> {
    const model = request.model || this.defaultModel;
    const provider = this.resolveProvider(model);
    if (!provider) {
      yield { type: 'error', error: `No provider found for model: ${model}` };
      return;
    }
    if (!provider.isAvailable()) {
      yield { type: 'error', error: `Provider ${provider.id} is not available` };
      return;
    }

    yield* provider.chatStream({ ...request, model });
  }

  /** Chat with automatic failover to a backup model */
  async chatWithFailover(
    request: ChatRequest,
    fallbackModels: string[] = [],
  ): Promise<ChatResponse> {
    const modelsToTry = [request.model || this.defaultModel, ...fallbackModels];

    for (const model of modelsToTry) {
      const provider = this.resolveProvider(model);
      if (!provider?.isAvailable()) continue;

      try {
        return await provider.chat({ ...request, model });
      } catch (err) {
        log.warn(`Model ${model} failed, trying next: ${(err as Error).message}`);
      }
    }

    throw new Error(`All models failed: ${modelsToTry.join(', ')}`);
  }
}
