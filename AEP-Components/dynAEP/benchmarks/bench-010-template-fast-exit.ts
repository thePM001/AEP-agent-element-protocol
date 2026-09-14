// ===========================================================================
// Benchmark: OPT-009 - Template Node Validation Fast-Exit
// Measures per-event latency for template instance fast-exit vs full
// pipeline processing. Must show >80% fast-exit ratio in template-heavy
// workloads, with <1µs per fast-exit resolution.
// ===========================================================================

import { TemplateInstanceResolver } from "../sdk/typescript/src/template/TemplateInstanceResolver";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface BenchResult {
  label: string;
  eventCount: number;
  totalMs: number;
  perEventUs: number;
  eventsPerSec: number;
}

// Mock registry with template entries
function buildMockRegistry(templateCount: number, nonTemplateCount: number): Record<string, any> {
  const registry: Record<string, any> = {};
  for (let i = 0; i < templateCount; i++) {
    const id = `CN-${String(i + 1).padStart(5, "0")}`;
    registry[id] = { label: `DataCell-${i}`, type: "cell_node", template: true };
  }
  for (let i = 0; i < nonTemplateCount; i++) {
    const id = `CP-${String(i + 1).padStart(5, "0")}`;
    registry[id] = { label: `Panel-${i}`, type: "component" };
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Benchmark: Pure fast-exit resolution (template instances only)
// ---------------------------------------------------------------------------

function benchFastExitOnly(eventCount: number, templateCount: number): BenchResult {
  const registry = buildMockRegistry(templateCount, 0);
  const resolver = new TemplateInstanceResolver(registry);

  const start = performance.now();
  for (let i = 0; i < eventCount; i++) {
    const targetId = `CN-${String((i % templateCount) + 1).padStart(5, "0")}`;
    resolver.tryFastExit(targetId, i);
  }
  const elapsed = performance.now() - start;

  return {
    label: `fast-exit only (${templateCount} templates)`,
    eventCount,
    totalMs: elapsed,
    perEventUs: (elapsed / eventCount) * 1000,
    eventsPerSec: Math.round(eventCount / (elapsed / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Benchmark: Mixed workload (template + non-template)
// ---------------------------------------------------------------------------

function benchMixedWorkload(
  eventCount: number,
  templateRatio: number,
): BenchResult {
  const templateCount = 50;
  const nonTemplateCount = 10;
  const registry = buildMockRegistry(templateCount, nonTemplateCount);
  const resolver = new TemplateInstanceResolver(registry);

  const templateThreshold = Math.floor(eventCount * templateRatio);

  const start = performance.now();
  for (let i = 0; i < eventCount; i++) {
    let targetId: string;
    if (i < templateThreshold) {
      targetId = `CN-${String((i % templateCount) + 1).padStart(5, "0")}`;
    } else {
      targetId = `CP-${String((i % nonTemplateCount) + 1).padStart(5, "0")}`;
    }
    resolver.tryFastExit(targetId, i);
  }
  const elapsed = performance.now() - start;

  const stats = resolver.getStats();

  return {
    label: `mixed ${(templateRatio * 100).toFixed(0)}% template (ratio: ${stats.fastExitRatio.toFixed(3)})`,
    eventCount,
    totalMs: elapsed,
    perEventUs: (elapsed / eventCount) * 1000,
    eventsPerSec: Math.round(eventCount / (elapsed / 1000)),
  };
}

// ---------------------------------------------------------------------------
// Benchmark: Cache cold start vs warm
// ---------------------------------------------------------------------------

function benchCacheColdWarm(eventCount: number): { cold: BenchResult; warm: BenchResult } {
  const templateCount = 100;
  const registry = buildMockRegistry(templateCount, 0);
  const resolver = new TemplateInstanceResolver(registry);

  // Cold: first pass populates cache
  const coldStart = performance.now();
  for (let i = 0; i < eventCount; i++) {
    const targetId = `CN-${String((i % templateCount) + 1).padStart(5, "0")}`;
    resolver.tryFastExit(targetId, i);
  }
  const coldElapsed = performance.now() - coldStart;

  // Warm: second pass hits cache
  const warmStart = performance.now();
  for (let i = 0; i < eventCount; i++) {
    const targetId = `CN-${String((i % templateCount) + 1).padStart(5, "0")}`;
    resolver.tryFastExit(targetId, eventCount + i);
  }
  const warmElapsed = performance.now() - warmStart;

  return {
    cold: {
      label: "cache cold start",
      eventCount,
      totalMs: coldElapsed,
      perEventUs: (coldElapsed / eventCount) * 1000,
      eventsPerSec: Math.round(eventCount / (coldElapsed / 1000)),
    },
    warm: {
      label: "cache warm",
      eventCount,
      totalMs: warmElapsed,
      perEventUs: (warmElapsed / eventCount) * 1000,
      eventsPerSec: Math.round(eventCount / (warmElapsed / 1000)),
    },
  };
}

// ---------------------------------------------------------------------------
// Run benchmarks
// ---------------------------------------------------------------------------

console.log("=== OPT-009: Template Node Validation Fast-Exit Benchmark ===\n");

const rates = [100, 1000, 5000, 10000];

console.log("--- Fast-exit only (100% template instances) ---\n");
for (const rate of rates) {
  const result = benchFastExitOnly(rate, 50);
  console.log(`  ${rate} events: ${result.perEventUs.toFixed(3)} µs/event (${result.eventsPerSec.toLocaleString()} events/s)`);
}

console.log("\n--- Mixed workload at various template ratios ---\n");
for (const ratio of [0.5, 0.8, 0.9, 0.95]) {
  const result = benchMixedWorkload(10000, ratio);
  console.log(`  ${result.label}: ${result.perEventUs.toFixed(3)} µs/event (${result.eventsPerSec.toLocaleString()} events/s)`);
}

console.log("\n--- Cache cold start vs warm ---\n");
const cw = benchCacheColdWarm(10000);
console.log(`  Cold: ${cw.cold.perEventUs.toFixed(3)} µs/event (${cw.cold.eventsPerSec.toLocaleString()} events/s)`);
console.log(`  Warm: ${cw.warm.perEventUs.toFixed(3)} µs/event (${cw.warm.eventsPerSec.toLocaleString()} events/s)`);
console.log(`  Speedup: ${(cw.cold.perEventUs / cw.warm.perEventUs).toFixed(2)}x`);

console.log("\n--- Summary ---\n");
const large = benchFastExitOnly(50000, 100);
console.log(`  50000 events: ${large.perEventUs.toFixed(3)} µs/event`);
console.log(`  Requirement: <1 µs per fast-exit → ${large.perEventUs < 1 ? "PASS" : "FAIL"}`);
console.log(`  Throughput: ${large.eventsPerSec.toLocaleString()} events/s`);
