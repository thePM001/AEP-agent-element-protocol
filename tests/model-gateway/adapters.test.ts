import { describe, it, expect } from "vitest";
import { AnthropicAdapter } from "../../src/model-gateway/providers/anthropic.js";
import { OpenAIAdapter } from "../../src/model-gateway/providers/openai.js";
import { OllamaAdapter } from "../../src/model-gateway/providers/ollama.js";
import { CustomAdapter } from "../../src/model-gateway/providers/custom.js";

describe("AnthropicAdapter", () => {
  it("has correct provider name", () => {
    const adapter = new AnthropicAdapter();
    expect(adapter.provider).toBe("anthropic");
  });

  it("is an instance of AnthropicAdapter", () => {
    const adapter = new AnthropicAdapter();
    expect(adapter).toBeInstanceOf(AnthropicAdapter);
  });

  it("has complete and stream methods", () => {
    const adapter = new AnthropicAdapter();
    expect(typeof adapter.complete).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });
});

describe("OpenAIAdapter", () => {
  it("has correct provider name", () => {
    const adapter = new OpenAIAdapter();
    expect(adapter.provider).toBe("openai");
  });

  it("has complete and stream methods", () => {
    const adapter = new OpenAIAdapter();
    expect(typeof adapter.complete).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });
});

describe("OllamaAdapter", () => {
  it("has correct provider name", () => {
    const adapter = new OllamaAdapter();
    expect(adapter.provider).toBe("ollama");
  });

  it("has complete and stream methods", () => {
    const adapter = new OllamaAdapter();
    expect(typeof adapter.complete).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });
});

describe("CustomAdapter", () => {
  it("has correct provider name", () => {
    const adapter = new CustomAdapter();
    expect(adapter.provider).toBe("custom");
  });

  it("has complete and stream methods", () => {
    const adapter = new CustomAdapter();
    expect(typeof adapter.complete).toBe("function");
    expect(typeof adapter.stream).toBe("function");
  });

  it("requires baseUrl in config for complete", async () => {
    const adapter = new CustomAdapter();
    await expect(
      adapter.complete(
        { messages: [{ role: "user", content: "test" }], stream: false },
        { provider: "custom", model: "test", maxTokens: 100, temperature: 1, stopSequences: [], headers: {}, timeoutMs: 5000 },
      )
    ).rejects.toThrow("Custom provider requires baseUrl");
  });

  it("requires baseUrl in config for stream", async () => {
    const adapter = new CustomAdapter();
    const gen = adapter.stream(
      { messages: [{ role: "user", content: "test" }], stream: true },
      { provider: "custom", model: "test", maxTokens: 100, temperature: 1, stopSequences: [], headers: {}, timeoutMs: 5000 },
    );
    await expect(gen.next()).rejects.toThrow("Custom provider requires baseUrl");
  });
});
