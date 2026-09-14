// ===========================================================================
// Benchmark: OPT-004 Cold-Path Latency (Sequential vs Parallel Chain)
//
// Measures:
//   - Sequential vs parallel execution of full 15-step chain
//   - Early abort latency (rejection at Stage A vs Stage B vs Stage E)
//   - All-pass latency with various step durations
//   - Short-circuit profiles (all-always vs mixed active/always)
//
// Target: Parallel < 60% of sequential wall-clock time at p50
// ===========================================================================

import type {
  StepExecutor,
  StepResult,
  ChainInput,
  StepContext,
  StepMode,
} from "../sdk/typescript/src/chain/types";
import { STEP_DEFINITIONS, CHAIN_STEP_COUNT } from "../sdk/typescript/src/chain/types";
import { ParallelChainExecutor } from "../sdk/typescript/src/chain/ParallelChainExecutor";
import { SequentialChainExecutor } from "../sdk/typescript/src/chain/SequentialChainExecutor";

// ---------------------------------------------------------------------------
// Configurable step fixture: simulates work with controllable latency
// ---------------------------------------------------------------------------

function createStep(
  stepNum: number,
  latencyMs: number,
  shouldReject: boolean = false,
  rejectReason: string = "benchmark_rejection",
): StepExecutor {
  const def = STEP_DEFINITIONS[stepNum];
  return {
    step: stepNum,
    name: def.name,
    mode: def.mode as StepMode,
    async execute(
      _input: ChainInput,
      _context: StepContext,
    ): Promise<StepResult> {
      const start = performance.now();
      // Simulate async work
      if (latencyMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, latencyMs));
      }
      const elapsed = (performance.now() - start) * 1000;
      return {
        step: stepNum,
        name: def.name,
        mode: def.mode as StepMode,
        verdict: shouldReject ? "reject" : "pass",
        verdict_reason: shouldReject ? rejectReason : "ok",
        duration_us: elapsed,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

function createStepSet(
  latencyMs: number,
  rejectStep?: number,
): StepExecutor[] {
  return Array.from({ length: CHAIN_STEP_COUNT }, (_, i) =>
    createStep(i, latencyMs, i === rejectStep),
  );
}

// ---------------------------------------------------------------------------
// Percentile calculation
// ---------------------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function stats(samples: number[]): {
  p50: number;
  p95: number;
  p99: number;
  mean: number;
} {
  const sorted = [...samples].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    p50: percentile(sorted, 50),
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    mean: sum / sorted.length,
  };
}

// ---------------------------------------------------------------------------
// Benchmark runner
// ---------------------------------------------------------------------------

async function runBenchmark(
  label: string,
  iterations: number,
  stepLatencyMs: number,
  rejectStep?: number,
): Promise<void> {
  const input: ChainInput = {
    event: { type: "CUSTOM", target_id: "CP-00001" },
    context: {},
  };

  const seqSteps = createStepSet(stepLatencyMs, rejectStep);
  const parSteps = createStepSet(stepLatencyMs, rejectStep);
  const seqExecutor = new SequentialChainExecutor(seqSteps);
  const parExecutor = new ParallelChainExecutor(parSteps);

  // Warm up
  await seqExecutor.execute(input);
  await parExecutor.execute(input);

  // Sequential
  const seqTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await seqExecutor.execute(input);
    seqTimes.push(performance.now() - start);
  }

  // Parallel
  const parTimes: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await parExecutor.execute(input);
    parTimes.push(performance.now() - start);
  }

  const seqStats = stats(seqTimes);
  const parStats = stats(parTimes);
  const speedup = seqStats.p50 / parStats.p50;

  console.log(`\n--- ${label} ---`);
  console.log(
    `  Sequential p50=${seqStats.p50.toFixed(2)}ms  p95=${seqStats.p95.toFixed(2)}ms  p99=${seqStats.p99.toFixed(2)}ms`,
  );
  console.log(
    `  Parallel   p50=${parStats.p50.toFixed(2)}ms  p95=${parStats.p95.toFixed(2)}ms  p99=${parStats.p99.toFixed(2)}ms`,
  );
  console.log(`  Speedup    ${speedup.toFixed(2)}x at p50`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("=== OPT-004: Cold-Path Chain Latency Benchmark ===\n");

  const iterations = 50;

  // Full chain, all pass, 1ms per step
  await runBenchmark(
    "All pass, 1ms/step (15ms sequential baseline)",
    iterations,
    1,
  );

  // Full chain, all pass, 5ms per step (more realistic)
  await runBenchmark(
    "All pass, 5ms/step (75ms sequential baseline)",
    iterations,
    5,
  );

  // Full chain, all pass, 10ms per step
  await runBenchmark(
    "All pass, 10ms/step (150ms sequential baseline)",
    iterations,
    10,
  );

  // Early abort at Stage A (Step 3)
  await runBenchmark(
    "Reject at Step 3 (Stage A), 5ms/step",
    iterations,
    5,
    3,
  );

  // Early abort at Stage B (Step 8)
  await runBenchmark(
    "Reject at Step 8 (Stage B), 5ms/step",
    iterations,
    5,
    8,
  );

  // Late abort at Stage E (Step 14)
  await runBenchmark(
    "Reject at Step 14 (Stage E), 5ms/step",
    iterations,
    5,
    14,
  );

  // Zero-latency steps (measures executor overhead only)
  await runBenchmark(
    "All pass, 0ms/step (executor overhead only)",
    iterations,
    0,
  );

  console.log("\n=== Benchmark complete ===");
}

main().catch(console.error);
