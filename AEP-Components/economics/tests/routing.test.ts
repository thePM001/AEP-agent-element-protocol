import { afterEach, describe, expect, it, vi } from "vitest";
import { BalanceEngine, createBalanceEngine } from "../lib/balance.js";
import { FallbackManager, createFallbackManager } from "../lib/fallback.js";
import { ModelMapper, resolveModelId } from "../lib/model-mapping.js";
import { DEFAULT_FALLBACK } from "../lib/types.js";

describe("BalanceEngine", () => {
  const realRandom = Math.random;
  let nextRandom = 0;
  afterEach(() => {
    Math.random = realRandom;
  });
  function fixRandom(value: number): void {
    nextRandom = value;
    Math.random = () => nextRandom;
  }

  const engine = new BalanceEngine({
    chat: {
      strategy: "provider-weighted",
      providers: [
        { provider: "openai", weight: 1 },
        { provider: "anthropic", weight: 3 },
      ],
      models: [
        { model: "openai/gpt-x", weight: 2 },
        { model: "anthropic/claude-y", weight: 2 },
      ],
    },
    zero: {
      strategy: "provider-weighted",
      providers: [
        { provider: "first", weight: 0 },
        { provider: "second", weight: 0 },
      ],
      models: [{ model: "a/b", weight: 0 }],
    },
  });

  it("picks providers in proportion to their weight", () => {
    fixRandom(0.1);
    expect(engine.selectProvider("chat")).toBe("openai");
    fixRandom(0.25);
    expect(engine.selectProvider("chat")).toBe("openai");
    fixRandom(0.26);
    expect(engine.selectProvider("chat")).toBe("anthropic");
    fixRandom(0.999);
    expect(engine.selectProvider("chat")).toBe("anthropic");
  });

  it("picks models by weight", () => {
    fixRandom(0.4);
    expect(engine.resolveModel("chat")).toBe("openai/gpt-x");
    fixRandom(0.6);
    expect(engine.resolveModel("chat")).toBe("anthropic/claude-y");
  });

  it("falls back to the first entry when all weights are zero", () => {
    expect(engine.selectProvider("zero")).toBe("first");
    expect(engine.resolveModel("zero")).toBe("a/b");
  });

  it("returns null for unknown endpoints or empty lists", () => {
    const e = new BalanceEngine({ empty: { strategy: "model-weighted", providers: [], models: [] } });
    expect(e.selectProvider("missing")).toBeNull();
    expect(e.selectProvider("empty")).toBeNull();
    expect(e.resolveModel("empty")).toBeNull();
    expect(createBalanceEngine().selectProvider("chat")).toBeNull();
  });

  it("validate reports missing providers and non-positive model weights", () => {
    expect(engine.validate()).toEqual(["zero: model weights must sum to > 0, got 0"]);
    const bad = new BalanceEngine({ x: { strategy: "balanced-latency" } });
    expect(bad.validate()).toEqual(["x: strategy requires non-empty providers list"]);
  });

  it("testDefaults returns a weighted three-provider config that validates", () => {
    const d = engine.testDefaults();
    expect(d.providers?.map((p) => p.provider)).toEqual(["openai", "anthropic", "deepseek"]);
    expect(new BalanceEngine({ d }).validate()).toEqual([]);
  });

  it("recordLatency keeps accepting samples past the window size", () => {
    const e = new BalanceEngine({});
    for (let i = 0; i < 150; i += 1) e.recordLatency("openai", i);
    expect(e.validate()).toEqual([]);
  });
});

describe("ModelMapper", () => {
  const mapper = new ModelMapper({
    fast: ["openai/gpt-mini", "together/meta/llama-z"],
    smart: ["anthropic/claude-y"],
  });

  it("resolves canonical names", () => {
    expect(mapper.resolve("fast")).toEqual(["openai/gpt-mini", "together/meta/llama-z"]);
    expect(mapper.resolve("nope")).toEqual([]);
    expect(mapper.resolveFirst("smart")).toBe("anthropic/claude-y");
    expect(mapper.resolveFirst("nope")).toBeNull();
  });

  it("splits provider and model ids", () => {
    expect(ModelMapper.providerFromId("together/meta/llama-z")).toBe("together");
    expect(ModelMapper.modelFromId("together/meta/llama-z")).toBe("meta/llama-z");
    expect(ModelMapper.modelFromId("bare")).toBe("");
  });

  it("finds canonical names served by a provider", () => {
    expect(mapper.canonicalForProvider("openai")).toEqual(["fast"]);
    expect(mapper.canonicalForProvider("open")).toEqual([]);
    expect(mapper.listCanonical()).toEqual(["fast", "smart"]);
    expect(mapper.size).toBe(2);
  });

  it("validate rejects empty mappings and ids without a provider", () => {
    expect(mapper.validate()).toEqual([]);
    expect(new ModelMapper().validate()).toEqual(["Model mapping is empty"]);
    expect(new ModelMapper({ a: [], b: ["no-slash"] }).validate()).toEqual([
      "a: must map to at least one provider ID",
      'b: invalid model ID "no-slash" - must be provider/model format',
    ]);
  });

  it("resolveModelId returns the first id or null", () => {
    expect(resolveModelId("fast", { fast: ["x/y", "z/w"] })).toBe("x/y");
    expect(resolveModelId("fast", { fast: [] })).toBeNull();
    expect(resolveModelId("fast")).toBeNull();
  });
});

describe("FallbackManager", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("treats unknown providers as healthy and reports no health", () => {
    const fm = new FallbackManager();
    expect(fm.isHealthy("x")).toBe(true);
    expect(fm.getHealth("x")).toBeNull();
    expect(fm.maxRetries).toBe(DEFAULT_FALLBACK.max_retries);
  });

  it("keeps a provider healthy during the grace period", () => {
    const fm = new FallbackManager({ grace_period_min_requests: 5 });
    for (let i = 0; i < 4; i += 1) fm.recordError("p");
    expect(fm.getHealth("p")?.status).toBe("healthy");
    expect(fm.getHealth("p")?.error_ratio).toBe(1);
  });

  it("marks a provider unhealthy at the error threshold and degraded at half of it", () => {
    const fm = new FallbackManager({ grace_period_min_requests: 10, error_ratio_threshold: 0.2 });
    for (let i = 0; i < 9; i += 1) fm.recordSuccess("p");
    fm.recordError("p");
    expect(fm.getHealth("p")?.status).toBe("degraded");
    fm.recordError("p");
    expect(fm.getHealth("p")?.status).toBe("degraded");
    fm.recordError("p");
    expect(fm.getHealth("p")?.error_ratio).toBeCloseTo(3 / 12);
    expect(fm.getHealth("p")?.status).toBe("unhealthy");
    expect(fm.isHealthy("p")).toBe(false);
    for (let i = 0; i < 40; i += 1) fm.recordSuccess("p");
    expect(fm.getHealth("p")?.status).toBe("healthy");
  });

  it("lets an unhealthy provider back in as degraded after the restore buffer", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
    const fm = new FallbackManager({ grace_period_min_requests: 1, restore_buffer_seconds: 30 });
    fm.recordError("p");
    expect(fm.isHealthy("p")).toBe(false);
    vi.setSystemTime(1_000_000 + 30_000);
    expect(fm.isHealthy("p")).toBe(false);
    vi.setSystemTime(1_000_000 + 30_001);
    expect(fm.isHealthy("p")).toBe(true);
    expect(fm.getHealth("p")?.status).toBe("degraded");
  });

  it("rate limits degrade a provider until the retry-after window ends", () => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000_000);
    const fm = new FallbackManager({ grace_period_min_requests: 1, error_ratio_threshold: 0.5 });
    fm.recordRateLimit("p", 10);
    expect(fm.getHealth("p")?.status).toBe("degraded");
    expect(fm.getHealth("p")?.rate_limit_restore_seconds).toBe(10);
    expect(fm.isHealthy("p")).toBe(true);
    fm.recordError("p");
    expect(fm.getHealth("p")?.status).toBe("degraded");

    vi.setSystemTime(5_000_000 + 10_001);
    expect(fm.isHealthy("p")).toBe(false);
    expect(fm.getHealth("p")?.status).toBe("unhealthy");
    expect(fm.getHealth("p")?.rate_limit_restore_seconds).toBeUndefined();
  });

  it("uses the default retry-after when none is given", () => {
    const fm = new FallbackManager({ default_retry_after_seconds: 42 });
    fm.recordRateLimit("p");
    expect(fm.getHealth("p")?.rate_limit_restore_seconds).toBe(42);
    expect(fm.getHealth("p")?.total_requests).toBe(1);
    expect(fm.getHealth("p")?.error_requests).toBe(1);
  });

  it("pickBest prefers fully healthy providers and skips unhealthy ones", () => {
    const fm = new FallbackManager({ grace_period_min_requests: 1 });
    fm.recordRateLimit("a", 60);
    fm.recordError("b");
    fm.recordSuccess("c");
    expect(fm.filterHealthy(["a", "b", "c"])).toEqual(["a", "c"]);
    expect(fm.pickBest(["a", "b", "c"])).toBe("c");
    expect(fm.pickBest(["a", "b"])).toBe("a");
    expect(fm.pickBest(["b"])).toBeNull();
    expect(fm.getAllHealth().map((h) => h.provider)).toEqual(["a", "b", "c"]);
  });

  it("reset forgets all providers", () => {
    const fm = createFallbackManager();
    fm.recordError("p");
    fm.reset();
    expect(fm.getAllHealth()).toEqual([]);
  });
});
