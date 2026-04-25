// AEP 2.5 -- OpenAI Provider Adapter
// Raw fetch() to api.openai.com. Zero SDK dependencies.

import type { ProviderAdapter, ModelConfig, ModelRequest, ModelResponse } from "../types.js";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

interface OpenAIMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OpenAIChoice {
  index: number;
  message: { role: string; content: string | null };
  finish_reason: string | null;
}

interface OpenAIResponse {
  id: string;
  object: string;
  model: string;
  choices: OpenAIChoice[];
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface OpenAIStreamChoice {
  index: number;
  delta: { role?: string; content?: string };
  finish_reason: string | null;
}

interface OpenAIStreamChunk {
  id: string;
  object: string;
  model: string;
  choices: OpenAIStreamChoice[];
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;

  async complete(request: ModelRequest, config: ModelConfig): Promise<ModelResponse> {
    const start = Date.now();
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";

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
      "Authorization": `Bearer ${apiKey}`,
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${text}`);
      }

      const data = await res.json() as OpenAIResponse;
      const content = data.choices[0]?.message?.content ?? "";

      return {
        content,
        model: data.model,
        provider: "openai",
        usage: {
          inputTokens: data.usage.prompt_tokens,
          outputTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
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
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    const apiKey = config.apiKey ?? process.env.OPENAI_API_KEY ?? "";

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
      "Authorization": `Bearer ${apiKey}`,
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const res = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`OpenAI API ${res.status}: ${text}`);
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
              const chunk = JSON.parse(payload) as OpenAIStreamChunk;
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
  ): OpenAIMessage[] {
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
