// Shared test fakes for the model-gateway suites (not a test file itself).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EvidenceLedger } from "../../evidence-ledger/lib/ledger/ledger.js";
import { validatePolicy } from "../../policy-engine/lib/policy/loader.js";
import type { Policy } from "../../policy-engine/lib/policy/types.js";
import type { Finding, Scanner } from "../../scanners/lib/types.js";
import {
  ModelConfigSchema,
  ModelRequestSchema,
  type GatewayFetch,
  type GatewayFetchMeta,
  type ModelConfig,
  type ModelProvider,
  type ModelRequest,
  type ModelResponse,
  type ProviderAdapter,
} from "../lib/types.js";

export function makeConfig(overrides: Record<string, unknown> = {}): ModelConfig {
  return ModelConfigSchema.parse({ provider: "custom", model: "fake-model", ...overrides });
}

export function makeRequest(overrides: Record<string, unknown> = {}): ModelRequest {
  return ModelRequestSchema.parse({
    messages: [{ role: "user", content: "hello" }],
    ...overrides,
  });
}

export function makePolicy(extra: Record<string, unknown> = {}): Policy {
  return validatePolicy({
    version: "1",
    name: "gateway-test",
    capabilities: [],
    limits: {},
    session: { max_actions: 100 },
    ...extra,
  });
}

/** A real evidence ledger in a fresh temp dir; the caller removes `dir`. */
export function makeLedger(): { dir: string; ledger: EvidenceLedger } {
  const dir = mkdtempSync(join(tmpdir(), "aep-"));
  return { dir, ledger: new EvidenceLedger({ dir, sessionId: "gw-session" }) };
}

/** Reports a finding whenever the scanned content contains `keyword`. */
export class KeywordScanner implements Scanner {
  readonly name: string;
  constructor(
    private readonly keyword: string,
    private readonly severity: "hard" | "soft",
    private readonly category: string,
  ) {
    this.name = `kw-${category}`;
  }
  scan(content: string): Finding[] {
    const position = content.indexOf(this.keyword);
    if (position < 0) return [];
    return [
      { scanner: this.name, category: this.category, severity: this.severity, match: this.keyword, position },
    ];
  }
}

export type AdapterCall = { request: ModelRequest; config: ModelConfig };

/**
 * Scripted provider adapter: `complete` answers from the queue of contents in
 * order (the last one repeats), `stream` yields the scripted chunks.
 */
export class ScriptedAdapter implements ProviderAdapter {
  readonly provider: ModelProvider;
  readonly completeCalls: AdapterCall[] = [];
  readonly streamCalls: AdapterCall[] = [];
  completeError: Error | null = null;
  streamError: Error | null = null;

  constructor(
    private readonly contents: string[] = ["ok"],
    private readonly chunks: string[] = ["a", "b"],
    provider: ModelProvider = "custom",
  ) {
    this.provider = provider;
  }

  async complete(request: ModelRequest, config: ModelConfig): Promise<ModelResponse> {
    this.completeCalls.push({ request, config });
    if (this.completeError) throw this.completeError;
    const idx = Math.min(this.completeCalls.length - 1, this.contents.length - 1);
    return {
      content: this.contents[idx] ?? "",
      model: "fake-model",
      provider: this.provider,
      usage: { inputTokens: 2000, outputTokens: 1000, totalTokens: 3000 },
      finishReason: "stop",
      latencyMs: 12,
    };
  }

  async *stream(
    request: ModelRequest,
    config: ModelConfig,
  ): AsyncGenerator<{ content: string; done: boolean }, void, unknown> {
    this.streamCalls.push({ request, config });
    for (const [i, c] of this.chunks.entries()) {
      if (this.streamError && i === 1) throw this.streamError;
      yield { content: c, done: false };
    }
    yield { content: "", done: true };
  }
}

export type FetchCall = { url: string; init: RequestInit; meta: GatewayFetchMeta };

/** Fake outbound fetch that records each call and replies from `respond`. */
export function makeFakeFetch(respond: () => Response): { fetch: GatewayFetch; calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const fetch: GatewayFetch = async (url, init, meta) => {
    calls.push({ url, init, meta });
    return respond();
  };
  return { fetch, calls };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Streaming response whose body arrives in the given text pieces. */
export function streamResponse(pieces: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of pieces) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}

export function sentBody(call: FetchCall | undefined): Record<string, unknown> {
  if (!call) throw new Error("no fetch call recorded");
  const parsed: unknown = JSON.parse(String(call.init.body));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("request body is not a JSON object");
  }
  return Object.fromEntries(Object.entries(parsed));
}

export function sentHeaders(call: FetchCall | undefined): Headers {
  if (!call) throw new Error("no fetch call recorded");
  return new Headers(call.init.headers);
}

export async function collect<T>(gen: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

/** A test API key built at runtime so no literal key appears in source. */
export function testKey(): string {
  return "test" + "-" + "k".repeat(24);
}

const savedEnv = new Map<string, string | undefined>();

/** Sets an environment variable for one test; restoreEnv puts the old value back. */
export function setEnv(name: string, value: string): void {
  if (!savedEnv.has(name)) savedEnv.set(name, process.env[name]);
  process.env[name] = value;
}

export function restoreEnv(): void {
  for (const [name, value] of savedEnv) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  savedEnv.clear();
}
