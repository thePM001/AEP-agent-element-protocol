// AEP 2.5 -- Custom Provider Adapter
// OpenAI-compatible endpoint adapter. Works with any API that follows
// the OpenAI chat completions format (vLLM, Together, Groq, etc.).

import type { ProviderAdapter, ModelConfig, ModelRequest, ModelResponse } from "../types.js";

interface CustomMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface CustomChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

interface CustomResponse {
  id: string;
  model: string;
  choices: CustomChoice[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface CustomStreamChoice {
  index: number;
  delta: { role?: string; content?: string };
  finish_reason: string | null;
}

interface CustomStreamChunk {
  id: string;
  model: string;
  choices: CustomStreamChoice[];
}

export class CustomAdapter implements ProviderAdapter {
  readonly provider = "custom" as const;

  async complete(request: ModelRequest, config: ModelConfig): Promise<ModelResponse> {
    const start = Date.now();
    const baseUrl = config.baseUrl;

    if (!baseUrl) {
      throw new Error("Custom provider requires baseUrl in config");
    }

    const messages = this.formatMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model ?? config.model,
      messages,
      max_tokens: request.maxTokens ?? config.maxTokens ?? 4096,
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    else if (config.temperature !== undefined) body.temperature = config.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    else if (config.topP !== undefined) body.top_p = config.topP;
    const stops = request.stopSequences ?? config.stopSequences;
    if (stops && stops.length > 0) body.stop = stops;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      // Use /chat/completions path, append if baseUrl doesn't include it
      const url = baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Custom API ${res.status}: ${text}`);
      }

      const data = await res.json() as CustomResponse;
      const content = data.choices[0]?.message?.content ?? "";

      return {
        content,
        model: data.model,
        provider: "custom",
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
          totalTokens: data.usage?.total_tokens ?? 0,
        },
        finishReason: this.mapFinishReason(data.choices[0]?.finish_reason),
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
    const baseUrl = config.baseUrl;

    if (!baseUrl) {
      throw new Error("Custom provider requires baseUrl in config");
    }

    const messages = this.formatMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model ?? config.model,
      messages,
      max_tokens: request.maxTokens ?? config.maxTokens ?? 4096,
      stream: true,
    };

    if (request.temperature !== undefined) body.temperature = request.temperature;
    else if (config.temperature !== undefined) body.temperature = config.temperature;
    if (request.topP !== undefined) body.top_p = request.topP;
    else if (config.topP !== undefined) body.top_p = config.topP;
    const stops = request.stopSequences ?? config.stopSequences;
    if (stops && stops.length > 0) body.stop = stops;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    if (config.apiKey) {
      headers["Authorization"] = `Bearer ${config.apiKey}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const url = baseUrl.endsWith("/chat/completions")
        ? baseUrl
        : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Custom API ${res.status}: ${text}`);
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
              const chunk = JSON.parse(payload) as CustomStreamChunk;
              const delta = chunk.choices[0]?.delta?.content;
              if (delta) {
                yield { content: delta, done: false };
              }
              if (chunk.choices[0]?.finish_reason) {
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
  ): CustomMessage[] {
    return messages.map(m => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));
  }

  private mapFinishReason(reason: string | null | undefined): ModelResponse["finishReason"] {
    switch (reason) {
      case "stop": return "stop";
      case "length": return "length";
      case "content_filter": return "content_filter";
      default: return "unknown";
    }
  }
}
