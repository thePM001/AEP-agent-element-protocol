// ===========================================================================
// Benchmark: OPT-001 - TimesFM Async Sidecar Decoupling
// Measures per-event latency with forecast enabled (async cache) vs disabled.
// Must show < 0.05 ms difference between enabled and disabled.
// ===========================================================================

import {
  ForecastSidecar,
  ForecastConfig,
  RuntimeCoordinateEvent,
} from "../sdk/typescript/src/temporal/forecast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(enabled: boolean): ForecastConfig {
  return {
    enabled,
    timesfmEndpoint: null,
    timesfmMode: "local",
    contextWindow: 64,
    forecastHorizon: 12,
    anomalyThreshold: 3.0,
    debounceMs: 250,
    maxTrackedElements: 500,
  };
}

function makeEvent(id: string, idx: number): RuntimeCoordinateEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_RUNTIME_COORDINATES",
    target_id: id,
    coordinates: {
      x: 100 + idx,
      y: 200 + idx,
      width: 300,
      height: 150,
      visible: true,
      renderedAt: "vp-lg",
    },
  };
}

interface BenchResult {
  label: string;
  eventCount: number;
  totalMs: number;
  perEventUs: number;
  eventsPerSec: number;
}

// ---------------------------------------------------------------------------
// Benchmark: per-event latency with sync cache check
// ---------------------------------------------------------------------------

function benchSyncCacheCheck(eventCount: number, enabled: boolean): BenchResult {
  const label = enabled ? "forecast ENABLED (async cache)" : "forecast DISABLED";
  const sidecar = new ForecastSidecar(makeConfig(enabled));

  // Pre-populate some history
  for (let i = 0; i < 20; i++) {
    for (let e = 0; e < 50; e++) {
      sidecar.ingest(makeEvent(`elem-${e}`, i));
    }
  }

  const start = performance.now();
  for (let i = 0; i < eventCount; i++) {
    const targetId = `elem-${i % 50}`;
    // This is the critical path operation: O(1) sync cache lookup
    sidecar.checkAnomalySync(targetId, { x: 100 + i, y: 200 + i, width: 300, height: 150 });
  }
  const elapsed = performance.now() - start;

  return {
    label,
    eventCount,
    totalMs: elapsed,
    perEventUs: (elapsed / eventCount) * 1000,
    eventsPerSec: Math.round(eventCount / (elapsed / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Benchmark: ingest + check throughput
// ---------------------------------------------------------------------------

function benchIngestAndCheck(eventCount: number): BenchResult {
  const sidecar = new ForecastSidecar(makeConfig(true));

  const start = performance.now();
  for (let i = 0; i < eventCount; i++) {
    const targetId = `elem-${i % 100}`;
    sidecar.ingest(makeEvent(targetId, i));
    sidecar.checkAnomalySync(targetId, { x: 100 + i, y: 200 + i });
  }
  const elapsed = performance.now() - start;

  return {
    label: "ingest + checkAnomalySync",
    eventCount,
    totalMs: elapsed,
    perEventUs: (elapsed / eventCount) * 1000,
    eventsPerSec: Math.round(eventCount / (elapsed / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Run benchmarks
// ---------------------------------------------------------------------------

console.log("=== OPT-001: TimesFM Async Sidecar Decoupling Benchmark ===\n");

const rates = [100, 500, 1000, 5000];

console.log("--- Per-event latency: enabled vs disabled ---\n");
for (const rate of rates) {
  const enabled = benchSyncCacheCheck(rate, true);
  const disabled = benchSyncCacheCheck(rate, false);
  const diff = Math.abs(enabled.perEventUs - disabled.perEventUs);

  console.log(`  ${rate} events:`);
  console.log(`    Enabled:  ${enabled.perEventUs.toFixed(3)} µs/event (${enabled.eventsPerSec.toLocaleString()} events/s)`);
  console.log(`    Disabled: ${disabled.perEventUs.toFixed(3)} µs/event (${disabled.eventsPerSec.toLocaleString()} events/s)`);
  console.log(`    Delta:    ${diff.toFixed(3)} µs/event ${diff < 50 ? "✓ PASS (<50µs)" : "✗ FAIL (≥50µs)"}`);
  console.log();
}

console.log("--- Ingest + check throughput ---\n");
for (const rate of rates) {
  const result = benchIngestAndCheck(rate);
  console.log(`  ${rate} events: ${result.perEventUs.toFixed(3)} µs/event (${result.eventsPerSec.toLocaleString()} events/s)`);
}

console.log("\n--- Summary ---\n");
const large = benchSyncCacheCheck(10000, true);
const largeDis = benchSyncCacheCheck(10000, false);
const largeDiff = Math.abs(large.perEventUs - largeDis.perEventUs);
console.log(`  10000 events delta: ${largeDiff.toFixed(3)} µs/event`);
console.log(`  Requirement: < 50 µs difference → ${largeDiff < 50 ? "PASS" : "FAIL"}`);
console.log(`  Enabled throughput: ${large.eventsPerSec.toLocaleString()} events/s`);
