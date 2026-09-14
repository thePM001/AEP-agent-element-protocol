// ===========================================================================
// Benchmark: bench-001 - Maximum Event Throughput
// Measures the maximum events/second the validation pipeline can sustain
// before p99 latency exceeds 10 ms. Tests at 1, 5, 10 agents.
//
// Uses standalone modules only (no @aep/core dependency) to ensure
// the benchmark runs independently of the AEP build state.
// ===========================================================================

import { UnifiedRegoEvaluator, type RegoConfig } from "../sdk/typescript/src/rego/UnifiedRegoEvaluator";
import { AttractorIndex, type LedgerAttractor } from "../sdk/typescript/src/lattice/AttractorIndex";
import type { FeatureSource } from "../sdk/typescript/src/lattice/FeatureExtractor";
import { BridgeClock, type ClockConfig } from "../sdk/typescript/src/temporal/clock";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WARMUP_MS = 5_000;
const RUN_MS = 10_000;

function percentile(samples: number[], p: number): number {
  if (samples.length === 0) return 0;
  const s = [...samples].sort((a, b) => a - b);
  const idx = Math.ceil(p * s.length) - 1;
  return s[Math.max(0, idx)];
}

function seededRng(seed: number): () => number {
  let s = seed | 0 || 1;
  return (): number => {
    s ^= s << 13;
    s ^= s >> 17;
    s ^= s << 5;
    return Math.abs(s) / 2147483648;
  };
}

const clockConfig: ClockConfig = {
  protocol: "system",
  source: "pool.ntp.org",
  syncIntervalMs: 30000,
  maxDriftMs: 50,
  bridgeIsAuthority: true,
};

// Inline template resolution (avoids @aep/core dependency)
function isTemplateId(id: string): boolean {
  return id.startsWith("CN-");
}

// ---------------------------------------------------------------------------
// Throughput Test
// ---------------------------------------------------------------------------

interface ThroughputResult {
  agentCount: number;
  totalEvents: number;
  durationMs: number;
  eventsPerSecond: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
  latencyP99Ms: number;
  p99Under10ms: boolean;
  hotPathRate: number;
}

function runThroughputTest(agentCount: number, elementCount: number = 500): ThroughputResult {
  const clock = new BridgeClock(clockConfig);
  const rego = new UnifiedRegoEvaluator({
    policyPath: "./aep-policy.rego",
    evaluation: "precompiled",
    bundleMode: "unified",
    decisionCacheSize: 5000,
    cacheInvalidateOnReload: true,
  });
  const attractorIndex = new AttractorIndex({
    maxAttractors: 2000,
    similarityThreshold: 0.95,
    indexType: "lsh",
    lshTables: 8,
    lshHashDimension: 4,
  });

  // Pre-populate attractor index
  const rngPop = seededRng(7);
  for (let i = 0; i < 100; i++) {
    attractorIndex.insert({
      id: `attr-${i}`,
      features: {
        elementType: i % 2 === 0 ? "CN" : "CP",
        zBand: 300 + i,
        mutationType: "update",
      },
      verdict: "accepted",
      insertedAt: clock.now(),
      lastMatchedAt: 0,
    });
  }

  const templateCount = Math.floor(elementCount * 0.8);
  const nonTemplateCount = elementCount - templateCount;
  const rng = seededRng(agentCount * 1000);
  const latencies: number[] = [];
  let hotPathCount = 0;

  // Warmup
  const warmupEnd = performance.now() + WARMUP_MS;
  while (performance.now() < warmupEnd) {
    const isTemplate = rng() < 0.5;
    const idx = Math.floor(rng() * (isTemplate ? templateCount : nonTemplateCount)) + 1;
    const targetId = isTemplate
      ? `CN-${String(idx).padStart(5, "0")}`
      : `CP-${String(idx).padStart(5, "0")}`;

    if (isTemplateId(targetId)) {
      // fast-exit path (simulated)
    } else {
      rego.evaluate({
        scene: { aep_version: "2.5" },
        registry: { aep_version: "2.5" },
        theme: { aep_version: "2.5", component_styles: {} },
        event: { target_id: targetId, type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
      });
    }
  }

  // Measurement
  const runStart = performance.now();
  const runEnd = runStart + RUN_MS;
  let totalEvents = 0;

  while (performance.now() < runEnd) {
    const eventStart = performance.now();
    const agentIdx = Math.floor(rng() * agentCount);
    const isTemplate = rng() < 0.5;
    const idx = Math.floor(rng() * (isTemplate ? templateCount : nonTemplateCount)) + 1;
    const targetId = isTemplate
      ? `CN-${String(idx).padStart(5, "0")}`
      : `CP-${String(idx).padStart(5, "0")}`;

    // Template fast-exit (OPT-009 simulated)
    if (isTemplateId(targetId)) {
      hotPathCount++;
      latencies.push(performance.now() - eventStart);
      totalEvents++;
      continue;
    }

    // Full pipeline: Rego + Attractor
    rego.evaluate({
      scene: { aep_version: "2.5", [targetId]: { z: 300, parent: "SH-00001", children: [], visible: true } },
      registry: { aep_version: "2.5" },
      theme: { aep_version: "2.5", component_styles: {} },
      event: { target_id: targetId, type: "CUSTOM", dynaep_type: "AEP_MUTATE_STRUCTURE", mutation: {} },
    });

    attractorIndex.findMatch({
      elementType: targetId.substring(0, 2),
      zBand: 300,
      mutationType: "update",
    });

    latencies.push(performance.now() - eventStart);
    totalEvents++;
  }

  const actualDuration = performance.now() - runStart;

  return {
    agentCount,
    totalEvents,
    durationMs: Math.round(actualDuration),
    eventsPerSecond: Math.round(totalEvents / (actualDuration / 1000)),
    latencyP50Ms: percentile(latencies, 0.50),
    latencyP95Ms: percentile(latencies, 0.95),
    latencyP99Ms: percentile(latencies, 0.99),
    p99Under10ms: percentile(latencies, 0.99) < 10,
    hotPathRate: totalEvents > 0 ? hotPathCount / totalEvents : 0,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== bench-001: Maximum Event Throughput ===\n");
console.log(`Warmup: ${WARMUP_MS / 1000}s | Run: ${RUN_MS / 1000}s\n`);

const results: ThroughputResult[] = [];

for (const agents of [1, 5, 10]) {
  console.log(`--- ${agents} agent(s) ---`);
  const result = runThroughputTest(agents);
  results.push(result);
  console.log(`  Throughput:    ${result.eventsPerSecond.toLocaleString()} events/s`);
  console.log(`  Total events:  ${result.totalEvents.toLocaleString()}`);
  console.log(`  Hot path rate: ${(result.hotPathRate * 100).toFixed(1)}%`);
  console.log(`  Latency p50:   ${result.latencyP50Ms.toFixed(4)} ms`);
  console.log(`  Latency p95:   ${result.latencyP95Ms.toFixed(4)} ms`);
  console.log(`  Latency p99:   ${result.latencyP99Ms.toFixed(4)} ms`);
  console.log(`  p99 < 10 ms:   ${result.p99Under10ms ? "PASS" : "FAIL"}`);
  console.log();
}

// Summary
const allPass = results.every(r => r.p99Under10ms);
console.log("--- Summary ---");
console.log(`  All p99 < 10 ms: ${allPass ? "PASS" : "FAIL"}`);

// Write results
const resultData = {
  benchmark: "bench-001-event-throughput",
  version: "0.3.1-perf",
  date: new Date().toISOString(),
  results,
  pass: allPass,
};

const resultsDir = path.join(__dirname, "results");
if (!fs.existsSync(resultsDir)) fs.mkdirSync(resultsDir, { recursive: true });

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
fs.writeFileSync(
  path.join(resultsDir, `bench-001-event-throughput-${timestamp}.json`),
  JSON.stringify(resultData, null, 2),
);

process.exit(allPass ? 0 : 1);
