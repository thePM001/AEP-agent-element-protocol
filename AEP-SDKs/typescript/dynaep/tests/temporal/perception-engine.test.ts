// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/perception-engine.test.ts
// ===========================================================================
// Tests for PerceptionEngine - dynAEP perceptual temporal governance
// ===========================================================================

import { PerceptionRegistry } from "../../src/temporal/perception-registry";
import { BridgeClock, type ClockConfig } from "../../src/temporal/clock";
import { DynAEPTemporalAuthority, type TemporalAuthorityConfig } from "../../src/temporal/authority";
import {
  PerceptionEngine,
  type PerceptionEngineConfig,
  type TemporalOutputEvent,
  type GovernedEnvelope,
} from "../../src/temporal/perception-engine";
import type { UserTemporalInteraction } from "../../src/temporal/perception-profile";

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

function makeAuthorityConfig(): TemporalAuthorityConfig {
  return {
    auditTrailDepth: 500,
    mutationTrackingEnabled: true,
    stalenessBroadcastIntervalMs: 10000,
  };
}

function makeEngineConfig(overrides?: Partial<PerceptionEngineConfig>): PerceptionEngineConfig {
  return {
    enableAdaptiveProfiles: true,
    profileLearningRate: 0.15,
    profileErosionHalfLifeMs: 604800000,
    minInteractionsForProfile: 5,
    hardViolationAction: "clamp",
    softViolationAction: "clamp",
    governedEnvelopeMode: "overwrite",
    ...overrides,
  };
}

function makeEngine(configOverrides?: Partial<PerceptionEngineConfig>): PerceptionEngine {
  const registry = new PerceptionRegistry();
  const clock = new BridgeClock(makeClockConfig());
  const authority = new DynAEPTemporalAuthority(clock, makeAuthorityConfig());
  return new PerceptionEngine(registry, authority, null, makeEngineConfig(configOverrides));
}

function makeSpeechEvent(annotations: Record<string, number | string | boolean>, userId?: string): TemporalOutputEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_SPEECH_OUTPUT",
    targetId: "elem-001",
    modality: "speech",
    temporalAnnotations: annotations,
    userId: userId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testGovernReturnsOriginalForCleanAnnotations(): void {
  test("govern returns 'original' for annotations within comfortable range", () => {
    const engine = makeEngine();
    const event = makeSpeechEvent({ syllable_rate: 4.0, turn_gap_ms: 400 });
    const envelope = engine.govern(event);
    assert(envelope.applied === "original", "Should apply 'original' for clean annotations");
    assert(envelope.violations.length === 0, "Should have zero violations");
    assert(envelope.profileUsed === null, "No profile should be used");
  });
}

export function testGovernReturnsGovernedForViolation(): void {
  test("govern returns 'governed' when annotations violate perception bounds", () => {
    const engine = makeEngine();
    const event = makeSpeechEvent({ syllable_rate: 10.0 });
    const envelope = engine.govern(event);
    assert(envelope.applied === "governed", "Should apply 'governed' for violated annotations");
    assert(envelope.violations.length > 0, "Should report violations");
    const clampedRate = envelope.governedAnnotations["syllable_rate"] as number;
    assert(clampedRate < 10.0, "Clamped rate should be less than the violated 10.0");
  });
}

export function testGovernPreservesOriginalAnnotations(): void {
  test("govern preserves original annotations unchanged in the envelope", () => {
    const engine = makeEngine();
    const event = makeSpeechEvent({ syllable_rate: 10.0, turn_gap_ms: 50 });
    const envelope = engine.govern(event);
    assert(envelope.originalAnnotations["syllable_rate"] === 10.0,
      "Original syllable_rate should be preserved as 10.0");
    assert(envelope.originalAnnotations["turn_gap_ms"] === 50,
      "Original turn_gap_ms should be preserved as 50");
  });
}

export function testGovernAppliesAdaptiveProfileWhenEligible(): void {
  test("govern applies adaptive profile when user has sufficient interactions", () => {
    const engine = makeEngine({ minInteractionsForProfile: 2 });
    // Ingest enough interactions to build a profile
    for (let i = 0; i < 5; i++) {
      engine.ingestInteraction("user-001", {
        userId: "user-001",
        modality: "speech",
        timestamp: Date.now() + i,
        interactionType: "slow_down_request",
        contextParameters: { syllable_rate: 5.0 },
        responseLatencyMs: null,
      });
    }
    const event = makeSpeechEvent({ syllable_rate: 5.0 }, "user-001");
    const envelope = engine.govern(event);
    // With adaptive profiles enabled and user having 5 interactions (>= 2 threshold)
    // and syllable_rate 5.0 is within comfortable range but profile may push it
    assert(envelope.profileUsed === "user-001", "Should use user profile");
    assert(envelope.applied === "adaptive", "Should apply 'adaptive' when profile is used");
  });
}

export function testGovernSkipsAdaptiveWhenDisabled(): void {
  test("govern skips adaptive profiles when enableAdaptiveProfiles is false", () => {
    const engine = makeEngine({ enableAdaptiveProfiles: false, minInteractionsForProfile: 1 });
    engine.ingestInteraction("user-001", {
      userId: "user-001",
      modality: "speech",
      timestamp: Date.now(),
      interactionType: "slow_down_request",
      contextParameters: {},
      responseLatencyMs: null,
    });
    const event = makeSpeechEvent({ syllable_rate: 5.0 }, "user-001");
    const envelope = engine.govern(event);
    assert(envelope.profileUsed === null, "Profile should not be used when disabled");
    assert(envelope.applied !== "adaptive", "Should not apply 'adaptive' when disabled");
  });
}

export function testGovernSkipsAdaptiveWhenNoUserId(): void {
  test("govern skips adaptive profiles when userId is null", () => {
    const engine = makeEngine({ minInteractionsForProfile: 1 });
    const event = makeSpeechEvent({ syllable_rate: 5.0 });
    const envelope = engine.govern(event);
    assert(envelope.profileUsed === null, "Profile should not be used when userId is null");
  });
}

export function testGovernSkipsAdaptiveWhenInsufficientInteractions(): void {
  test("govern skips adaptive when user has fewer interactions than threshold", () => {
    const engine = makeEngine({ minInteractionsForProfile: 100 });
    engine.ingestInteraction("user-001", {
      userId: "user-001",
      modality: "speech",
      timestamp: Date.now(),
      interactionType: "slow_down_request",
      contextParameters: {},
      responseLatencyMs: null,
    });
    const event = makeSpeechEvent({ syllable_rate: 5.0 }, "user-001");
    const envelope = engine.govern(event);
    assert(envelope.profileUsed === null, "Profile should not be used with insufficient interactions");
  });
}

export function testSoftViolationLogOnlyKeepsOriginalValues(): void {
  test("govern with softViolationAction=log_only keeps original values for soft violations", () => {
    const engine = makeEngine({ softViolationAction: "log_only" });
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech")!;
    const syllableBound = profile.bounds["syllable_rate"];
    // Value between comfortable_max and hard max = soft violation
    const softViolationValue = (syllableBound.comfortable_max + syllableBound.max) / 2;
    const event = makeSpeechEvent({ syllable_rate: softViolationValue });
    const envelope = engine.govern(event);
    // In log_only mode, soft violations should keep original value
    const governedValue = envelope.governedAnnotations["syllable_rate"] as number;
    assert(governedValue === softViolationValue,
      "log_only should preserve original value for soft violations");
  });
}

export function testValidateStaticDelegates(): void {
  test("validateStatic delegates to the registry correctly", () => {
    const engine = makeEngine();
    const result = engine.validateStatic("speech", { syllable_rate: 10.0 });
    assert(result.valid === false, "Should detect violation");
    assert(result.violations.length > 0, "Should have violations");
  });
}

export function testGetProfileReturnsNullForUnknownUser(): void {
  test("getProfile returns null for user with no profile", () => {
    const engine = makeEngine();
    const profile = engine.getProfile("nonexistent");
    assert(profile === null, "Should return null for unknown user");
  });
}

export function testResetProfileRemovesUserData(): void {
  test("resetProfile removes user profile data", () => {
    const engine = makeEngine();
    engine.ingestInteraction("user-001", {
      userId: "user-001",
      modality: "speech",
      timestamp: Date.now(),
      interactionType: "slow_down_request",
      contextParameters: {},
      responseLatencyMs: null,
    });
    assert(engine.getProfile("user-001") !== null, "Profile should exist before reset");
    engine.resetProfile("user-001");
    assert(engine.getProfile("user-001") === null, "Profile should be null after reset");
  });
}

export function testListProfilesReturnsAllActive(): void {
  test("listProfiles returns all user IDs with active profiles", () => {
    const engine = makeEngine();
    engine.ingestInteraction("alice", {
      userId: "alice",
      modality: "speech",
      timestamp: Date.now(),
      interactionType: "completion",
      contextParameters: {},
      responseLatencyMs: null,
    });
    engine.ingestInteraction("bob", {
      userId: "bob",
      modality: "haptic",
      timestamp: Date.now(),
      interactionType: "skip",
      contextParameters: {},
      responseLatencyMs: null,
    });
    const profiles = engine.listProfiles();
    assert(profiles.length === 2, "Should have 2 profiles");
    assert(profiles.includes("alice"), "Should include alice");
    assert(profiles.includes("bob"), "Should include bob");
  });
}

export function testGovernHapticModality(): void {
  test("govern works correctly for haptic modality", () => {
    const engine = makeEngine();
    const event: TemporalOutputEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_HAPTIC_OUTPUT",
      targetId: "elem-002",
      modality: "haptic",
      temporalAnnotations: { tap_duration_ms: 5 },  // Below hard min
      userId: null,
    };
    const envelope = engine.govern(event);
    assert(envelope.applied === "governed", "Should govern violated haptic annotation");
    assert(envelope.violations.length > 0, "Should report haptic violation");
  });
}

export function testGovernNotificationModality(): void {
  test("govern works correctly for notification modality", () => {
    const engine = makeEngine();
    const event: TemporalOutputEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_NOTIFICATION_OUTPUT",
      targetId: "elem-003",
      modality: "notification",
      temporalAnnotations: { min_interval_ms: 200 },  // Spam territory
      userId: null,
    };
    const envelope = engine.govern(event);
    assert(envelope.violations.length > 0, "Should detect notification spam violation");
  });
}

export function testAdaptiveNeverExceedsHardBounds(): void {
  test("Adaptive profiles NEVER push annotations beyond hard bounds", () => {
    const engine = makeEngine({ minInteractionsForProfile: 1 });
    const registry = new PerceptionRegistry();
    const speechProfile = registry.getModality("speech")!;
    const syllableBound = speechProfile.bounds["syllable_rate"];

    // Ingest many speed_up requests to push offset strongly positive
    for (let i = 0; i < 50; i++) {
      engine.ingestInteraction("aggressive-user", {
        userId: "aggressive-user",
        modality: "speech",
        timestamp: Date.now() + i,
        interactionType: "speed_up_request",
        contextParameters: {},
        responseLatencyMs: null,
      });
    }

    // Try to govern with a value already at comfortable_max
    const event = makeSpeechEvent(
      { syllable_rate: syllableBound.comfortable_max },
      "aggressive-user",
    );
    const envelope = engine.govern(event);
    const adaptiveValue = envelope.adaptiveAnnotations["syllable_rate"] as number;
    assert(adaptiveValue <= syllableBound.comfortable_max,
      "Adaptive value must not exceed comfortable_max");
    assert(adaptiveValue >= syllableBound.comfortable_min,
      "Adaptive value must not go below comfortable_min");
  });
}

export function testGetProfileManagerReturnsInstance(): void {
  test("getProfileManager returns the underlying AdaptiveProfileManager", () => {
    const engine = makeEngine();
    const pm = engine.getProfileManager();
    assert(pm !== null && pm !== undefined, "Should return a profile manager instance");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("perception-engine.test.ts");

testGovernReturnsOriginalForCleanAnnotations();
testGovernReturnsGovernedForViolation();
testGovernPreservesOriginalAnnotations();
testGovernAppliesAdaptiveProfileWhenEligible();
testGovernSkipsAdaptiveWhenDisabled();
testGovernSkipsAdaptiveWhenNoUserId();
testGovernSkipsAdaptiveWhenInsufficientInteractions();
testSoftViolationLogOnlyKeepsOriginalValues();
testValidateStaticDelegates();
testGetProfileReturnsNullForUnknownUser();
testResetProfileRemovesUserData();
testListProfilesReturnsAllActive();
testGovernHapticModality();
testGovernNotificationModality();
testAdaptiveNeverExceedsHardBounds();
testGetProfileManagerReturnsInstance();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
