// AEP 2.5 -- Anthropic Provider Adapter
// Raw fetch() to api.anthropic.com. Zero SDK dependencies.

import type { ProviderAdapter, ModelConfig, ModelRequest, ModelResponse } from "../types.js";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const API_VERSION = "2023-06-01";

interface AnthropicMessage {
  role: "user" | "assistant";
  content: string;
}

interface AnthropicResponse {
  id: string;
  type: string;
  role: string;
  content: Array<{ type: string; text: string }>;
  model: string;
  stop_reason: string | null;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

interface AnthropicStreamEvent {
  type: string;
  index?: number;
  delta?: { type: string; text?: string; stop_reason?: string };
  message?: AnthropicResponse;
  content_block?: { type: string; text: string };
  usage?: { output_tokens: number };
}

export class AnthropicAdapter implements ProviderAdapter {
  readonly provider = "anthropic" as const;

  async complete(request: ModelRequest, config: ModelConfig): Promise<ModelResponse> {
    const start = Date.now();
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";

    const { system, messages } = this.formatMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model ?? config.model,
      max_tokens: request.maxTokens ?? config.maxTokens ?? 4096,
      messages,
    };

    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    else if (config.temperature !== undefined) body.temperature = config.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    else if (config.topP !== undefined) body.top_p = config.topP;
    const stops = request.stopSequences ?? config.stopSequences;
    if (stops && stops.length > 0) body.stop_sequences = stops;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${text}`);
      }

      const data = await res.json() as AnthropicResponse;
      const content = data.content
        .filter(b => b.type === "text")
        .map(b => b.text)
        .join("");

      return {
        content,
        model: data.model,
        provider: "anthropic",
        usage: {
          inputTokens: data.usage.input_tokens,
          outputTokens: data.usage.output_tokens,
          totalTokens: data.usage.input_tokens + data.usage.output_tokens,
        },
        finishReason: this.mapStopReason(data.stop_reason),
        latencyMs: Date.now() - start,
        raw: data,
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  async *stream(
    request: ModelRequest,
    config: ModelConfig,
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "";

    const { system, messages } = this.formatMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model ?? config.model,
      max_tokens: request.maxTokens ?? config.maxTokens ?? 4096,
      messages,
      stream: true,
    };

    if (system) body.system = system;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    else if (config.temperature !== undefined) body.temperature = config.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    else if (config.topP !== undefined) body.top_p = config.topP;
    const stops = request.stopSequences ?? config.stopSequences;
    if (stops && stops.length > 0) body.stop_sequences = stops;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": API_VERSION,
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const res = await fetch(`${baseUrl}/v1/messages`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Anthropic API ${res.status}: ${text}`);
      }

      if (!res.body) {
        throw new Error("No response body for streaming");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6).trim();
            if (payload === "[DONE]") {
              yield { content: "", done: true };
              return;
            }

            try {
              const event = JSON.parse(payload) as AnthropicStreamEvent;
              if (event.type === "content_block_delta" && event.delta?.text) {
                yield { content: event.delta.text, done: false };
              } else if (event.type === "message_stop") {
                yield { content: "", done: true };
                return;
              }
            } catch {
              // Skip malformed SSE data
            }
          }
        }
      } finally {
        reader.releaseLock();
      }

      yield { content: "", done: true };
    } finally {
      clearTimeout(timeout);
    }
  }

  private formatMessages(
    messages: Array<{ role: string; content: string }>,
  ): { system: string | null; messages: AnthropicMessage[] } {
    let system: string | null = null;
    const formatted: AnthropicMessage[] = [];

    for (const msg of messages) {
      if (msg.role === "system") {
        system = system ? `${system}\n${msg.content}` : msg.content;
      } else {
        formatted.push({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        });
      }
    }

    return { system, messages: formatted };
  }

  private mapStopReason(reason: string | null): ModelResponse["finishReason"] {
    switch (reason) {
      case "end_turn": return "stop";
      case "max_tokens": return "length";
      case "stop_sequence": return "stop";
      default: return "unknown";
    }
  }
}
