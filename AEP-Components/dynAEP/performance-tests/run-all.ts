// ===========================================================================
// run-all.ts - Consolidated Performance Test Runner
// Runs all benchmarks in sequence, outputs consolidated results.
// ===========================================================================

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Benchmark Registry
// ---------------------------------------------------------------------------

interface BenchEntry {
  id: string;
  name: string;
  file: string;
  category: "existing" | "new";
}

const BENCHMARKS: BenchEntry[] = [
  // New performance-tests (Document 5)
  { id: "bench-001", name: "Event Throughput", file: "performance-tests/bench-001-event-throughput.ts", category: "new" },
  { id: "bench-003", name: "Hot Path Latency", file: "performance-tests/bench-003-hot-path-latency.ts", category: "new" },
  { id: "bench-012", name: "End-to-End Suite", file: "performance-tests/bench-012-end-to-end.ts", category: "new" },

  // Existing benchmarks (Documents 1-4)
  { id: "bench-002", name: "Cold Path Latency", file: "benchmarks/bench-002-cold-path-latency.ts", category: "existing" },
  { id: "bench-004", name: "Rego Evaluation", file: "benchmarks/bench-004-rego-evaluation.ts", category: "existing" },
  { id: "bench-005", name: "Scanner Throughput", file: "benchmarks/bench-005-scanner-throughput.ts", category: "existing" },
  { id: "bench-006", name: "Causal Ordering", file: "benchmarks/bench-006-causal-ordering.ts", category: "existing" },
  { id: "bench-008", name: "Attractor Matching", file: "benchmarks/bench-008-attractor-matching.ts", category: "existing" },
  { id: "bench-009", name: "TimesFM Decoupling", file: "benchmarks/bench-009-timesfm-decoupling.ts", category: "existing" },
  { id: "bench-010", name: "Template Fast-Exit", file: "benchmarks/bench-010-template-fast-exit.ts", category: "existing" },
  { id: "bench-011", name: "Buffered Ledger", file: "benchmarks/bench-011-buffered-ledger.ts", category: "existing" },
  { id: "bench-012-existing", name: "Async Clock", file: "benchmarks/bench-012-async-clock.ts", category: "existing" },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

interface RunResult {
  id: string;
  name: string;
  status: "pass" | "fail" | "error";
  durationMs: number;
  output: string;
}

const repoRoot = path.resolve(__dirname, "..");

function runBenchmark(entry: BenchEntry): RunResult {
  const filePath = path.join(repoRoot, entry.file);

  if (!fs.existsSync(filePath)) {
    return {
      id: entry.id,
      name: entry.name,
      status: "error",
      durationMs: 0,
      output: `File not found: ${filePath}`,
    };
  }

  const start = performance.now();
  try {
    const output = execSync(`npx tsx "${filePath}"`, {
      cwd: repoRoot,
      timeout: 600_000, // 10 minutes max per benchmark
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, NODE_ENV: "production" },
    });
    const elapsed = performance.now() - start;

    return {
      id: entry.id,
      name: entry.name,
      status: "pass",
      durationMs: Math.round(elapsed),
      output: output.toString(),
    };
  } catch (error: any) {
    const elapsed = performance.now() - start;
    const output = error.stdout?.toString() || error.message || "Unknown error";
    const exitCode = error.status ?? 1;

    return {
      id: entry.id,
      name: entry.name,
      status: exitCode === 0 ? "pass" : "fail",
      durationMs: Math.round(elapsed),
      output,
    };
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log("=== dynAEP Performance Test Suite - Full Run ===\n");
console.log(`Total benchmarks: ${BENCHMARKS.length}\n`);

const results: RunResult[] = [];
let passCount = 0;
let failCount = 0;
let errorCount = 0;

for (const entry of BENCHMARKS) {
  console.log(`[${entry.id}] ${entry.name}...`);
  const result = runBenchmark(entry);
  results.push(result);

  if (result.status === "pass") {
    passCount++;
    console.log(`  PASS (${(result.durationMs / 1000).toFixed(1)}s)\n`);
  } else if (result.status === "fail") {
    failCount++;
    console.log(`  FAIL (${(result.durationMs / 1000).toFixed(1)}s)\n`);
  } else {
    errorCount++;
    console.log(`  ERROR: ${result.output.substring(0, 200)}\n`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log("\n========== SUMMARY ==========\n");

const maxIdLen = Math.max(...results.map(r => r.id.length));
const maxNameLen = Math.max(...results.map(r => r.name.length));

for (const r of results) {
  const statusIcon = r.status === "pass" ? "PASS" : r.status === "fail" ? "FAIL" : "ERR ";
  const duration = `${(r.durationMs / 1000).toFixed(1)}s`;
  console.log(`  ${statusIcon}  ${r.id.padEnd(maxIdLen)}  ${r.name.padEnd(maxNameLen)}  ${duration.padStart(8)}`);
}

console.log();
console.log(`  Pass:  ${passCount}`);
console.log(`  Fail:  ${failCount}`);
console.log(`  Error: ${errorCount}`);
console.log(`  Total: ${results.length}`);

const totalDuration = results.reduce((sum, r) => sum + r.durationMs, 0);
console.log(`\n  Total duration: ${(totalDuration / 1000).toFixed(1)}s`);

// Write consolidated results
const consolidatedPath = path.join(__dirname, "results", "run-all-consolidated.json");
const consolidatedDir = path.dirname(consolidatedPath);
if (!fs.existsSync(consolidatedDir)) fs.mkdirSync(consolidatedDir, { recursive: true });

fs.writeFileSync(consolidatedPath, JSON.stringify({
  version: "0.3.1-perf",
  date: new Date().toISOString(),
  benchmarks: results.map(r => ({
    id: r.id,
    name: r.name,
    status: r.status,
    durationMs: r.durationMs,
  })),
  summary: { pass: passCount, fail: failCount, error: errorCount, total: results.length },
}, null, 2));

console.log(`\nConsolidated results: ${consolidatedPath}`);

const allPass = failCount === 0 && errorCount === 0;
console.log(`\nOVERALL: ${allPass ? "PASS" : "FAIL"}`);
process.exit(allPass ? 0 : 1);
