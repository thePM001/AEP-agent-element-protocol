import { describe, it, expect } from "vitest";
import { ProviderRegistry } from "../lib/registry.js";
import { AnthropicAdapter } from "../lib/providers/anthropic.js";
import { OpenAIAdapter } from "../lib/providers/openai.js";
import { OllamaAdapter } from "../lib/providers/ollama.js";
import { CustomAdapter } from "../lib/providers/custom.js";
import { ScriptedAdapter, makeConfig } from "./fakes.js";

describe("ProviderRegistry", () => {
  it("registers the four built-in adapters", () => {
    const r = new ProviderRegistry();
    expect(r.list().sort()).toEqual(["anthropic", "custom", "ollama", "openai"]);
    expect(r.get("anthropic")).toBeInstanceOf(AnthropicAdapter);
    expect(r.get("openai")).toBeInstanceOf(OpenAIAdapter);
    expect(r.get("ollama")).toBeInstanceOf(OllamaAdapter);
    expect(r.get("custom")).toBeInstanceOf(CustomAdapter);
    expect(r.has("ollama")).toBe(true);
  });

  it("replaces an adapter registered under the same provider", () => {
    const r = new ProviderRegistry();
    const fake = new ScriptedAdapter([], [], "openai");
    r.register(fake);
    expect(r.get("openai")).toBe(fake);
    expect(r.list()).toHaveLength(4);
  });

  it("resolves the adapter named by a model config", () => {
    const r = new ProviderRegistry();
    expect(r.resolve(makeConfig({ provider: "ollama" })).provider).toBe("ollama");
    expect(r.resolve(makeConfig({ provider: "anthropic" })).provider).toBe("anthropic");
  });
});
