// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/authority.test.ts
// ===========================================================================
// Tests for DynAEPTemporalAuthority - dynAEP temporal governance
// ===========================================================================

import { BridgeClock, type ClockConfig } from "../../src/temporal/clock";
import {
  DynAEPTemporalAuthority,
  type TemporalAuthorityConfig,
  type TemporalAuditEntry,
} from "../../src/temporal/authority";

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
// Helpers
// ---------------------------------------------------------------------------

function makeClockConfig(): ClockConfig {
  return {
    protocol: "system",
    source: "localhost",
    syncIntervalMs: 30000,
    maxDriftMs: 50,
    bridgeIsAuthority: true,
  };
}

function makeAuthority(overrides?: Partial<TemporalAuthorityConfig>): DynAEPTemporalAuthority {
  const config: TemporalAuthorityConfig = {
    auditTrailDepth: 100,
    mutationTrackingEnabled: true,
    stalenessBroadcastIntervalMs: 10000,
    ...overrides,
  };
  const clock = new BridgeClock(makeClockConfig());
  return new DynAEPTemporalAuthority(clock, config);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testNowReturnsPositiveTimestamp(): void {
  test("now() returns a positive timestamp in milliseconds", () => {
    const authority = makeAuthority();
    const time = authority.now();
    assert(time > 0, "Timestamp should be positive");
    assert(time > 1700000000000, "Timestamp should be a recent epoch millisecond value");
  });
}

export function testRecordMutationAndRetrieveLastMutationTime(): void {
  test("recordMutation stores mutation and lastMutationTime retrieves it", () => {
    const authority = makeAuthority();
    const timeMs = authority.now();
    authority.recordMutation("elem-001", "event-001", timeMs);
    const lastTime = authority.lastMutationTime("elem-001");
    assert(lastTime !== null, "lastMutationTime should return a value");
    assert(lastTime === timeMs, "lastMutationTime should match recorded time");
  });
}

export function testLastMutationTimeReturnsNullForUnknownElement(): void {
  test("lastMutationTime returns null for elements with no mutations", () => {
    const authority = makeAuthority();
    const result = authority.lastMutationTime("nonexistent");
    assert(result === null, "Should return null for unknown element");
  });
}

export function testMutationFrequencyComputesCorrectRate(): void {
  test("mutationFrequency computes correct rate within time window", () => {
    const authority = makeAuthority();
    const baseTime = authority.now();
    // Record 5 mutations in rapid succession
    for (let i = 0; i < 5; i++) {
      authority.recordMutation("elem-002", "event-" + i, baseTime + i);
    }
    // With a 10-second window, all 5 should be included
    const freq = authority.mutationFrequency("elem-002", 10);
    assert(freq > 0, "Frequency should be positive");
    assert(freq <= 5, "Frequency should not exceed 5 mutations per 10 seconds");
  });
}

export function testMutationFrequencyReturnsZeroForUnknown(): void {
  test("mutationFrequency returns 0 for elements with no mutations", () => {
    const authority = makeAuthority();
    const freq = authority.mutationFrequency("nonexistent", 60);
    assert(freq === 0, "Should return 0 for unknown element");
  });
}

export function testIsStaleDetectsOldTimestamp(): void {
  test("isStale returns true for timestamps older than maxAgeMs", () => {
    const authority = makeAuthority();
    const oldTime = authority.now() - 60000;  // 60 seconds ago
    const stale = authority.isStale(oldTime, 5000);  // 5 second max age
    assert(stale === true, "60-second-old timestamp should be stale with 5s threshold");
  });
}

export function testIsStaleReturnsFalseForRecentTimestamp(): void {
  test("isStale returns false for recent timestamps within maxAgeMs", () => {
    const authority = makeAuthority();
    const recentTime = authority.now() - 100;  // 100ms ago
    const stale = authority.isStale(recentTime, 5000);  // 5 second max age
    assert(stale === false, "100ms-old timestamp should not be stale with 5s threshold");
  });
}

export function testElapsedReturnsPositiveDuration(): void {
  test("elapsed returns positive duration for past timestamps", () => {
    const authority = makeAuthority();
    const pastTime = authority.now() - 1000;
    const elapsedMs = authority.elapsed(pastTime);
    assert(elapsedMs >= 1000, "Elapsed should be at least 1000ms");
    assert(elapsedMs < 5000, "Elapsed should be reasonable (not years old)");
  });
}

export function testAuditTrailReturnsChronologicalEntries(): void {
  test("auditTrail returns entries in chronological order", () => {
    const authority = makeAuthority();
    const baseTime = authority.now();
    authority.recordMutation("elem-003", "evt-a", baseTime);
    authority.recordMutation("elem-003", "evt-b", baseTime + 100);
    authority.recordMutation("elem-003", "evt-c", baseTime + 200);
    const trail = authority.auditTrail("elem-003", 10);
    assert(trail.length === 3, "Should have 3 entries");
    assert(trail[0].eventId === "evt-a", "First entry should be evt-a");
    assert(trail[2].eventId === "evt-c", "Last entry should be evt-c");
    assert(trail[0].bridgeTimeMs <= trail[1].bridgeTimeMs, "Entries should be chronological");
  });
}

export function testAuditTrailEnforcesDepthLimit(): void {
  test("auditTrail enforces configured depth limit", () => {
    const authority = makeAuthority({ auditTrailDepth: 5 });
    const baseTime = authority.now();
    for (let i = 0; i < 20; i++) {
      authority.recordMutation("elem-004", "evt-" + i, baseTime + i);
    }
    const trail = authority.auditTrail("elem-004", 100);
    assert(trail.length <= 5, "Should respect audit trail depth of 5, got " + trail.length);
  });
}

export function testMutationTrackingDisabled(): void {
  test("recordMutation is a no-op when mutationTrackingEnabled is false", () => {
    const authority = makeAuthority({ mutationTrackingEnabled: false });
    authority.recordMutation("elem-005", "evt-x", authority.now());
    const result = authority.lastMutationTime("elem-005");
    assert(result === null, "Mutation should not be tracked when disabled");
  });
}

export function testDurationBetweenReturnsAbsoluteDifference(): void {
  test("durationBetween returns absolute millisecond difference between two events", () => {
    const authority = makeAuthority();
    const baseTime = authority.now();
    authority.recordMutation("elem-006", "early", baseTime);
    authority.recordMutation("elem-006", "late", baseTime + 500);
    const duration = authority.durationBetween("early", "late");
    assert(duration !== null, "Should find both events");
    assert(duration === 500, "Duration should be 500ms");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("authority.test.ts");

testNowReturnsPositiveTimestamp();
testRecordMutationAndRetrieveLastMutationTime();
testLastMutationTimeReturnsNullForUnknownElement();
testMutationFrequencyComputesCorrectRate();
testMutationFrequencyReturnsZeroForUnknown();
testIsStaleDetectsOldTimestamp();
testIsStaleReturnsFalseForRecentTimestamp();
testElapsedReturnsPositiveDuration();
testAuditTrailReturnsChronologicalEntries();
testAuditTrailEnforcesDepthLimit();
testMutationTrackingDisabled();
testDurationBetweenReturnsAbsoluteDifference();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
