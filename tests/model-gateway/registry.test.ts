import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../../src/model-gateway/registry.js";
import { AnthropicAdapter } from "../../src/model-gateway/providers/anthropic.js";
import { OpenAIAdapter } from "../../src/model-gateway/providers/openai.js";
import { OllamaAdapter } from "../../src/model-gateway/providers/ollama.js";
import { CustomAdapter } from "../../src/model-gateway/providers/custom.js";
import type { ProviderAdapter, ModelConfig, ModelRequest, ModelResponse } from "../../src/model-gateway/types.js";

describe("ProviderRegistry", () => {
  it("registers all built-in adapters on construction", () => {
    const registry = new ProviderRegistry();
    expect(registry.has("anthropic")).toBe(true);
    expect(registry.has("openai")).toBe(true);
    expect(registry.has("ollama")).toBe(true);
    expect(registry.has("custom")).toBe(true);
  });

  it("lists all registered providers", () => {
    const registry = new ProviderRegistry();
    const providers = registry.list();
    expect(providers).toContain("anthropic");
    expect(providers).toContain("openai");
    expect(providers).toContain("ollama");
    expect(providers).toContain("custom");
    expect(providers).toHaveLength(4);
  });

  it("gets adapter by provider name", () => {
    const registry = new ProviderRegistry();
    const adapter = registry.get("anthropic");
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
    expect(adapter.provider).toBe("anthropic");
  });

  it("throws for unregistered provider", () => {
    const registry = new ProviderRegistry();
    expect(() => registry.get("nonexistent" as "anthropic")).toThrow(
      'No adapter registered for provider "nonexistent"'
    );
  });

  it("registers a custom adapter", () => {
    const registry = new ProviderRegistry();
    const mockAdapter: ProviderAdapter = {
      provider: "custom",
      complete: async () => ({} as ModelResponse),
      stream: async function* () { yield { content: "", done: true }; },
    };
    registry.register(mockAdapter);
    expect(registry.get("custom")).toBe(mockAdapter);
  });

  it("resolves adapter from config", () => {
    const registry = new ProviderRegistry();
    const config = { provider: "openai" as const, model: "gpt-4o" } as ModelConfig;
    const adapter = registry.resolve(config);
    expect(adapter).toBeInstanceOf(OpenAIAdapter);
  });

  it("has() returns false for unregistered providers", () => {
    const registry = new ProviderRegistry();
    expect(registry.has("nonexistent" as "anthropic")).toBe(false);
  });

  it("returns correct adapter types", () => {
    const registry = new ProviderRegistry();
    expect(registry.get("anthropic")).toBeInstanceOf(AnthropicAdapter);
    expect(registry.get("openai")).toBeInstanceOf(OpenAIAdapter);
    expect(registry.get("ollama")).toBeInstanceOf(OllamaAdapter);
    expect(registry.get("custom")).toBeInstanceOf(CustomAdapter);
  });
});
