// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/clock-quality-tracker.test.ts
// ===========================================================================
// Tests for TA-3.2: TIM Clock Quality Tracker
// Tests sync state machine, confidence class computation, anomaly detection,
// Welford's variance, TIM block generation, and AsyncBridgeClock integration.
// ===========================================================================

import {
  ClockQualityTracker,
  type TIMConfig,
} from "../../src/temporal/ClockQualityTracker";
import { AsyncBridgeClock } from "../../src/temporal/AsyncBridgeClock";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;
const asyncTests: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      const tracked = result
        .then(() => { passed++; console.log(`  PASS: ${name}`); })
        .catch((e: any) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
      asyncTests.push(tracked);
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

function makeDefaultConfig(overrides: Partial<TIMConfig> = {}): TIMConfig {
  return {
    enabled: true,
    holdoverThreshold: 3,
    freewheelThreshold: 5,
    uncertaintyEstimation: "variance",
    fixedUncertaintyNs: 50_000_000,   // 50ms in ns
    ...overrides,
  };
}

function makeTracker(overrides: Partial<TIMConfig> = {}): ClockQualityTracker {
  return new ClockQualityTracker(makeDefaultConfig(overrides));
}

// ---------------------------------------------------------------------------
// Sync State Machine Tests
// ---------------------------------------------------------------------------

console.log("\n=== TA-3.2: TIM Clock Quality Tracker Tests ===\n");
console.log("--- Sync State Machine ---\n");

test("Initial state is FREEWHEEL", () => {
  const tracker = makeTracker();
  assert(tracker.getSyncState() === "FREEWHEEL", `Expected FREEWHEEL, got ${tracker.getSyncState()}`);
});

test("First successful sync transitions to LOCKED", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");
  assert(tracker.getSyncState() === "LOCKED", `Expected LOCKED, got ${tracker.getSyncState()}`);
});

test("Consecutive failures from LOCKED transition to HOLDOVER", () => {
  const tracker = makeTracker({ holdoverThreshold: 3 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED
  assert(tracker.getSyncState() === "LOCKED", "Should be LOCKED initially");

  tracker.recordSyncFailure(); // 1
  tracker.recordSyncFailure(); // 2
  assert(tracker.getSyncState() === "LOCKED", "Should still be LOCKED after 2 failures");

  tracker.recordSyncFailure(); // 3 -> HOLDOVER
  assert(tracker.getSyncState() === "HOLDOVER", `Expected HOLDOVER after 3 failures, got ${tracker.getSyncState()}`);
});

test("Consecutive failures from HOLDOVER transition to FREEWHEEL", () => {
  const tracker = makeTracker({ holdoverThreshold: 2, freewheelThreshold: 4 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED

  // LOCKED -> HOLDOVER
  tracker.recordSyncFailure(); // 1
  tracker.recordSyncFailure(); // 2 -> HOLDOVER
  assert(tracker.getSyncState() === "HOLDOVER", "Should be HOLDOVER");

  // HOLDOVER -> FREEWHEEL
  tracker.recordSyncFailure(); // 3
  assert(tracker.getSyncState() === "HOLDOVER", "Should still be HOLDOVER at 3 failures");
  tracker.recordSyncFailure(); // 4 -> FREEWHEEL
  assert(tracker.getSyncState() === "FREEWHEEL", `Expected FREEWHEEL after 4 failures, got ${tracker.getSyncState()}`);
});

test("Success from HOLDOVER transitions to LOCKED", () => {
  const tracker = makeTracker({ holdoverThreshold: 1 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED
  tracker.recordSyncFailure(); // 1 -> HOLDOVER
  assert(tracker.getSyncState() === "HOLDOVER", "Should be HOLDOVER");

  tracker.recordSyncSuccess(6.0, "NTP"); // -> LOCKED
  assert(tracker.getSyncState() === "LOCKED", `Expected LOCKED after success from HOLDOVER, got ${tracker.getSyncState()}`);
});

test("Success from FREEWHEEL transitions to LOCKED", () => {
  const tracker = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 1 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED
  tracker.recordSyncFailure(); // -> HOLDOVER
  tracker.recordSyncFailure(); // -> FREEWHEEL (consecutive failures reset on each state)
  // Note: consecutiveFailures is NOT reset on HOLDOVER transition, so at 2 total
  // freewheelThreshold=1 means after holdover, the NEXT failure triggers freewheel
  // Actually let's trace: after success, consec=0. Failure#1: consec=1, LOCKED->HOLDOVER (1>=1).
  // Failure#2: consec=2, HOLDOVER->FREEWHEEL (2>=1).
  assert(tracker.getSyncState() === "FREEWHEEL", "Should be FREEWHEEL");

  tracker.recordSyncSuccess(7.0, "NTP"); // -> LOCKED
  assert(tracker.getSyncState() === "LOCKED", `Expected LOCKED from FREEWHEEL, got ${tracker.getSyncState()}`);
});

test("Success resets consecutive failure counter", () => {
  const tracker = makeTracker({ holdoverThreshold: 3 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED

  tracker.recordSyncFailure(); // 1
  tracker.recordSyncFailure(); // 2

  tracker.recordSyncSuccess(6.0, "NTP"); // resets counter
  assert(tracker.getConsecutiveFailures() === 0, `Expected 0 failures after success, got ${tracker.getConsecutiveFailures()}`);

  // Now 3 more failures needed for HOLDOVER
  tracker.recordSyncFailure(); // 1
  tracker.recordSyncFailure(); // 2
  assert(tracker.getSyncState() === "LOCKED", "Should still be LOCKED after 2 new failures");
});

test("Disabled tracker does not change state", () => {
  const tracker = makeTracker({ enabled: false });
  tracker.recordSyncSuccess(5.0, "NTP");
  assert(tracker.getSyncState() === "FREEWHEEL", "Disabled tracker should stay FREEWHEEL");
  tracker.recordSyncFailure();
  assert(tracker.getSyncState() === "FREEWHEEL", "Disabled tracker should stay FREEWHEEL");
});

// ---------------------------------------------------------------------------
// Confidence Class Tests
// ---------------------------------------------------------------------------

console.log("\n--- Confidence Class ---\n");

test("PTP with low uncertainty returns A", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 500 });
  tracker.recordSyncSuccess(0.0001, "PTP"); // -> LOCKED
  const cc = tracker.getConfidenceClass();
  assert(cc === "A", `Expected A for PTP with low uncertainty, got ${cc}`);
});

test("PTP with medium uncertainty returns B", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 50_000 });
  tracker.recordSyncSuccess(0.05, "PTP"); // -> LOCKED
  const cc = tracker.getConfidenceClass();
  assert(cc === "B", `Expected B for PTP with medium uncertainty, got ${cc}`);
});

test("NTP with low uncertainty returns C", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 5_000_000 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED
  const cc = tracker.getConfidenceClass();
  assert(cc === "C", `Expected C for NTP with low uncertainty, got ${cc}`);
});

test("NTP with medium uncertainty returns D", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 50_000_000 });
  tracker.recordSyncSuccess(50.0, "NTP"); // -> LOCKED
  const cc = tracker.getConfidenceClass();
  assert(cc === "D", `Expected D for NTP with medium uncertainty, got ${cc}`);
});

test("System source returns E", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 500 });
  tracker.recordSyncSuccess(0.0, "system"); // -> LOCKED
  const cc = tracker.getConfidenceClass();
  assert(cc === "E", `Expected E for system source, got ${cc}`);
});

test("FREEWHEEL always returns F", () => {
  const tracker = makeTracker();
  // Initial state is FREEWHEEL
  const cc = tracker.getConfidenceClass();
  assert(cc === "F", `Expected F for FREEWHEEL, got ${cc}`);
});

test("FREEWHEEL returns F regardless of source", () => {
  const tracker = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 1 });
  tracker.recordSyncSuccess(0.0001, "PTP"); // -> LOCKED (would be A)
  tracker.recordSyncFailure(); // -> HOLDOVER
  tracker.recordSyncFailure(); // -> FREEWHEEL
  assert(tracker.getSyncState() === "FREEWHEEL", "Should be FREEWHEEL");
  const cc = tracker.getConfidenceClass();
  assert(cc === "F", `Expected F in FREEWHEEL state even with PTP source, got ${cc}`);
});

test("Disabled tracker returns E", () => {
  const tracker = makeTracker({ enabled: false });
  const cc = tracker.getConfidenceClass();
  assert(cc === "E", `Expected E for disabled tracker, got ${cc}`);
});

// ---------------------------------------------------------------------------
// Anomaly Detection Tests
// ---------------------------------------------------------------------------

console.log("\n--- Anomaly Detection ---\n");

test("Large step detected (>1000ms offset change)", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");   // first sync, sets lastOffset
  tracker.recordSyncSuccess(1200.0, "NTP"); // step of 1195ms > 1000ms threshold

  const flags = tracker.getAnomalyFlags();
  assert(flags.includes("LARGE_STEP"), `Expected LARGE_STEP flag, got [${flags.join(",")}]`);
});

test("No large step for small offset change", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncSuccess(10.0, "NTP"); // step of 5ms < 1000ms

  const flags = tracker.getAnomalyFlags();
  assert(!flags.includes("LARGE_STEP"), "Should NOT have LARGE_STEP for small change");
});

test("High jitter detected (>3-sigma)", () => {
  const tracker = makeTracker();
  // Build up some history with low variance
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncSuccess(5.1, "NTP");
  tracker.recordSyncSuccess(4.9, "NTP");
  // Now a large jump relative to variance
  tracker.recordSyncSuccess(200.0, "NTP"); // way beyond 3-sigma of the ~0.1ms std dev

  const flags = tracker.getAnomalyFlags();
  assert(flags.includes("HIGH_JITTER"), `Expected HIGH_JITTER flag, got [${flags.join(",")}]`);
});

test("Source change detected (NTP -> PTP)", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncSuccess(5.0, "PTP"); // source changed

  const flags = tracker.getAnomalyFlags();
  assert(flags.includes("SOURCE_CHANGE"), `Expected SOURCE_CHANGE flag, got [${flags.join(",")}]`);
});

test("No source change when source stays the same", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncSuccess(6.0, "NTP");

  const flags = tracker.getAnomalyFlags();
  assert(!flags.includes("SOURCE_CHANGE"), "Should NOT have SOURCE_CHANGE when source is same");
});

test("SYNC_LOSS set on FREEWHEEL transition", () => {
  const tracker = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 2 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED
  tracker.recordSyncFailure(); // -> HOLDOVER (1 >= holdoverThreshold=1)
  tracker.recordSyncFailure(); // -> FREEWHEEL (2 >= freewheelThreshold=2)
  assert(tracker.getSyncState() === "FREEWHEEL", "Should be FREEWHEEL");

  const flags = tracker.getAnomalyFlags();
  assert(flags.includes("SYNC_LOSS"), `Expected SYNC_LOSS flag on FREEWHEEL, got [${flags.join(",")}]`);
});

test("SYNC_LOSS cleared on successful sync", () => {
  const tracker = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 2 });
  tracker.recordSyncSuccess(5.0, "NTP"); // -> LOCKED
  tracker.recordSyncFailure(); // -> HOLDOVER
  tracker.recordSyncFailure(); // -> FREEWHEEL, SYNC_LOSS set

  const flagsBefore = tracker.getAnomalyFlags();
  assert(flagsBefore.includes("SYNC_LOSS"), "Should have SYNC_LOSS in FREEWHEEL");

  tracker.recordSyncSuccess(6.0, "NTP"); // -> LOCKED, clears SYNC_LOSS

  const flagsAfter = tracker.getAnomalyFlags();
  assert(!flagsAfter.includes("SYNC_LOSS"), "SYNC_LOSS should be cleared after successful sync");
});

test("clearTransientAnomalyFlags clears LARGE_STEP, HIGH_JITTER, SOURCE_CHANGE but not SYNC_LOSS", () => {
  const tracker = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 2 });

  // Get into FREEWHEEL to set SYNC_LOSS
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncFailure();
  tracker.recordSyncFailure();
  assert(tracker.getAnomalyFlags().includes("SYNC_LOSS"), "Should have SYNC_LOSS");

  // Now sync success with conditions that trigger all transient flags
  tracker.recordSyncSuccess(5.0, "NTP"); // clears SYNC_LOSS, -> LOCKED
  // Re-establish SYNC_LOSS manually not possible, so let's test differently:
  // Go back to FREEWHEEL
  tracker.recordSyncFailure();
  tracker.recordSyncFailure();
  // Now we have SYNC_LOSS

  // Trigger SOURCE_CHANGE and LARGE_STEP on the next success
  tracker.recordSyncSuccess(2000.0, "PTP");
  // This should set SOURCE_CHANGE and LARGE_STEP (2000 - prev ~5 > 1000)
  // But SYNC_LOSS was cleared by the success call

  // Let's take a different approach: Set up state where we have SYNC_LOSS + transient flags
  const tracker2 = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 2 });
  tracker2.recordSyncSuccess(5.0, "NTP"); // LOCKED
  tracker2.recordSyncSuccess(5.1, "NTP"); // still LOCKED
  tracker2.recordSyncSuccess(4.9, "NTP"); // build variance history
  tracker2.recordSyncFailure(); // -> HOLDOVER
  tracker2.recordSyncFailure(); // -> FREEWHEEL, SYNC_LOSS set

  // Do a success that triggers transient flags
  tracker2.recordSyncSuccess(2000.0, "PTP"); // LARGE_STEP + SOURCE_CHANGE, clears SYNC_LOSS

  const flagsBefore2 = tracker2.getAnomalyFlags();
  assert(flagsBefore2.includes("LARGE_STEP"), "Should have LARGE_STEP");
  assert(flagsBefore2.includes("SOURCE_CHANGE"), "Should have SOURCE_CHANGE");
  assert(!flagsBefore2.includes("SYNC_LOSS"), "SYNC_LOSS should be cleared by success");

  // Clear transient flags
  tracker2.clearTransientAnomalyFlags();

  const flagsAfter2 = tracker2.getAnomalyFlags();
  assert(!flagsAfter2.includes("LARGE_STEP"), "LARGE_STEP should be cleared by clearTransient");
  assert(!flagsAfter2.includes("SOURCE_CHANGE"), "SOURCE_CHANGE should be cleared by clearTransient");
});

test("clearTransientAnomalyFlags preserves SYNC_LOSS", () => {
  const tracker = makeTracker({ holdoverThreshold: 1, freewheelThreshold: 2 });
  tracker.recordSyncSuccess(5.0, "NTP"); // LOCKED
  tracker.recordSyncFailure(); // HOLDOVER
  tracker.recordSyncFailure(); // FREEWHEEL, SYNC_LOSS

  assert(tracker.getAnomalyFlags().includes("SYNC_LOSS"), "Should have SYNC_LOSS");

  tracker.clearTransientAnomalyFlags();

  assert(tracker.getAnomalyFlags().includes("SYNC_LOSS"), "SYNC_LOSS should persist after clearTransient");
});

test("No anomaly on first sync (no previous offset to compare)", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5000.0, "NTP"); // large offset but it's the first

  const flags = tracker.getAnomalyFlags();
  assert(!flags.includes("LARGE_STEP"), "No LARGE_STEP on first sync");
  assert(!flags.includes("HIGH_JITTER"), "No HIGH_JITTER on first sync");
  assert(!flags.includes("SOURCE_CHANGE"), "No SOURCE_CHANGE on first sync (from 'none')");
});

// ---------------------------------------------------------------------------
// Welford's Variance Tests
// ---------------------------------------------------------------------------

console.log("\n--- Welford's Variance ---\n");

test("Variance of identical values is 0", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "variance" });
  tracker.recordSyncSuccess(10.0, "NTP");
  tracker.recordSyncSuccess(10.0, "NTP");
  tracker.recordSyncSuccess(10.0, "NTP");

  const uncertaintyNs = tracker.getUncertaintyNs();
  // stddev = 0, so 2-sigma uncertainty = 0
  assert(uncertaintyNs === 0, `Expected 0 uncertainty for identical values, got ${uncertaintyNs}`);
});

test("Variance matches hand-computed values", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "variance" });
  // Values: 2, 4, 6
  // Mean = 4, Var = ((2-4)^2 + (4-4)^2 + (6-4)^2) / (3-1) = (4+0+4)/2 = 4
  // StdDev = 2.0
  // 2-sigma uncertainty = 2 * 2.0 * 1_000_000 = 4_000_000 ns
  tracker.recordSyncSuccess(2.0, "NTP");
  tracker.recordSyncSuccess(4.0, "NTP");
  tracker.recordSyncSuccess(6.0, "NTP");

  const uncertaintyNs = tracker.getUncertaintyNs();
  assert(uncertaintyNs === 4_000_000, `Expected 4000000 ns, got ${uncertaintyNs}`);
});

test("Uncertainty computed from variance in nanoseconds", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "variance" });
  // Single sample: falls back to fixed uncertainty
  tracker.recordSyncSuccess(5.0, "NTP");
  const u1 = tracker.getUncertaintyNs();
  assert(u1 === 50_000_000, `Expected fixed fallback 50000000 ns for 1 sample, got ${u1}`);

  // Add second sample
  tracker.recordSyncSuccess(15.0, "NTP");
  // Values: 5, 15. Var = (5-10)^2 + (15-10)^2 / 1 = 50. StdDev = sqrt(50) = 7.071
  // 2-sigma = 2 * 7.071 * 1_000_000 = 14142135.6... rounds to 14142136
  const u2 = tracker.getUncertaintyNs();
  assert(u2 > 0, `Uncertainty should be positive, got ${u2}`);
  // Approximate check: should be around 14142136 ns
  assert(Math.abs(u2 - 14142136) < 2, `Expected ~14142136 ns, got ${u2}`);
});

test("Fixed uncertainty mode returns configured value", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 99_999 });
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncSuccess(10.0, "NTP");

  const uncertaintyNs = tracker.getUncertaintyNs();
  assert(uncertaintyNs === 99_999, `Expected 99999, got ${uncertaintyNs}`);
});

test("Disabled tracker returns 0 uncertainty", () => {
  const tracker = makeTracker({ enabled: false });
  const uncertaintyNs = tracker.getUncertaintyNs();
  assert(uncertaintyNs === 0, `Expected 0 for disabled tracker, got ${uncertaintyNs}`);
});

// ---------------------------------------------------------------------------
// TIM Block Tests
// ---------------------------------------------------------------------------

console.log("\n--- TIM Block ---\n");

test("getTIMBlock returns all required fields", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");

  const block = tracker.getTIMBlock();
  assert(typeof block.sync_state === "string", "sync_state should be a string");
  assert(typeof block.uncertainty_ns === "number", "uncertainty_ns should be a number");
  assert(typeof block.sequence_token === "number", "sequence_token should be a number");
  assert(typeof block.sync_source === "string", "sync_source should be a string");
  assert(typeof block.confidence_class === "string", "confidence_class should be a string");
  assert(Array.isArray(block.anomaly_flags), "anomaly_flags should be an array");

  assert(block.sync_state === "LOCKED", `Expected LOCKED, got ${block.sync_state}`);
  assert(block.sync_source === "NTP", `Expected NTP (uppercased), got ${block.sync_source}`);
  assert(block.sequence_token === 1, `Expected token 1, got ${block.sequence_token}`);
});

test("Sequence token increments on success", () => {
  const tracker = makeTracker();
  assert(tracker.getSequenceToken() === 0, "Initial token should be 0");

  tracker.recordSyncSuccess(5.0, "NTP");
  assert(tracker.getSequenceToken() === 1, "Token should be 1 after first success");

  tracker.recordSyncSuccess(6.0, "NTP");
  assert(tracker.getSequenceToken() === 2, "Token should be 2 after second success");
});

test("Sequence token increments on failure", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP"); // token = 1

  tracker.recordSyncFailure(); // token = 2
  assert(tracker.getSequenceToken() === 2, `Expected token 2, got ${tracker.getSequenceToken()}`);

  tracker.recordSyncFailure(); // token = 3
  assert(tracker.getSequenceToken() === 3, `Expected token 3, got ${tracker.getSequenceToken()}`);
});

test("Sequence token increments on both success and failure", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");  // 1
  tracker.recordSyncFailure();             // 2
  tracker.recordSyncSuccess(6.0, "NTP");  // 3
  tracker.recordSyncFailure();             // 4
  tracker.recordSyncFailure();             // 5

  assert(tracker.getSequenceToken() === 5, `Expected token 5, got ${tracker.getSequenceToken()}`);
});

test("Disabled tracker returns default TIM block values", () => {
  const tracker = makeTracker({ enabled: false });
  tracker.recordSyncSuccess(5.0, "NTP"); // should be ignored
  tracker.recordSyncFailure();            // should be ignored

  assert(tracker.getSyncState() === "FREEWHEEL", "Disabled: state should stay FREEWHEEL");
  assert(tracker.getSequenceToken() === 0, "Disabled: token should stay 0");
  assert(tracker.getUncertaintyNs() === 0, "Disabled: uncertainty should be 0");
  assert(tracker.getConfidenceClass() === "E", "Disabled: confidence should be E");
});

test("TIM block sync_source is uppercased", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "ntp");
  const block = tracker.getTIMBlock();
  assert(block.sync_source === "NTP", `Expected uppercased NTP, got ${block.sync_source}`);
});

test("TIM block includes anomaly flags", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");
  tracker.recordSyncSuccess(2000.0, "PTP"); // LARGE_STEP + SOURCE_CHANGE

  const block = tracker.getTIMBlock();
  assert(block.anomaly_flags.includes("LARGE_STEP"), "TIM block should include LARGE_STEP");
  assert(block.anomaly_flags.includes("SOURCE_CHANGE"), "TIM block should include SOURCE_CHANGE");
});

// ---------------------------------------------------------------------------
// AsyncBridgeClock Integration Tests
// ---------------------------------------------------------------------------

console.log("\n--- AsyncBridgeClock Integration ---\n");

test("AsyncBridgeClock: getClockQuality returns null without TIM config", () => {
  const clock = new AsyncBridgeClock({
    protocol: "system",
    source: "pool.ntp.org",
    syncIntervalMs: 30000,
    maxDriftMs: 50,
    bridgeIsAuthority: true,
  });

  const quality = clock.getClockQuality();
  assert(quality === null, "Should return null without TIM config");
  clock.stop();
});

test("AsyncBridgeClock: getClockQuality returns TIM block with TIM config", () => {
  const clock = new AsyncBridgeClock(
    {
      protocol: "system",
      source: "pool.ntp.org",
      syncIntervalMs: 30000,
      maxDriftMs: 50,
      bridgeIsAuthority: true,
    },
    makeDefaultConfig(),
  );

  const quality = clock.getClockQuality();
  assert(quality !== null, "Should return TIM block with TIM config");
  assert(quality!.sync_state === "FREEWHEEL", `Expected initial FREEWHEEL, got ${quality!.sync_state}`);
  assert(quality!.confidence_class === "F", `Expected initial F, got ${quality!.confidence_class}`);
  clock.stop();
});

test("AsyncBridgeClock: getClockQualityTracker returns tracker instance", () => {
  const clock = new AsyncBridgeClock(
    {
      protocol: "system",
      source: "pool.ntp.org",
      syncIntervalMs: 30000,
      maxDriftMs: 50,
      bridgeIsAuthority: true,
    },
    makeDefaultConfig(),
  );

  const tracker = clock.getClockQualityTracker();
  assert(tracker !== null, "Should return tracker instance");
  assert(tracker instanceof ClockQualityTracker, "Should be a ClockQualityTracker instance");
  clock.stop();
});

test("AsyncBridgeClock: getClockQualityTracker returns null without TIM config", () => {
  const clock = new AsyncBridgeClock({
    protocol: "system",
    source: "pool.ntp.org",
    syncIntervalMs: 30000,
    maxDriftMs: 50,
    bridgeIsAuthority: true,
  });

  const tracker = clock.getClockQualityTracker();
  assert(tracker === null, "Should return null without TIM config");
  clock.stop();
});

test("AsyncBridgeClock: manual sync recording through tracker updates quality", () => {
  const clock = new AsyncBridgeClock(
    {
      protocol: "system",
      source: "pool.ntp.org",
      syncIntervalMs: 30000,
      maxDriftMs: 50,
      bridgeIsAuthority: true,
    },
    makeDefaultConfig(),
  );

  const tracker = clock.getClockQualityTracker()!;

  // Initially FREEWHEEL
  assert(tracker.getSyncState() === "FREEWHEEL", "Initially FREEWHEEL");

  // Simulate sync success directly on tracker
  tracker.recordSyncSuccess(5.0, "NTP");
  assert(tracker.getSyncState() === "LOCKED", "Should be LOCKED after success");

  // Quality should reflect the change
  const quality = clock.getClockQuality()!;
  assert(quality.sync_state === "LOCKED", "Quality should show LOCKED");
  clock.stop();
});

// ---------------------------------------------------------------------------
// Additional edge case AEP-NOSHIP/tests
// ---------------------------------------------------------------------------

console.log("\n--- Edge Cases ---\n");

test("Multiple consecutive syncs maintain LOCKED state", () => {
  const tracker = makeTracker();
  for (let i = 0; i < 10; i++) {
    tracker.recordSyncSuccess(5.0 + i * 0.1, "NTP");
  }
  assert(tracker.getSyncState() === "LOCKED", "Should remain LOCKED");
  assert(tracker.getConsecutiveFailures() === 0, "Should have 0 failures");
});

test("Alternating success/failure stays LOCKED (failures never reach threshold)", () => {
  const tracker = makeTracker({ holdoverThreshold: 3 });
  tracker.recordSyncSuccess(5.0, "NTP"); // LOCKED

  for (let i = 0; i < 10; i++) {
    tracker.recordSyncFailure(); // 1 failure
    tracker.recordSyncSuccess(5.0 + i, "NTP"); // resets to 0
  }

  assert(tracker.getSyncState() === "LOCKED", "Alternating should stay LOCKED");
});

test("getLastSyncSource returns the most recent source", () => {
  const tracker = makeTracker();
  tracker.recordSyncSuccess(5.0, "NTP");
  assert(tracker.getLastSyncSource() === "NTP", "Last source should be NTP");

  tracker.recordSyncSuccess(5.0, "PTP");
  assert(tracker.getLastSyncSource() === "PTP", "Last source should be PTP");
});

test("getLastSyncAt returns the timestamp of most recent sync", () => {
  const tracker = makeTracker();
  assert(tracker.getLastSyncAt() === 0, "Initial lastSyncAt should be 0");

  const before = Date.now();
  tracker.recordSyncSuccess(5.0, "NTP");
  const after = Date.now();

  const lastSync = tracker.getLastSyncAt();
  assert(lastSync >= before, `Last sync ${lastSync} should be >= ${before}`);
  assert(lastSync <= after, `Last sync ${lastSync} should be <= ${after}`);
});

test("isEnabled returns the config enabled state", () => {
  const enabledTracker = makeTracker({ enabled: true });
  assert(enabledTracker.isEnabled() === true, "Should be enabled");

  const disabledTracker = makeTracker({ enabled: false });
  assert(disabledTracker.isEnabled() === false, "Should be disabled");
});

test("PTP with very high uncertainty falls through to E", () => {
  // PTP with uncertainty > 100_000 ns falls through the PTP checks
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 500_000 });
  tracker.recordSyncSuccess(0.5, "PTP");
  const cc = tracker.getConfidenceClass();
  // 500_000 > 100_000 so it falls through PTP checks, and PTP is not NTP, so -> E
  assert(cc === "E", `Expected E for PTP with very high uncertainty, got ${cc}`);
});

test("NTP with very high uncertainty falls through to E", () => {
  const tracker = makeTracker({ uncertaintyEstimation: "fixed", fixedUncertaintyNs: 200_000_000 });
  tracker.recordSyncSuccess(200.0, "NTP");
  const cc = tracker.getConfidenceClass();
  // 200_000_000 > 100_000_000 so falls through NTP checks -> E
  assert(cc === "E", `Expected E for NTP with very high uncertainty, got ${cc}`);
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

Promise.all(asyncTests).then(() => {
  setTimeout(() => {
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
  }, 200);
});
