import { afterEach, describe, it, expect } from "vitest";
import { rmSync } from "node:fs";
import { GovernedModelGateway, type GatewayDependencies } from "../lib/gateway.js";
import { ProviderRegistry } from "../lib/registry.js";
import { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import { RecoveryEngine } from "../../recovery/lib/engine.js";
import type { EvidenceLedger } from "../../evidence-ledger/lib/ledger/ledger.js";
import type { ModelGatewayOptions } from "../lib/types.js";
import {
  KeywordScanner,
  ScriptedAdapter,
  collect,
  makeConfig,
  makeLedger,
  makePolicy,
  makeRequest,
} from "./fakes.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function ledger(): EvidenceLedger {
  const made = makeLedger();
  dirs.push(made.dir);
  return made.ledger;
}

function build(
  adapter: ScriptedAdapter,
  opts: Partial<ModelGatewayOptions> = {},
  deps: Partial<GatewayDependencies> = {},
): GovernedModelGateway {
  const registry = new ProviderRegistry();
  registry.register(adapter);
  return new GovernedModelGateway(
    { sessionId: "sess-1", config: makeConfig(), optimisePrompts: false, ...opts },
    { policy: makePolicy(), registry, ...deps },
  );
}

function scanners(...s: KeywordScanner[]): ScannerPipeline {
  return new ScannerPipeline(s);
}

describe("GovernedModelGateway.call", () => {
  it("returns the provider content with governance and ledger record on a clean call", async () => {
    const adapter = new ScriptedAdapter(["all good"]);
    const l = ledger();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("secret", "hard", "secret")), ledger: l });
    const res = await gw.call(makeRequest());
    expect(res.content).toBe("all good");
    expect(res.provider).toBe("custom");
    expect(res.finishReason).toBe("stop");
    expect(res.latencyMs).toBe(12);
    expect(res.usage.totalTokens).toBe(3000);
    expect(res.governance).toEqual({
      sessionId: "sess-1",
      scanPassed: true,
      scanFindings: [],
      recoveryAttempted: false,
      recoverySucceeded: false,
      trustDelta: 5,
      promptOptimised: false,
    });
    const entries = l.entries();
    expect(entries).toHaveLength(1);
    expect(entries[0]?.type).toBe("model:call");
    expect(entries[0]?.data.decision).toBe("allow");
    expect(entries[0]?.data.sessionId).toBe("sess-1");
    expect(adapter.completeCalls).toHaveLength(1);
  });

  it("fails closed when scanning is on but no scanner is wired", async () => {
    const adapter = new ScriptedAdapter();
    await expect(build(adapter).call(makeRequest())).rejects.toThrow(/scanInput enabled but scanner dependency is missing/);
    await expect(build(adapter, { scanInput: false }).call(makeRequest())).rejects.toThrow(
      /scanOutput enabled but scanner dependency is missing/,
    );
    expect(adapter.completeCalls).toHaveLength(0);
  });

  it("runs without a scanner when both scans are switched off", async () => {
    const adapter = new ScriptedAdapter(["plain"]);
    const res = await build(adapter, { scanInput: false, scanOutput: false }).call(makeRequest());
    expect(res.content).toBe("plain");
    expect(res.governance.scanPassed).toBe(true);
  });

  it("blocks hard input findings before dispatch and records the denial", async () => {
    const adapter = new ScriptedAdapter();
    const l = ledger();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("secret", "hard", "secret")), ledger: l });
    await expect(gw.call(makeRequest({ messages: [{ role: "user", content: "my secret" }] }))).rejects.toThrow(
      "Input blocked by scanner: secret",
    );
    expect(adapter.completeCalls).toHaveLength(0);
    const entry = l.entries()[0];
    expect(entry?.data.decision).toBe("deny");
    expect(entry?.data.reason).toBe("input_scan_hard_violation");
    expect(entry?.data.findings).toEqual(["kw-secret:secret"]);
  });

  it("lets soft input findings through with a trust penalty", async () => {
    const adapter = new ScriptedAdapter(["fine"]);
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("hmm", "soft", "tone")) });
    const res = await gw.call(makeRequest({ messages: [{ role: "user", content: "hmm ok" }] }));
    expect(res.content).toBe("fine");
    expect(res.governance.trustDelta).toBe(0);
  });

  it("blocks hard output findings and records the denial", async () => {
    const adapter = new ScriptedAdapter(["here is the leak"]);
    const l = ledger();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("leak", "hard", "leak")), ledger: l });
    await expect(gw.call(makeRequest())).rejects.toThrow("Output blocked by scanner: leak");
    const entry = l.entries()[0];
    expect(entry?.data.reason).toBe("output_scan_hard_violation");
    expect(entry?.data.decision).toBe("deny");
  });

  it("withholds content on soft output findings when no recovery engine is wired", async () => {
    const adapter = new ScriptedAdapter(["maybe yes"]);
    const l = ledger();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("maybe", "soft", "tone")), ledger: l });
    const res = await gw.call(makeRequest());
    expect(res.content).toBe("");
    expect(res.finishReason).toBe("content_filter");
    expect(res.governance.aborted).toBe(true);
    expect(res.governance.softDenied).toBe(true);
    expect(res.governance.scanFindings).toEqual(["kw-tone:tone"]);
    expect(res.governance.recoveryAttempted).toBe(false);
    expect(l.entries()[0]?.data.decision).toBe("deny");
  });

  it("re-calls the provider with a correction prompt and keeps a clean recovered answer", async () => {
    const adapter = new ScriptedAdapter(["maybe yes", "yes"]);
    const gw = build(
      adapter,
      {},
      {
        scanner: scanners(new KeywordScanner("maybe", "soft", "tone")),
        recovery: new RecoveryEngine({ enabled: true, maxAttempts: 1 }),
      },
    );
    const res = await gw.call(makeRequest());
    expect(res.content).toBe("yes");
    expect(res.governance.recoveryAttempted).toBe(true);
    expect(res.governance.recoverySucceeded).toBe(true);
    expect(res.governance.scanPassed).toBe(true);
    expect(res.governance.trustDelta).toBe(15);
    expect(adapter.completeCalls).toHaveLength(2);
    const retry = adapter.completeCalls[1]?.request.messages ?? [];
    expect(retry.map((m) => m.role)).toEqual(["user", "assistant", "user"]);
    expect(retry[1]?.content).toBe("maybe yes");
    expect(retry[2]?.content).toContain("Rule: tone");
  });

  it("soft-denies when the recovered answer is still flagged", async () => {
    const adapter = new ScriptedAdapter(["maybe a", "maybe b"]);
    const gw = build(
      adapter,
      {},
      {
        scanner: scanners(new KeywordScanner("maybe", "soft", "tone")),
        recovery: new RecoveryEngine({ enabled: true, maxAttempts: 1 }),
      },
    );
    const res = await gw.call(makeRequest());
    expect(res.content).toBe("");
    expect(res.governance.softDenied).toBe(true);
    expect(res.governance.recoverySucceeded).toBe(false);
    expect(res.governance.trustDelta).toBe(-5);
  });

  it("injects governance context into an existing system message", async () => {
    const adapter = new ScriptedAdapter(["ok"]);
    const gw = build(
      adapter,
      { optimisePrompts: true, scanInput: false, scanOutput: false },
      { optimizer: { injectGovernanceContext: (s) => `${s}[gov]` } },
    );
    const res = await gw.call(
      makeRequest({
        messages: [
          { role: "system", content: "sys" },
          { role: "user", content: "q" },
        ],
      }),
    );
    expect(res.governance.promptOptimised).toBe(true);
    const sent = adapter.completeCalls[0]?.request.messages ?? [];
    expect(sent).toEqual([
      { role: "system", content: "sys[gov]" },
      { role: "user", content: "q" },
    ]);
  });

  it("prepends a governance system message when none exists", async () => {
    const adapter = new ScriptedAdapter(["ok"]);
    const gw = build(
      adapter,
      { optimisePrompts: true, scanInput: false, scanOutput: false },
      { optimizer: { injectGovernanceContext: (s) => `${s}[gov]` } },
    );
    const req = makeRequest();
    await gw.call(req);
    const sent = adapter.completeCalls[0]?.request.messages ?? [];
    expect(sent[0]).toEqual({ role: "system", content: "[gov]" });
    expect(sent).toHaveLength(2);
    expect(req.messages).toHaveLength(1);
  });

  it("prices usage from policy tracking rates", async () => {
    const adapter = new ScriptedAdapter(["ok"]);
    const gw = build(
      adapter,
      { scanInput: false, scanOutput: false },
      { policy: makePolicy({ tracking: { cost_per_million_input: 3, cost_per_million_output: 15, currency: "EUR" } }) },
    );
    const res = await gw.call(makeRequest());
    expect(res.cost).toEqual({ inputCost: 0.006, outputCost: 0.015, totalCost: 0.021, currency: "EUR" });
  });

  it("prefers per-provider rates from the model_gateway policy block", async () => {
    const adapter = new ScriptedAdapter(["ok"]);
    const gw = build(
      adapter,
      { scanInput: false, scanOutput: false },
      {
        policy: makePolicy({
          tracking: { cost_per_million_input: 3, cost_per_million_output: 15 },
          model_gateway: { providers: { custom: { cost_per_million_input: 10, cost_per_million_output: 20 } } },
        }),
      },
    );
    const res = await gw.call(makeRequest());
    expect(res.cost).toEqual({ inputCost: 0.02, outputCost: 0.02, totalCost: 0.04, currency: "USD" });
  });

  it("reports zero cost when cost tracking is off", async () => {
    const adapter = new ScriptedAdapter(["ok"]);
    const gw = build(
      adapter,
      { scanInput: false, scanOutput: false, costTracking: false },
      { policy: makePolicy({ tracking: { cost_per_million_input: 3 } }) },
    );
    const res = await gw.call(makeRequest());
    expect(res.cost.totalCost).toBe(0);
  });

  it("records provider errors and rethrows them", async () => {
    const adapter = new ScriptedAdapter();
    adapter.completeError = new Error("upstream down");
    const l = ledger();
    const gw = build(adapter, { scanInput: false, scanOutput: false }, { ledger: l });
    await expect(gw.call(makeRequest())).rejects.toThrow("upstream down");
    const entry = l.entries()[0];
    expect(entry?.data.decision).toBe("error");
    expect(entry?.data.error).toBe("upstream down");
  });

  it("exposes the resolved adapter and session id", () => {
    const adapter = new ScriptedAdapter();
    const gw = build(adapter);
    expect(gw.getAdapter()).toBe(adapter);
    expect(gw.getSessionId()).toBe("sess-1");
  });
});

describe("GovernedModelGateway.stream", () => {
  it("yields each chunk with the running accumulation and logs an allow", async () => {
    const adapter = new ScriptedAdapter([], ["a", "b"]);
    const l = ledger();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("bad", "hard", "bad")), ledger: l });
    const chunks = await collect(gw.stream(makeRequest()));
    expect(chunks).toEqual([
      { content: "a", done: false, accumulated: "a", index: 1 },
      { content: "b", done: false, accumulated: "ab", index: 2 },
      { content: "", done: true, accumulated: "ab", index: 3 },
    ]);
    const entry = l.entries()[0];
    expect(entry?.data.decision).toBe("allow");
    expect(entry?.data.streaming).toBe(true);
    expect(entry?.data.contentLength).toBe(2);
  });

  it("aborts mid-stream on a hard finding split across chunks and yields nothing after", async () => {
    const adapter = new ScriptedAdapter([], ["ok ", "ba", "d", "more"]);
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("bad", "hard", "bad")) });
    const chunks = await collect(gw.stream(makeRequest()));
    expect(chunks.map((c) => c.content)).toEqual(["ok ", "ba", ""]);
    const last = chunks[2];
    expect(last?.done).toBe(true);
    expect(last?.accumulated).toBe("");
    expect(last?.governance?.aborted).toBe(true);
    expect(last?.governance?.reason).toBe("Stream aborted: bad");
  });

  it("refuses to stream when the input has a hard finding", async () => {
    const adapter = new ScriptedAdapter();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("secret", "hard", "secret")) });
    const chunks = await collect(gw.stream(makeRequest({ messages: [{ role: "user", content: "secret!" }] })));
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.governance).toEqual({
      aborted: true,
      reason: "Input blocked: secret",
      findings: ["kw-secret:secret"],
    });
    expect(adapter.streamCalls).toHaveLength(0);
  });

  it("soft-denies after the stream when the whole output has a soft finding", async () => {
    const adapter = new ScriptedAdapter([], ["fine ", "maybe"]);
    const l = ledger();
    const gw = build(adapter, {}, { scanner: scanners(new KeywordScanner("maybe", "soft", "tone")), ledger: l });
    const chunks = await collect(gw.stream(makeRequest()));
    expect(chunks).toHaveLength(4);
    const tail = chunks[3];
    expect(tail?.index).toBe(4);
    expect(tail?.governance?.softDenied).toBe(true);
    expect(tail?.governance?.findings).toEqual(["kw-tone:tone"]);
    expect(l.entries()[0]?.data.decision).toBe("deny");
  });

  it("turns a provider error into an aborted chunk", async () => {
    const adapter = new ScriptedAdapter([], ["a", "b"]);
    adapter.streamError = new Error("socket reset");
    const gw = build(adapter, { scanInput: false, scanOutput: false });
    const chunks = await collect(gw.stream(makeRequest()));
    expect(chunks).toHaveLength(2);
    expect(chunks[1]?.accumulated).toBe("a");
    expect(chunks[1]?.governance?.reason).toBe("socket reset");
  });

  it("fails closed when streaming without a scanner", async () => {
    const gw = build(new ScriptedAdapter(), { scanInput: false });
    await expect(collect(gw.stream(makeRequest()))).rejects.toThrow(/scanOutput enabled/);
  });

  it("applies the optimizer before streaming", async () => {
    const adapter = new ScriptedAdapter([], ["x"]);
    const gw = build(
      adapter,
      { optimisePrompts: true, scanInput: false, scanOutput: false },
      { optimizer: { injectGovernanceContext: (s) => `${s}<ctx>` } },
    );
    await collect(gw.stream(makeRequest({ messages: [{ role: "system", content: "S" }, { role: "user", content: "U" }] })));
    expect(adapter.streamCalls[0]?.request.messages[0]).toEqual({ role: "system", content: "S<ctx>" });
  });
});
