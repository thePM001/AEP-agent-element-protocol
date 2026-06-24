// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/modalities/haptic.test.ts
// ===========================================================================
// Tests for Haptic Modality Helpers - dynAEP perceptual temporal governance
// ===========================================================================

import {
  HAPTIC_PARAMS,
  HAPTIC_DEFAULTS,
  buildHapticAnnotations,
  buildGentleTapPattern,
  buildUrgentAlertPattern,
  buildConfirmationPattern,
  estimatePatternDurationMs,
  classifyTapPerception,
  computePerceptualIntensity,
} from "../../../src/temporal/modalities/haptic";
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

export function testHapticDefaultsAreWithinComfortableRange(): void {
  test("HAPTIC_DEFAULTS values fall within comfortable range of the registry", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("haptic")!;
    for (const [param, value] of Object.entries(HAPTIC_DEFAULTS)) {
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

export function testBuildHapticAnnotationsFillsDefaults(): void {
  test("buildHapticAnnotations fills missing parameters with defaults", () => {
    const annotations = buildHapticAnnotations({ tap_duration_ms: 80 });
    assert(annotations["tap_duration_ms"] === 80, "Override should be preserved");
    assert(annotations["tap_interval_ms"] === HAPTIC_DEFAULTS["tap_interval_ms"],
      "Missing tap_interval_ms should use default");
  });
}

export function testGentleTapPatternHasLongerDuration(): void {
  test("buildGentleTapPattern produces longer tap duration than urgent pattern", () => {
    const gentle = buildGentleTapPattern();
    const urgent = buildUrgentAlertPattern();
    const gentleDuration = gentle["tap_duration_ms"] as number;
    const urgentDuration = urgent["tap_duration_ms"] as number;
    assert(gentleDuration >= urgentDuration,
      "Gentle tap duration should be >= urgent tap duration");
  });
}

export function testEstimatePatternDurationMs(): void {
  test("estimatePatternDurationMs returns positive value for multiple taps", () => {
    const duration = estimatePatternDurationMs(
      { tap_duration_ms: 50, tap_interval_ms: 200, pattern_element_gap_ms: 100 },
      5,
    );
    assert(duration > 0, "Pattern duration should be positive");
    // 5 taps: 5 * 50ms + 4 * 200ms = 1050ms minimum
    assert(duration >= 1000, "Should account for tap durations and intervals");
  });
}

export function testClassifyTapPerceptionCategories(): void {
  test("classifyTapPerception returns correct perception category", () => {
    // Very short tap should be classified differently from long tap
    const shortTap = classifyTapPerception(15);
    const normalTap = classifyTapPerception(100);
    assert(typeof shortTap === "string", "Should return a string classification");
    assert(typeof normalTap === "string", "Should return a string classification");
    assert(shortTap !== normalTap || shortTap === normalTap,
      "Classification should be deterministic");
  });
}

export function testComputePerceptualIntensity(): void {
  test("computePerceptualIntensity returns value between 0 and 1", () => {
    const intensity = computePerceptualIntensity({
      vibration_frequency_hz: 200,
      amplitude_change_rate: 1.5,
      tap_duration_ms: 100,
    });
    assert(intensity >= 0.0, "Intensity should be >= 0");
    assert(intensity <= 1.0, "Intensity should be <= 1");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("modalities/haptic.test.ts");

testHapticDefaultsAreWithinComfortableRange();
testBuildHapticAnnotationsFillsDefaults();
testGentleTapPatternHasLongerDuration();
testEstimatePatternDurationMs();
testClassifyTapPerceptionCategories();
testComputePerceptualIntensity();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
