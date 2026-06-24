// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/perception-events.test.ts
// ===========================================================================
// Tests for PerceptionEvents - dynAEP perceptual temporal governance
// ===========================================================================

import type { BridgeTimestamp } from "../../src/temporal/clock";
import type { PerceptionViolation, TemporalAnnotation } from "../../src/temporal/perception-registry";
import {
  type PerceptionViolationEvent,
  type GovernedEnvelopeEvent,
  type PerceptionProfileUpdateEvent,
  type PerceptionConfigChangeEvent,
  type PerceptionEvent,
  isPerceptionViolationEvent,
  isGovernedEnvelopeEvent,
  isPerceptionProfileUpdateEvent,
  isPerceptionConfigChangeEvent,
  createPerceptionViolationEvent,
  createGovernedEnvelopeEvent,
  createPerceptionProfileUpdateEvent,
  createPerceptionConfigChangeEvent,
  serializePerceptionEvent,
} from "../../src/temporal/perception-events";

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

export function testCreatePerceptionViolationEventSetsCorrectType(): void {
  test("createPerceptionViolationEvent sets type=CUSTOM and correct dynaep_type", () => {
    const event = createPerceptionViolationEvent({
      targetId: "elem-001",
      modality: "speech",
      violations: [],
      originalAnnotations: { syllable_rate: 10.0 },
      clampedAnnotations: { syllable_rate: 5.5 },
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    assert(event.type === "CUSTOM", "type should be CUSTOM");
    assert(event.dynaep_type === "AEP_PERCEPTION_VIOLATION", "dynaep_type should be AEP_PERCEPTION_VIOLATION");
    assert(event.targetId === "elem-001", "targetId should match");
    assert(event.modality === "speech", "modality should match");
  });
}

export function testCreateGovernedEnvelopeEventSetsCorrectType(): void {
  test("createGovernedEnvelopeEvent sets correct type discriminators", () => {
    const event = createGovernedEnvelopeEvent({
      targetId: "elem-002",
      modality: "haptic",
      originalAnnotations: {},
      governedAnnotations: {},
      adaptiveAnnotations: {},
      applied: "governed",
      violationCount: 2,
      profileUsed: null,
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    assert(event.type === "CUSTOM", "type should be CUSTOM");
    assert(event.dynaep_type === "AEP_GOVERNED_ENVELOPE", "dynaep_type should be AEP_GOVERNED_ENVELOPE");
    assert(event.applied === "governed", "applied should be 'governed'");
    assert(event.violationCount === 2, "violationCount should be 2");
  });
}

export function testCreateProfileUpdateEventSetsCorrectType(): void {
  test("createPerceptionProfileUpdateEvent sets correct type discriminators", () => {
    const event = createPerceptionProfileUpdateEvent({
      userId: "user-001",
      modality: "speech",
      interactionType: "slow_down_request",
      interactionCount: 15,
      confidenceScore: 0.72,
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    assert(event.type === "CUSTOM", "type should be CUSTOM");
    assert(event.dynaep_type === "AEP_PERCEPTION_PROFILE_UPDATE", "dynaep_type should be AEP_PERCEPTION_PROFILE_UPDATE");
    assert(event.userId === "user-001", "userId should match");
    assert(event.interactionCount === 15, "interactionCount should be 15");
  });
}

export function testCreateConfigChangeEventSetsCorrectType(): void {
  test("createPerceptionConfigChangeEvent sets correct type discriminators", () => {
    const event = createPerceptionConfigChangeEvent({
      changeType: "modality_override",
      affectedModalities: ["speech", "haptic"],
      affectedUserIds: [],
      description: "Loaded speech modality overrides from configuration",
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    assert(event.type === "CUSTOM", "type should be CUSTOM");
    assert(event.dynaep_type === "AEP_PERCEPTION_CONFIG_CHANGE", "dynaep_type should be AEP_PERCEPTION_CONFIG_CHANGE");
    assert(event.changeType === "modality_override", "changeType should match");
    assert(event.affectedModalities.length === 2, "Should have 2 affected modalities");
  });
}

export function testTypeGuardsIdentifyCorrectEventTypes(): void {
  test("Type guard functions correctly identify their respective event types", () => {
    const violationEvent = createPerceptionViolationEvent({
      targetId: "e1", modality: "speech", violations: [],
      originalAnnotations: {}, clampedAnnotations: {},
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    const envelopeEvent = createGovernedEnvelopeEvent({
      targetId: "e2", modality: "haptic",
      originalAnnotations: {}, governedAnnotations: {}, adaptiveAnnotations: {},
      applied: "original", violationCount: 0, profileUsed: null,
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    const profileEvent = createPerceptionProfileUpdateEvent({
      userId: "u1", modality: "speech", interactionType: "skip",
      interactionCount: 1, confidenceScore: 0.1,
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    const configEvent = createPerceptionConfigChangeEvent({
      changeType: "profile_reset", affectedModalities: [],
      affectedUserIds: ["u1"], description: "Reset profile",
      bridgeTimestamp: makeBridgeTimestamp(),
    });

    assert(isPerceptionViolationEvent(violationEvent) === true, "Should identify violation event");
    assert(isGovernedEnvelopeEvent(envelopeEvent) === true, "Should identify envelope event");
    assert(isPerceptionProfileUpdateEvent(profileEvent) === true, "Should identify profile event");
    assert(isPerceptionConfigChangeEvent(configEvent) === true, "Should identify config event");

    // Cross-check: guards should reject wrong types
    assert(isPerceptionViolationEvent(envelopeEvent) === false, "Violation guard should reject envelope event");
    assert(isGovernedEnvelopeEvent(violationEvent) === false, "Envelope guard should reject violation event");
    assert(isPerceptionProfileUpdateEvent(configEvent) === false, "Profile guard should reject config event");
    assert(isPerceptionConfigChangeEvent(profileEvent) === false, "Config guard should reject profile event");
  });
}

export function testTypeGuardsRejectNonObjects(): void {
  test("Type guards reject null, undefined and non-object values", () => {
    assert(isPerceptionViolationEvent(null) === false, "Should reject null");
    assert(isPerceptionViolationEvent(undefined) === false, "Should reject undefined");
    assert(isPerceptionViolationEvent("not an object") === false, "Should reject string");
    assert(isPerceptionViolationEvent(42) === false, "Should reject number");
    assert(isGovernedEnvelopeEvent({}) === false, "Should reject empty object");
  });
}

export function testSerializationProducesDeterministicOutput(): void {
  test("serializePerceptionEvent produces deterministic JSON with sorted keys", () => {
    const event = createPerceptionViolationEvent({
      targetId: "elem-001",
      modality: "speech",
      violations: [
        { parameter: "syllable_rate", value: 10, bound_min: 1, bound_max: 8,
          comfortable_min: 3, comfortable_max: 5.5, severity: "hard",
          message: "Exceeds hard limit" },
      ],
      originalAnnotations: { syllable_rate: 10.0, turn_gap_ms: 400 },
      clampedAnnotations: { syllable_rate: 5.5, turn_gap_ms: 400 },
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    const json1 = serializePerceptionEvent(event);
    const json2 = serializePerceptionEvent(event);
    assert(json1 === json2, "Serialization should be deterministic");
    // Verify it is valid JSON
    const parsed = JSON.parse(json1);
    assert(parsed.type === "CUSTOM", "Parsed type should be CUSTOM");
    assert(parsed.dynaep_type === "AEP_PERCEPTION_VIOLATION", "Parsed dynaep_type should match");
  });
}

export function testSerializationKeyOrderIsSorted(): void {
  test("Serialized events have alphabetically sorted keys at every level", () => {
    const event = createGovernedEnvelopeEvent({
      targetId: "z-target",
      modality: "a-modality",
      originalAnnotations: { z_param: 1, a_param: 2 },
      governedAnnotations: { z_param: 1, a_param: 2 },
      adaptiveAnnotations: { z_param: 1, a_param: 2 },
      applied: "original",
      violationCount: 0,
      profileUsed: null,
      bridgeTimestamp: makeBridgeTimestamp(),
    });
    const json = serializePerceptionEvent(event);
    const parsed = JSON.parse(json);
    const topKeys = Object.keys(parsed);
    const sortedKeys = [...topKeys].sort();
    for (let i = 0; i < topKeys.length; i++) {
      assert(topKeys[i] === sortedKeys[i],
        "Key at position " + i + " should be '" + sortedKeys[i] + "' but was '" + topKeys[i] + "'");
    }
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("perception-events.test.ts");

testCreatePerceptionViolationEventSetsCorrectType();
testCreateGovernedEnvelopeEventSetsCorrectType();
testCreateProfileUpdateEventSetsCorrectType();
testCreateConfigChangeEventSetsCorrectType();
testTypeGuardsIdentifyCorrectEventTypes();
testTypeGuardsRejectNonObjects();
testSerializationProducesDeterministicOutput();
testSerializationKeyOrderIsSorted();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
