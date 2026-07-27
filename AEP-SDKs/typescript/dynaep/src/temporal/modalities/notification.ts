// @PAD: /root/dynAEP/sdk/typescript/src/temporal/modalities/notification.ts
// ===========================================================================
// @dynaep/core - Notification Temporal Annotations
// Provides notification-specific helper functions, scheduling builders
// and analysis utilities for governing the temporal properties of
// push notifications and alerts. All constants are derived from the
// attention science research cited in the perception registry.
// ===========================================================================

import type { TemporalAnnotation, PerceptionBounds } from "../perception-registry";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Parameter names for the notification modality, matching the keys
 * defined in the perception registry buildNotificationProfile().
 */
export const NOTIFICATION_PARAMS = {
  MIN_INTERVAL_MS: "min_interval_ms",
  BURST_MAX_COUNT: "burst_max_count",
  BURST_WINDOW_MS: "burst_window_ms",
  HABITUATION_ONSET: "habituation_onset",
  RECOVERY_INTERVAL_MS: "recovery_interval_ms",
} as const;

/**
 * Default comfortable-midpoint annotation values for notifications.
 * These represent the centre of the comfortable range for each
 * parameter and serve as safe defaults when no user profile exists.
 */
export const NOTIFICATION_DEFAULTS: TemporalAnnotation = {
  min_interval_ms: 1815000,
  burst_max_count: 2,
  burst_window_ms: 17500,
  habituation_onset: 10,
  recovery_interval_ms: 1950000,
};

// ---------------------------------------------------------------------------
// Scheduling Builders
// ---------------------------------------------------------------------------

/**
 * Build notification annotations from partial input, filling in
 * missing parameters with comfortable-midpoint defaults.
 */
export function buildNotificationAnnotations(partial: Partial<TemporalAnnotation>): TemporalAnnotation {
  const annotations: TemporalAnnotation = { ...NOTIFICATION_DEFAULTS };
  for (const [key, value] of Object.entries(partial)) {
    if (value !== undefined && value !== null) {
      annotations[key] = value;
    }
  }
  return annotations;
}

/**
 * Build notification annotations for a low-priority informational
 * schedule. Long intervals between notifications, small burst limits
 * and a generous recovery window to prevent attention fatigue.
 */
export function buildLowPrioritySchedule(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    min_interval_ms: 3600000,
    burst_max_count: 1,
    burst_window_ms: 30000,
    habituation_onset: 5,
    recovery_interval_ms: 3600000,
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
 * Build notification annotations for a high-priority alert schedule.
 * Shorter intervals and higher burst counts are allowed, but
 * habituation onset and recovery are calibrated to prevent the user
 * from ignoring critical alerts due to overexposure.
 */
export function buildHighPrioritySchedule(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    min_interval_ms: 60000,
    burst_max_count: 3,
    burst_window_ms: 10000,
    habituation_onset: 8,
    recovery_interval_ms: 600000,
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
 * Build notification annotations for batched digest delivery.
 * Notifications are accumulated and delivered in a single burst
 * at longer intervals to minimize context-switching disruption.
 */
export function buildBatchedDigestSchedule(overrides?: Partial<TemporalAnnotation>): TemporalAnnotation {
  const base: TemporalAnnotation = {
    min_interval_ms: 7200000,
    burst_max_count: 5,
    burst_window_ms: 5000,
    habituation_onset: 15,
    recovery_interval_ms: 1800000,
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
 * Track notification delivery timestamps and determine whether
 * sending a new notification would violate the configured temporal
 * constraints. Returns a structured decision with the reason.
 */
export interface NotificationGateDecision {
  allowed: boolean;
  reason: "clear" | "interval_too_short" | "burst_limit_exceeded" | "habituation_reached";
  nextAllowedAtMs: number | null;
}

/**
 * Evaluate whether a notification should be sent given the current
 * delivery history and the temporal annotations governing this
 * notification channel.
 *
 * @param deliveryTimestamps - Array of previous delivery timestamps in ms
 * @param nowMs - Current bridge time in ms
 * @param annotations - Active notification temporal annotations
 */
export function evaluateNotificationGate(
  deliveryTimestamps: number[],
  nowMs: number,
  annotations: TemporalAnnotation,
): NotificationGateDecision {
  const minInterval = typeof annotations.min_interval_ms === "number"
    ? annotations.min_interval_ms
    : 30000;

  const burstMaxCount = typeof annotations.burst_max_count === "number"
    ? annotations.burst_max_count
    : 3;

  const burstWindow = typeof annotations.burst_window_ms === "number"
    ? annotations.burst_window_ms
    : 30000;

  const habituationOnset = typeof annotations.habituation_onset === "number"
    ? annotations.habituation_onset
    : 10;

  const recoveryInterval = typeof annotations.recovery_interval_ms === "number"
    ? annotations.recovery_interval_ms
    : 300000;

  // Check minimum interval since last delivery
  if (deliveryTimestamps.length > 0) {
    const lastDelivery = deliveryTimestamps[deliveryTimestamps.length - 1];
    const elapsed = nowMs - lastDelivery;
    if (elapsed < minInterval) {
      return {
        allowed: false,
        reason: "interval_too_short",
        nextAllowedAtMs: lastDelivery + minInterval,
      };
    }
  }

  // Check burst limit within the burst window
  const burstWindowStart = nowMs - burstWindow;
  let burstCount = 0;
  for (let i = deliveryTimestamps.length - 1; i >= 0; i--) {
    if (deliveryTimestamps[i] >= burstWindowStart) {
      burstCount += 1;
    } else {
      break;
    }
  }

  if (burstCount >= burstMaxCount) {
    return {
      allowed: false,
      reason: "burst_limit_exceeded",
      nextAllowedAtMs: nowMs + burstWindow,
    };
  }

  // Check habituation onset
  if (deliveryTimestamps.length >= habituationOnset) {
    const lastDelivery = deliveryTimestamps[deliveryTimestamps.length - 1];
    const elapsed = nowMs - lastDelivery;
    if (elapsed < recoveryInterval) {
      return {
        allowed: false,
        reason: "habituation_reached",
        nextAllowedAtMs: lastDelivery + recoveryInterval,
      };
    }
  }

  return {
    allowed: true,
    reason: "clear",
    nextAllowedAtMs: null,
  };
}

/**
 * Compute the effective notification frequency in notifications
 * per hour from the temporal annotations. This helps agents
 * understand the maximum throughput of a notification channel.
 */
export function computeMaxNotificationsPerHour(annotations: TemporalAnnotation): number {
  const minInterval = typeof annotations.min_interval_ms === "number"
    ? annotations.min_interval_ms
    : 30000;

  if (minInterval <= 0) {
    return 0;
  }

  const msPerHour = 3600000;
  const maxPerHour = msPerHour / minInterval;
  return Math.floor(maxPerHour);
}

/**
 * Estimate how many notifications can be sent before habituation
 * onset is reached, given the current delivery count and the
 * configured habituation threshold.
 */
export function remainingBeforeHabituation(
  currentDeliveryCount: number,
  annotations: TemporalAnnotation,
): number {
  const habituationOnset = typeof annotations.habituation_onset === "number"
    ? annotations.habituation_onset
    : 10;

  const remaining = habituationOnset - currentDeliveryCount;
  return Math.max(0, remaining);
}
