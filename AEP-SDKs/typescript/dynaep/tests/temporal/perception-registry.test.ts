// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/perception-registry.test.ts
// ===========================================================================
// Tests for PerceptionRegistry - dynAEP perceptual temporal governance
// ===========================================================================

import {
  PerceptionRegistry,
  type PerceptionBounds,
  type PerceptionValidationResult,
  type PerceptionViolation,
  type ModalityProfile,
  type TemporalAnnotation,
} from "../../src/temporal/perception-registry";

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

export function testRegistryListsAllFiveModalities(): void {
  test("Registry lists all five modalities", () => {
    const registry = new PerceptionRegistry();
    const modalities = registry.listModalities();
    assert(modalities.length === 5, "Should have 5 modalities, got " + modalities.length);
    assert(modalities.includes("speech"), "Should include speech");
    assert(modalities.includes("haptic"), "Should include haptic");
    assert(modalities.includes("notification"), "Should include notification");
    assert(modalities.includes("sensor"), "Should include sensor");
    assert(modalities.includes("audio"), "Should include audio");
  });
}

export function testGetModalityReturnsSpeechProfile(): void {
  test("getModality returns speech profile with correct bounds", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech");
    assert(profile !== null, "Speech profile should exist");
    assert(profile!.modality === "speech", "Profile modality should be 'speech'");
    assert("syllable_rate" in profile!.bounds, "Should have syllable_rate bound");
    assert("turn_gap_ms" in profile!.bounds, "Should have turn_gap_ms bound");
    assert("clause_pause_ms" in profile!.bounds, "Should have clause_pause_ms bound");
  });
}

export function testGetModalityReturnsNullForUnknown(): void {
  test("getModality returns null for unknown modality", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("taste");
    assert(profile === null, "Unknown modality should return null");
  });
}

export function testSpeechBoundsHaveCorrectStructure(): void {
  test("Speech bounds have correct structure with min/max/comfortable range", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech")!;
    const syllableRate = profile.bounds["syllable_rate"];
    assert(syllableRate !== undefined, "syllable_rate bound should exist");
    assert(syllableRate.min < syllableRate.comfortable_min, "min should be less than comfortable_min");
    assert(syllableRate.comfortable_min <= syllableRate.comfortable_max, "comfortable_min should be <= comfortable_max");
    assert(syllableRate.comfortable_max < syllableRate.max, "comfortable_max should be less than max");
    assert(syllableRate.unit === "per_second", "syllable_rate unit should be 'per_second'");
    assert(syllableRate.source.length > 0, "Source citation should be non-empty");
  });
}

export function testValidateCleanAnnotationsReturnsNoViolations(): void {
  test("validate returns no violations for annotations within comfortable range", () => {
    const registry = new PerceptionRegistry();
    const annotations: TemporalAnnotation = {
      syllable_rate: 4.0,
      turn_gap_ms: 400,
      clause_pause_ms: 300,
    };
    const result = registry.validate("speech", annotations);
    assert(result.valid === true, "Should be valid");
    assert(result.violations.length === 0, "Should have no violations");
  });
}

export function testValidateDetectsHardViolation(): void {
  test("validate detects hard violation for syllable_rate exceeding hard max", () => {
    const registry = new PerceptionRegistry();
    const annotations: TemporalAnnotation = {
      syllable_rate: 10.0,
    };
    const result = registry.validate("speech", annotations);
    assert(result.valid === false, "Should be invalid");
    assert(result.violations.length > 0, "Should have violations");
    const violation = result.violations.find(v => v.parameter === "syllable_rate");
    assert(violation !== undefined, "Should have syllable_rate violation");
    assert(violation!.severity === "hard", "Syllable rate 10.0 should be a hard violation");
  });
}

export function testValidateDetectsSoftViolation(): void {
  test("validate detects soft violation for annotations outside comfortable but within hard limits", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech")!;
    const syllableBound = profile.bounds["syllable_rate"];
    // Pick a value between comfortable_max and hard max
    const softViolationValue = (syllableBound.comfortable_max + syllableBound.max) / 2;
    const annotations: TemporalAnnotation = {
      syllable_rate: softViolationValue,
    };
    const result = registry.validate("speech", annotations);
    assert(result.violations.length > 0, "Should have at least one violation");
    const violation = result.violations.find(v => v.parameter === "syllable_rate");
    assert(violation !== undefined, "Should have syllable_rate violation");
    assert(violation!.severity === "soft", "Value between comfortable_max and max should be soft violation");
  });
}

export function testValidateClampsToHardBounds(): void {
  test("validate clamps exceeded values to hard bounds in result", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech")!;
    const syllableBound = profile.bounds["syllable_rate"];
    const annotations: TemporalAnnotation = {
      syllable_rate: 100.0,
    };
    const result = registry.validate("speech", annotations);
    const clampedValue = result.clamped["syllable_rate"] as number;
    assert(clampedValue <= syllableBound.max, "Clamped value should not exceed hard max");
    assert(clampedValue >= syllableBound.min, "Clamped value should not be below hard min");
  });
}

export function testValidateSkipsUnknownParameters(): void {
  test("validate ignores annotation parameters not defined in the registry", () => {
    const registry = new PerceptionRegistry();
    const annotations: TemporalAnnotation = {
      syllable_rate: 4.0,
      unknown_param: 999,
    };
    const result = registry.validate("speech", annotations);
    // Unknown params should pass through without generating violations
    const unknownViolation = result.violations.find(v => v.parameter === "unknown_param");
    assert(unknownViolation === undefined, "Unknown parameters should not generate violations");
  });
}

export function testValidateHapticModality(): void {
  test("validate works correctly for haptic modality bounds", () => {
    const registry = new PerceptionRegistry();
    const annotations: TemporalAnnotation = {
      tap_duration_ms: 5,   // Below hard min of 10ms
    };
    const result = registry.validate("haptic", annotations);
    assert(result.violations.length > 0, "Should have violation for sub-threshold tap duration");
    const violation = result.violations.find(v => v.parameter === "tap_duration_ms");
    assert(violation !== undefined, "Should flag tap_duration_ms");
    assert(violation!.severity === "hard", "Below hard min should be a hard violation");
  });
}

export function testValidateNotificationModality(): void {
  test("validate flags notification spam below 1000ms interval", () => {
    const registry = new PerceptionRegistry();
    const annotations: TemporalAnnotation = {
      min_interval_ms: 500,
    };
    const result = registry.validate("notification", annotations);
    assert(result.violations.length > 0, "Should have violation for spam interval");
  });
}

export function testComfortableRangeReturnsCorrectRange(): void {
  test("comfortableRange returns correct min/max for known parameter", () => {
    const registry = new PerceptionRegistry();
    const range = registry.comfortableRange("speech", "syllable_rate");
    assert(range !== null, "Should return a range for known parameter");
    assert(range!.min > 0, "Comfortable min should be positive");
    assert(range!.max > range!.min, "Comfortable max should exceed min");
  });
}

export function testComfortableRangeReturnsNullForUnknown(): void {
  test("comfortableRange returns null for unknown modality or parameter", () => {
    const registry = new PerceptionRegistry();
    const result1 = registry.comfortableRange("taste", "speed");
    assert(result1 === null, "Unknown modality should return null");
    const result2 = registry.comfortableRange("speech", "nonexistent_param");
    assert(result2 === null, "Unknown parameter should return null");
  });
}

export function testLoadOverridesNeverExceedHardBounds(): void {
  test("loadOverrides never allows comfortable range to exceed hard bounds", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech")!;
    const syllableBound = profile.bounds["syllable_rate"];

    // Attempt to override comfortable range beyond hard bounds
    registry.loadOverrides("speech", {
      syllable_rate: {
        comfortable_min: syllableBound.min - 100,
        comfortable_max: syllableBound.max + 100,
      },
    });

    const updated = registry.getModality("speech")!;
    const updatedBound = updated.bounds["syllable_rate"];
    assert(updatedBound.comfortable_min >= updatedBound.min,
      "comfortable_min should be clamped to hard min");
    assert(updatedBound.comfortable_max <= updatedBound.max,
      "comfortable_max should be clamped to hard max");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("perception-registry.test.ts");

testRegistryListsAllFiveModalities();
testGetModalityReturnsSpeechProfile();
testGetModalityReturnsNullForUnknown();
testSpeechBoundsHaveCorrectStructure();
testValidateCleanAnnotationsReturnsNoViolations();
testValidateDetectsHardViolation();
testValidateDetectsSoftViolation();
testValidateClampsToHardBounds();
testValidateSkipsUnknownParameters();
testValidateHapticModality();
testValidateNotificationModality();
testComfortableRangeReturnsCorrectRange();
testComfortableRangeReturnsNullForUnknown();
testLoadOverridesNeverExceedHardBounds();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
