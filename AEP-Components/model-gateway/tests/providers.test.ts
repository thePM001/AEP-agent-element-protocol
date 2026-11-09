import { afterEach, describe, it, expect } from "vitest";
import { AnthropicAdapter } from "../lib/providers/anthropic.js";
import { OpenAIAdapter } from "../lib/providers/openai.js";
import { OllamaAdapter } from "../lib/providers/ollama.js";
import { CustomAdapter } from "../lib/providers/custom.js";
import {
  collect,
  jsonResponse,
  makeConfig,
  makeFakeFetch,
  makeRequest,
  restoreEnv,
  sentBody,
  setEnv,
  sentHeaders,
  streamResponse,
  testKey,
} from "./fakes.js";

afterEach(() => {
  restoreEnv();
});

const sse = (obj: unknown): string => `data: ${JSON.stringify(obj)}\n`;

describe("AnthropicAdapter", () => {
  const okBody = {
    id: "msg_1",
    type: "message",
    role: "assistant",
    content: [
      { type: "text", text: "Hel" },
      { type: "tool_use", text: "skipped" },
      { type: "text", text: "lo" },
    ],
    model: "claude-test-1",
    stop_reason: "max_tokens",
    usage: { input_tokens: 10, output_tokens: 4 },
  };

  it("builds the messages request and parses the response", async () => {
    const key = testKey();
    const { fetch, calls } = makeFakeFetch(() => jsonResponse(okBody));
    const adapter = new AnthropicAdapter(fetch);
    const res = await adapter.complete(
      makeRequest({
        messages: [
          { role: "system", content: "rules" },
          { role: "system", content: "more" },
          { role: "user", content: "hi" },
          { role: "assistant", content: "prev" },
        ],
        maxTokens: 50,
        temperature: 0.2,
      }),
      makeConfig({
        provider: "anthropic",
        model: "claude-test",
        apiKey: key,
        topP: 0.5,
        stopSequences: ["STOP"],
        headers: { "x-extra": "1" },
      }),
    );
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.url).toBe("https://api.anthropic.com/v1/messages");
    expect(call?.init.method).toBe("POST");
    expect(call?.meta).toEqual({ agentId: "model-gateway", channelId: "ch-anthropic", gateway: "anthropic" });
    const h = sentHeaders(call);
    expect(h.get("x-api-key")).toBe(key);
    expect(h.get("anthropic-version")).toBe("2023-06-01");
    expect(h.get("x-extra")).toBe("1");
    expect(sentBody(call)).toEqual({
      model: "claude-test",
      max_tokens: 50,
      messages: [
        { role: "user", content: "hi" },
        { role: "assistant", content: "prev" },
      ],
      system: "rules\nmore",
      temperature: 0.2,
      top_p: 0.5,
      stop_sequences: ["STOP"],
    });
    expect(res.content).toBe("Hello");
    expect(res.model).toBe("claude-test-1");
    expect(res.provider).toBe("anthropic");
    expect(res.usage).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14 });
    expect(res.finishReason).toBe("length");
    expect(res.raw).toEqual(okBody);
    expect(res.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("uses request model, config defaults and a custom base url", async () => {
    const { fetch, calls } = makeFakeFetch(() => jsonResponse({ ...okBody, stop_reason: "end_turn" }));
    const res = await new AnthropicAdapter(fetch).complete(
      makeRequest({ model: "override" }),
      makeConfig({ provider: "anthropic", model: "base", apiKey: testKey(), baseUrl: "https://proxy.example.com" }),
    );
    expect(calls[0]?.url).toBe("https://proxy.example.com/v1/messages");
    const body = sentBody(calls[0]);
    expect(body.model).toBe("override");
    expect(body.max_tokens).toBe(4096);
    expect(body.temperature).toBe(1);
    expect(body).not.toHaveProperty("system");
    expect(body).not.toHaveProperty("stop_sequences");
    expect(res.finishReason).toBe("stop");
  });

  it("falls back to the environment key and refuses an empty key", async () => {
    const { fetch, calls } = makeFakeFetch(() => jsonResponse(okBody));
    const adapter = new AnthropicAdapter(fetch);
    const config = makeConfig({ provider: "anthropic", model: "m" });
    setEnv("ANTHROPIC_API_KEY", "");
    await expect(adapter.complete(makeRequest(), config)).rejects.toThrow("API key is required");
    await expect(collect(adapter.stream(makeRequest(), config))).rejects.toThrow("API key is required");
    expect(calls).toHaveLength(0);
    const envKey = testKey() + "env";
    setEnv("ANTHROPIC_API_KEY", envKey);
    await adapter.complete(makeRequest(), config);
    expect(sentHeaders(calls[0]).get("x-api-key")).toBe(envKey);
  });

  it("throws with status and body on an HTTP error", async () => {
    const { fetch } = makeFakeFetch(() => new Response("rate limited", { status: 429 }));
    await expect(
      new AnthropicAdapter(fetch).complete(makeRequest(), makeConfig({ provider: "anthropic", model: "m", apiKey: testKey() })),
    ).rejects.toThrow("Anthropic API 429: rate limited");
  });

  it("streams text deltas across split reads and stops at message_stop", async () => {
    const pieces = [
      "event: message_start\n" + sse({ type: "message_start" }),
      sse({ type: "content_block_delta", delta: { type: "text_delta", text: "He" } }) + 'data: {"type":"content_bl',
      'ock_delta","delta":{"type":"text_delta","text":"llo"}}\n',
      "data: not json\n",
      sse({ type: "message_stop" }),
      sse({ type: "content_block_delta", delta: { type: "text_delta", text: "ignored" } }),
    ];
    const { fetch, calls } = makeFakeFetch(() => streamResponse(pieces));
    const out = await collect(
      new AnthropicAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "anthropic", model: "m", apiKey: testKey() })),
    );
    expect(out).toEqual([
      { content: "He", done: false },
      { content: "llo", done: false },
      { content: "", done: true },
    ]);
    expect(sentBody(calls[0]).stream).toBe(true);
  });

  it("ends a stream with done when the body closes without a stop event", async () => {
    const { fetch } = makeFakeFetch(() =>
      streamResponse([sse({ type: "content_block_delta", delta: { type: "text_delta", text: "x" } })]),
    );
    const out = await collect(
      new AnthropicAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "anthropic", model: "m", apiKey: testKey() })),
    );
    expect(out).toEqual([
      { content: "x", done: false },
      { content: "", done: true },
    ]);
  });

  it("rejects a stream response without a body", async () => {
    const { fetch } = makeFakeFetch(() => new Response(null, { status: 200 }));
    await expect(
      collect(new AnthropicAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "anthropic", model: "m", apiKey: testKey() }))),
    ).rejects.toThrow("No response body for streaming");
  });
});

describe("OpenAIAdapter", () => {
  const okBody = {
    id: "c1",
    object: "chat.completion",
    model: "gpt-test-1",
    choices: [{ index: 0, message: { role: "assistant", content: "answer" }, finish_reason: "content_filter" }],
    usage: { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 },
  };

  it("builds the chat completions request and parses the response", async () => {
    const key = testKey();
    const { fetch, calls } = makeFakeFetch(() => jsonResponse(okBody));
    const res = await new OpenAIAdapter(fetch).complete(
      makeRequest({
        messages: [
          { role: "system", content: "s" },
          { role: "user", content: "u" },
        ],
        topP: 0.9,
        stopSequences: ["END"],
      }),
      makeConfig({ provider: "openai", model: "gpt-test", apiKey: key, maxTokens: 100 }),
    );
    const call = calls[0];
    expect(call?.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(call?.meta.channelId).toBe("ch-openai");
    expect(sentHeaders(call).get("authorization")).toBe(`Bearer ${key}`);
    expect(sentBody(call)).toEqual({
      model: "gpt-test",
      messages: [
        { role: "system", content: "s" },
        { role: "user", content: "u" },
      ],
      max_tokens: 100,
      temperature: 1,
      top_p: 0.9,
      stop: ["END"],
    });
    expect(res.content).toBe("answer");
    expect(res.usage).toEqual({ inputTokens: 5, outputTokens: 6, totalTokens: 11 });
    expect(res.finishReason).toBe("content_filter");
    expect(res.provider).toBe("openai");
  });

  it("handles a response with no choices", async () => {
    const { fetch } = makeFakeFetch(() => jsonResponse({ ...okBody, choices: [] }));
    const res = await new OpenAIAdapter(fetch).complete(makeRequest(), makeConfig({ provider: "openai", model: "m", apiKey: testKey() }));
    expect(res.content).toBe("");
    expect(res.finishReason).toBe("unknown");
  });

  it("refuses an empty key and reports HTTP errors", async () => {
    setEnv("OPENAI_API_KEY", "");
    const { fetch, calls } = makeFakeFetch(() => new Response("bad", { status: 500 }));
    const adapter = new OpenAIAdapter(fetch);
    await expect(adapter.complete(makeRequest(), makeConfig({ provider: "openai", model: "m" }))).rejects.toThrow(
      "API key is required",
    );
    expect(calls).toHaveLength(0);
    await expect(adapter.complete(makeRequest(), makeConfig({ provider: "openai", model: "m", apiKey: testKey() }))).rejects.toThrow(
      "OpenAI API 500: bad",
    );
  });

  it("streams deltas and stops at finish_reason", async () => {
    const pieces = [
      sse({ choices: [{ index: 0, delta: { role: "assistant" }, finish_reason: null }] }),
      sse({ choices: [{ index: 0, delta: { content: "A" }, finish_reason: null }] }),
      ": keep-alive comment\n",
      sse({ choices: [{ index: 0, delta: { content: "B" }, finish_reason: "stop" }] }),
      sse({ choices: [{ index: 0, delta: { content: "C" }, finish_reason: null }] }),
    ];
    const { fetch, calls } = makeFakeFetch(() => streamResponse(pieces));
    const out = await collect(new OpenAIAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "openai", model: "m", apiKey: testKey() })));
    expect(out).toEqual([
      { content: "A", done: false },
      { content: "B", done: false },
      { content: "", done: true },
    ]);
    expect(sentBody(calls[0]).stream).toBe(true);
  });

  it("stops a stream at the DONE sentinel", async () => {
    const pieces = [sse({ choices: [{ index: 0, delta: { content: "A" }, finish_reason: null }] }), "data: [DONE]\n", sse({ choices: [{ index: 0, delta: { content: "late" }, finish_reason: null }] })];
    const { fetch } = makeFakeFetch(() => streamResponse(pieces));
    const out = await collect(new OpenAIAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "openai", model: "m", apiKey: testKey() })));
    expect(out.map((c) => c.content)).toEqual(["A", ""]);
  });
});

describe("OllamaAdapter", () => {
  it("builds the chat request with options and parses token counts", async () => {
    const { fetch, calls } = makeFakeFetch(() =>
      jsonResponse({ model: "llama-t", message: { role: "assistant", content: "hey" }, done: true, prompt_eval_count: 7, eval_count: 3 }),
    );
    const res = await new OllamaAdapter(fetch).complete(
      makeRequest({ temperature: 0.3, stopSequences: ["x"] }),
      makeConfig({ provider: "ollama", model: "llama", topP: 0.8 }),
    );
    const call = calls[0];
    expect(call?.url).toBe("http://localhost:11434/api/chat");
    expect(call?.meta).toEqual({ agentId: "model-gateway", channelId: "ch-ollama", gateway: "ollama" });
    expect(sentHeaders(call).get("authorization")).toBeNull();
    expect(sentBody(call)).toEqual({
      model: "llama",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
      options: { temperature: 0.3, top_p: 0.8, num_predict: 4096, stop: ["x"] },
    });
    expect(res.content).toBe("hey");
    expect(res.usage).toEqual({ inputTokens: 7, outputTokens: 3, totalTokens: 10 });
    expect(res.finishReason).toBe("stop");
  });

  it("treats missing counts as zero and an unfinished reply as unknown", async () => {
    const { fetch, calls } = makeFakeFetch(() => jsonResponse({ model: "m", message: { role: "assistant", content: "" }, done: false }));
    const res = await new OllamaAdapter(fetch).complete(
      makeRequest(),
      makeConfig({ provider: "ollama", model: "m", baseUrl: "http://gpu-box.example.com:9000" }),
    );
    expect(calls[0]?.url).toBe("http://gpu-box.example.com:9000/api/chat");
    expect(res.usage.totalTokens).toBe(0);
    expect(res.finishReason).toBe("unknown");
  });

  it("reports HTTP errors", async () => {
    const { fetch } = makeFakeFetch(() => new Response("no model", { status: 404 }));
    await expect(new OllamaAdapter(fetch).complete(makeRequest(), makeConfig({ provider: "ollama", model: "m" }))).rejects.toThrow(
      "Ollama API 404: no model",
    );
  });

  it("streams NDJSON lines across split reads and skips malformed ones", async () => {
    const pieces = [
      '{"model":"m","message":{"role":"assistant","content":"a"},"done":false}\n{"model":"m","mess',
      'age":{"role":"assistant","content":"b"},"done":false}\nnot json\n\n',
      '{"model":"m","message":{"role":"assistant","content":""},"done":true}\n',
      '{"model":"m","message":{"role":"assistant","content":"late"},"done":false}\n',
    ];
    const { fetch, calls } = makeFakeFetch(() => streamResponse(pieces));
    const out = await collect(new OllamaAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "ollama", model: "m" })));
    expect(out).toEqual([
      { content: "a", done: false },
      { content: "b", done: false },
      { content: "", done: true },
    ]);
    expect(sentBody(calls[0]).stream).toBe(true);
  });
});

describe("CustomAdapter", () => {
  const okBody = {
    id: "x",
    model: "served-model",
    choices: [{ index: 0, message: { role: "assistant", content: "out" }, finish_reason: "length" }],
  };

  it("requires a base url", async () => {
    const { fetch, calls } = makeFakeFetch(() => jsonResponse(okBody));
    const adapter = new CustomAdapter(fetch);
    const config = makeConfig({ provider: "custom", model: "m" });
    await expect(adapter.complete(makeRequest(), config)).rejects.toThrow("Custom provider requires baseUrl in config");
    await expect(collect(adapter.stream(makeRequest(), config))).rejects.toThrow("Custom provider requires baseUrl in config");
    expect(calls).toHaveLength(0);
  });

  it("appends the completions path, sends a bearer key only when set, and parses the reply", async () => {
    const key = testKey();
    const { fetch, calls } = makeFakeFetch(() => jsonResponse(okBody));
    const adapter = new CustomAdapter(fetch);
    const res = await adapter.complete(makeRequest(), makeConfig({ provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1/", apiKey: key }));
    expect(calls[0]?.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(calls[0]?.meta.channelId).toBe("ch-custom-llm");
    expect(sentHeaders(calls[0]).get("authorization")).toBe(`Bearer ${key}`);
    expect(res.content).toBe("out");
    expect(res.finishReason).toBe("length");
    expect(res.usage).toEqual({ inputTokens: 0, outputTokens: 0, totalTokens: 0 });

    await adapter.complete(makeRequest(), makeConfig({ provider: "custom", model: "m", baseUrl: "https://llm.example.com/v1/chat/completions" }));
    expect(calls[1]?.url).toBe("https://llm.example.com/v1/chat/completions");
    expect(sentHeaders(calls[1]).get("authorization")).toBeNull();
  });

  it("reports HTTP errors", async () => {
    const { fetch } = makeFakeFetch(() => new Response("nope", { status: 403 }));
    await expect(
      new CustomAdapter(fetch).complete(makeRequest(), makeConfig({ provider: "custom", model: "m", baseUrl: "https://llm.example.com" })),
    ).rejects.toThrow("Custom API 403: nope");
  });

  it("streams SSE deltas until DONE", async () => {
    const pieces = [
      sse({ id: "1", model: "m", choices: [{ index: 0, delta: { content: "x" }, finish_reason: null }] }),
      sse({ id: "1", model: "m", choices: [{ index: 0, delta: { content: "y" }, finish_reason: null }] }),
      "data: [DONE]\n",
    ];
    const { fetch } = makeFakeFetch(() => streamResponse(pieces));
    const out = await collect(
      new CustomAdapter(fetch).stream(makeRequest(), makeConfig({ provider: "custom", model: "m", baseUrl: "https://llm.example.com" })),
    );
    expect(out).toEqual([
      { content: "x", done: false },
      { content: "y", done: false },
      { content: "", done: true },
    ]);
  });
});
