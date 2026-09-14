// ===========================================================================
// Benchmark: OPT-008 Async Bridge Clock - now() Latency
//
// Measures the per-call latency of AsyncBridgeClock.now() to verify it
// completes in < 0.01ms (pure arithmetic). Also measures stamp() latency
// and monotonicity guarantee under tight loop.
//
// Target: now() < 0.01ms per call (~100K+ calls/ms)
// ===========================================================================

import { AsyncBridgeClock } from "../sdk/typescript/src/temporal/AsyncBridgeClock";
import type { ClockConfig } from "../sdk/typescript/src/temporal/clock";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const config: ClockConfig = {
  protocol: "system",
  source: "",
  syncIntervalMs: 30000,
  maxDriftMs: 50,
  bridgeIsAuthority: true,
};

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function benchNowLatency(iterations: number): void {
  const clock = new AsyncBridgeClock(config);

  const start = performance.now();
  let lastVal = 0;
  for (let i = 0; i < iterations; i++) {
    lastVal = clock.now();
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / iterations;
  const callsPerMs = iterations / elapsed;
  console.log(`  now() (${iterations} calls): ${avgUs.toFixed(3)}µs/call, ${Math.round(callsPerMs)} calls/ms, last=${lastVal.toFixed(0)}`);
}

function benchStampLatency(iterations: number): void {
  const clock = new AsyncBridgeClock(config);
  const agentTime = Date.now();

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    clock.stamp(agentTime);
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / iterations;
  console.log(`  stamp() (${iterations} calls): ${avgUs.toFixed(3)}µs/call, ${Math.round(iterations / (elapsed / 1000))} stamps/sec`);
}

function benchMonotonicity(iterations: number): void {
  const clock = new AsyncBridgeClock(config);
  let violations = 0;
  let prev = 0;

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    const t = clock.now();
    if (t < prev) {
      violations++;
    }
    prev = t;
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / iterations;
  console.log(`  Monotonicity check (${iterations} calls): ${avgUs.toFixed(3)}µs/call, violations=${violations}`);
}

function benchNowDuringSlew(iterations: number): void {
  const clock = new AsyncBridgeClock(config);

  // Simulate a slew by injecting offset manually through start()
  // Since we can't easily trigger real NTP sync, we test now() arithmetic
  // with the slew mechanism at rest (baseline)
  const start = performance.now();
  let lastVal = 0;
  for (let i = 0; i < iterations; i++) {
    lastVal = clock.now();
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / iterations;
  console.log(`  now() during slew baseline (${iterations} calls): ${avgUs.toFixed(3)}µs/call, last=${lastVal.toFixed(0)}`);
}

function benchConcurrentTimestamps(batchSize: number, batches: number): void {
  const clock = new AsyncBridgeClock(config);
  let totalMonoViolations = 0;

  const start = performance.now();
  for (let b = 0; b < batches; b++) {
    const timestamps: number[] = [];
    for (let i = 0; i < batchSize; i++) {
      timestamps.push(clock.now());
    }
    // Check monotonicity within batch
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] < timestamps[i - 1]) {
        totalMonoViolations++;
      }
    }
  }
  const elapsed = performance.now() - start;
  const totalCalls = batchSize * batches;
  const avgUs = (elapsed * 1000) / totalCalls;
  console.log(`  Batch timestamps (${batches}×${batchSize}): ${avgUs.toFixed(3)}µs/call, mono violations=${totalMonoViolations}`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("=== OPT-008: Async Bridge Clock - now() Latency ===\n");

console.log("--- now() latency (target: <0.01ms = <10µs) ---");
benchNowLatency(1000);
benchNowLatency(10000);
benchNowLatency(100000);
benchNowLatency(1000000);

console.log("\n--- stamp() latency ---");
benchStampLatency(10000);
benchStampLatency(100000);

console.log("\n--- Monotonicity verification ---");
benchMonotonicity(100000);
benchMonotonicity(1000000);

console.log("\n--- Slew baseline ---");
benchNowDuringSlew(100000);

console.log("\n--- Batch timestamp production ---");
benchConcurrentTimestamps(100, 100);
benchConcurrentTimestamps(1000, 100);

console.log("\nDone.");
