// AEP 2.5 -- Model Gateway Types
// Provider-agnostic types for governed LLM interactions.
// Every model call passes through the full AEP evaluation chain.

import { z } from "zod";

// ── Provider Identification ──────────────────────────────────────────

export const ModelProviderSchema = z.enum([
  "anthropic",
  "openai",
  "ollama",
  "custom",
]);

export type ModelProvider = z.infer<typeof ModelProviderSchema>;

// ── Model Configuration ──────────────────────────────────────────────

export const ModelConfigSchema = z.object({
  provider: ModelProviderSchema,
  model: z.string(),
  apiKey: z.string().optional(),
  baseUrl: z.string().optional(),
  maxTokens: z.number().positive().optional().default(4096),
  temperature: z.number().min(0).max(2).optional().default(1),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).optional().default([]),
  headers: z.record(z.string()).optional().default({}),
  timeoutMs: z.number().positive().optional().default(120000),
});

export type ModelConfig = z.infer<typeof ModelConfigSchema>;

// ── Model Request ────────────────────────────────────────────────────

export const ModelMessageSchema = z.object({
  role: z.enum(["system", "user", "assistant"]),
  content: z.string(),
});

export type ModelMessage = z.infer<typeof ModelMessageSchema>;

export const ModelRequestSchema = z.object({
  messages: z.array(ModelMessageSchema).min(1),
  model: z.string().optional(),
  maxTokens: z.number().positive().optional(),
  temperature: z.number().min(0).max(2).optional(),
  topP: z.number().min(0).max(1).optional(),
  stopSequences: z.array(z.string()).optional(),
  stream: z.boolean().optional().default(false),
});

export type ModelRequest = z.infer<typeof ModelRequestSchema>;

// ── Raw Model Response (from provider adapter) ───────────────────────

export interface ModelResponse {
  content: string;
  model: string;
  provider: ModelProvider;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  finishReason: "stop" | "length" | "content_filter" | "error" | "unknown";
  latencyMs: number;
  raw?: unknown;
}

// ── Governed Model Response (post-evaluation chain) ──────────────────

export interface GovernedModelResponse {
  content: string;
  model: string;
  provider: ModelProvider;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  cost: {
    inputCost: number;
    outputCost: number;
    totalCost: number;
    currency: string;
  };
  governance: {
    sessionId: string;
    scanPassed: boolean;
    scanFindings: string[];
    recoveryAttempted: boolean;
    recoverySucceeded: boolean;
    trustDelta: number;
    promptOptimised: boolean;
  };
  finishReason: "stop" | "length" | "content_filter" | "error" | "unknown";
  latencyMs: number;
}

// ── Streaming Chunk ──────────────────────────────────────────────────

export interface GovernedChunk {
  content: string;
  done: boolean;
  accumulated: string;
  index: number;
  governance?: {
    aborted: boolean;
    reason?: string;
  };
}

// ── Provider Adapter Interface ───────────────────────────────────────

export interface ProviderAdapter {
  readonly provider: ModelProvider;

  /** Send a completion request and return the full response. */
  complete(request: ModelRequest, config: ModelConfig): Promise<ModelResponse>;

  /** Stream a completion request, yielding chunks. */
  stream(
    request: ModelRequest,
    config: ModelConfig,
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown>;
}

// ── Policy Configuration for Model Gateway ───────────────────────────

export const ModelGatewayPolicySchema = z.object({
  enabled: z.boolean().optional().default(false),
  default_provider: ModelProviderSchema.optional(),
  default_model: z.string().optional(),
  scan_output: z.boolean().optional().default(true),
  scan_input: z.boolean().optional().default(true),
  optimise_prompts: z.boolean().optional().default(true),
  max_retries: z.number().nonnegative().optional().default(2),
  cost_tracking: z.boolean().optional().default(true),
  providers: z.record(z.object({
    api_key_env: z.string().optional(),
    base_url: z.string().optional(),
    models: z.array(z.string()).optional().default([]),
    cost_per_million_input: z.number().nonnegative().optional(),
    cost_per_million_output: z.number().nonnegative().optional(),
  })).optional().default({}),
}).optional();

export type ModelGatewayPolicy = z.infer<typeof ModelGatewayPolicySchema>;

// ── Gateway Options ──────────────────────────────────────────────────

export interface ModelGatewayOptions {
  sessionId: string;
  config: ModelConfig;
  policyPath?: string;
  scanOutput?: boolean;
  scanInput?: boolean;
  optimisePrompts?: boolean;
  costTracking?: boolean;
}
