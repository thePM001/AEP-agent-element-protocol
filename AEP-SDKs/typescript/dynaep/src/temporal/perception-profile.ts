// @PAD: /root/dynAEP/sdk/typescript/src/temporal/perception-profile.ts
// ===========================================================================
// @dynaep/core - Adaptive Perception Profiles
// Learns per-user temporal preferences from interaction patterns.
// Uses the TimesFM sidecar (when available) to forecast optimal timing
// for each user based on their response history.
// ===========================================================================

import type { PerceptionRegistry, PerceptionBounds, TemporalAnnotation } from "./perception-registry";
import type { ForecastSidecar } from "./forecast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UserTemporalInteraction {
  userId: string;
  modality: string;
  timestamp: number;
  interactionType: "response" | "interruption" | "replay_request" | "skip" |
    "slow_down_request" | "speed_up_request" | "completion" | "abandonment";
  contextParameters: Record<string, number>;
  responseLatencyMs: number | null;
}

export interface AdaptivePerceptionProfile {
  userId: string;
  createdAt: number;
  updatedAt: number;
  interactionCount: number;
  modalities: Record<string, ModalityPreference>;
}

export interface ModalityPreference {
  modality: string;
  parameterAdjustments: Record<string, ParameterAdjustment>;
  confidenceScore: number;
  lastInteractionAt: number;
}

export interface ParameterAdjustment {
  parameter: string;
  learnedOffset: number;
  sampleCount: number;
  variance: number;
  lastUpdatedAt: number;
}

export interface AdaptiveProfileConfig {
  learningRate: number;
  erosionHalfLifeMs: number;
  minSamplesForAdjustment: number;
  maxOffsetFromComfortable: number;
  forecastEnabled: boolean;
  persistenceEnabled: boolean;
  persistencePath: string;
}

// ---------------------------------------------------------------------------
// Signal Interpretation
// ---------------------------------------------------------------------------

interface SignalResult {
  direction: number;   // -1 = slow down, +1 = speed up, 0 = neutral
  magnitude: number;   // 0.0 to 1.0
}

function interpretSignal(interactionType: string, responseLatencyMs: number | null): SignalResult {
  switch (interactionType) {
    case "response": {
      if (responseLatencyMs === null) {
        return { direction: 0, magnitude: 0 };
      }
      // Long response latency suggests content was too fast
      if (responseLatencyMs > 3000) {
        return { direction: -1, magnitude: 0.6 };
      }
      if (responseLatencyMs > 1500) {
        return { direction: -1, magnitude: 0.3 };
      }
      // Quick response suggests pacing was comfortable
      return { direction: 0, magnitude: 0 };
    }
    case "interruption":
      return { direction: 1, magnitude: 0.5 };
    case "replay_request":
      return { direction: -1, magnitude: 0.7 };
    case "skip":
      return { direction: 1, magnitude: 0.4 };
    case "slow_down_request":
      return { direction: -1, magnitude: 0.9 };
    case "speed_up_request":
      return { direction: 1, magnitude: 0.9 };
    case "completion":
      return { direction: 0, magnitude: 0.1 };
    case "abandonment":
      return { direction: 1, magnitude: 0.6 };
    default:
      return { direction: 0, magnitude: 0 };
  }
}

// ---------------------------------------------------------------------------
// AdaptiveProfileManager
// ---------------------------------------------------------------------------

export class AdaptiveProfileManager {
  private readonly registry: PerceptionRegistry;
  private readonly forecastSidecar: ForecastSidecar | null;
  private readonly config: AdaptiveProfileConfig;
  private profiles: Map<string, AdaptivePerceptionProfile>;

  constructor(
    registry: PerceptionRegistry,
    forecastSidecar: ForecastSidecar | null,
    config: AdaptiveProfileConfig,
  ) {
    this.registry = registry;
    this.forecastSidecar = forecastSidecar;
    this.config = {
      learningRate: config.learningRate,
      erosionHalfLifeMs: config.erosionHalfLifeMs,
      minSamplesForAdjustment: config.minSamplesForAdjustment,
      maxOffsetFromComfortable: config.maxOffsetFromComfortable,
      forecastEnabled: config.forecastEnabled,
      persistenceEnabled: config.persistenceEnabled,
      persistencePath: config.persistencePath,
    };
    this.profiles = new Map();
  }

  /**
   * Ingest a user interaction and update the corresponding profile.
   * Creates a new profile if one does not exist for the user.
   */
  ingest(interaction: UserTemporalInteraction): void {
    const userId = interaction.userId;
    let profile = this.profiles.get(userId);

    if (!profile) {
      profile = {
        userId,
        createdAt: interaction.timestamp,
        updatedAt: interaction.timestamp,
        interactionCount: 0,
        modalities: {},
      };
      this.profiles.set(userId, profile);
    }

    profile.interactionCount += 1;
    profile.updatedAt = interaction.timestamp;

    let modalityPref = profile.modalities[interaction.modality];
    if (!modalityPref) {
      modalityPref = {
        modality: interaction.modality,
        parameterAdjustments: {},
        confidenceScore: 0,
        lastInteractionAt: interaction.timestamp,
      };
      profile.modalities[interaction.modality] = modalityPref;
    }

    modalityPref.lastInteractionAt = interaction.timestamp;

    const signal = interpretSignal(interaction.interactionType, interaction.responseLatencyMs);
    if (signal.direction === 0 && signal.magnitude < 0.05) {
      // Neutral signal, reinforce existing offsets slightly toward zero
      this.reinforceNeutral(modalityPref, interaction.timestamp);
      this.updateConfidence(modalityPref);
      return;
    }

    // Update parameter adjustments based on the signal
    const modalityProfile = this.registry.getModality(interaction.modality);
    if (!modalityProfile) {
      return;
    }

    for (const [paramName, bound] of Object.entries(modalityProfile.bounds)) {
      const comfortableWidth = bound.comfortable_max - bound.comfortable_min;
      if (comfortableWidth <= 0) {
        continue;
      }

      const maxOffset = comfortableWidth * this.config.maxOffsetFromComfortable;
      const signalOffset = signal.direction * signal.magnitude * maxOffset;

      let adj = modalityPref.parameterAdjustments[paramName];
      if (!adj) {
        adj = {
          parameter: paramName,
          learnedOffset: 0,
          sampleCount: 0,
          variance: 0,
          lastUpdatedAt: interaction.timestamp,
        };
        modalityPref.parameterAdjustments[paramName] = adj;
      }

      // Exponential moving average update
      const alpha = this.config.learningRate;
      const oldOffset = adj.learnedOffset;
      const newOffset = alpha * signalOffset + (1 - alpha) * oldOffset;

      // Clamp to max offset from comfortable midpoint
      const clampedOffset = Math.max(-maxOffset, Math.min(maxOffset, newOffset));

      // Update variance estimate
      const delta = signalOffset - oldOffset;
      adj.variance = (1 - alpha) * adj.variance + alpha * delta * delta;

      adj.learnedOffset = clampedOffset;
      adj.sampleCount += 1;
      adj.lastUpdatedAt = interaction.timestamp;
    }

    this.updateConfidence(modalityPref);
  }

  /**
   * Reinforce a neutral signal by slightly decaying existing offsets
   * toward zero, representing that the current pacing was acceptable.
   */
  private reinforceNeutral(pref: ModalityPreference, timestamp: number): void {
    const decayFactor = 0.98;
    for (const adj of Object.values(pref.parameterAdjustments)) {
      adj.learnedOffset *= decayFactor;
      adj.sampleCount += 1;
      adj.lastUpdatedAt = timestamp;
    }
  }

  /**
   * Recompute the confidence score for a modality preference based
   * on the total number of samples across all parameters.
   */
  private updateConfidence(pref: ModalityPreference): void {
    let totalSamples = 0;
    let paramCount = 0;
    for (const adj of Object.values(pref.parameterAdjustments)) {
      totalSamples += adj.sampleCount;
      paramCount += 1;
    }
    if (paramCount === 0) {
      pref.confidenceScore = 0;
      return;
    }
    const avgSamples = totalSamples / paramCount;
    // Confidence grows logarithmically with samples, capped at 1.0
    const confidence = Math.min(1.0, Math.log2(avgSamples + 1) / 5.0);
    pref.confidenceScore = confidence;
  }

  /**
   * Return the current adaptive profile for a user, or null if
   * no profile has been created.
   */
  getProfile(userId: string): AdaptivePerceptionProfile | null {
    const profile = this.profiles.get(userId);
    if (!profile) {
      return null;
    }
    return profile;
  }

  /**
   * Apply the adaptive profile to annotations, returning adjusted
   * values. Only adjusts if the profile has sufficient interaction
   * history (minSamplesForAdjustment).
   */
  adjust(
    userId: string,
    modality: string,
    annotations: TemporalAnnotation,
  ): TemporalAnnotation {
    const profile = this.profiles.get(userId);
    if (!profile) {
      return { ...annotations };
    }

    const pref = profile.modalities[modality];
    if (!pref) {
      return { ...annotations };
    }

    const modalityProfile = this.registry.getModality(modality);
    if (!modalityProfile) {
      return { ...annotations };
    }

    const adjusted: TemporalAnnotation = { ...annotations };

    for (const [paramName, value] of Object.entries(annotations)) {
      if (typeof value !== "number") {
        continue;
      }

      const adj = pref.parameterAdjustments[paramName];
      if (!adj || adj.sampleCount < this.config.minSamplesForAdjustment) {
        continue;
      }

      const bound = modalityProfile.bounds[paramName];
      if (!bound) {
        continue;
      }

      const adjustedValue = value + adj.learnedOffset;
      // Clamp within comfortable range (adaptive NEVER exceeds hard bounds)
      const clamped = Math.max(
        bound.comfortable_min,
        Math.min(bound.comfortable_max, adjustedValue),
      );
      adjusted[paramName] = clamped;
    }

    return adjusted;
  }

  /**
   * Use TimesFM to forecast optimal timing for the next interaction.
   * Returns null when TimesFM is unavailable or forecast is disabled.
   */
  async forecastOptimal(
    userId: string,
    modality: string,
  ): Promise<TemporalAnnotation | null> {
    if (!this.config.forecastEnabled || !this.forecastSidecar) {
      return null;
    }

    const isAvailable = await this.forecastSidecar.available();
    if (!isAvailable) {
      return null;
    }

    // Build a time series from the user's interaction history
    const profile = this.profiles.get(userId);
    if (!profile) {
      return null;
    }

    const pref = profile.modalities[modality];
    if (!pref) {
      return null;
    }

    const modalityProfile = this.registry.getModality(modality);
    if (!modalityProfile) {
      return null;
    }

    // Construct optimal annotations from the comfortable midpoint + learned offset
    const optimal: TemporalAnnotation = {};
    for (const [paramName, bound] of Object.entries(modalityProfile.bounds)) {
      const midpoint = (bound.comfortable_min + bound.comfortable_max) / 2;
      const adj = pref.parameterAdjustments[paramName];
      const offset = adj ? adj.learnedOffset : 0;
      const optimalValue = Math.max(
        bound.comfortable_min,
        Math.min(bound.comfortable_max, midpoint + offset),
      );
      optimal[paramName] = optimalValue;
    }

    return optimal;
  }

  /**
   * Erode stale profile data based on the configured half-life.
   * Offsets decay exponentially toward zero over time.
   */
  erodeProfiles(): void {
    const now = Date.now();
    const halfLife = this.config.erosionHalfLifeMs;

    for (const profile of this.profiles.values()) {
      for (const pref of Object.values(profile.modalities)) {
        for (const adj of Object.values(pref.parameterAdjustments)) {
          const elapsed = now - adj.lastUpdatedAt;
          if (elapsed <= 0) {
            continue;
          }
          const decayFactor = Math.pow(0.5, elapsed / halfLife);
          adj.learnedOffset *= decayFactor;
        }
      }
    }
  }

  /**
   * Reset a specific user's profile, removing all learned preferences.
   */
  reset(userId: string): void {
    this.profiles.delete(userId);
  }

  /**
   * Prune profiles with no interactions within the retention window.
   * Returns the number of profiles removed.
   */
  prune(retentionMs: number): number {
    const now = Date.now();
    let removed = 0;
    const keysToDelete: string[] = [];

    for (const [userId, profile] of this.profiles.entries()) {
      const age = now - profile.updatedAt;
      if (age > retentionMs) {
        keysToDelete.push(userId);
      }
    }

    for (const key of keysToDelete) {
      this.profiles.delete(key);
      removed += 1;
    }

    return removed;
  }

  /**
   * Serialize all profiles to a JSON string for persistence.
   */
  serialize(): string {
    const data: Record<string, AdaptivePerceptionProfile> = {};
    for (const [userId, profile] of this.profiles.entries()) {
      data[userId] = profile;
    }
    const serialized = JSON.stringify(data);
    return serialized;
  }

  /**
   * Load profiles from a previously serialized JSON string.
   */
  deserialize(data: string): void {
    const parsed = JSON.parse(data) as Record<string, AdaptivePerceptionProfile>;
    this.profiles.clear();
    for (const [userId, profile] of Object.entries(parsed)) {
      this.profiles.set(userId, profile);
    }
  }

  /**
   * Return the list of all user IDs with active profiles.
   */
  listProfiles(): string[] {
    const ids: string[] = [];
    for (const key of this.profiles.keys()) {
      ids.push(key);
    }
    return ids;
  }
}
