// @PAD: /root/dynAEP/sdk/typescript/tests/rego/unified-evaluator.test.ts
// ===========================================================================
// Tests: OPT-002 Unified Rego Evaluator
// ===========================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { UnifiedRegoEvaluator, type RegoConfig } from "../../src/rego/UnifiedRegoEvaluator";
import type { RegoInput } from "../../src/rego/RegoDecisionCache";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides: Partial<RegoConfig> = {}): RegoConfig {
  return {
    policyPath: "./aep-policy.rego",
    evaluation: "precompiled",
    bundleMode: "unified",
    decisionCacheSize: 0,
    cacheInvalidateOnReload: true,
    ...overrides,
  };
}

function makeValidInput(): RegoInput {
  return {
    scene: {
      aep_version: "1.1",
      "SH-00001": { z: 5, parent: null, children: ["CP-00001"], visible: true },
      "CP-00001": { z: 25, parent: "SH-00001", children: [], visible: true },
    },
    registry: {
      aep_version: "1.1",
      "SH-00001": { skin_binding: "shell_default" },
      "CP-00001": { skin_binding: "component_card" },
    },
    theme: {
      aep_version: "1.1",
      component_styles: { shell_default: {}, component_card: {} },
    },
    event: {
      target_id: "CP-00001",
      type: "CUSTOM",
      dynaep_type: "AEP_MUTATE_STRUCTURE",
      mutation: { parent: "SH-00001" },
    },
  };
}

function makeInvalidInput(): RegoInput {
  return {
    scene: {
      aep_version: "1.1",
      "CP-00001": { z: 5, parent: "NONEXISTENT", children: ["MISSING"], visible: true },
      "MD-00001": { z: 35, parent: null, children: [], visible: true }, // z too low for MD
    },
    registry: {
      aep_version: "1.2", // Version mismatch
    },
    theme: {
      aep_version: "1.1",
      component_styles: {},
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("UnifiedRegoEvaluator", () => {
  it("precompiled evaluation returns no denials for valid input", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const result = evaluator.evaluate(makeValidInput());

    expect(result.structural_deny).toEqual([]);
  });

  it("precompiled evaluation detects z-band violations", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const result = evaluator.evaluate(makeInvalidInput());

    const zBandDeny = result.structural_deny.filter(d => d.includes("z-band violation"));
    expect(zBandDeny.length).toBeGreaterThan(0);
  });

  it("precompiled evaluation detects orphan elements", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const result = evaluator.evaluate(makeInvalidInput());

    const orphanDeny = result.structural_deny.filter(d => d.includes("Orphan element") || d.includes("non-existent parent"));
    expect(orphanDeny.length).toBeGreaterThan(0);
  });

  it("precompiled evaluation detects version mismatches", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const result = evaluator.evaluate(makeInvalidInput());

    const versionDeny = result.structural_deny.filter(d => d.includes("Version mismatch"));
    expect(versionDeny.length).toBeGreaterThan(0);
  });

  it("precompiled evaluation detects missing children", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const result = evaluator.evaluate(makeInvalidInput());

    const missingChild = result.structural_deny.filter(d => d.includes("Missing child"));
    expect(missingChild.length).toBeGreaterThan(0);
  });

  it("precompiled temporal evaluation detects drift violations", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const input = makeValidInput();
    input.temporal = {
      drift_ms: 100,
      agent_time_ms: 1000,
      bridge_time_ms: 1100,
    };
    input.config = {
      timekeeping: { max_drift_ms: 50, max_future_ms: 500, max_staleness_ms: 5000 },
    };

    const result = evaluator.evaluate(input);
    expect(result.temporal_deny.some(d => d.includes("drift exceeded"))).toBe(true);
  });

  it("precompiled perception evaluation detects speech violations", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const input = makeValidInput();
    input.perception = {
      modality: "speech",
      annotations: { syllable_rate: 9.0, turn_gap_ms: 100 },
    };

    const result = evaluator.evaluate(input);
    expect(result.perception_deny.some(d => d.includes("syllable rate"))).toBe(true);
    expect(result.perception_deny.some(d => d.includes("turn gap"))).toBe(true);
  });

  it("precompiled perception evaluation detects haptic violations", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const input = makeValidInput();
    input.perception = {
      modality: "haptic",
      annotations: { tap_duration_ms: 5, vibration_frequency_hz: 600 },
    };

    const result = evaluator.evaluate(input);
    expect(result.perception_deny.some(d => d.includes("Haptic tap duration"))).toBe(true);
    expect(result.perception_deny.some(d => d.includes("vibration frequency"))).toBe(true);
  });

  it("precompiled perception evaluation produces warnings for soft violations", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig());
    const input = makeValidInput();
    input.perception = {
      modality: "speech",
      annotations: { syllable_rate: 6.0 }, // Above 5.5, below 8.0
    };

    const result = evaluator.evaluate(input);
    expect(result.perception_deny.length).toBe(0); // No hard deny
    expect(result.perception_warn?.some(w => w.includes("comfortable maximum"))).toBe(true);
  });

  it("cache integration: second evaluation is a cache hit", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig({ decisionCacheSize: 100 }));
    const input = makeValidInput();

    evaluator.evaluate(input);
    const statsBefore = evaluator.cacheStats();
    expect(statsBefore.misses).toBe(1);
    expect(statsBefore.hits).toBe(0);

    evaluator.evaluate(input);
    const statsAfter = evaluator.cacheStats();
    expect(statsAfter.hits).toBe(1);
    expect(statsAfter.misses).toBe(1);
  });

  it("cache hit returns same result as fresh evaluation", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig({ decisionCacheSize: 100 }));
    const input = makeInvalidInput();

    const fresh = evaluator.evaluate(input);
    const cached = evaluator.evaluate(input);

    expect(cached.structural_deny).toEqual(fresh.structural_deny);
    expect(cached.temporal_deny).toEqual(fresh.temporal_deny);
    expect(cached.perception_deny).toEqual(fresh.perception_deny);
  });

  it("policy reload triggers cache invalidation", async () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig({ decisionCacheSize: 100 }));
    const input = makeValidInput();

    evaluator.evaluate(input);
    expect(evaluator.cacheStats().size).toBe(1);

    await evaluator.reload(["./aep-policy.rego"]);
    expect(evaluator.cacheStats().size).toBe(0);
  });

  it("backward compatibility: works with separate bundle mode", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig({ bundleMode: "separate" }));
    const result = evaluator.evaluate(makeValidInput());

    expect(result.structural_deny).toEqual([]);
  });

  it("getBackend returns precompiled when WASM is not available", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig({ evaluation: "wasm" }));
    // WASM is not available in test environment, should fall back
    expect(evaluator.getBackend()).toBe("precompiled");
  });

  it("disabled cache returns zero stats", () => {
    const evaluator = new UnifiedRegoEvaluator(makeConfig({ decisionCacheSize: 0 }));
    const stats = evaluator.cacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.maxSize).toBe(0);
  });
});
