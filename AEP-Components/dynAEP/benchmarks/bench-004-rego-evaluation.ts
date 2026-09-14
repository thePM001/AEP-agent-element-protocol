// ===========================================================================
// Benchmark: OPT-002 Unified Rego WASM Bundle with Decision Cache
//
// Measures:
//   - Single unified bundle vs three separate evaluations (precompiled)
//   - With cache (various hit rates) vs without cache
//   - Policy size impact (26+ rules)
//
// Target: Cached evaluation < 0.01 ms, uncached < 0.5 ms
// ===========================================================================

import { UnifiedRegoEvaluator, type RegoConfig } from "../sdk/typescript/src/rego/UnifiedRegoEvaluator";
import { RegoDecisionCache, type RegoInput, type RegoResult } from "../sdk/typescript/src/rego/RegoDecisionCache";

// ---------------------------------------------------------------------------
// Test Data Generators
// ---------------------------------------------------------------------------

function makeSceneElements(count: number): Record<string, Record<string, unknown>> {
  const scene: Record<string, Record<string, unknown>> = { aep_version: { value: "1.1" } as unknown as Record<string, unknown> };
  const prefixes = ["SH", "PN", "CP", "CZ", "CN", "TB", "WD", "OV", "MD", "TT"];
  const zBands: Record<string, [number, number]> = {
    SH: [0, 9], PN: [10, 19], CP: [20, 29], CZ: [30, 39],
    CN: [30, 39], TB: [40, 49], WD: [50, 59], OV: [60, 69],
    MD: [70, 79], TT: [80, 89],
  };

  for (let i = 0; i < count; i++) {
    const prefix = prefixes[i % prefixes.length];
    const id = `${prefix}-${String(i + 1).padStart(5, "0")}`;
    const band = zBands[prefix];
    scene[id] = {
      z: band[0] + (i % (band[1] - band[0] + 1)),
      parent: i > 0 ? "SH-00001" : null,
      children: [],
      visible: true,
    };
  }

  return scene;
}

function makeRegoInput(elementCount: number, withPerception: boolean): RegoInput {
  return {
    scene: makeSceneElements(elementCount),
    registry: { aep_version: "1.1" as unknown as Record<string, unknown> },
    theme: { aep_version: "1.1", component_styles: {} } as unknown as Record<string, unknown>,
    event: {
      target_id: "CP-00001",
      type: "CUSTOM",
      dynaep_type: "AEP_MUTATE_STRUCTURE",
      mutation: { parent: "SH-00001" },
    },
    temporal: withPerception ? { drift_ms: 10, agent_time_ms: 1000, bridge_time_ms: 1010 } : undefined,
    perception: withPerception
      ? { modality: "speech", annotations: { syllable_rate: 5.0, turn_gap_ms: 200 } }
      : undefined,
  };
}

function makeDistinctInputs(count: number): RegoInput[] {
  const inputs: RegoInput[] = [];
  const prefixes = ["SH", "PN", "CP", "CZ", "CN", "TB", "WD", "OV", "MD", "TT"];
  const ops = ["AEP_MUTATE_STRUCTURE", "AEP_MUTATE_BEHAVIOUR", "AEP_MUTATE_SKIN"];

  for (let i = 0; i < count; i++) {
    const prefix = prefixes[i % prefixes.length];
    inputs.push({
      scene: makeSceneElements(10),
      registry: { aep_version: "1.1" as unknown as Record<string, unknown> },
      theme: { aep_version: "1.1", component_styles: {} } as unknown as Record<string, unknown>,
      event: {
        target_id: `${prefix}-${String(i + 1).padStart(5, "0")}`,
        type: "CUSTOM",
        dynaep_type: ops[i % ops.length],
        mutation: {},
      },
    });
  }
  return inputs;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function benchPrecompiledEvaluation(elementCount: number, iterations: number): void {
  const config: RegoConfig = {
    policyPath: "./aep-policy.rego",
    evaluation: "precompiled",
    bundleMode: "unified",
    decisionCacheSize: 0,
    cacheInvalidateOnReload: true,
  };
  const evaluator = new UnifiedRegoEvaluator(config);
  const input = makeRegoInput(elementCount, true);

  // Warmup
  for (let i = 0; i < 100; i++) evaluator.evaluate(input);

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    evaluator.evaluate(input);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(iterations * 0.5)];
  const p95 = times[Math.floor(iterations * 0.95)];
  const p99 = times[Math.floor(iterations * 0.99)];
  const avg = times.reduce((a, b) => a + b, 0) / iterations;

  console.log(`  Precompiled (${elementCount} elements): p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms avg=${avg.toFixed(3)}ms`);
}

function benchCachedEvaluation(iterations: number, hitRate: number): void {
  const config: RegoConfig = {
    policyPath: "./aep-policy.rego",
    evaluation: "precompiled",
    bundleMode: "unified",
    decisionCacheSize: 5000,
    cacheInvalidateOnReload: true,
  };
  const evaluator = new UnifiedRegoEvaluator(config);

  // Create inputs with desired cache hit pattern
  const distinctCount = Math.max(1, Math.floor(iterations * (1 - hitRate)));
  const inputs = makeDistinctInputs(distinctCount);
  const repeatedInput = inputs[0];

  // Prime cache
  for (const inp of inputs) evaluator.evaluate(inp);

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const input = Math.random() < hitRate ? repeatedInput : inputs[i % inputs.length];
    const start = performance.now();
    evaluator.evaluate(input);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(iterations * 0.5)];
  const p95 = times[Math.floor(iterations * 0.95)];
  const p99 = times[Math.floor(iterations * 0.99)];
  const avg = times.reduce((a, b) => a + b, 0) / iterations;
  const stats = evaluator.cacheStats();

  console.log(`  Cached (${(hitRate * 100).toFixed(0)}% hit rate): p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms avg=${avg.toFixed(3)}ms (hits=${stats.hits}, misses=${stats.misses})`);
}

function benchCacheOperations(iterations: number): void {
  const cache = new RegoDecisionCache(5000);
  const inputs = makeDistinctInputs(100);
  const result: RegoResult = { structural_deny: [], temporal_deny: [], perception_deny: [] };

  // Store benchmark
  const storeStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    cache.store(inputs[i % inputs.length], result);
  }
  const storeElapsed = performance.now() - storeStart;
  const storeAvgNs = (storeElapsed * 1_000_000) / iterations;

  // Lookup benchmark (all hits)
  const lookupStart = performance.now();
  for (let i = 0; i < iterations; i++) {
    cache.lookup(inputs[i % inputs.length]);
  }
  const lookupElapsed = performance.now() - lookupStart;
  const lookupAvgNs = (lookupElapsed * 1_000_000) / iterations;

  console.log(`  cache.store(): ${iterations} ops in ${storeElapsed.toFixed(2)}ms (avg ${storeAvgNs.toFixed(0)}ns)`);
  console.log(`  cache.lookup(): ${iterations} ops in ${lookupElapsed.toFixed(2)}ms (avg ${lookupAvgNs.toFixed(0)}ns)`);
}

function benchInvalidation(): void {
  const cache = new RegoDecisionCache(5000);
  const inputs = makeDistinctInputs(5000);
  const result: RegoResult = { structural_deny: [], temporal_deny: [], perception_deny: [] };

  for (const inp of inputs) cache.store(inp, result);

  const start = performance.now();
  cache.invalidate();
  const elapsed = performance.now() - start;

  console.log(`  cache.invalidate() (5000 entries): ${elapsed.toFixed(3)}ms`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\n=== OPT-002: Unified Rego Evaluation Benchmark ===\n");

console.log("--- Precompiled evaluation latency ---");
benchPrecompiledEvaluation(10, 1000);
benchPrecompiledEvaluation(50, 1000);
benchPrecompiledEvaluation(100, 1000);

console.log("\n--- Cached evaluation (various hit rates) ---");
benchCachedEvaluation(5000, 0.0);
benchCachedEvaluation(5000, 0.5);
benchCachedEvaluation(5000, 0.8);
benchCachedEvaluation(5000, 0.95);

console.log("\n--- Cache operations ---");
benchCacheOperations(10000);

console.log("\n--- Cache invalidation ---");
benchInvalidation();

console.log("\n=== Benchmark complete ===\n");
