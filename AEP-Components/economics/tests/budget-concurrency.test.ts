import { afterEach, describe, expect, it, vi } from "vitest";
import { BudgetEnforcer, createBudgetEnforcer } from "../lib/budget.js";
import { ConcurrencyLimiter, createConcurrencyLimiter } from "../lib/concurrency.js";
import type { BudgetConfig, CostEstimate } from "../lib/types.js";

function cost(microUsd: number): CostEstimate {
  return {
    estimated_input_tokens: 1,
    estimated_prompt_micro_usd: microUsd,
    provider: "openai",
    model: "m",
    price_per_million_prompt: 1,
    price_per_million_completion: 1,
    from_cache: false,
  };
}

function config(overrides: Partial<BudgetConfig> = {}): BudgetConfig {
  return {
    enabled: true,
    mode: "deny",
    scope: "per-workspace",
    period: "monthly",
    hard_cap: 1,
    soft_warning_at: 0.8,
    ...overrides,
  };
}

describe("BudgetEnforcer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows everything when disabled and records nothing", () => {
    const b = new BudgetEnforcer(config({ enabled: false }));
    const status = b.check(cost(10_000_000));
    expect(status).toEqual({ allowed: true, remaining_usd: Infinity, consumed_ratio: 0, warning: false });
    b.record(cost(5));
    expect(b.getSpent()).toBe(0);
  });

  it("deny mode refuses a call that would pass the hard cap", () => {
    const b = new BudgetEnforcer(config());
    b.record(cost(600_000));
    const status = b.check(cost(500_000));
    expect(status.allowed).toBe(false);
    expect(status.reason).toBe("Budget hard cap exceeded: 1 USD");
    expect(status.remaining_usd).toBeCloseTo(0.4);
    expect(status.consumed_ratio).toBeCloseTo(0.6);
  });

  it("allows up to exactly the cap and raises the soft warning", () => {
    const b = new BudgetEnforcer(config());
    const under = b.check(cost(500_000));
    expect(under).toEqual({ allowed: true, remaining_usd: 0.5, consumed_ratio: 0.5, warning: false });
    const atCap = b.check(cost(1_000_000));
    expect(atCap.allowed).toBe(true);
    expect(atCap.warning).toBe(true);
    expect(atCap.remaining_usd).toBe(0);
  });

  it("quota mode reports exhaustion", () => {
    const b = new BudgetEnforcer(config({ mode: "quota" }));
    expect(b.check(cost(2_000_000))).toEqual({
      allowed: false,
      remaining_usd: 0,
      consumed_ratio: 1,
      warning: true,
      reason: "Quota exhausted",
    });
  });

  it("warn mode lets an over-cap call through with a warning", () => {
    const b = new BudgetEnforcer(config({ mode: "warn" }));
    const status = b.check(cost(1_500_000));
    expect(status.allowed).toBe(true);
    expect(status.warning).toBe(true);
    expect(status.remaining_usd).toBeCloseTo(-0.5);
  });

  it("soft_warning_at 0 disables the warning", () => {
    const b = new BudgetEnforcer(config({ soft_warning_at: 0 }));
    expect(b.check(cost(999_999)).warning).toBe(false);
  });

  it("counts completion cost too and keeps scopes apart", () => {
    const b = new BudgetEnforcer(config());
    b.record({ ...cost(100_000), estimated_completion_micro_usd: 50_000 }, "agent-a");
    b.record(cost(200_000), "agent-b");
    expect(b.getSpent("agent-a")).toBeCloseTo(0.15);
    expect(b.getSpent("agent-b")).toBeCloseTo(0.2);
    expect(b.getSpent()).toBe(0);
  });

  it("checkAndRecord records only allowed calls", () => {
    const b = new BudgetEnforcer(config());
    expect(b.checkAndRecord(cost(700_000)).allowed).toBe(true);
    expect(b.checkAndRecord(cost(700_000)).allowed).toBe(false);
    expect(b.getSpent()).toBeCloseTo(0.7);
  });

  it("release returns a charge and never goes below zero", () => {
    const b = new BudgetEnforcer(config());
    b.record(cost(300_000));
    b.release(cost(100_000));
    expect(b.getSpent()).toBeCloseTo(0.2);
    b.release(cost(900_000));
    expect(b.getSpent()).toBe(0);
  });

  it("resetPeriod clears one scope or all", () => {
    const b = new BudgetEnforcer(config());
    b.record(cost(100), "a");
    b.record(cost(100), "b");
    b.resetPeriod("a");
    expect(b.getSpent("a")).toBe(0);
    expect(b.getSpent("b")).toBeCloseTo(0.0001);
    b.resetPeriod();
    expect(b.getSpent("b")).toBe(0);
  });

  it("maybeResetPeriod resets a daily budget after 24 hours", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 10, 12, 0, 0));
    const b = new BudgetEnforcer(config({ period: "daily" }));
    b.record(cost(100_000));
    vi.setSystemTime(new Date(2026, 0, 11, 11, 0, 0));
    expect(b.maybeResetPeriod()).toBe(false);
    expect(b.getSpent()).toBeCloseTo(0.1);
    vi.setSystemTime(new Date(2026, 0, 11, 12, 0, 1));
    expect(b.maybeResetPeriod()).toBe(true);
    expect(b.getSpent()).toBe(0);
  });

  it("maybeResetPeriod resets a monthly budget at the calendar month boundary", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 1, 15, 9, 0, 0));
    const b = new BudgetEnforcer(config({ period: "monthly" }));
    b.record(cost(100_000));
    vi.setSystemTime(new Date(2026, 2, 15, 8, 59, 59));
    expect(b.maybeResetPeriod()).toBe(false);
    vi.setSystemTime(new Date(2026, 2, 15, 9, 0, 0));
    expect(b.maybeResetPeriod()).toBe(true);
    expect(b.getSpent()).toBe(0);
  });

  it("maybeResetPeriod never resets a per-request budget", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 0, 1));
    const b = new BudgetEnforcer(config({ period: "per-request" }));
    vi.setSystemTime(new Date(2026, 5, 1));
    expect(b.maybeResetPeriod()).toBe(false);
  });

  it("validate checks the cap and warning ratio", () => {
    expect(new BudgetEnforcer(config()).validate()).toEqual([]);
    expect(new BudgetEnforcer(config({ hard_cap: 0, soft_warning_at: 1.5 })).validate()).toEqual([
      "hard_cap must be > 0",
      "soft_warning_at must be between 0 and 1",
    ]);
  });

  it("createBudgetEnforcer defaults to a 100 USD monthly deny cap", () => {
    const b = createBudgetEnforcer();
    expect(b.check(cost(100_000_001)).allowed).toBe(false);
    expect(b.check(cost(100_000_000)).allowed).toBe(true);
  });
});

describe("ConcurrencyLimiter", () => {
  it("grants permits up to the limit and queues the rest in order", async () => {
    const lim = new ConcurrencyLimiter(2);
    await lim.acquire();
    await lim.acquire();
    expect(lim.active).toBe(2);
    expect(lim.tryAcquire()).toBe(false);

    const order: string[] = [];
    const a = lim.acquire().then(() => order.push("a"));
    const b = lim.acquire().then(() => order.push("b"));
    expect(lim.waiting).toBe(2);

    lim.release();
    await a;
    expect(order).toEqual(["a"]);
    expect(lim.active).toBe(2);
    expect(lim.waiting).toBe(1);

    lim.release();
    await b;
    expect(order).toEqual(["a", "b"]);
    expect(lim.waiting).toBe(0);
  });

  it("tryAcquire takes a free permit", () => {
    const lim = new ConcurrencyLimiter(1);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.utilization).toBe(1);
    expect(lim.tryAcquire()).toBe(false);
  });

  it("release without a held permit does nothing", () => {
    const lim = new ConcurrencyLimiter(1);
    lim.release();
    expect(lim.active).toBe(0);
    expect(lim.tryAcquire()).toBe(true);
    expect(lim.tryAcquire()).toBe(false);
  });

  it("setLimit wakes waiters when raised and never drops below 1", async () => {
    const lim = new ConcurrencyLimiter(1);
    await lim.acquire();
    const woke = lim.acquire();
    expect(lim.waiting).toBe(1);
    lim.setLimit(3);
    await woke;
    expect(lim.active).toBe(2);
    expect(lim.limit).toBe(3);
    lim.setLimit(-5);
    expect(lim.limit).toBe(1);
  });

  it("reset drops permits and waiters", async () => {
    const lim = new ConcurrencyLimiter(1);
    await lim.acquire();
    void lim.acquire();
    lim.reset();
    expect(lim.active).toBe(0);
    expect(lim.waiting).toBe(0);
    expect(lim.utilization).toBe(0);
  });

  it("createConcurrencyLimiter defaults to 10", () => {
    expect(createConcurrencyLimiter().limit).toBe(10);
    expect(createConcurrencyLimiter(0).limit).toBe(10);
    expect(createConcurrencyLimiter(4).limit).toBe(4);
  });
});
