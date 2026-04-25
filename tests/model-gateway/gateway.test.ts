import { describe, it, expect, vi, beforeEach } from "vitest";
import { GovernedModelGateway } from "../../src/model-gateway/gateway.js";
import { ProviderRegistry } from "../../src/model-gateway/registry.js";
import type {
  ModelConfig,
  ModelRequest,
  ModelResponse,
  ProviderAdapter,
  GovernedChunk,
} from "../../src/model-gateway/types.js";
import type { Policy } from "../../src/policy/types.js";
import { ScannerPipeline } from "../../src/scanners/pipeline.js";
import { RecoveryEngine } from "../../src/recovery/engine.js";
import type { Finding } from "../../src/scanners/types.js";

// ── Helpers ────────────────────────────────────────────────────────────

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    version: "2.5",
    name: "test-policy",
    capabilities: [{ tool: "*" }],
    limits: {},
    gates: [],
    evidence: { enabled: false, dir: "./ledgers" },
    forbidden: [],
    session: { max_actions: 100, escalation: [] },
    recovery: { enabled: true, max_retries: 2 },
    scanners: { enabled: true, pii: { enabled: false, severity: "soft" }, injection: { enabled: false, severity: "soft" }, secrets: { enabled: false, severity: "soft" }, jailbreak: { enabled: false, severity: "soft" }, toxicity: { enabled: false, severity: "soft", custom_words: [] }, urls: { enabled: false, severity: "soft", allowlist: [], blocklist: [] } },
    tracking: { tokens: true, cost_per_million_input: 3, cost_per_million_output: 15, currency: "USD" },
    ...overrides,
  } as Policy;
}

function makeConfig(overrides?: Partial<ModelConfig>): ModelConfig {
  return {
    provider: "anthropic",
    model: "claude-test",
    maxTokens: 4096,
    temperature: 1,
    stopSequences: [],
    headers: {},
    timeoutMs: 120000,
    ...overrides,
  } as ModelConfig;
}

function makeRequest(content = "hello"): ModelRequest {
  return {
    messages: [{ role: "user", content }],
    stream: false,
  };
}

function makeResponse(content = "response text"): ModelResponse {
  return {
    content,
    model: "claude-test",
    provider: "anthropic",
    usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
    finishReason: "stop",
    latencyMs: 200,
  };
}

function makeMockAdapter(response?: ModelResponse): ProviderAdapter {
  const resp = response ?? makeResponse();
  return {
    provider: "anthropic",
    complete: vi.fn().mockResolvedValue(resp),
    stream: vi.fn(async function* () {
      yield { content: resp.content.slice(0, 5), done: false };
      yield { content: resp.content.slice(5), done: false };
      yield { content: "", done: true };
    }),
  };
}

function makeRegistry(adapter: ProviderAdapter): ProviderRegistry {
  const registry = new ProviderRegistry();
  registry.register(adapter);
  return registry;
}

// ── Tests ──────────────────────────────────────────────────────────────

describe("GovernedModelGateway", () => {
  describe("call()", () => {
    it("returns a governed response for a successful call", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "test-1", config: makeConfig() },
        { policy, registry },
      );

      const result = await gw.call(makeRequest());

      expect(result.content).toBe("response text");
      expect(result.model).toBe("claude-test");
      expect(result.provider).toBe("anthropic");
      expect(result.usage.totalTokens).toBe(150);
      expect(result.governance.sessionId).toBe("test-1");
      expect(result.governance.scanPassed).toBe(true);
      expect(result.governance.recoveryAttempted).toBe(false);
      expect(result.finishReason).toBe("stop");
      expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    });

    it("computes cost from policy tracking config", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy({
        tracking: { tokens: true, cost_per_million_input: 3, cost_per_million_output: 15, currency: "USD" },
      });

      const gw = new GovernedModelGateway(
        { sessionId: "test-cost", config: makeConfig() },
        { policy, registry },
      );

      const result = await gw.call(makeRequest());

      // 100 input tokens at $3/M = $0.0003
      // 50 output tokens at $15/M = $0.00075
      expect(result.cost.inputCost).toBeCloseTo(0.0003, 6);
      expect(result.cost.outputCost).toBeCloseTo(0.00075, 6);
      expect(result.cost.totalCost).toBeCloseTo(0.00105, 6);
      expect(result.cost.currency).toBe("USD");
    });

    it("throws on hard violation in input scan", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      // Create a mock scanner that always finds a hard violation
      const mockScanner: ScannerPipeline = {
        scan: vi.fn().mockReturnValue({
          passed: false,
          findings: [{
            scanner: "test-scanner",
            severity: "hard",
            match: "secret",
            position: 0,
            category: "secrets",
          }],
        }),
        getScanners: vi.fn().mockReturnValue([]),
      } as unknown as ScannerPipeline;

      const gw = new GovernedModelGateway(
        { sessionId: "test-hard", config: makeConfig() },
        { policy, registry, scanner: mockScanner },
      );

      await expect(gw.call(makeRequest("my secret key is abc123")))
        .rejects.toThrow("Input blocked by scanner");
    });

    it("throws on hard violation in output scan", async () => {
      const adapter = makeMockAdapter(makeResponse("the secret key is xyz789"));
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      // Scanner passes input, fails output
      let callCount = 0;
      const mockScanner: ScannerPipeline = {
        scan: vi.fn().mockImplementation((content: string) => {
          callCount++;
          if (callCount === 1) return { passed: true, findings: [] }; // input
          return {
            passed: false,
            findings: [{
              scanner: "secrets",
              severity: "hard" as const,
              match: "secret key",
              position: 4,
              category: "secrets",
            }],
          };
        }),
        getScanners: vi.fn().mockReturnValue([]),
      } as unknown as ScannerPipeline;

      const gw = new GovernedModelGateway(
        { sessionId: "test-output-hard", config: makeConfig() },
        { policy, registry, scanner: mockScanner },
      );

      await expect(gw.call(makeRequest()))
        .rejects.toThrow("Output blocked by scanner");
    });

    it("attempts recovery on soft violations", async () => {
      const adapter = makeMockAdapter(makeResponse("mild issue here"));
      const registry = makeRegistry(adapter);
      const policy = makePolicy();
      const recoveryEngine = new RecoveryEngine({ enabled: true, maxAttempts: 2 });

      let scanCallCount = 0;
      const mockScanner: ScannerPipeline = {
        scan: vi.fn().mockImplementation(() => {
          scanCallCount++;
          if (scanCallCount === 1) return { passed: true, findings: [] }; // input
          if (scanCallCount === 2) return {
            passed: false,
            findings: [{
              scanner: "toxicity",
              severity: "soft" as const,
              match: "mild issue",
              position: 0,
              category: "mild_language",
            }],
          };
          return { passed: true, findings: [] }; // recovery output
        }),
        getScanners: vi.fn().mockReturnValue([]),
      } as unknown as ScannerPipeline;

      const gw = new GovernedModelGateway(
        { sessionId: "test-recovery", config: makeConfig() },
        { policy, registry, scanner: mockScanner, recovery: recoveryEngine },
      );

      const result = await gw.call(makeRequest());
      expect(result.governance.recoveryAttempted).toBe(true);
    });

    it("skips scanning when scanInput/scanOutput are false", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const mockScanner: ScannerPipeline = {
        scan: vi.fn().mockReturnValue({ passed: true, findings: [] }),
        getScanners: vi.fn().mockReturnValue([]),
      } as unknown as ScannerPipeline;

      const gw = new GovernedModelGateway(
        { sessionId: "test-noscan", config: makeConfig(), scanInput: false, scanOutput: false },
        { policy, registry, scanner: mockScanner },
      );

      await gw.call(makeRequest());
      expect(mockScanner.scan).not.toHaveBeenCalled();
    });

    it("propagates provider errors", async () => {
      const adapter = {
        ...makeMockAdapter(),
        complete: vi.fn().mockRejectedValue(new Error("API rate limited")),
      };
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "test-error", config: makeConfig() },
        { policy, registry },
      );

      await expect(gw.call(makeRequest())).rejects.toThrow("API rate limited");
    });

    it("disables cost tracking when costTracking is false", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "test-nocost", config: makeConfig(), costTracking: false },
        { policy, registry },
      );

      const result = await gw.call(makeRequest());
      expect(result.cost.totalCost).toBe(0);
    });
  });

  describe("stream()", () => {
    it("yields governed chunks", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "test-stream", config: makeConfig() },
        { policy, registry },
      );

      const chunks: GovernedChunk[] = [];
      for await (const chunk of gw.stream(makeRequest())) {
        chunks.push(chunk);
      }

      expect(chunks.length).toBeGreaterThanOrEqual(2);
      const lastChunk = chunks[chunks.length - 1];
      expect(lastChunk.done).toBe(true);
    });

    it("aborts stream on hard violation in input", async () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const mockScanner: ScannerPipeline = {
        scan: vi.fn().mockReturnValue({
          passed: false,
          findings: [{
            scanner: "injection",
            severity: "hard" as const,
            match: "DROP TABLE",
            position: 0,
            category: "sql_injection",
          }],
        }),
        getScanners: vi.fn().mockReturnValue([]),
      } as unknown as ScannerPipeline;

      const gw = new GovernedModelGateway(
        { sessionId: "test-stream-abort", config: makeConfig() },
        { policy, registry, scanner: mockScanner },
      );

      const chunks: GovernedChunk[] = [];
      for await (const chunk of gw.stream(makeRequest("DROP TABLE users"))) {
        chunks.push(chunk);
      }

      expect(chunks).toHaveLength(1);
      expect(chunks[0].done).toBe(true);
      expect(chunks[0].governance?.aborted).toBe(true);
    });

    it("accumulates content across chunks", async () => {
      const response = makeResponse("hello world");
      const adapter = {
        ...makeMockAdapter(),
        stream: vi.fn(async function* () {
          yield { content: "hello", done: false };
          yield { content: " ", done: false };
          yield { content: "world", done: false };
          yield { content: "", done: true };
        }),
      };
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "test-accum", config: makeConfig() },
        { policy, registry },
      );

      const chunks: GovernedChunk[] = [];
      for await (const chunk of gw.stream(makeRequest())) {
        chunks.push(chunk);
      }

      // Find the last non-done chunk
      const nonDoneChunks = chunks.filter(c => !c.done);
      if (nonDoneChunks.length > 0) {
        const last = nonDoneChunks[nonDoneChunks.length - 1];
        expect(last.accumulated).toContain("hello");
        expect(last.accumulated).toContain("world");
      }
    });
  });

  describe("getAdapter()", () => {
    it("returns the resolved adapter", () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "test-adapter", config: makeConfig() },
        { policy, registry },
      );

      expect(gw.getAdapter()).toBe(adapter);
    });
  });

  describe("getSessionId()", () => {
    it("returns the session ID", () => {
      const adapter = makeMockAdapter();
      const registry = makeRegistry(adapter);
      const policy = makePolicy();

      const gw = new GovernedModelGateway(
        { sessionId: "my-session-42", config: makeConfig() },
        { policy, registry },
      );

      expect(gw.getSessionId()).toBe("my-session-42");
    });
  });
});
