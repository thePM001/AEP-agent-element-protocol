// @PAD: /root/dynAEP/sdk/typescript/src/temporal/perception-engine.ts
// ===========================================================================
// @dynaep/core - Perception Validation Engine
// Validates agent-proposed temporal annotations against the perception
// registry and adaptive user profiles. Produces governed temporal envelopes
// that are perception-safe.
// ===========================================================================

import type {
  PerceptionRegistry,
  TemporalAnnotation,
  PerceptionViolation,
  PerceptionValidationResult,
} from "./perception-registry";
import type { TemporalAuthority } from "./authority";
import type { ForecastSidecar } from "./forecast";
import {
  AdaptiveProfileManager,
  type AdaptivePerceptionProfile,
  type UserTemporalInteraction,
  type AdaptiveProfileConfig,
} from "./perception-profile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemporalOutputEvent {
  type: "CUSTOM";
  dynaep_type: string;
  targetId: string;
  modality: "speech" | "haptic" | "notification" | "sensor" | "audio";
  temporalAnnotations: TemporalAnnotation;
  userId: string | null;
}

export interface GovernedEnvelope {
  originalAnnotations: TemporalAnnotation;
  governedAnnotations: TemporalAnnotation;
  adaptiveAnnotations: TemporalAnnotation;
  applied: "original" | "governed" | "adaptive";
  violations: PerceptionViolation[];
  profileUsed: string | null;
}

export interface PerceptionEngineConfig {
  enableAdaptiveProfiles: boolean;
  profileLearningRate: number;
  profileErosionHalfLifeMs: number;
  minInteractionsForProfile: number;
  hardViolationAction: "reject" | "clamp";
  softViolationAction: "clamp" | "warn" | "log_only";
  governedEnvelopeMode: "overwrite" | "metadata_only";
}

// ---------------------------------------------------------------------------
// PerceptionEngine
// ---------------------------------------------------------------------------

export class PerceptionEngine {
  private readonly registry: PerceptionRegistry;
  private readonly authority: TemporalAuthority;
  private readonly profileManager: AdaptiveProfileManager;
  private readonly config: PerceptionEngineConfig;

  constructor(
    registry: PerceptionRegistry,
    authority: TemporalAuthority,
    forecastSidecar: ForecastSidecar | null,
    config: PerceptionEngineConfig,
  ) {
    this.registry = registry;
    this.authority = authority;
    this.config = {
      enableAdaptiveProfiles: config.enableAdaptiveProfiles,
      profileLearningRate: config.profileLearningRate,
      profileErosionHalfLifeMs: config.profileErosionHalfLifeMs,
      minInteractionsForProfile: config.minInteractionsForProfile,
      hardViolationAction: config.hardViolationAction,
      softViolationAction: config.softViolationAction,
      governedEnvelopeMode: config.governedEnvelopeMode,
    };

    const profileConfig: AdaptiveProfileConfig = {
      learningRate: config.profileLearningRate,
      erosionHalfLifeMs: config.profileErosionHalfLifeMs,
      minSamplesForAdjustment: config.minInteractionsForProfile,
      maxOffsetFromComfortable: 0.3,
      forecastEnabled: forecastSidecar !== null,
      persistenceEnabled: false,
      persistencePath: "",
    };

    this.profileManager = new AdaptiveProfileManager(
      registry,
      forecastSidecar,
      profileConfig,
    );
  }

  /**
   * Validate and govern temporal annotations for an output event.
   * Applies static registry bounds, then adaptive profile adjustments.
   */
  govern(event: TemporalOutputEvent): GovernedEnvelope {
    const originalAnnotations = { ...event.temporalAnnotations };

    // Step 1: Validate against static registry
    const staticResult = this.registry.validate(event.modality, originalAnnotations);
    const governedAnnotations = { ...staticResult.clamped };

    // Step 2: Apply soft violation handling
    if (this.config.softViolationAction === "log_only") {
      // For soft violations in log_only mode, keep original values
      for (const violation of staticResult.violations) {
        if (violation.severity === "soft") {
          governedAnnotations[violation.parameter] = originalAnnotations[violation.parameter];
        }
      }
    }

    // Step 3: Apply adaptive profile if enabled and userId is present
    let adaptiveAnnotations: TemporalAnnotation = { ...governedAnnotations };
    let profileUsed: string | null = null;

    if (
      this.config.enableAdaptiveProfiles &&
      event.userId !== null
    ) {
      const profile = this.profileManager.getProfile(event.userId);
      if (profile && profile.interactionCount >= this.config.minInteractionsForProfile) {
        adaptiveAnnotations = this.profileManager.adjust(
          event.userId,
          event.modality,
          governedAnnotations,
        );
        profileUsed = event.userId;
      }
    }

    // Determine which annotation set was applied
    let applied: "original" | "governed" | "adaptive" = "original";
    if (staticResult.violations.length > 0) {
      applied = "governed";
    }
    if (profileUsed !== null) {
      applied = "adaptive";
    }

    const envelope: GovernedEnvelope = {
      originalAnnotations,
      governedAnnotations,
      adaptiveAnnotations,
      applied,
      violations: staticResult.violations,
      profileUsed,
    };

    return envelope;
  }

  /**
   * Validate annotations against the static registry only.
   */
  validateStatic(
    modality: string,
    annotations: TemporalAnnotation,
  ): PerceptionValidationResult {
    const result = this.registry.validate(modality, annotations);
    return result;
  }

  /**
   * Get the adaptive perception profile for a user.
   */
  getProfile(userId: string): AdaptivePerceptionProfile | null {
    const profile = this.profileManager.getProfile(userId);
    return profile;
  }

  /**
   * Ingest a user interaction to update the adaptive profile.
   */
  ingestInteraction(userId: string, interaction: UserTemporalInteraction): void {
    this.profileManager.ingest(interaction);
  }

  /**
   * Apply a user's adaptive profile to annotations.
   */
  applyProfile(
    modality: string,
    annotations: TemporalAnnotation,
    profile: AdaptivePerceptionProfile,
  ): TemporalAnnotation {
    const adjusted = this.profileManager.adjust(
      profile.userId,
      modality,
      annotations,
    );
    return adjusted;
  }

  /**
   * Reset a user's adaptive profile.
   */
  resetProfile(userId: string): void {
    this.profileManager.reset(userId);
  }

  /**
   * Return the list of all user IDs with active profiles.
   */
  listProfiles(): string[] {
    const profiles = this.profileManager.listProfiles();
    return profiles;
  }

  /**
   * Return the underlying profile manager for direct access.
   */
  getProfileManager(): AdaptiveProfileManager {
    return this.profileManager;
  }
}
