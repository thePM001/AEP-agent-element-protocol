#!/usr/bin/env node
// ===========================================================================
// compare-performance-tests.js
// Compares current benchmark results against baseline.
// Fails (exit code 1) if any metric regresses by more than threshold.
// Reports improvements and regressions in a table.
//
// Usage:
//   node scripts/compare-performance-tests.js [--threshold 10] [--baseline path] [--current path]
// ===========================================================================

const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Parse CLI args
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
let threshold = 10; // default 10%
let baselinePath = path.join(__dirname, "..", "performance-tests", "baseline.json");
let currentPath = path.join(__dirname, "..", "performance-tests", "current.json");

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--threshold" && args[i + 1]) {
    threshold = parseFloat(args[i + 1]);
    i++;
  } else if (args[i] === "--baseline" && args[i + 1]) {
    baselinePath = args[i + 1];
    i++;
  } else if (args[i] === "--current" && args[i + 1]) {
    currentPath = args[i + 1];
    i++;
  }
}

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

if (!fs.existsSync(baselinePath)) {
  console.error(`Baseline not found: ${baselinePath}`);
  console.error("Run benchmarks first to establish a baseline.");
  process.exit(1);
}

if (!fs.existsSync(currentPath)) {
  console.error(`Current results not found: ${currentPath}`);
  console.error("Run benchmarks first: npm run bench");
  process.exit(1);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf-8"));
const current = JSON.parse(fs.readFileSync(currentPath, "utf-8"));

// ---------------------------------------------------------------------------
// Compare metrics
// ---------------------------------------------------------------------------

// Metrics where higher is better
const HIGHER_IS_BETTER = new Set([
  "throughput_events_per_second",
  "hot_path_rate",
]);

// Metrics where lower is better
const LOWER_IS_BETTER = new Set([
  "latency_p50_ms",
  "latency_p95_ms",
  "latency_p99_ms",
  "latency_p999_ms",
  "cold_path_avg_ms",
  "memory_peak_mb",
]);

const METRICS = [...HIGHER_IS_BETTER, ...LOWER_IS_BETTER];

let hasRegression = false;
const rows = [];

console.log("=== Performance Test Comparison ===\n");
console.log(`Baseline: ${baseline.date || "not established"}`);
console.log(`Current:  ${current.date || "unknown"}`);
console.log(`Threshold: ${threshold}%\n`);

const profiles = Object.keys(current.profiles || {});

for (const profileName of profiles) {
  const baseProfile = baseline.profiles?.[profileName];
  const currProfile = current.profiles?.[profileName];

  if (!baseProfile || !currProfile) continue;

  console.log(`--- ${profileName} ---`);

  for (const metric of METRICS) {
    const baseVal = baseProfile[metric];
    const currVal = currProfile[metric];

    if (baseVal === null || baseVal === undefined || currVal === null || currVal === undefined) {
      continue;
    }

    if (baseVal === 0) continue;

    const changePercent = ((currVal - baseVal) / Math.abs(baseVal)) * 100;
    const isHigherBetter = HIGHER_IS_BETTER.has(metric);

    let status;
    let isRegression = false;

    if (isHigherBetter) {
      // Higher is better: negative change is regression
      if (changePercent < -threshold) {
        status = "REGRESSION";
        isRegression = true;
      } else if (changePercent > threshold) {
        status = "IMPROVED";
      } else {
        status = "OK";
      }
    } else {
      // Lower is better: positive change is regression
      if (changePercent > threshold) {
        status = "REGRESSION";
        isRegression = true;
      } else if (changePercent < -threshold) {
        status = "IMPROVED";
      } else {
        status = "OK";
      }
    }

    if (isRegression) hasRegression = true;

    const sign = changePercent >= 0 ? "+" : "";
    const indicator = isRegression ? "!!!" : status === "IMPROVED" ? "+++" : "   ";

    const row = {
      profile: profileName,
      metric,
      baseline: baseVal,
      current: currVal,
      change: `${sign}${changePercent.toFixed(1)}%`,
      status,
    };
    rows.push(row);

    const baseStr = typeof baseVal === "number" ? baseVal.toFixed(4) : String(baseVal);
    const currStr = typeof currVal === "number" ? currVal.toFixed(4) : String(currVal);
    console.log(`  ${indicator} ${metric.padEnd(35)} ${baseStr.padStart(12)} → ${currStr.padStart(12)}  ${row.change.padStart(8)}  ${status}`);
  }
  console.log();
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const regressions = rows.filter(r => r.status === "REGRESSION");
const improvements = rows.filter(r => r.status === "IMPROVED");

console.log("=== Summary ===\n");
console.log(`  Regressions:  ${regressions.length}`);
console.log(`  Improvements: ${improvements.length}`);
console.log(`  Unchanged:    ${rows.length - regressions.length - improvements.length}`);

if (regressions.length > 0) {
  console.log("\n  REGRESSIONS:");
  for (const r of regressions) {
    console.log(`    ${r.profile} / ${r.metric}: ${r.change}`);
  }
}

if (improvements.length > 0) {
  console.log("\n  IMPROVEMENTS:");
  for (const r of improvements) {
    console.log(`    ${r.profile} / ${r.metric}: ${r.change}`);
  }
}

// Check if baseline has null values (first run)
const baselineHasNulls = Object.values(baseline.profiles || {}).some(
  (p) => Object.values(p).some((v) => v === null)
);

if (baselineHasNulls) {
  console.log("\n  NOTE: Baseline contains null values (not yet established).");
  console.log("  Copy current.json to baseline.json to establish baseline:");
  console.log("    cp performance-tests/current.json performance-tests/baseline.json");
  process.exit(0);
}

console.log(`\n  RESULT: ${hasRegression ? "FAIL (regressions detected)" : "PASS"}`);
process.exit(hasRegression ? 1 : 0);
