import { TrustManager } from "../../src/trust/manager.js";
import type { TrustConfig } from "../../src/trust/types.js";

function makeConfig(overrides?: Partial<TrustConfig>): TrustConfig {
  return {
    initial_score: 500,
    decay_rate: 5,
    penalties: {
      policy_violation: 50,
      structural_violation: 30,
      rate_limit: 10,
      forbidden_match: 100,
      intent_drift: 75,
    },
    rewards: {
      successful_action: 5,
      successful_rollback: 10,
    },
    ...overrides,
  };
}

describe("TrustManager", () => {
  let tm: TrustManager;

  beforeEach(() => {
    tm = new TrustManager(makeConfig());
  });

  it("starts at initial score", () => {
    expect(tm.getScore()).toBe(500);
    expect(tm.getTier()).toBe("standard");
  });

  it("rewards increase score", () => {
    const event = tm.reward("good action");
    expect(event.delta).toBe(5);
    expect(tm.getScore()).toBe(505);
  });

  it("custom reward amount", () => {
    tm.reward("bonus", 100);
    expect(tm.getScore()).toBe(600);
    expect(tm.getTier()).toBe("trusted");
  });

  it("penalizes decrease score", () => {
    const event = tm.penalize("bad action", "policy_violation");
    expect(event.delta).toBe(-50);
    expect(tm.getScore()).toBe(450);
  });

  it("penalty types use configured values", () => {
    tm.penalize("rate issue", "rate_limit");
    expect(tm.getScore()).toBe(490);

    tm.penalize("forbidden", "forbidden_match");
    expect(tm.getScore()).toBe(390);
  });

  it("score is clamped to 0-1000", () => {
    tm.reward("max out", 600);
    expect(tm.getScore()).toBe(1000);
    expect(tm.getTier()).toBe("privileged");

    // Create a new manager at 100
    const low = new TrustManager(makeConfig({ initial_score: 100 }));
    low.penalize("crash", "forbidden_match");
    expect(low.getScore()).toBe(0);
    expect(low.getTier()).toBe("untrusted");
  });

  it("tier boundaries are correct", () => {
    const t0 = new TrustManager(makeConfig({ initial_score: 0 }));
    expect(t0.getTier()).toBe("untrusted");

    const t200 = new TrustManager(makeConfig({ initial_score: 200 }));
    expect(t200.getTier()).toBe("provisional");

    const t400 = new TrustManager(makeConfig({ initial_score: 400 }));
    expect(t400.getTier()).toBe("standard");

    const t600 = new TrustManager(makeConfig({ initial_score: 600 }));
    expect(t600.getTier()).toBe("trusted");

    const t800 = new TrustManager(makeConfig({ initial_score: 800 }));
    expect(t800.getTier()).toBe("privileged");
  });

  it("meetsMinTier checks correctly", () => {
    expect(tm.meetsMinTier("untrusted")).toBe(true);
    expect(tm.meetsMinTier("provisional")).toBe(true);
    expect(tm.meetsMinTier("standard")).toBe(true);
    expect(tm.meetsMinTier("trusted")).toBe(false);
    expect(tm.meetsMinTier("privileged")).toBe(false);
  });

  it("decay reduces score after inactivity", () => {
    // Simulate 2 hours of inactivity by manipulating the manager
    const config = makeConfig({ decay_rate: 10 });
    const manager = new TrustManager(config);
    // Access private field via type assertion for testing
    (manager as any).lastActivityAt = Date.now() - 2 * 60 * 60 * 1000;
    const event = manager.applyDecay();
    expect(event).not.toBeNull();
    expect(event!.delta).toBe(-20);
    expect(manager.getScore()).toBe(480);
  });

  it("no decay within 1 hour", () => {
    const event = tm.applyDecay();
    expect(event).toBeNull();
  });

  it("events are recorded", () => {
    tm.reward("a");
    tm.penalize("b");
    tm.reward("c");
    expect(tm.getEvents()).toHaveLength(3);
    expect(tm.getEvents()[0].type).toBe("reward");
    expect(tm.getEvents()[1].type).toBe("penalty");
  });

  it("markActivity resets decay timer", () => {
    (tm as any).lastActivityAt = Date.now() - 3 * 60 * 60 * 1000;
    tm.markActivity();
    const event = tm.applyDecay();
    expect(event).toBeNull();
  });
});
