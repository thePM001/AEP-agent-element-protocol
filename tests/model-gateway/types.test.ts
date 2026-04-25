import { describe, it, expect } from "vitest";
import {
  ModelProviderSchema,
  ModelConfigSchema,
  ModelRequestSchema,
  ModelMessageSchema,
  ModelGatewayPolicySchema,
} from "../../src/model-gateway/types.js";

describe("ModelProviderSchema", () => {
  it("accepts valid providers", () => {
    expect(ModelProviderSchema.parse("anthropic")).toBe("anthropic");
    expect(ModelProviderSchema.parse("openai")).toBe("openai");
    expect(ModelProviderSchema.parse("ollama")).toBe("ollama");
    expect(ModelProviderSchema.parse("custom")).toBe("custom");
  });

  it("rejects invalid providers", () => {
    expect(() => ModelProviderSchema.parse("grok")).toThrow();
    expect(() => ModelProviderSchema.parse("")).toThrow();
  });
});

describe("ModelConfigSchema", () => {
  it("parses minimal config", () => {
    const config = ModelConfigSchema.parse({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250929",
    });
    expect(config.provider).toBe("anthropic");
    expect(config.model).toBe("claude-sonnet-4-5-20250929");
    expect(config.maxTokens).toBe(4096);
    expect(config.temperature).toBe(1);
    expect(config.stopSequences).toEqual([]);
    expect(config.headers).toEqual({});
    expect(config.timeoutMs).toBe(120000);
  });

  it("parses full config", () => {
    const config = ModelConfigSchema.parse({
      provider: "openai",
      model: "gpt-4o",
      apiKey: "sk-test",
      baseUrl: "https://custom.api.com",
      maxTokens: 2048,
      temperature: 0.7,
      topP: 0.9,
      stopSequences: ["END"],
      headers: { "X-Custom": "value" },
      timeoutMs: 60000,
    });
    expect(config.maxTokens).toBe(2048);
    expect(config.temperature).toBe(0.7);
    expect(config.topP).toBe(0.9);
    expect(config.headers["X-Custom"]).toBe("value");
  });

  it("rejects invalid temperature", () => {
    expect(() => ModelConfigSchema.parse({
      provider: "anthropic",
      model: "test",
      temperature: 3,
    })).toThrow();
  });

  it("rejects missing required fields", () => {
    expect(() => ModelConfigSchema.parse({})).toThrow();
    expect(() => ModelConfigSchema.parse({ provider: "anthropic" })).toThrow();
  });
});

describe("ModelMessageSchema", () => {
  it("parses valid messages", () => {
    expect(ModelMessageSchema.parse({ role: "user", content: "hello" })).toEqual({
      role: "user",
      content: "hello",
    });
    expect(ModelMessageSchema.parse({ role: "system", content: "be helpful" }).role).toBe("system");
    expect(ModelMessageSchema.parse({ role: "assistant", content: "ok" }).role).toBe("assistant");
  });

  it("rejects invalid roles", () => {
    expect(() => ModelMessageSchema.parse({ role: "tool", content: "x" })).toThrow();
  });
});

describe("ModelRequestSchema", () => {
  it("parses minimal request", () => {
    const req = ModelRequestSchema.parse({
      messages: [{ role: "user", content: "hello" }],
    });
    expect(req.messages).toHaveLength(1);
    expect(req.stream).toBe(false);
  });

  it("rejects empty messages array", () => {
    expect(() => ModelRequestSchema.parse({ messages: [] })).toThrow();
  });
});

describe("ModelGatewayPolicySchema", () => {
  it("parses undefined as optional", () => {
    const result = ModelGatewayPolicySchema.parse(undefined);
    expect(result).toBeUndefined();
  });

  it("parses empty object with defaults", () => {
    const result = ModelGatewayPolicySchema.parse({});
    expect(result?.enabled).toBe(false);
    expect(result?.scan_output).toBe(true);
    expect(result?.scan_input).toBe(true);
    expect(result?.optimise_prompts).toBe(true);
    expect(result?.max_retries).toBe(2);
    expect(result?.cost_tracking).toBe(true);
    expect(result?.providers).toEqual({});
  });

  it("parses full config", () => {
    const result = ModelGatewayPolicySchema.parse({
      enabled: true,
      default_provider: "anthropic",
      default_model: "claude-sonnet-4-5-20250929",
      scan_output: false,
      providers: {
        anthropic: {
          api_key_env: "ANTHROPIC_API_KEY",
          cost_per_million_input: 3,
          cost_per_million_output: 15,
        },
      },
    });
    expect(result?.enabled).toBe(true);
    expect(result?.default_provider).toBe("anthropic");
    expect(result?.providers?.anthropic?.cost_per_million_input).toBe(3);
  });
});
