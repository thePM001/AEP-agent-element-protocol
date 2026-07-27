// @PAD: /root/dynAEP/sdk/typescript/src/temporal/modalities/haptic.ts
// ===========================================================================
// @dynaep/core - Haptic Temporal Annotations
// Provides haptic-specific helper functions, pattern builders and
// analysis utilities for governing the temporal properties of
// vibrotactile feedback. All constants are derived from the
// psychophysics research cited in the perception registry.
// ===========================================================================

import type { TemporalAnnotation, PerceptionBounds } from "../perception-registry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Parameter names for the haptic modality, matching the keys defined
 * in the perception registry buildHapticProfile().
 */
export const HAPTIC_PARAMS = {
  TAP_DURATION_MS: "tap_duration_ms",
  TAP_INTERVAL_MS: "tap_interval_ms",
  PATTERN_ELEMENT_GAP_MS: "pattern_element_gap_ms",
  VIBRATION_FREQUENCY_HZ: "vibration_frequency_hz",
  AMPLITUDE_CHANGE_RATE: "amplitude_change_rate",
} as const;

/**
 * Default comfortable-midpoint annotation values for haptic output.
 * These represent the centre of the comfortable range for each
 * parameter and serve as safe defaults when no user profile exists.
 */
export const HAPTIC_DEFAULTS: TemporalAnnotation = {
  tap_duration_ms: 110,
  tap_interval_ms: 550,
  pattern_element_gap_ms: 275,
  vibration_frequency_hz: 200,
  amplitude_change_rate: 1.75,
};

// ---------------------------------------------------------------------------
// Pattern Builders
// ---------------------------------------------------------------------------

/**
 * Build haptic annotations from partial input, filling in missing
 * parameters with comfortable-midpoint defaults.
 */
export function buildHapticAnnotations(partial: Partial<TemporalAnnotation>): TemporalAnnotation {
  const annotations: TemporalAnnotation = { ...HAPTIC_DEFAULTS };
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined && value !== null) {
      annotations[key] = value;
    }
  }
  return annotations;
}

/**
 * Build haptic annotations for a gentle notification tap pattern.
 * Short duration, moderate frequency, subtle amplitude changes.
 */
export function buildGentleTapPattern(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    tap_duration_ms: 50,
    tap_interval_ms: 300,
    pattern_element_gap_ms: 150,
    vibration_frequency_hz: 150,
    amplitude_change_rate: 1.0,
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
 * Build haptic annotations for an urgent alert pattern.
 * Longer duration, higher frequency, sharper amplitude transitions.
 */
export function buildUrgentAlertPattern(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    tap_duration_ms: 180,
    tap_interval_ms: 150,
    pattern_element_gap_ms: 80,
    vibration_frequency_hz: 280,
    amplitude_change_rate: 2.5,
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
 * Build haptic annotations for a rhythmic confirmation pattern.
 * Evenly spaced taps with consistent amplitude for acknowledgement
 * feedback without urgency.
 */
export function buildConfirmationPattern(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    tap_duration_ms: 80,
    tap_interval_ms: 200,
    pattern_element_gap_ms: 100,
    vibration_frequency_hz: 180,
    amplitude_change_rate: 0.8,
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
 * Estimate the total duration of a haptic pattern in milliseconds
 * given the number of taps and the temporal annotations.
 */
export function estimatePatternDurationMs(
  tapCount: number,
  annotations: TemporalAnnotation,
): number {
  if (tapCount <= 0) {
    return 0;
  }

  const tapDuration = typeof annotations.tap_duration_ms === "number"
    ? annotations.tap_duration_ms
    : 110;

  const tapInterval = typeof annotations.tap_interval_ms === "number"
    ? annotations.tap_interval_ms
    : 550;

  // Total = (tapCount * tapDuration) + ((tapCount - 1) * tapInterval)
  const totalTapMs = tapCount * tapDuration;
  const totalIntervalMs = (tapCount - 1) * tapInterval;
  return Math.round(totalTapMs + totalIntervalMs);
}

/**
 * Determine whether a vibration frequency will be perceived as
 * distinct taps or as continuous vibration. Returns "discrete_taps"
 * if the tap interval is long enough for distinct perception,
 * "continuous" if taps merge into steady vibration, or "borderline"
 * if the interval is near the perceptual boundary.
 *
 * Based on van Erp 2002 vibrotactile temporal resolution data.
 */
export function classifyTapPerception(
  tapIntervalMs: number,
): "discrete_taps" | "continuous" | "borderline" {
  // Below 80 ms interval, taps merge into continuous vibration
  if (tapIntervalMs < 80) {
    return "continuous";
  }
  // Between 80-120 ms is the borderline zone
  if (tapIntervalMs < 120) {
    return "borderline";
  }
  return "discrete_taps";
}

/**
 * Compute a perceptual intensity score for a haptic annotation set.
 * Higher scores indicate stronger, more noticeable feedback.
 * Normalized to [0, 1].
 */
export function computePerceptualIntensity(
  annotations: TemporalAnnotation,
  bounds: Record<string, PerceptionBounds>,
): number {
  let totalIntensity = 0;
  let paramCount = 0;

  // Longer taps, higher frequency and faster amplitude changes
  // all contribute to higher perceived intensity.
  const intensityParams: Record<string, "higher_is_more" | "lower_is_more"> = {
    tap_duration_ms: "higher_is_more",
    vibration_frequency_hz: "higher_is_more",
    amplitude_change_rate: "higher_is_more",
    tap_interval_ms: "lower_is_more",
    pattern_element_gap_ms: "lower_is_more",
  };

  for (const [paramName, direction] of Object.entries(intensityParams)) {
    const value = annotations[paramName];
    if (typeof value !== "number") {
      continue;
    }

    const bound = bounds[paramName];
    if (!bound) {
      continue;
    }

    const range = bound.max - bound.min;
    if (range <= 0) {
      continue;
    }

    let normalizedValue: number;
    if (direction === "higher_is_more") {
      normalizedValue = (value - bound.min) / range;
    } else {
      normalizedValue = 1 - ((value - bound.min) / range);
    }

    totalIntensity += Math.max(0, Math.min(1, normalizedValue));
    paramCount += 1;
  }

  if (paramCount === 0) {
    return 0;
  }

  return totalIntensity / paramCount;
}
