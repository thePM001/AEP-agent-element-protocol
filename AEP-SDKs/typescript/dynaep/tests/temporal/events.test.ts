// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/events.test.ts
// ===========================================================================
// Tests for Temporal Event Types - dynAEP temporal authority layer
// ===========================================================================

import type { BridgeTimestamp } from "../../src/temporal/clock";
import type { TemporalViolation } from "../../src/temporal/validator";
import type { ForecastPoint, RuntimeCoordinates } from "../../src/temporal/forecast";
import {
  ClockSyncEvent,
  TemporalStampEvent,
  TemporalRejectionEvent,
  CausalViolationEvent,
  TemporalForecastEvent,
  TemporalAnomalyEvent,
  TemporalResetEvent,
  createClockSyncEvent,
  createCausalViolationEvent,
  createTemporalRejectionEvent,
  createTemporalResetEvent,
  serializeTemporalEvent,
} from "../../src/temporal/events";

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
// Shared fixtures
// ---------------------------------------------------------------------------

function makeBridgeTimestamp(): BridgeTimestamp {
  return {
    bridgeTimeMs: Date.now(),
    agentTimeMs: null,
    driftMs: 0,
    source: "system",
    syncedAt: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testClockSyncEventHasCorrectDynaepType(): void {
  test("ClockSyncEvent has correct dynaep_type", () => {
    const event = createClockSyncEvent({
      bridgeTimeMs: Date.now(),
      source: "ntp",
      offsetMs: 12,
      syncedAt: Date.now(),
    });
    assert(event.dynaep_type === "AEP_CLOCK_SYNC", "dynaep_type should be 'AEP_CLOCK_SYNC'");
    assert(event.type === "CUSTOM", "type should be 'CUSTOM'");
  });
}

export function testTemporalStampEventIncludesBridgeTimestampAndVectorClock(): void {
  test("TemporalStampEvent includes bridgeTimestamp and vectorClock", () => {
    const event: TemporalStampEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_TEMPORAL_STAMP",
      originalEventType: "STATE_DELTA",
      targetId: "elem-1",
      bridgeTimestamp: makeBridgeTimestamp(),
      causalPosition: 0,
      vectorClock: { "agent-1": 1 },
    };
    assert(event.bridgeTimestamp !== null && event.bridgeTimestamp !== undefined, "bridgeTimestamp should be present");
    assert(typeof event.bridgeTimestamp.bridgeTimeMs === "number", "bridgeTimestamp.bridgeTimeMs should be a number");
    assert(typeof event.vectorClock === "object", "vectorClock should be an object");
    assert(event.vectorClock["agent-1"] === 1, "vectorClock agent-1 should be 1");
  });
}

export function testTemporalRejectionEventIncludesViolationsArray(): void {
  test("TemporalRejectionEvent includes violations array", () => {
    const violation: TemporalViolation = {
      type: "drift_exceeded",
      detail: "Drift of 200ms exceeds maximum allowed 50ms",
      agentTimeMs: 1000,
      bridgeTimeMs: 1200,
      thresholdMs: 50,
    };
    const event = createTemporalRejectionEvent({
      targetId: "elem-1",
      error: "Temporal validation failed",
      violations: [violation],
      originalEventTimestamp: 1000,
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    assert(Array.isArray(event.violations), "violations should be an array");
    assert(event.violations.length === 1, "violations should have 1 entry");
    assert(event.violations[0].type === "drift_exceeded", "violation type should be drift_exceeded");
  });
}

export function testCausalViolationEventIncludesExpectedAndReceivedSequences(): void {
  test("CausalViolationEvent includes expected and received sequences", () => {
    const event = createCausalViolationEvent({
      eventId: "e-5",
      agentId: "agent-1",
      expectedSequence: 3,
      receivedSequence: 5,
      missingDependencies: [],
      bufferStatus: "buffered",
    });
    assert(typeof event.expectedSequence === "number", "expectedSequence should be a number");
    assert(typeof event.receivedSequence === "number", "receivedSequence should be a number");
    assert(event.expectedSequence === 3, "expectedSequence should be 3");
    assert(event.receivedSequence === 5, "receivedSequence should be 5");
  });
}

export function testTemporalForecastEventIncludesPredictionsArray(): void {
  test("TemporalForecastEvent includes predictions array", () => {
    const event: TemporalForecastEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_TEMPORAL_FORECAST",
      targetId: "elem-1",
      horizonMs: 5000,
      predictions: [
        {
          offsetMs: 1000,
          predictedState: { x: 100, y: 200 },
          quantileLow: { x: 90, y: 190 },
          quantileHigh: { x: 110, y: 210 },
        },
      ],
      confidence: 0.9,
      forecastedAt: Date.now(),
    };
    assert(Array.isArray(event.predictions), "predictions should be an array");
    assert(event.predictions.length === 1, "predictions should have 1 entry");
    assert(event.predictions[0].offsetMs === 1000, "first prediction offsetMs should be 1000");
  });
}

export function testTemporalAnomalyEventIncludesAnomalyScoreAndRecommendation(): void {
  test("TemporalAnomalyEvent includes anomaly score and recommendation", () => {
    const event: TemporalAnomalyEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_TEMPORAL_ANOMALY",
      targetId: "elem-1",
      anomalyScore: 3.5,
      predicted: { x: 100, y: 200 },
      actual: { x: 500, y: 800 },
      recommendation: "require_approval",
      bridgeTimestamp: makeBridgeTimestamp(),
    };
    assert(typeof event.anomalyScore === "number", "anomalyScore should be a number");
    assert(event.anomalyScore === 3.5, "anomalyScore should be 3.5");
    assert(
      event.recommendation === "pass" || event.recommendation === "warn" || event.recommendation === "require_approval",
      "recommendation should be one of the expected string values"
    );
  });
}

export function testTemporalResetEventIncludesOldAndNewVectorClocks(): void {
  test("TemporalResetEvent includes old and new vector clocks", () => {
    const event = createTemporalResetEvent({
      reason: "manual",
      oldVectorClock: { "agent-1": 5, "agent-2": 3 },
      newVectorClock: { "agent-1": 0, "agent-2": 0 },
      resetAt: Date.now(),
    });
    assert(typeof event.oldVectorClock === "object", "oldVectorClock should be an object");
    assert(typeof event.newVectorClock === "object", "newVectorClock should be an object");
    assert(event.oldVectorClock["agent-1"] === 5, "oldVectorClock agent-1 should be 5");
    assert(event.newVectorClock["agent-1"] === 0, "newVectorClock agent-1 should be 0");
  });
}

export function testAllEventTypesSerializeToValidJSON(): void {
  test("All event types serialize to valid JSON", () => {
    const bridgeTs = makeBridgeTimestamp();

    const clockSync = createClockSyncEvent({
      bridgeTimeMs: Date.now(),
      source: "ntp",
      offsetMs: 5,
      syncedAt: Date.now(),
    });

    const temporalStamp: TemporalStampEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_TEMPORAL_STAMP",
      originalEventType: "STATE_DELTA",
      targetId: "elem-1",
      bridgeTimestamp: bridgeTs,
      causalPosition: 1,
      vectorClock: { "agent-1": 1 },
    };

    const rejection = createTemporalRejectionEvent({
      targetId: "elem-1",
      error: "Validation failed",
      violations: [],
      originalEventTimestamp: null,
      bridgeTimestamp: bridgeTs,
    });

    const causalViolation = createCausalViolationEvent({
      eventId: "e-1",
      agentId: "agent-1",
      expectedSequence: 1,
      receivedSequence: 3,
      missingDependencies: [],
      bufferStatus: "dropped",
    });

    const forecastEvt: TemporalForecastEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_TEMPORAL_FORECAST",
      targetId: "elem-1",
      horizonMs: 5000,
      predictions: [],
      confidence: 0.95,
      forecastedAt: Date.now(),
    };

    const anomalyEvt: TemporalAnomalyEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_TEMPORAL_ANOMALY",
      targetId: "elem-1",
      anomalyScore: 1.2,
      predicted: { x: 10 },
      actual: { x: 50 },
      recommendation: "warn",
      bridgeTimestamp: bridgeTs,
    };

    const resetEvt = createTemporalResetEvent({
      reason: "clock_resync",
      oldVectorClock: { "agent-1": 2 },
      newVectorClock: { "agent-1": 0 },
      resetAt: Date.now(),
    });

    const allEvents = [clockSync, temporalStamp, rejection, causalViolation, forecastEvt, anomalyEvt, resetEvt];

    for (const event of allEvents) {
      const serialized = JSON.stringify(event);
      assert(typeof serialized === "string", "JSON.stringify should produce a string");
      assert(serialized.length > 2, "Serialized event should not be empty");

      const parsed = JSON.parse(serialized);
      assert(parsed.type === "CUSTOM", "Parsed event type should be 'CUSTOM'");
      assert(typeof parsed.dynaep_type === "string", "Parsed dynaep_type should be a string");

      // Verify round-trip equality by comparing the re-serialized form
      const reSerialized = JSON.stringify(parsed);
      assert(
        reSerialized === serialized,
        `Round-trip serialization should produce identical output for ${parsed.dynaep_type}`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Run all AEP-NOSHIP/tests
// ---------------------------------------------------------------------------

testClockSyncEventHasCorrectDynaepType();
testTemporalStampEventIncludesBridgeTimestampAndVectorClock();
testTemporalRejectionEventIncludesViolationsArray();
testCausalViolationEventIncludesExpectedAndReceivedSequences();
testTemporalForecastEventIncludesPredictionsArray();
testTemporalAnomalyEventIncludesAnomalyScoreAndRecommendation();
testTemporalResetEventIncludesOldAndNewVectorClocks();
testAllEventTypesSerializeToValidJSON();

setTimeout(() => {
  console.log(`\nEvents tests complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 2000);
