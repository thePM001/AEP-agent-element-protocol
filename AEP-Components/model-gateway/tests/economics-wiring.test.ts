import { describe, it, expect } from "vitest";
import { GovernedModelGateway } from "../lib/gateway.js";
import { ProviderRegistry } from "../lib/registry.js";
import { ScannerPipeline } from "../../scanners/lib/pipeline.js";
import { BudgetEnforcer } from "../../economics/lib/budget.js";
import { ConcurrencyLimiter } from "../../economics/lib/concurrency.js";
import { PriceCatalog } from "../../economics/lib/pricing.js";
import { estimateCostFromUsage, totalMicroUsd } from "../../economics/lib/cost-estimator.js";
import type { EconomicsGatewayDeps } from "../../economics/lib/gateway-integration.js";
import { KeywordScanner, ScriptedAdapter, collect, makeConfig, makePolicy, makeRequest } from "./fakes.js";

const PRICE = { prompt: 3, completion: 15 };

function economics(): { deps: EconomicsGatewayDeps; budget: BudgetEnforcer; concurrency: ConcurrencyLimiter } {
  const budget = new BudgetEnforcer({
    enabled: true,
    mode: "deny",
    scope: "per-workspace",
    period: "monthly",
    hard_cap: 100,
    soft_warning_at: 0.9,
  });
  const concurrency = new ConcurrencyLimiter(2);
  const priceCatalog = new PriceCatalog([{ provider: "custom", model: "fake-model", price: PRICE }]);
  return { deps: { budget, concurrency, priceCatalog, costEstimateEnabled: true }, budget, concurrency };
}

// The gateway fails closed without a scanner, so every build carries one that only
// refuses the word "blocked".
function build(adapter: ScriptedAdapter, deps: EconomicsGatewayDeps): GovernedModelGateway {
  const registry = new ProviderRegistry();
  registry.register(adapter);
  const scanner = new ScannerPipeline([new KeywordScanner("blocked", "hard", "injection")]);
  return new GovernedModelGateway(
    { sessionId: "sess-econ", config: makeConfig(), optimisePrompts: false },
    { policy: makePolicy(), registry, economics: deps, scanner },
  );
}

describe("model-gateway economics wiring", () => {
  it("charges a successful call once, at the actual usage, and returns the permit", async () => {
    const e = economics();
    const gw = build(new ScriptedAdapter(["fine"]), e.deps);
    await gw.call(makeRequest());
    const actual = estimateCostFromUsage(2000, 1000, "custom", "fake-model", {
      provider: "custom",
      model: "fake-model",
      price: PRICE,
    });
    // getSpent reports USD; the estimate is in micro USD.
    expect(e.budget.getSpent()).toBeCloseTo(totalMicroUsd(actual) / 1_000_000, 9);
    expect(e.concurrency.active).toBe(0);
  });

  it("returns the reserved estimate and the permit when the provider fails", async () => {
    const e = economics();
    const adapter = new ScriptedAdapter();
    adapter.completeError = new Error("provider down");
    const gw = build(adapter, e.deps);
    await expect(gw.call(makeRequest())).rejects.toThrow("provider down");
    expect(e.budget.getSpent()).toBe(0);
    expect(e.concurrency.active).toBe(0);
  });

  it("returns the permit after a completed stream and keeps the estimate charged", async () => {
    const e = economics();
    const gw = build(new ScriptedAdapter(["x"], ["a", "b"]), e.deps);
    const chunks = await collect(gw.stream(makeRequest()));
    expect(chunks.at(-1)?.done).toBe(true);
    expect(e.concurrency.active).toBe(0);
    expect(e.budget.getSpent()).toBeGreaterThan(0);
  });

  it("returns the permit when the consumer stops reading a stream early", async () => {
    const e = economics();
    const gw = build(new ScriptedAdapter(["x"], ["a", "b", "c"]), e.deps);
    for await (const chunk of gw.stream(makeRequest())) {
      expect(chunk.content).toBe("a");
      break;
    }
    expect(e.concurrency.active).toBe(0);
  });

  it("returns the estimate and the permit when the input scan refuses a stream", async () => {
    const e = economics();
    const gw = build(new ScriptedAdapter(), e.deps);
    const chunks = await collect(gw.stream(makeRequest({ messages: [{ role: "user", content: "blocked words" }] })));
    expect(chunks[0]?.governance?.aborted).toBe(true);
    expect(e.budget.getSpent()).toBe(0);
    expect(e.concurrency.active).toBe(0);
  });

  it("returns the permit when the provider stream throws", async () => {
    const e = economics();
    const adapter = new ScriptedAdapter(["x"], ["a", "b"]);
    adapter.streamError = new Error("stream broke");
    const gw = build(adapter, e.deps);
    const chunks = await collect(gw.stream(makeRequest()));
    expect(chunks.at(-1)?.governance?.reason).toBe("stream broke");
    expect(e.budget.getSpent()).toBe(0);
    expect(e.concurrency.active).toBe(0);
  });
});
