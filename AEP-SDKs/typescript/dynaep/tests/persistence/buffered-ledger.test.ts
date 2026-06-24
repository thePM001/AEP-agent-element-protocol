// @PAD: /root/dynAEP/sdk/typescript/tests/persistence/buffered-ledger.test.ts
// ===========================================================================
// Tests for OPT-006: Buffered Evidence Ledger and Persistence I/O
// Tests BufferedLedger hash chain, flush mechanics, serialization,
// and chain verification.
// ===========================================================================

import { BufferedLedger, type LedgerEntry, type LedgerDecision } from "../../src/persistence/BufferedLedger";
import { BridgeClock } from "../../src/temporal/clock";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { passed++; console.log(`  PASS: ${name}`); })
            .catch((e: Error) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
    } else {
      passed++;
      console.log(`  PASS: ${name}`);
    }
  } catch (e: any) {
    failed++;
    console.log(`  FAIL: ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createClock(): BridgeClock {
  return new BridgeClock({
    protocol: "system",
    source: "pool.ntp.org",
    syncIntervalMs: 30000,
    maxDriftMs: 50,
    bridgeIsAuthority: true,
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("\n=== OPT-006: Buffered Evidence Ledger Tests ===\n");

test("record() appends entries to buffer", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock, { bufferSize: 256 });

  ledger.record("accepted", "CP-00001", "event");
  ledger.record("rejected_temporal", "PN-00002", "drift exceeded");

  const buffered = ledger.getBuffered();
  assert(buffered.length === 2, `Expected 2 buffered, got ${buffered.length}`);
  assert(buffered[0].seq === 1, `Expected seq 1, got ${buffered[0].seq}`);
  assert(buffered[1].seq === 2, `Expected seq 2, got ${buffered[1].seq}`);
  assert(buffered[0].decision === "accepted", `Expected 'accepted', got '${buffered[0].decision}'`);
  assert(buffered[1].decision === "rejected_temporal", `Expected 'rejected_temporal', got '${buffered[1].decision}'`);
});

test("record() computes SHA-256 hash chain", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock, { hashChainEnabled: true });

  ledger.record("accepted", "CP-00001", "test1");
  ledger.record("accepted", "CP-00002", "test2");

  const buffered = ledger.getBuffered();
  assert(buffered[0].hash !== null, "First entry hash should not be null");
  assert(buffered[1].hash !== null, "Second entry hash should not be null");
  assert(buffered[0].hash!.length === 64, `Hash should be 64 hex chars, got ${buffered[0].hash!.length}`);
  assert(buffered[1].prevHash === buffered[0].hash!, "Second entry prevHash should equal first entry hash");
});

test("record() skips hash when hashChainEnabled=false", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock, { hashChainEnabled: false });

  ledger.record("accepted", "CP-00001", "test");

  const buffered = ledger.getBuffered();
  assert(buffered[0].hash === null, "Hash should be null when chain disabled");
});

test("flush() moves entries from buffer to flushed", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock);

  ledger.record("accepted", "CP-00001", "test");
  ledger.record("rejected_structural", "PN-00002", "validation error");

  assert(ledger.getBuffered().length === 2, "Should have 2 buffered before flush");
  assert(ledger.getFlushed().length === 0, "Should have 0 flushed before flush");

  const count = ledger.flush();
  assert(count === 2, `Expected 2 flushed, got ${count}`);
  assert(ledger.getBuffered().length === 0, "Buffer should be empty after flush");
  assert(ledger.getFlushed().length === 2, "Should have 2 flushed after flush");
});

test("flush() invokes onFlush callback", () => {
  const clock = createClock();
  let callbackEntries: LedgerEntry[] = [];
  const ledger = new BufferedLedger(clock, {}, (entries) => {
    callbackEntries = entries;
  });

  ledger.record("accepted", "CP-00001", "test");
  ledger.flush();

  assert(callbackEntries.length === 1, `Expected 1 entry in callback, got ${callbackEntries.length}`);
  assert(callbackEntries[0].decision === "accepted", "Callback entry should be 'accepted'");
});

test("auto-flush triggers when buffer reaches capacity", () => {
  const clock = createClock();
  let flushCount = 0;
  const ledger = new BufferedLedger(clock, { bufferSize: 3 }, () => { flushCount++; });

  ledger.record("accepted", "CP-00001", "test1");
  ledger.record("accepted", "CP-00002", "test2");
  assert(flushCount === 0, "Should not have flushed yet");

  ledger.record("accepted", "CP-00003", "test3");
  assert(flushCount === 1, `Expected 1 flush on capacity, got ${flushCount}`);
  assert(ledger.getBuffered().length === 0, "Buffer should be empty after auto-flush");
});

test("verifyChain() returns -1 for valid chain", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock, { hashChainEnabled: true });

  for (let i = 0; i < 10; i++) {
    ledger.record("accepted", `CP-${String(i).padStart(5, "0")}`, `test${i}`);
  }
  ledger.flush();

  const broken = ledger.verifyChain();
  assert(broken === -1, `Expected -1 (valid), got ${broken}`);
});

test("serialize()/deserialize() roundtrip preserves state", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock, { hashChainEnabled: true });

  ledger.record("accepted", "CP-00001", "test1");
  ledger.record("rejected_temporal", "PN-00002", "drift");
  ledger.record("fast_exit_template", "CN-00003", "template=CN-T001");
  ledger.flush();

  const serialized = ledger.serialize();

  // Restore into fresh ledger
  const ledger2 = new BufferedLedger(clock);
  ledger2.deserialize(serialized);

  const stats = ledger2.getStats();
  assert(stats.totalFlushed === 3, `Expected 3 total flushed, got ${stats.totalFlushed}`);
  assert(stats.currentSeq === 3, `Expected seq 3, got ${stats.currentSeq}`);

  const flushed = ledger2.getFlushed();
  assert(flushed[0].decision === "accepted", "First entry should be 'accepted'");
  assert(flushed[2].decision === "fast_exit_template", "Third entry should be 'fast_exit_template'");
});

test("getStats() reports accurate counters", () => {
  const clock = createClock();
  const ledger = new BufferedLedger(clock);

  ledger.record("accepted", "CP-00001", "test1");
  ledger.record("accepted", "CP-00002", "test2");
  ledger.flush();
  ledger.record("rejected_causal", "CP-00003", "regression");

  const stats = ledger.getStats();
  assert(stats.totalRecorded === 3, `Expected 3 recorded, got ${stats.totalRecorded}`);
  assert(stats.totalFlushed === 2, `Expected 2 flushed, got ${stats.totalFlushed}`);
  assert(stats.buffered === 1, `Expected 1 buffered, got ${stats.buffered}`);
  assert(stats.currentSeq === 3, `Expected seq 3, got ${stats.currentSeq}`);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

setTimeout(() => {
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
  if (failed > 0) process.exit(1);
}, 500);
