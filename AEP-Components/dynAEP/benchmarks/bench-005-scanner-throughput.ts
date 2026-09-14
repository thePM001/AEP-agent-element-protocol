// ===========================================================================
// Benchmark: OPT-003 Content Scanner Multi-Pattern Automaton
//
// Measures:
//   - Sequential vs unified scanner at various payload sizes
//   - Hard-abort latency
//   - Pattern count scaling
//
// Target: Unified < 50% of sequential latency at 100+ patterns
// ===========================================================================

import { UnifiedScanner, type ScannerConfig, type ScannerPattern, type ScanResult } from "../sdk/typescript/src/scanners/UnifiedScanner";
import { AhoCorasick } from "../sdk/typescript/src/scanners/AhoCorasick";

// ---------------------------------------------------------------------------
// Test Scanner Configs
// ---------------------------------------------------------------------------

function makePatterns(count: number, severity: "hard" | "soft"): ScannerPattern[] {
  const patterns: ScannerPattern[] = [];
  const literals = [
    "api_key", "secret", "password", "token", "private_key",
    "access_token", "authorization", "credential", "ssh-rsa",
    "BEGIN RSA", "aws_access", "AKIA", "ghp_", "sk_live_",
    "SELECT.*FROM", "DROP TABLE", "INSERT INTO", "DELETE FROM",
    "script>", "<iframe", "javascript:", "onerror=", "onclick=",
    "eval(", "document.cookie", "window.location",
  ];

  for (let i = 0; i < count; i++) {
    const base = literals[i % literals.length];
    patterns.push({
      patternId: `pat-${severity}-${i}`,
      regex: new RegExp(base.replace(".", "\\.").replace("*", ".*"), "i"),
      severity,
    });
  }

  return patterns;
}

function makeScannerConfigs(patternCount: number): ScannerConfig[] {
  const hardCount = Math.ceil(patternCount * 0.3);
  const softCount = patternCount - hardCount;

  return [
    {
      scannerId: "secrets",
      label: "Secrets Scanner",
      patterns: makePatterns(Math.ceil(hardCount / 3), "hard"),
    },
    {
      scannerId: "injection",
      label: "Injection Scanner",
      patterns: makePatterns(Math.ceil(hardCount / 3), "hard"),
    },
    {
      scannerId: "xss",
      label: "XSS Scanner",
      patterns: makePatterns(hardCount - 2 * Math.ceil(hardCount / 3), "hard"),
    },
    {
      scannerId: "pii",
      label: "PII Scanner",
      patterns: makePatterns(Math.ceil(softCount / 2), "soft"),
    },
    {
      scannerId: "brand",
      label: "Brand Scanner",
      patterns: makePatterns(softCount - Math.ceil(softCount / 2), "soft"),
    },
  ];
}

function makePayload(sizeBytes: number, includeMatch: boolean, matchSeverity?: "hard" | "soft"): string {
  const base = "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. ";
  let payload = "";
  while (payload.length < sizeBytes) {
    payload += base;
  }
  payload = payload.substring(0, sizeBytes);

  if (includeMatch) {
    const injection = matchSeverity === "hard"
      ? " api_key=sk_live_1234567890abcdef "
      : " user email is test@example.com ";
    // Insert match near the start for hard-abort testing
    payload = injection + payload.substring(injection.length);
  }

  return payload;
}

// ---------------------------------------------------------------------------
// Sequential Scanner (baseline)
// ---------------------------------------------------------------------------

function scanSequential(payload: string, configs: ScannerConfig[]): ScanResult[] {
  const results: ScanResult[] = [];

  for (const config of configs) {
    for (const pattern of config.patterns) {
      const match = pattern.regex.exec(payload);
      if (match) {
        results.push({
          scannerId: config.scannerId,
          patternId: pattern.patternId,
          severity: pattern.severity,
          match: { start: match.index, end: match.index + match[0].length, text: match[0] },
          scannerLabel: config.label,
        });

        if (pattern.severity === "hard") return results;
      }
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function benchPayloadSize(sizes: number[], patternCount: number, iterations: number): void {
  const configs = makeScannerConfigs(patternCount);
  const unified = new UnifiedScanner(configs);

  for (const size of sizes) {
    const payload = makePayload(size, false);
    const label = size >= 1024 ? `${(size / 1024).toFixed(0)}KB` : `${size}B`;

    // Sequential
    const seqTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      scanSequential(payload, configs);
      seqTimes.push(performance.now() - start);
    }

    // Unified
    const uniTimes: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      unified.scan(payload);
      uniTimes.push(performance.now() - start);
    }

    seqTimes.sort((a, b) => a - b);
    uniTimes.sort((a, b) => a - b);

    const seqP50 = seqTimes[Math.floor(iterations * 0.5)];
    const seqP95 = seqTimes[Math.floor(iterations * 0.95)];
    const uniP50 = uniTimes[Math.floor(iterations * 0.5)];
    const uniP95 = uniTimes[Math.floor(iterations * 0.95)];
    const speedup = seqP50 > 0 ? (seqP50 / uniP50).toFixed(1) : "N/A";

    console.log(`  ${label} (${patternCount} patterns):`);
    console.log(`    Sequential: p50=${seqP50.toFixed(3)}ms p95=${seqP95.toFixed(3)}ms`);
    console.log(`    Unified:    p50=${uniP50.toFixed(3)}ms p95=${uniP95.toFixed(3)}ms (${speedup}x)`);
  }
}

function benchHardAbort(iterations: number): void {
  const configs = makeScannerConfigs(100);
  const unified = new UnifiedScanner(configs);
  const payload = makePayload(10240, true, "hard");

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    const results = unified.scan(payload);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(iterations * 0.5)];
  const p95 = times[Math.floor(iterations * 0.95)];
  const p99 = times[Math.floor(iterations * 0.99)];

  console.log(`  Hard-abort (10KB payload, 100 patterns): p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms p99=${p99.toFixed(3)}ms`);
}

function benchPatternScaling(iterations: number): void {
  const counts = [20, 50, 100, 200];
  const payload = makePayload(1024, false);

  for (const count of counts) {
    const configs = makeScannerConfigs(count);
    const unified = new UnifiedScanner(configs);

    const times: number[] = [];
    for (let i = 0; i < iterations; i++) {
      const start = performance.now();
      unified.scan(payload);
      times.push(performance.now() - start);
    }

    times.sort((a, b) => a - b);
    const p50 = times[Math.floor(iterations * 0.5)];
    const p95 = times[Math.floor(iterations * 0.95)];
    const avg = times.reduce((a, b) => a + b, 0) / iterations;

    console.log(`  ${count} patterns (1KB): p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms avg=${avg.toFixed(3)}ms`);
  }
}

function benchAhoCorasickRaw(iterations: number): void {
  const patterns = [
    "api_key", "secret", "password", "token", "private_key",
    "access_token", "authorization", "credential", "ssh-rsa",
    "BEGIN RSA", "aws_access", "AKIA", "ghp_", "sk_live_",
  ];

  const ac = new AhoCorasick(patterns);
  const payload = makePayload(10240, false);

  const times: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    ac.search(payload);
    times.push(performance.now() - start);
  }

  times.sort((a, b) => a - b);
  const p50 = times[Math.floor(iterations * 0.5)];
  const p95 = times[Math.floor(iterations * 0.95)];
  const throughput = (iterations * 10) / ((times.reduce((a, b) => a + b, 0)) / 1000);

  console.log(`  Aho-Corasick raw (14 patterns, 10KB): p50=${p50.toFixed(3)}ms p95=${p95.toFixed(3)}ms (${throughput.toFixed(0)} KB/sec)`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\n=== OPT-003: Scanner Throughput Benchmark ===\n");

console.log("--- Payload size comparison (50 patterns) ---");
benchPayloadSize([100, 1024, 10240, 102400], 50, 500);

console.log("\n--- Hard-abort latency ---");
benchHardAbort(1000);

console.log("\n--- Pattern count scaling ---");
benchPatternScaling(500);

console.log("\n--- Aho-Corasick raw throughput ---");
benchAhoCorasickRaw(1000);

console.log("\n=== Benchmark complete ===\n");
