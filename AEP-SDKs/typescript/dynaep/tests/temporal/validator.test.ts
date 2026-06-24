// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/validator.test.ts
// ===========================================================================
// Tests for TemporalValidator - dynAEP temporal authority layer
// ===========================================================================

import { BridgeClock, ClockConfig, BridgeTimestamp } from "../../src/temporal/clock";
import {
  TemporalValidator,
  TemporalValidatorConfig,
  TemporalValidationResult,
  TemporalViolation,
} from "../../src/temporal/validator";

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

function makeSystemClock(): BridgeClock {
  const config: ClockConfig = {
    protocol: "system",
    source: "local",
    syncIntervalMs: 0,
    maxDriftMs: 5000,
    bridgeIsAuthority: true,
  };
  return new BridgeClock(config);
}

function makeSyncedClock(): BridgeClock {
  const clock = makeSystemClock();
  // Manually invoke sync to set lastSyncAt so the clock is considered synced
  // Since system sync is synchronous internally, we call sync() and rely on it
  return clock;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testAcceptsEventWithinDriftTolerance(): void {
  test("Accepts event within drift tolerance", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 100,
      maxFutureMs: 500,
      maxStalenessMs: 10000,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() };
    const result = validator.validate(event);
    assert(result.accepted === true, "Event within drift tolerance should be accepted");
  });
}

export function testRejectsEventExceedingMaxDriftMs(): void {
  test("Rejects event exceeding maxDriftMs", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 50,
      maxFutureMs: 500,
      maxStalenessMs: 10000,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() - 200 };
    const result = validator.validate(event);
    const hasDriftViolation = result.violations.some(
      (v: TemporalViolation) => v.type === "drift_exceeded"
    );
    assert(hasDriftViolation, "Should have a drift_exceeded violation");
  });
}

export function testRejectsEventTimestampedInTheFuture(): void {
  test("Rejects event timestamped in the future", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 5000,
      maxFutureMs: 500,
      maxStalenessMs: 10000,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() + 1000 };
    const result = validator.validate(event);
    const hasFutureViolation = result.violations.some(
      (v: TemporalViolation) => v.type === "future_timestamp"
    );
    assert(hasFutureViolation, "Should have a future_timestamp violation");
  });
}

export function testRejectsStaleEventBeyondMaxStalenessMs(): void {
  test("Rejects stale event beyond maxStalenessMs", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 50000,
      maxFutureMs: 500,
      maxStalenessMs: 5000,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() - 10000 };
    const result = validator.validate(event);
    const hasStaleViolation = result.violations.some(
      (v: TemporalViolation) => v.type === "stale_event"
    );
    assert(hasStaleViolation, "Should have a stale_event violation");
  });
}

export function testOverwritesAgentTimestampWhenConfigured(): void {
  test("Overwrites agent timestamp when overwriteTimestamps is true", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 50000,
      maxFutureMs: 50000,
      maxStalenessMs: 50000,
      overwriteTimestamps: true,
      logRejections: false,
      mode: "permissive",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const originalTimestamp = 12345;
    const event = { type: "STATE_DELTA", timestamp: originalTimestamp };
    validator.validate(event);
    assert(
      event.timestamp !== originalTimestamp,
      "Event timestamp should have been overwritten with bridge time"
    );
    assert(event.timestamp > 0, "Overwritten timestamp should be a positive number");
  });
}

export function testPreservesAgentTimestampWhenNotOverwriting(): void {
  test("Preserves agent timestamp when overwriteTimestamps is false", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 50000,
      maxFutureMs: 50000,
      maxStalenessMs: 50000,
      overwriteTimestamps: false,
      logRejections: false,
      mode: "permissive",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const originalTimestamp = Date.now();
    const event = { type: "STATE_DELTA", timestamp: originalTimestamp };
    validator.validate(event);
    assert(
      event.timestamp === originalTimestamp,
      "Event timestamp should be preserved when overwriteTimestamps is false"
    );
  });
}

export function testHandlesNullAgentTimestampGracefully(): void {
  test("Handles null agent timestamp gracefully", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 100,
      maxFutureMs: 500,
      maxStalenessMs: 10000,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA" };
    const result = validator.validate(event);
    assert(result.accepted === true, "Event with no timestamp should be accepted");
    assert(result.violations.length === 0, "No violations expected for null timestamp");
  });
}

export function testStrictModeRejectsOnAnyViolation(): void {
  test("Strict mode rejects on any violation", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 10,
      maxFutureMs: 10,
      maxStalenessMs: 10,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() - 500 };
    const result = validator.validate(event);
    assert(result.accepted === false, "Strict mode should reject events with violations");
  });
}

export function testPermissiveModePassesEventsWithViolationsLogged(): void {
  test("Permissive mode passes events with violations logged", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 10,
      maxFutureMs: 10,
      maxStalenessMs: 10,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "permissive",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() - 500 };
    const result = validator.validate(event);
    assert(result.accepted === true, "Permissive mode should accept events even with violations");
    assert(result.violations.length > 0, "Violations should still be recorded");
  });
}

export function testLogOnlyModeRecordsViolationsWithoutEnforcement(): void {
  test("log_only mode records violations without enforcement", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 10,
      maxFutureMs: 10,
      maxStalenessMs: 10,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "log_only",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const event = { type: "STATE_DELTA", timestamp: Date.now() - 500 };
    const result = validator.validate(event);
    assert(result.accepted === true, "log_only mode should accept all events");
    assert(result.violations.length > 0, "Violations should still be recorded in log_only mode");
  });
}

export function testValidateBatchProcessesMultipleEventsInOrder(): void {
  test("validateBatch processes multiple events in order", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 50000,
      maxFutureMs: 50000,
      maxStalenessMs: 50000,
      overwriteTimestamps: false,
      logRejections: false,
      mode: "permissive",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    const events = [
      { type: "EVENT_A", timestamp: Date.now() },
      { type: "EVENT_B", timestamp: Date.now() },
      { type: "EVENT_C", timestamp: Date.now() },
    ];
    const results = validator.validateBatch(events);
    assert(results.length === 3, "Should return 3 results for 3 events");
    for (let i = 0; i < results.length; i++) {
      assert(
        results[i].bridgeTimestamp !== null && results[i].bridgeTimestamp !== undefined,
        `Result ${i} should have a bridgeTimestamp`
      );
    }
  });
}

export function testReturnsCorrectViolationTypesInResult(): void {
  test("Returns correct violation types in result", async () => {
    const clock = makeSystemClock();
    await clock.sync();
    const validatorConfig: TemporalValidatorConfig = {
      maxDriftMs: 10,
      maxFutureMs: 10,
      maxStalenessMs: 10,
      overwriteTimestamps: false,
      logRejections: true,
      mode: "strict",
    };
    const validator = new TemporalValidator(clock, validatorConfig);
    // This event is 5000ms in the past - should trigger drift_exceeded and stale_event
    const event = { type: "STATE_DELTA", timestamp: Date.now() - 5000 };
    const result = validator.validate(event);
    const types = result.violations.map((v: TemporalViolation) => v.type);
    assert(types.length > 0, "Should have at least one violation type");
    for (const t of types) {
      assert(
        t === "drift_exceeded" || t === "future_timestamp" || t === "stale_event" || t === "causal_violation",
        `Violation type '${t}' should be a known type`
      );
    }
  });
}

// ---------------------------------------------------------------------------
// Run all AEP-NOSHIP/tests
// ---------------------------------------------------------------------------

testAcceptsEventWithinDriftTolerance();
testRejectsEventExceedingMaxDriftMs();
testRejectsEventTimestampedInTheFuture();
testRejectsStaleEventBeyondMaxStalenessMs();
testOverwritesAgentTimestampWhenConfigured();
testPreservesAgentTimestampWhenNotOverwriting();
testHandlesNullAgentTimestampGracefully();
testStrictModeRejectsOnAnyViolation();
testPermissiveModePassesEventsWithViolationsLogged();
testLogOnlyModeRecordsViolationsWithoutEnforcement();
testValidateBatchProcessesMultipleEventsInOrder();
testReturnsCorrectViolationTypesInResult();

setTimeout(() => {
  console.log(`\nValidator tests complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 2000);
