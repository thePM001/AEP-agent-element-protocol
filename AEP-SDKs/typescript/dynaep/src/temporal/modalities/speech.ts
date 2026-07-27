// @PAD: /root/dynAEP/sdk/typescript/src/temporal/modalities/speech.ts
// ===========================================================================
// @dynaep/core - Speech Temporal Annotations
// Provides speech-specific helper functions, annotation builders and
// analysis utilities for governing the temporal properties of
// synthesized speech output. All constants are derived from the
// psychoacoustics research cited in the perception registry.
// ===========================================================================

import type { TemporalAnnotation, PerceptionBounds } from "../perception-registry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Parameter names for the speech modality, matching the keys defined
 * in the perception registry buildSpeechProfile().
 */
export const SPEECH_PARAMS = {
  TURN_GAP_MS: "turn_gap_ms",
  SYLLABLE_RATE: "syllable_rate",
  CLAUSE_PAUSE_MS: "clause_pause_ms",
  SENTENCE_PAUSE_MS: "sentence_pause_ms",
  TOPIC_SHIFT_PAUSE_MS: "topic_shift_pause_ms",
  PITCH_RANGE: "pitch_range",
  EMPHASIS_DURATION_STRETCH: "emphasis_duration_stretch",
  TOTAL_UTTERANCE_MAX_MS: "total_utterance_max_ms",
} as const;

/**
 * Default comfortable-midpoint annotation values for speech output.
 * These represent the centre of the comfortable range for each
 * parameter and serve as safe defaults when no user profile exists.
 */
export const SPEECH_DEFAULTS: TemporalAnnotation = {
  turn_gap_ms: 350,
  syllable_rate: 4.25,
  clause_pause_ms: 350,
  sentence_pause_ms: 625,
  topic_shift_pause_ms: 1650,
  pitch_range: 1.3,
  emphasis_duration_stretch: 1.3,
  total_utterance_max_ms: 8000,
};

// ---------------------------------------------------------------------------
// Annotation Builders
// ---------------------------------------------------------------------------

/**
 * Build speech annotations from partial input, filling in missing
 * parameters with comfortable-midpoint defaults. This ensures that
 * every annotation set is complete before governance validation.
 */
export function buildSpeechAnnotations(partial: Partial<TemporalAnnotation>): TemporalAnnotation {
  const annotations: TemporalAnnotation = { ...SPEECH_DEFAULTS };
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined && value !== null) {
      annotations[key] = value;
    }
  }
  return annotations;
}

/**
 * Build speech annotations optimized for conversational pacing.
 * Shorter pauses and faster syllable rate reflect the cadence of
 * natural dialogue rather than monologue or narration.
 */
export function buildConversationalSpeech(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    turn_gap_ms: 250,
    syllable_rate: 4.8,
    clause_pause_ms: 150,
    sentence_pause_ms: 400,
    topic_shift_pause_ms: 1000,
    pitch_range: 1.4,
    emphasis_duration_stretch: 1.2,
    total_utterance_max_ms: 6000,
  };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value !== null) {
        base[key] = value;
      }
    }
  }
  return base;
}

/**
 * Build speech annotations optimized for narration pacing. Slower
 * syllable rate and longer pauses support comprehension of complex
 * or information-dense content.
 */
export function buildNarrationSpeech(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    turn_gap_ms: 400,
    syllable_rate: 3.5,
    clause_pause_ms: 400,
    sentence_pause_ms: 800,
    topic_shift_pause_ms: 2000,
    pitch_range: 1.1,
    emphasis_duration_stretch: 1.4,
    total_utterance_max_ms: 12000,
  };
  if (overrides) {
    for (const [key, value] of Object.entries(overrides)) {
      if (value !== undefined && value !== null) {
        base[key] = value;
      }
    }
  }
  return base;
}

// ---------------------------------------------------------------------------
// Analysis Utilities
// ---------------------------------------------------------------------------

/**
 * Estimate the total duration in milliseconds for a spoken utterance
 * given its syllable count and temporal annotations. Accounts for
 * clause pauses, sentence pauses and topic shift pauses based on
 * the provided counts.
 */
export function estimateUtteranceDurationMs(
  syllableCount: number,
  clauseBreaks: number,
  sentenceBreaks: number,
  topicShifts: number,
  annotations: TemporalAnnotation,
): number {
  const syllableRate = typeof annotations.syllable_rate === "number"
    ? annotations.syllable_rate
    : 4.25;

  const clausePauseMs = typeof annotations.clause_pause_ms === "number"
    ? annotations.clause_pause_ms
    : 350;

  const sentencePauseMs = typeof annotations.sentence_pause_ms === "number"
    ? annotations.sentence_pause_ms
    : 625;

  const topicShiftPauseMs = typeof annotations.topic_shift_pause_ms === "number"
    ? annotations.topic_shift_pause_ms
    : 1650;

  // Base speech duration from syllable count and rate
  const speechDurationMs = syllableRate > 0
    ? (syllableCount / syllableRate) * 1000
    : 0;

  // Total pause duration from structural breaks
  const pauseDurationMs =
    (clauseBreaks * clausePauseMs) +
    (sentenceBreaks * sentencePauseMs) +
    (topicShifts * topicShiftPauseMs);

  const totalMs = speechDurationMs + pauseDurationMs;
  return Math.round(totalMs);
}

/**
 * Compute a comprehension difficulty score for a speech annotation
 * set. Higher scores indicate annotations that are closer to
 * perception limits and therefore harder for listeners to process.
 * The score is normalized to the range [0, 1].
 *
 * Parameters that push toward faster delivery (high syllable rate,
 * short pauses) increase difficulty. Parameters near the comfortable
 * midpoint score close to zero.
 */
export function computeComprehensionDifficulty(
  annotations: TemporalAnnotation,
  bounds: Record<string, PerceptionBounds>,
): number {
  let totalScore = 0;
  let paramCount = 0;

  for (const [paramName, value] of Object.entries(annotations)) {
    if (typeof value !== "number") {
      continue;
    }

    const bound = bounds[paramName];
    if (!bound) {
      continue;
    }

    const comfortMid = (bound.comfortable_min + bound.comfortable_max) / 2;
    const comfortWidth = bound.comfortable_max - bound.comfortable_min;

    if (comfortWidth <= 0) {
      continue;
    }

    // Distance from comfortable midpoint normalized by comfortable width
    const distanceFromMid = Math.abs(value - comfortMid);
    const normalizedDistance = distanceFromMid / comfortWidth;

    // Score increases as the value approaches hard limits
    const hardRange = bound.max - bound.min;
    const distanceFromHardEdge = Math.min(
      Math.abs(value - bound.min),
      Math.abs(value - bound.max),
    );
    const hardProximity = hardRange > 0
      ? 1 - (distanceFromHardEdge / (hardRange / 2))
      : 0;

    const paramScore = Math.max(0, Math.min(1, (normalizedDistance + hardProximity) / 2));
    totalScore += paramScore;
    paramCount += 1;
  }

  if (paramCount === 0) {
    return 0;
  }

  const avgScore = totalScore / paramCount;
  return Math.max(0, Math.min(1, avgScore));
}

/**
 * Determine whether a syllable rate is suitable for the given content
 * complexity. Returns a recommendation: "appropriate", "too_fast"
 * or "too_slow". Content complexity is expressed as a ratio from
 * 0 (trivial) to 1 (highly complex).
 *
 * The recommendation is based on the empirically observed inverse
 * relationship between content complexity and optimal speech rate
 * (Pellegrino et al. 2011).
 */
export function assessSyllableRateForComplexity(
  syllableRate: number,
  contentComplexity: number,
): "appropriate" | "too_fast" | "too_slow" {
  // Linear interpolation of optimal rate based on complexity
  // Complexity 0 => up to 5.5 syl/sec comfortable
  // Complexity 1 => up to 3.0 syl/sec comfortable
  const optimalMax = 5.5 - (contentComplexity * 2.5);
  const optimalMin = 3.0 - (contentComplexity * 1.0);

  if (syllableRate > optimalMax) {
    return "too_fast";
  }
  if (syllableRate < optimalMin) {
    return "too_slow";
  }
  return "appropriate";
}
