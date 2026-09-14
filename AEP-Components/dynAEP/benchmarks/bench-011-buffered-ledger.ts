// ===========================================================================
// Benchmark: OPT-006 Buffered Evidence Ledger
//
// Measures the critical-path overhead of recording validation decisions
// in the SHA-256 hash-chain ledger. The record() call must be
// sub-microsecond on average to avoid impacting the event pipeline.
//
// Metrics:
//   - record() throughput (ops/sec)
//   - record() avg latency (ns)
//   - flush() throughput
//   - hash chain verification time
//   - serialization/deserialization roundtrip
//
// Target: record() < 10µs avg, flush() < 1ms for 256 entries
// ===========================================================================

import { BufferedLedger, type LedgerDecision } from "../sdk/typescript/src/persistence/BufferedLedger";
import { BridgeClock } from "../sdk/typescript/src/temporal/clock";

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const clock = new BridgeClock({
  protocol: "system",
  source: "pool.ntp.org",
  syncIntervalMs: 30000,
  maxDriftMs: 50,
  bridgeIsAuthority: true,
});

const DECISIONS: LedgerDecision[] = [
  "accepted",
  "rejected_temporal",
  "rejected_causal",
  "rejected_structural",
  "rejected_anomaly",
  "fast_exit_template",
  "anomaly_warned",
];

function randomDecision(): LedgerDecision {
  return DECISIONS[Math.floor(Math.random() * DECISIONS.length)];
}

function randomTargetId(): string {
  const prefixes = ["CP", "PN", "CN", "SH", "TB", "WD"];
  const prefix = prefixes[Math.floor(Math.random() * prefixes.length)];
  const num = Math.floor(Math.random() * 99999) + 1;
  return `${prefix}-${String(num).padStart(5, "0")}`;
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function benchRecord(iterations: number, hashEnabled: boolean): void {
  const label = hashEnabled ? "record() with hash chain" : "record() without hash chain";
  const ledger = new BufferedLedger(clock, {
    bufferSize: iterations + 1, // Prevent auto-flush during bench
    hashChainEnabled: hashEnabled,
  });

  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    ledger.record(randomDecision(), randomTargetId(), `bench entry ${i}`);
  }
  const elapsed = performance.now() - start;

  const avgNs = (elapsed * 1_000_000) / iterations;
  const opsPerSec = Math.round(iterations / (elapsed / 1000));
  console.log(`  ${label}: ${iterations} ops in ${elapsed.toFixed(2)}ms (avg ${avgNs.toFixed(0)}ns, ${opsPerSec.toLocaleString()} ops/sec)`);
}

function benchFlush(batchSize: number): void {
  const ledger = new BufferedLedger(clock, {
    bufferSize: batchSize + 1, // Prevent auto-flush
    hashChainEnabled: true,
  });

  // Fill buffer
  for (let i = 0; i < batchSize; i++) {
    ledger.record(randomDecision(), randomTargetId(), `flush entry ${i}`);
  }

  const start = performance.now();
  const count = ledger.flush();
  const elapsed = performance.now() - start;

  console.log(`  flush() ${count} entries: ${elapsed.toFixed(3)}ms`);
}

function benchVerifyChain(chainLength: number): void {
  const ledger = new BufferedLedger(clock, {
    bufferSize: chainLength + 1,
    hashChainEnabled: true,
  });

  for (let i = 0; i < chainLength; i++) {
    ledger.record(randomDecision(), randomTargetId(), `verify entry ${i}`);
  }
  ledger.flush();

  const start = performance.now();
  const result = ledger.verifyChain();
  const elapsed = performance.now() - start;

  console.log(`  verifyChain() ${chainLength} entries: ${elapsed.toFixed(3)}ms (result=${result})`);
}

function benchSerialize(entryCount: number): void {
  const ledger = new BufferedLedger(clock, {
    bufferSize: entryCount + 1,
    hashChainEnabled: true,
  });

  for (let i = 0; i < entryCount; i++) {
    ledger.record(randomDecision(), randomTargetId(), `serialize entry ${i}`);
  }
  ledger.flush();

  // Serialize
  const startSer = performance.now();
  const serialized = ledger.serialize();
  const elapsedSer = performance.now() - startSer;

  // Deserialize
  const ledger2 = new BufferedLedger(clock);
  const startDe = performance.now();
  ledger2.deserialize(serialized);
  const elapsedDe = performance.now() - startDe;

  const sizeKB = (serialized.length / 1024).toFixed(1);
  console.log(`  serialize() ${entryCount} entries: ${elapsedSer.toFixed(3)}ms (${sizeKB} KB)`);
  console.log(`  deserialize() ${entryCount} entries: ${elapsedDe.toFixed(3)}ms`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("\n=== OPT-006: Buffered Evidence Ledger Benchmark ===\n");

console.log("--- record() throughput ---");
benchRecord(1000, true);
benchRecord(10000, true);
benchRecord(1000, false);
benchRecord(10000, false);

console.log("\n--- flush() latency ---");
benchFlush(64);
benchFlush(256);
benchFlush(1024);

console.log("\n--- verifyChain() ---");
benchVerifyChain(256);
benchVerifyChain(1024);
benchVerifyChain(4096);

console.log("\n--- serialize/deserialize roundtrip ---");
benchSerialize(256);
benchSerialize(1024);

console.log("\n=== Benchmark complete ===\n");
