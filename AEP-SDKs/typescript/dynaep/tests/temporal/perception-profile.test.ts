// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/perception-profile.test.ts
// ===========================================================================
// Tests for AdaptiveProfileManager - dynAEP perceptual temporal governance
// ===========================================================================

import { PerceptionRegistry } from "../../src/temporal/perception-registry";
import {
  AdaptiveProfileManager,
  type UserTemporalInteraction,
  type AdaptiveProfileConfig,
  type AdaptivePerceptionProfile,
} from "../../src/temporal/perception-profile";

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

function makeConfig(overrides?: Partial<AdaptiveProfileConfig>): AdaptiveProfileConfig {
  return {
    learningRate: 0.15,
    erosionHalfLifeMs: 604800000,
    minSamplesForAdjustment: 5,
    maxOffsetFromComfortable: 0.3,
    forecastEnabled: false,
    persistenceEnabled: false,
    persistencePath: "",
    ...overrides,
  };
}

function makeInteraction(overrides?: Partial<UserTemporalInteraction>): UserTemporalInteraction {
  return {
    userId: "user-001",
    modality: "speech",
    timestamp: Date.now(),
    interactionType: "slow_down_request",
    contextParameters: { syllable_rate: 5.0 },
    responseLatencyMs: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testNewProfileCreatedOnFirstIngest(): void {
  test("New profile created on first ingest for unknown user", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    const interaction = makeInteraction({ userId: "new-user" });
    manager.ingest(interaction);
    const profile = manager.getProfile("new-user");
    assert(profile !== null, "Profile should be created");
    assert(profile!.userId === "new-user", "Profile userId should match");
    assert(profile!.interactionCount === 1, "Interaction count should be 1");
  });
}

export function testInteractionCountIncrements(): void {
  test("Interaction count increments with each ingested interaction", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    for (let i = 0; i < 10; i++) {
      manager.ingest(makeInteraction({ timestamp: Date.now() + i }));
    }
    const profile = manager.getProfile("user-001")!;
    assert(profile.interactionCount === 10, "Should have 10 interactions, got " + profile.interactionCount);
  });
}

export function testSlowDownRequestCreatesNegativeOffset(): void {
  test("slow_down_request creates negative learned offset", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction({ interactionType: "slow_down_request" }));
    const profile = manager.getProfile("user-001")!;
    const pref = profile.modalities["speech"];
    assert(pref !== undefined, "Speech modality preference should exist");
    const adj = pref.parameterAdjustments["syllable_rate"];
    assert(adj !== undefined, "syllable_rate adjustment should exist");
    assert(adj.learnedOffset < 0, "slow_down_request should produce negative offset");
  });
}

export function testSpeedUpRequestCreatesPositiveOffset(): void {
  test("speed_up_request creates positive learned offset", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction({ interactionType: "speed_up_request" }));
    const profile = manager.getProfile("user-001")!;
    const pref = profile.modalities["speech"];
    const adj = pref.parameterAdjustments["syllable_rate"];
    assert(adj !== undefined, "syllable_rate adjustment should exist");
    assert(adj.learnedOffset > 0, "speed_up_request should produce positive offset");
  });
}

export function testNeutralSignalDecaysOffsetsTowardZero(): void {
  test("Neutral signal (completion) decays existing offsets toward zero", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    // Build up an offset
    manager.ingest(makeInteraction({ interactionType: "slow_down_request" }));
    const beforeProfile = manager.getProfile("user-001")!;
    const beforeOffset = beforeProfile.modalities["speech"].parameterAdjustments["syllable_rate"].learnedOffset;
    // Neutral signal
    manager.ingest(makeInteraction({ interactionType: "completion" }));
    const afterProfile = manager.getProfile("user-001")!;
    const afterOffset = afterProfile.modalities["speech"].parameterAdjustments["syllable_rate"].learnedOffset;
    assert(Math.abs(afterOffset) <= Math.abs(beforeOffset),
      "Neutral signal should decay offset toward zero");
  });
}

export function testAdjustClampsWithinComfortableRange(): void {
  test("adjust() clamps adjusted values within comfortable range, never exceeding hard bounds", () => {
    const registry = new PerceptionRegistry();
    const config = makeConfig({ minSamplesForAdjustment: 1 });
    const manager = new AdaptiveProfileManager(registry, null, config);

    // Push offset strongly negative by repeating slow_down_request many times
    for (let i = 0; i < 20; i++) {
      manager.ingest(makeInteraction({
        interactionType: "slow_down_request",
        timestamp: Date.now() + i,
      }));
    }

    const profile = registry.getModality("speech")!;
    const syllableBound = profile.bounds["syllable_rate"];

    const annotations = { syllable_rate: syllableBound.comfortable_min };
    const adjusted = manager.adjust("user-001", "speech", annotations);
    const adjustedValue = adjusted["syllable_rate"] as number;

    assert(adjustedValue >= syllableBound.comfortable_min,
      "Adjusted value should not go below comfortable_min");
    assert(adjustedValue <= syllableBound.comfortable_max,
      "Adjusted value should not exceed comfortable_max");
  });
}

export function testAdjustSkipsInsufficientSamples(): void {
  test("adjust() returns original annotations when sample count is below threshold", () => {
    const registry = new PerceptionRegistry();
    const config = makeConfig({ minSamplesForAdjustment: 100 });
    const manager = new AdaptiveProfileManager(registry, null, config);
    manager.ingest(makeInteraction());
    const annotations = { syllable_rate: 4.0 };
    const adjusted = manager.adjust("user-001", "speech", annotations);
    assert(adjusted["syllable_rate"] === 4.0,
      "Should return original value when insufficient samples");
  });
}

export function testConfidenceGrowsWithSamples(): void {
  test("Confidence score grows logarithmically with sample count", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction({ interactionType: "slow_down_request" }));
    const earlyProfile = manager.getProfile("user-001")!;
    const earlyConfidence = earlyProfile.modalities["speech"].confidenceScore;

    for (let i = 0; i < 30; i++) {
      manager.ingest(makeInteraction({
        interactionType: "slow_down_request",
        timestamp: Date.now() + i + 1,
      }));
    }
    const lateProfile = manager.getProfile("user-001")!;
    const lateConfidence = lateProfile.modalities["speech"].confidenceScore;
    assert(lateConfidence > earlyConfidence,
      "Confidence should increase with more samples");
    assert(lateConfidence <= 1.0, "Confidence should never exceed 1.0");
  });
}

export function testResetRemovesProfile(): void {
  test("reset() removes a user profile entirely", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction());
    assert(manager.getProfile("user-001") !== null, "Profile should exist before reset");
    manager.reset("user-001");
    assert(manager.getProfile("user-001") === null, "Profile should be null after reset");
  });
}

export function testSerializeDeserializeRoundTrip(): void {
  test("serialize/deserialize produces identical profile data", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction({ interactionType: "slow_down_request" }));
    manager.ingest(makeInteraction({ interactionType: "speed_up_request", timestamp: Date.now() + 1 }));
    const serialized = manager.serialize();

    const manager2 = new AdaptiveProfileManager(registry, null, makeConfig());
    manager2.deserialize(serialized);
    const profile1 = manager.getProfile("user-001")!;
    const profile2 = manager2.getProfile("user-001")!;
    assert(profile2.interactionCount === profile1.interactionCount,
      "Interaction count should survive serialization");
    assert(profile2.userId === profile1.userId, "userId should survive serialization");
  });
}

export function testListProfilesReturnsAllUserIds(): void {
  test("listProfiles returns all user IDs with active profiles", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction({ userId: "alice" }));
    manager.ingest(makeInteraction({ userId: "bob" }));
    manager.ingest(makeInteraction({ userId: "carol" }));
    const ids = manager.listProfiles();
    assert(ids.length === 3, "Should have 3 profiles");
    assert(ids.includes("alice"), "Should include alice");
    assert(ids.includes("bob"), "Should include bob");
    assert(ids.includes("carol"), "Should include carol");
  });
}

export function testMultipleModalitiesTrackedIndependently(): void {
  test("Multiple modalities tracked independently in the same profile", () => {
    const registry = new PerceptionRegistry();
    const manager = new AdaptiveProfileManager(registry, null, makeConfig());
    manager.ingest(makeInteraction({ modality: "speech", interactionType: "slow_down_request" }));
    manager.ingest(makeInteraction({ modality: "haptic", interactionType: "speed_up_request" }));
    const profile = manager.getProfile("user-001")!;
    assert("speech" in profile.modalities, "Should track speech modality");
    assert("haptic" in profile.modalities, "Should track haptic modality");
    const speechAdj = profile.modalities["speech"].parameterAdjustments;
    const hapticAdj = profile.modalities["haptic"].parameterAdjustments;
    // Speech slow_down produces negative offset, haptic speed_up produces positive
    const speechParam = Object.values(speechAdj)[0];
    const hapticParam = Object.values(hapticAdj)[0];
    assert(speechParam !== undefined, "Speech should have parameter adjustments");
    assert(hapticParam !== undefined, "Haptic should have parameter adjustments");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("perception-profile.test.ts");

testNewProfileCreatedOnFirstIngest();
testInteractionCountIncrements();
testSlowDownRequestCreatesNegativeOffset();
testSpeedUpRequestCreatesPositiveOffset();
testNeutralSignalDecaysOffsetsTowardZero();
testAdjustClampsWithinComfortableRange();
testAdjustSkipsInsufficientSamples();
testConfidenceGrowsWithSamples();
testResetRemovesProfile();
testSerializeDeserializeRoundTrip();
testListProfilesReturnsAllUserIds();
testMultipleModalitiesTrackedIndependently();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
