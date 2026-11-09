import { describe, expect, it } from "vitest";
import type { ModelConfig, ModelRequest, ModelResponse } from "../../model-gateway/lib/types.js";
import { BudgetEnforcer } from "../lib/budget.js";
import { ConcurrencyLimiter } from "../lib/concurrency.js";
import { FallbackManager } from "../lib/fallback.js";
import { EconomicsGatewayHooks, createEconomicsGatewayHooks } from "../lib/gateway-integration.js";
import { PriceCatalog } from "../lib/pricing.js";

const config: ModelConfig = {
  provider: "openai",
  model: "gpt-x",
  maxTokens: 256,
  temperature: 0,
  stopSequences: [],
  headers: {},
  timeoutMs: 1000,
};

// Ten words, so the estimate is 13 prompt tokens and ceil(13 * 0.3) = 4 output tokens.
const request: ModelRequest = {
  messages: [
    { role: "system", content: "one two three four five" },
    { role: "user", content: "six seven eight nine ten" },
  ],
  stream: false,
};

function response(inputTokens: number, outputTokens: number): ModelResponse {
  return {
    content: "ok",
    model: "gpt-x",
    provider: "openai",
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    finishReason: "stop",
    latencyMs: 5,
  };
}

function catalog(): PriceCatalog {
  // 1000 USD per million tokens makes 1 token cost 1000 micro-USD, easy to follow.
  return new PriceCatalog([{ provider: "openai", model: "gpt-x", price: { prompt: 1000, completion: 1000 } }]);
}

function budget(hardCapUsd = 1): BudgetEnforcer {
  return new BudgetEnforcer({
    enabled: true,
    mode: "deny",
    scope: "per-agent",
    period: "per-request",
    hard_cap: hardCapUsd,
    soft_warning_at: 0.01,
  });
}

describe("EconomicsGatewayHooks.preDispatch", () => {
  it("does nothing without dependencies", async () => {
    const hooks = createEconomicsGatewayHooks();
    expect(await hooks.preDispatch(request, config)).toEqual({});
    expect(hooks.getPriceCatalog()).toBeUndefined();
    expect(hooks.estimateRequestCost(request, config)).toBeNull();
  });

  it("returns no estimate when cost estimation is off or the model is not priced", async () => {
    const priceCatalog = catalog();
    expect(await new EconomicsGatewayHooks({ priceCatalog }).preDispatch(request, config)).toEqual({});
    const hooks = new EconomicsGatewayHooks({ priceCatalog, costEstimateEnabled: true });
    expect(await hooks.preDispatch(request, { ...config, model: "unpriced" })).toEqual({});
  });

  it("estimates cost from the joined prompt messages", async () => {
    const hooks = new EconomicsGatewayHooks({ priceCatalog: catalog(), costEstimateEnabled: true });
    const res = await hooks.preDispatch(request, config);
    expect(res.estimate?.estimated_input_tokens).toBe(13);
    expect(res.estimate?.estimated_output_tokens).toBe(4);
    expect(res.estimate?.estimated_prompt_micro_usd).toBe(13_000);
    expect(res.reserved).toBeUndefined();
    expect(hooks.estimateRequestCost(request, config)?.estimated_completion_micro_usd).toBe(4_000);
  });

  it("reserves the estimate on the budget and flags the warning", async () => {
    const b = budget();
    const hooks = new EconomicsGatewayHooks({
      priceCatalog: catalog(),
      costEstimateEnabled: true,
      budget: b,
      budgetScope: "agent-1",
    });
    const res = await hooks.preDispatch(request, config);
    expect(res.reserved).toBe(true);
    expect(res.budgetWarning).toBe(true);
    expect(b.getSpent("agent-1")).toBeCloseTo(0.017);
  });

  it("denies over budget and gives back the concurrency permit", async () => {
    const concurrency = new ConcurrencyLimiter(1);
    const hooks = new EconomicsGatewayHooks({
      priceCatalog: catalog(),
      costEstimateEnabled: true,
      budget: budget(0.01),
      concurrency,
    });
    await expect(hooks.preDispatch(request, config)).rejects.toThrow("Budget hard cap exceeded: 0.01 USD");
    expect(concurrency.active).toBe(0);
  });

  it("refuses an unhealthy provider and gives back the concurrency permit", async () => {
    const concurrency = new ConcurrencyLimiter(2);
    const fallback = new FallbackManager({ grace_period_min_requests: 1 });
    fallback.recordError("openai");
    const hooks = new EconomicsGatewayHooks({ concurrency, fallback });
    await expect(hooks.preDispatch(request, config)).rejects.toThrow(
      "Provider 'openai' is unhealthy (economics fallback)",
    );
    expect(concurrency.active).toBe(0);
  });

  it("holds a concurrency permit until the call is recorded", async () => {
    const concurrency = new ConcurrencyLimiter(1);
    const fallback = new FallbackManager();
    const hooks = new EconomicsGatewayHooks({ concurrency, fallback });
    await hooks.preDispatch(request, config);
    expect(concurrency.active).toBe(1);
    expect(fallback.getHealth("openai")?.total_requests).toBe(0);
    hooks.recordSuccess(response(1, 1), config);
    expect(concurrency.active).toBe(0);
    expect(fallback.getHealth("openai")?.total_requests).toBe(1);
  });
});

describe("EconomicsGatewayHooks.recordSuccess", () => {
  it("replaces the reservation with the actual usage when given the precheck", async () => {
    const b = budget();
    const hooks = new EconomicsGatewayHooks({ priceCatalog: catalog(), costEstimateEnabled: true, budget: b });
    const precheck = await hooks.preDispatch(request, config);
    expect(b.getSpent()).toBeCloseTo(0.017);
    hooks.recordSuccess(response(20, 10), config, precheck);
    expect(b.getSpent()).toBeCloseTo(0.03);
  });

  it("charges reservation plus usage when the precheck is not passed", async () => {
    const b = budget();
    const hooks = new EconomicsGatewayHooks({ priceCatalog: catalog(), costEstimateEnabled: true, budget: b });
    await hooks.preDispatch(request, config);
    hooks.recordSuccess(response(20, 10), config);
    expect(b.getSpent()).toBeCloseTo(0.047);
  });

  it("keeps the reservation when the response model is not priced", async () => {
    const b = budget();
    const hooks = new EconomicsGatewayHooks({ priceCatalog: catalog(), costEstimateEnabled: true, budget: b });
    const precheck = await hooks.preDispatch(request, config);
    hooks.recordSuccess({ ...response(20, 10), model: "other" }, config, precheck);
    expect(b.getSpent()).toBeCloseTo(0.017);
  });
});

describe("EconomicsGatewayHooks.recordFailure", () => {
  it("returns the reservation, records the error and releases the permit", async () => {
    const b = budget();
    const concurrency = new ConcurrencyLimiter(1);
    const fallback = new FallbackManager();
    const hooks = new EconomicsGatewayHooks({
      priceCatalog: catalog(),
      costEstimateEnabled: true,
      budget: b,
      concurrency,
      fallback,
    });
    const precheck = await hooks.preDispatch(request, config);
    hooks.recordFailure(config, new Error("upstream 500"), precheck);
    expect(b.getSpent()).toBe(0);
    expect(concurrency.active).toBe(0);
    expect(fallback.getHealth("openai")).toMatchObject({ total_requests: 1, error_requests: 1 });
    expect(fallback.getHealth("openai")?.rate_limit_restore_seconds).toBeUndefined();
  });

  it("counts a rate-limited call once and degrades the provider", () => {
    const fallback = new FallbackManager();
    const hooks = new EconomicsGatewayHooks({ fallback });
    hooks.recordFailure(config, new Error("429 Rate limit reached"));
    expect(fallback.getHealth("openai")).toMatchObject({
      total_requests: 1,
      error_requests: 1,
      status: "degraded",
      rate_limit_restore_seconds: 30,
    });
  });
});
