// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/modalities/speech.test.ts
// ===========================================================================
// Tests for Speech Modality Helpers - dynAEP perceptual temporal governance
// ===========================================================================

import {
  SPEECH_PARAMS,
  SPEECH_DEFAULTS,
  buildSpeechAnnotations,
  buildConversationalSpeech,
  buildNarrationSpeech,
  estimateUtteranceDurationMs,
  computeComprehensionDifficulty,
  assessSyllableRateForComplexity,
} from "../../../src/temporal/modalities/speech";
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

export function testSpeechParamsContainsAllExpectedKeys(): void {
  test("SPEECH_PARAMS contains all expected parameter names", () => {
    assert(SPEECH_PARAMS.TURN_GAP_MS === "turn_gap_ms", "TURN_GAP_MS should be 'turn_gap_ms'");
    assert(SPEECH_PARAMS.SYLLABLE_RATE === "syllable_rate", "SYLLABLE_RATE should be 'syllable_rate'");
    assert(SPEECH_PARAMS.CLAUSE_PAUSE_MS === "clause_pause_ms", "CLAUSE_PAUSE_MS should be 'clause_pause_ms'");
    assert(SPEECH_PARAMS.SENTENCE_PAUSE_MS === "sentence_pause_ms", "SENTENCE_PAUSE_MS should be 'sentence_pause_ms'");
    assert(SPEECH_PARAMS.PITCH_RANGE === "pitch_range", "PITCH_RANGE should be 'pitch_range'");
  });
}

export function testSpeechDefaultsAreWithinComfortableRange(): void {
  test("SPEECH_DEFAULTS values fall within comfortable range of the registry", () => {
    const registry = new PerceptionRegistry();
    const profile = registry.getModality("speech")!;
    for (const [param, value] of Object.entries(SPEECH_DEFAULTS)) {
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

export function testBuildSpeechAnnotationsFillsDefaults(): void {
  test("buildSpeechAnnotations fills missing parameters with defaults", () => {
    const annotations = buildSpeechAnnotations({ syllable_rate: 3.5 });
    assert(annotations["syllable_rate"] === 3.5, "Override should be preserved");
    assert(annotations["turn_gap_ms"] === SPEECH_DEFAULTS["turn_gap_ms"],
      "Missing turn_gap_ms should use default");
    assert(annotations["clause_pause_ms"] === SPEECH_DEFAULTS["clause_pause_ms"],
      "Missing clause_pause_ms should use default");
  });
}

export function testBuildConversationalSpeechPattern(): void {
  test("buildConversationalSpeech produces conversational-speed annotations", () => {
    const conv = buildConversationalSpeech();
    assert(typeof conv["syllable_rate"] === "number", "Should have syllable_rate");
    assert(typeof conv["turn_gap_ms"] === "number", "Should have turn_gap_ms");
    // Conversational speech should have moderate syllable rate
    const rate = conv["syllable_rate"] as number;
    assert(rate >= 3.0 && rate <= 6.0, "Conversational rate should be moderate (3-6)");
  });
}

export function testBuildNarrationSpeechPattern(): void {
  test("buildNarrationSpeech produces slower-paced annotations", () => {
    const narration = buildNarrationSpeech();
    const conv = buildConversationalSpeech();
    const narrationRate = narration["syllable_rate"] as number;
    const convRate = conv["syllable_rate"] as number;
    assert(narrationRate <= convRate,
      "Narration rate should be slower than or equal to conversational");
  });
}

export function testEstimateUtteranceDurationMs(): void {
  test("estimateUtteranceDurationMs returns positive duration for non-zero syllable count", () => {
    const duration = estimateUtteranceDurationMs(20, { syllable_rate: 4.0, clause_pause_ms: 300 }, 3);
    assert(duration > 0, "Duration should be positive for 20 syllables");
    // 20 syllables at 4 per second = 5000ms base, plus 2 clause pauses (600ms)
    assert(duration >= 5000, "Duration should be at least 5000ms for 20 syllables at 4/sec");
  });
}

export function testEstimateUtteranceDurationZeroSyllables(): void {
  test("estimateUtteranceDurationMs returns zero for zero syllable count", () => {
    const duration = estimateUtteranceDurationMs(0, { syllable_rate: 4.0 }, 0);
    assert(duration === 0, "Duration should be 0 for 0 syllables");
  });
}

export function testComputeComprehensionDifficulty(): void {
  test("computeComprehensionDifficulty returns value between 0 and 1", () => {
    const difficulty = computeComprehensionDifficulty({
      syllable_rate: 5.0,
      clause_pause_ms: 200,
      pitch_range: 0.8,
    });
    assert(difficulty >= 0.0, "Difficulty should be >= 0");
    assert(difficulty <= 1.0, "Difficulty should be <= 1");
  });
}

export function testAssessSyllableRateForComplexity(): void {
  test("assessSyllableRateForComplexity returns lower rate for high complexity", () => {
    const lowComplexity = assessSyllableRateForComplexity(0.2);
    const highComplexity = assessSyllableRateForComplexity(0.9);
    assert(highComplexity <= lowComplexity,
      "High complexity should recommend lower syllable rate than low complexity");
  });
}

export function testConversationalOverridesApply(): void {
  test("buildConversationalSpeech accepts overrides", () => {
    const custom = buildConversationalSpeech({ turn_gap_ms: 500 });
    assert(custom["turn_gap_ms"] === 500, "Override should apply to conversational speech");
  });
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("modalities/speech.test.ts");

testSpeechParamsContainsAllExpectedKeys();
testSpeechDefaultsAreWithinComfortableRange();
testBuildSpeechAnnotationsFillsDefaults();
testBuildConversationalSpeechPattern();
testBuildNarrationSpeechPattern();
testEstimateUtteranceDurationMs();
testEstimateUtteranceDurationZeroSyllables();
testComputeComprehensionDifficulty();
testAssessSyllableRateForComplexity();
testConversationalOverridesApply();

setTimeout(() => {
  console.log(`\nResults: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 100);
