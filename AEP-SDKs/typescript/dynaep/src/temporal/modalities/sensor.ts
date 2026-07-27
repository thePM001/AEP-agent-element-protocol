// @PAD: /root/dynAEP/sdk/typescript/src/temporal/modalities/sensor.ts
// ===========================================================================
// @dynaep/core - Sensor Temporal Annotations
// Provides sensor-specific helper functions, polling schedule builders
// and analysis utilities for governing the temporal properties of
// sensor data delivery. All constants are derived from the human
// factors research cited in the perception registry.
// ===========================================================================

import type { TemporalAnnotation, PerceptionBounds } from "../perception-registry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Parameter names for the sensor modality, matching the keys defined
 * in the perception registry buildSensorProfile().
 */
export const SENSOR_PARAMS = {
  HUMAN_RESPONSE_LATENCY_MS: "human_response_latency_ms",
  DISPLAY_REFRESH_ALIGNMENT_MS: "display_refresh_alignment_ms",
  HEALTH_MONITORING_INTERVAL_MS: "health_monitoring_interval_ms",
  ENVIRONMENTAL_POLLING_INTERVAL_MS: "environmental_polling_interval_ms",
} as const;

/**
 * Default comfortable-midpoint annotation values for sensor output.
 * These represent the centre of the comfortable range for each
 * parameter and serve as safe defaults when no context-specific
 * configuration is available.
 */
export const SENSOR_DEFAULTS: TemporalAnnotation = {
  human_response_latency_ms: 350,
  display_refresh_alignment_ms: 24,
  health_monitoring_interval_ms: 152500,
  environmental_polling_interval_ms: 65000,
};

/**
 * Common display refresh rates mapped to their frame interval in
 * milliseconds. These are used to align sensor data delivery with
 * the display refresh cycle for perceptual smoothness.
 */
export const DISPLAY_REFRESH_RATES: Record<string, number> = {
  "30hz": 33,
  "60hz": 16,
  "90hz": 11,
  "120hz": 8,
};

// ---------------------------------------------------------------------------
// Polling Schedule Builders
// ---------------------------------------------------------------------------

/**
 * Build sensor annotations from partial input, filling in missing
 * parameters with comfortable-midpoint defaults.
 */
export function buildSensorAnnotations(partial: Partial<TemporalAnnotation>): TemporalAnnotation {
  const annotations: TemporalAnnotation = { ...SENSOR_DEFAULTS };
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined && value !== null) {
      annotations[key] = value;
    }
  }
  return annotations;
}

/**
 * Build sensor annotations for clinical health monitoring. Uses
 * shorter polling intervals within the comfortable range to balance
 * vigilance against alarm fatigue.
 */
export function buildClinicalMonitoringSchedule(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    human_response_latency_ms: 300,
    display_refresh_alignment_ms: 16,
    health_monitoring_interval_ms: 10000,
    environmental_polling_interval_ms: 30000,
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
 * Build sensor annotations for ambient environmental monitoring.
 * Uses longer polling intervals suitable for slowly-changing signals
 * like temperature, air quality and humidity.
 */
export function buildAmbientMonitoringSchedule(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    human_response_latency_ms: 500,
    display_refresh_alignment_ms: 33,
    health_monitoring_interval_ms: 60000,
    environmental_polling_interval_ms: 120000,
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
 * Build sensor annotations for real-time interactive display.
 * Uses the shortest comfortable intervals to support responsive
 * visual feedback at 60 hz or higher refresh rates.
 */
export function buildRealtimeDisplaySchedule(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    human_response_latency_ms: 200,
    display_refresh_alignment_ms: 16,
    health_monitoring_interval_ms: 30000,
    environmental_polling_interval_ms: 60000,
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
 * Determine the optimal display refresh alignment given a target
 * refresh rate string (e.g. "60hz"). Returns the frame interval
 * in milliseconds, or the comfortable midpoint if the rate is
 * not recognized.
 */
export function alignToRefreshRate(targetRate: string): number {
  const interval = DISPLAY_REFRESH_RATES[targetRate.toLowerCase()];
  if (interval !== undefined) {
    return interval;
  }
  // Default to 60 hz alignment
  return 16;
}

/**
 * Evaluate whether a sensor polling interval is efficient given
 * the human response latency. Polling faster than the human can
 * respond wastes energy with no perceptual benefit.
 *
 * Returns "efficient" if polling interval >= response latency,
 * "wasteful" if polling is faster than human response capability,
 * or "borderline" if within 20% of the response latency threshold.
 */
export function evaluatePollingEfficiency(
  pollingIntervalMs: number,
  humanResponseLatencyMs: number,
): "efficient" | "wasteful" | "borderline" {
  const ratio = pollingIntervalMs / humanResponseLatencyMs;

  if (ratio >= 1.0) {
    return "efficient";
  }
  if (ratio >= 0.8) {
    return "borderline";
  }
  return "wasteful";
}

/**
 * Compute the battery impact score for a sensor polling schedule.
 * Lower scores indicate more battery-friendly configurations.
 * Normalized to [0, 1] where 0 is minimal impact and 1 is
 * maximum drain.
 *
 * The score is a weighted combination of all polling intervals,
 * where shorter intervals contribute more to the score.
 */
export function computeBatteryImpact(
  annotations: TemporalAnnotation,
  bounds: Record<string, PerceptionBounds>,
): number {
  let totalImpact = 0;
  let paramCount = 0;

  // All sensor interval parameters: shorter = more battery drain
  const intervalParams = [
    "display_refresh_alignment_ms",
    "health_monitoring_interval_ms",
    "environmental_polling_interval_ms",
  ];

  for (const paramName of intervalParams) {
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

    // Invert: shorter interval = higher impact
    const normalizedValue = 1 - ((value - bound.min) / range);
    totalImpact += Math.max(0, Math.min(1, normalizedValue));
    paramCount += 1;
  }

  if (paramCount === 0) {
    return 0;
  }

  return totalImpact / paramCount;
}

/**
 * Determine the appropriate monitoring category for a given health
 * monitoring interval. Returns a clinical category label that
 * maps the interval to standard monitoring tiers.
 */
export function classifyMonitoringTier(
  healthIntervalMs: number,
): "continuous" | "frequent" | "routine" | "periodic" {
  if (healthIntervalMs <= 5000) {
    return "continuous";
  }
  if (healthIntervalMs <= 30000) {
    return "frequent";
  }
  if (healthIntervalMs <= 120000) {
    return "routine";
  }
  return "periodic";
}
