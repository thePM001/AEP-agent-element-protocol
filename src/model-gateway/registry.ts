// AEP 2.5 -- Provider Registry
// Maps provider names to adapter instances. Thread-safe singleton pattern.

import type { ModelProvider, ProviderAdapter, ModelConfig } from "./types.js";
import { AnthropicAdapter } from "./providers/anthropic.js";
import { OpenAIAdapter } from "./providers/openai.js";
import { OllamaAdapter } from "./providers/ollama.js";
import { CustomAdapter } from "./providers/custom.js";

export class ProviderRegistry {
  private adapters: Map<ModelProvider, ProviderAdapter> = new Map();

  constructor() {
    // Register built-in adapters
    this.register(new AnthropicAdapter());
    this.register(new OpenAIAdapter());
    this.register(new OllamaAdapter());
    this.register(new CustomAdapter());
  }

  /**
   * Register or replace a provider adapter.
   */
  register(adapter: ProviderAdapter): void {
    this.adapters.set(adapter.provider, adapter);
  }

  /**
   * Get an adapter by provider name.
   * Throws if the provider is not registered.
   */
  get(provider: ModelProvider): ProviderAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      throw new Error(`No adapter registered for provider "${provider}"`);
    }
    return adapter;
  }

  /**
   * Check whether a provider is registered.
   */
  has(provider: ModelProvider): boolean {
    return this.adapters.has(provider);
  }

  /**
   * List all registered provider names.
   */
  list(): ModelProvider[] {
    return Array.from(this.adapters.keys());
  }

  /**
   * Resolve the adapter for a given config.
   */
  resolve(config: ModelConfig): ProviderAdapter {
    return this.get(config.provider);
  }
}
