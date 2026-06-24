// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/modalities/notification.test.ts
// ===========================================================================
// Tests for Notification Modality Helpers - dynAEP perceptual temporal governance
// ===========================================================================

import {
  NOTIFICATION_PARAMS,
  NOTIFICATION_DEFAULTS,
  buildNotificationAnnotations,
  buildLowPrioritySchedule,
  buildHighPrioritySchedule,
  buildBatchedDigestSchedule,
  evaluateNotificationGate,
  computeMaxNotificationsPerHour,
  remainingBeforeHabituation,
} from "../../../src/temporal/modalities/notification";
import { PerceptionRegistry } from "../../../src/temporal/perception-registry";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Expected throw: ${message}`);
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { passed++; console.log(`  PASS: ${name}`); })
            .catch((e: any) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
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
// Tests
// ---------------------------------------------------------------------------

export function testNotificationDefaultsAreWithinComfortableRange(): void {
  test("NOTIFICATION_DEFAULTS fall within comfortable range of the registry", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("notification")!;
    for (const [param, value] of Object.entries(NOTIFICATION_DEFAULTS)) {
      if (typeof value !== "number") continue;
      const bound = profile.bounds[param];
      if (!bound) continue;
      assert(value >= bound.comfortable_min,
        param + " default " + value + " should be >= comfortable_min " + bound.comfortable_min);
      assert(value <= bound.comfortable_max,
        param + " default " + value + " should be <= comfortable_max " + bound.comfortable_max);
    }
  });
}

export function testBuildNotificationAnnotationsFillsDefaults(): void {
  test("buildNotificationAnnotations fills missing parameters with defaults", () => {
    const annotations = buildNotificationAnnotations({ burst_max_count: 5 });
    assert(annotations["burst_max_count"] === 5, "Override should be preserved");
    assert(annotations["min_interval_ms"] === NOTIFICATION_DEFAULTS["min_interval_ms"],
      "Missing min_interval_ms should use default");
  });
}

export function testLowPriorityScheduleHasLargerIntervals(): void {
  test("buildLowPrioritySchedule has larger intervals than high priority", () => {
    const low = buildLowPrioritySchedule();
    const high = buildHighPrioritySchedule();
    const lowInterval = low["min_interval_ms"] as number;
    const highInterval = high["min_interval_ms"] as number;
    assert(lowInterval >= highInterval,
      "Low priority interval should be >= high priority interval");
  });
}

export function testHighPriorityScheduleHasMoreBurstCapacity(): void {
  test("buildHighPrioritySchedule allows more bursts than low priority", () => {
    const low = buildLowPrioritySchedule();
    const high = buildHighPrioritySchedule();
    const lowBurst = low["burst_max_count"] as number;
    const highBurst = high["burst_max_count"] as number;
    assert(highBurst >= lowBurst,
      "High priority should allow >= burst count compared to low priority");
  });
}

export function testBatchedDigestScheduleHasLargestInterval(): void {
  test("buildBatchedDigestSchedule has the largest min_interval_ms", () => {
    const batched = buildBatchedDigestSchedule();
    const high = buildHighPrioritySchedule();
    const batchedInterval = batched["min_interval_ms"] as number;
    const highInterval = high["min_interval_ms"] as number;
    assert(batchedInterval >= highInterval,
      "Batched digest interval should be >= high priority");
  });
}

export function testEvaluateNotificationGateAllowsWithinBudget(): void {
  test("evaluateNotificationGate allows notifications within burst budget", () => {
    const annotations = buildHighPrioritySchedule();
    const decision = evaluateNotificationGate(annotations, 0, Date.now());
    assert(decision.allowed === true, "First notification should be allowed");
    assert(typeof decision.reason === "string", "Should have a reason string");
  });
}

export function testComputeMaxNotificationsPerHour(): void {
  test("computeMaxNotificationsPerHour returns positive count", () => {
    const annotations = buildHighPrioritySchedule();
    const maxPerHour = computeMaxNotificationsPerHour(annotations);
    assert(maxPerHour > 0, "Should allow at least 1 notification per hour");
    assert(maxPerHour < 3600, "Should not exceed 1 per second sustained");
  });
}

export function testRemainingBeforeHabituation(): void {
  test("remainingBeforeHabituation returns count > 0 for fresh start", () => {
    const remaining = remainingBeforeHabituation(NOTIFICATION_DEFAULTS, 0);
    const onset = NOTIFICATION_DEFAULTS["habituation_onset"] as number;
    assert(remaining === onset, "Fresh start should have full habituation budget");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("modalities/notification.test.ts");

testNotificationDefaultsAreWithinComfortableRange();
testBuildNotificationAnnotationsFillsDefaults();
testLowPriorityScheduleHasLargerIntervals();
testHighPriorityScheduleHasMoreBurstCapacity();
testBatchedDigestScheduleHasLargestInterval();
testEvaluateNotificationGateAllowsWithinBudget();
testComputeMaxNotificationsPerHour();
testRemainingBeforeHabituation();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
