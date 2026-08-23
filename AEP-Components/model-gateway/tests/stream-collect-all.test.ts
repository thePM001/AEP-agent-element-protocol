import { describe, it, expect } from "vitest";
import { GovernedModelGateway } from "../lib/gateway.js";
import { ProviderRegistry } from "../lib/registry.js";
import { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import type { Finding, Scanner } from "../../scanners/lib/types.js";
import type { ProviderAdapter, ModelConfig, ModelRequest } from "../lib/types.js";
import type { Policy } from "../../policy-engine/lib/policy/types.js";

class TwoHardScanner implements Scanner {
  name = "two-hard";
  scan(_content: string): Finding[] {
    return [
      { scanner: "two-hard", category: "injection", severity: "hard", match: "one", position: 0 },
      { scanner: "two-hard", category: "toxicity", severity: "hard", match: "two", position: 1 },
    ];
  }
}

class FakeAdapter implements ProviderAdapter {
  readonly provider = "custom" as const;
  async complete() {
    return {
      content: "x",
      model: "fake",
      provider: "custom" as const,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      finishReason: "stop" as const,
      latencyMs: 1,
    };
  }
  async *stream() {
    yield { content: "hello", done: true };
  }
}

describe("model gateway stream collect-all", () => {
  it("returns both hard categories and refuses the yield", async () => {
    const ledger: Array<{ type: string; data: Record<string, unknown> }> = [];
    const registry = new ProviderRegistry();
    registry.register(new FakeAdapter());
    const gw = new GovernedModelGateway(
      {
        config: { provider: "custom", model: "fake" } as ModelConfig,
        sessionId: "s1",
        scanInput: false,
        scanOutput: true,
        optimisePrompts: false,
      },
      {
        policy: {} as Policy,
        scanner: new ScannerPipeline([new TwoHardScanner()]),
        registry,
        ledger: {
          append(type: string, data: Record<string, unknown>) {
            ledger.push({ type, data });
          },
        } as unknown as import("../../evidence-ledger/lib/ledger/ledger.js").EvidenceLedger,
      },
    );
    const req: ModelRequest = { messages: [{ role: "user", content: "hi" }] };
    const chunks = [];
    for await (const c of gw.stream(req)) {
      chunks.push(c);
    }
    expect(chunks.length).toBeGreaterThan(0);
    const last = chunks[chunks.length - 1];
    expect(last.governance?.aborted).toBe(true);
    const reason = last.governance?.reason ?? "";
    expect(reason.includes("injection")).toBe(true);
    expect(reason.includes("toxicity")).toBe(true);
    const findings = last.governance?.findings ?? [];
    expect(findings.some((f) => f.includes("injection"))).toBe(true);
    expect(findings.some((f) => f.includes("toxicity"))).toBe(true);
    expect(ledger.some((e) => e.type === "stream:abort" && Array.isArray(e.data.findings) && (e.data.findings as string[]).length >= 2)).toBe(true);
  });
});
