// AEP 2.5 -- Ollama Provider Adapter
// Raw fetch() to local Ollama instance. Default localhost:11434.

import type { ProviderAdapter, ModelConfig, ModelRequest, ModelResponse } from "../types.js";

const DEFAULT_BASE_URL = "http://localhost:11434";

interface OllamaMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OllamaResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

interface OllamaStreamChunk {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  total_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
}

export class OllamaAdapter implements ProviderAdapter {
  readonly provider = "ollama" as const;

  async complete(request: ModelRequest, config: ModelConfig): Promise<ModelResponse> {
    const start = Date.now();
    const baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;

    const messages = this.formatMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model ?? config.model,
      messages,
      stream: false,
      options: {} as Record<string, unknown>,
    };

    const options = body.options as Record<string, unknown>;
    if (request.temperature !== undefined) options.temperature = request.temperature;
    else if (config.temperature !== undefined) options.temperature = config.temperature;
    if (request.topP !== undefined) options.top_p = request.topP;
    else if (config.topP !== undefined) options.top_p = config.topP;
    if (request.maxTokens ?? config.maxTokens) {
      options.num_predict = request.maxTokens ?? config.maxTokens ?? 4096;
    }
    const stops = request.stopSequences ?? config.stopSequences;
    if (stops && stops.length > 0) options.stop = stops;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama API ${res.status}: ${text}`);
      }

      const data = await res.json() as OllamaResponse;
      const inputTokens = data.prompt_eval_count ?? 0;
      const outputTokens = data.eval_count ?? 0;

      return {
        content: data.message.content,
        model: data.model,
        provider: "ollama",
        usage: {
          inputTokens,
          outputTokens,
          totalTokens: inputTokens + outputTokens,
        },
        finishReason: data.done ? "stop" : "unknown",
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

    const messages = this.formatMessages(request.messages);

    const body: Record<string, unknown> = {
      model: request.model ?? config.model,
      messages,
      stream: true,
      options: {} as Record<string, unknown>,
    };

    const options = body.options as Record<string, unknown>;
    if (request.temperature !== undefined) options.temperature = request.temperature;
    else if (config.temperature !== undefined) options.temperature = config.temperature;
    if (request.topP !== undefined) options.top_p = request.topP;
    else if (config.topP !== undefined) options.top_p = config.topP;
    if (request.maxTokens ?? config.maxTokens) {
      options.num_predict = request.maxTokens ?? config.maxTokens ?? 4096;
    }
    const stops = request.stopSequences ?? config.stopSequences;
    if (stops && stops.length > 0) options.stop = stops;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...config.headers,
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.timeoutMs ?? 120000);

    try {
      const res = await fetch(`${baseUrl}/api/chat`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`Ollama API ${res.status}: ${text}`);
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
            if (!line.trim()) continue;
            try {
              const chunk = JSON.parse(line) as OllamaStreamChunk;
              if (chunk.message?.content) {
                yield { content: chunk.message.content, done: false };
              }
              if (chunk.done) {
                yield { content: "", done: true };
                return;
              }
            } catch {
              // Skip malformed lines
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
  ): OllamaMessage[] {
    return messages.map(m => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    }));
  }
}
