// @PAD: /root/dynAEP/sdk/typescript/src/temporal/perception-events.ts
// ===========================================================================
// @dynaep/core - Perception Event Extensions
// Defines the four perception-specific event types used to communicate
// perception governance decisions through the AG-UI event stream.
// Follows the same type/dynaep_type discriminator pattern established
// by the seven TA-1 temporal events.
// ===========================================================================

import type { BridgeTimestamp } from "./clock";
import type { PerceptionViolation, TemporalAnnotation } from "./perception-registry";

// ---------------------------------------------------------------------------
// Event Interfaces
// ---------------------------------------------------------------------------

/**
 * Emitted when an agent-proposed temporal annotation violates one
 * or more perception bounds. Carries the full list of violations
 * and the clamped values that were applied in place of the original.
 */
export interface PerceptionViolationEvent {
  type: "CUSTOM";
  dynaep_type: "AEP_PERCEPTION_VIOLATION";
  targetId: string;
  modality: string;
  violations: PerceptionViolation[];
  originalAnnotations: TemporalAnnotation;
  clampedAnnotations: TemporalAnnotation;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Emitted after the perception engine produces a governed envelope
 * for an output event. Carries the full envelope including the
 * original, governed and adaptive annotation sets along with the
 * determination of which set was actually applied.
 */
export interface GovernedEnvelopeEvent {
  type: "CUSTOM";
  dynaep_type: "AEP_GOVERNED_ENVELOPE";
  targetId: string;
  modality: string;
  originalAnnotations: TemporalAnnotation;
  governedAnnotations: TemporalAnnotation;
  adaptiveAnnotations: TemporalAnnotation;
  applied: "original" | "governed" | "adaptive";
  violationCount: number;
  profileUsed: string | null;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Emitted when an adaptive perception profile is updated due to
 * the ingestion of a new user interaction. Carries the user ID,
 * the modality that was affected and the updated confidence score.
 */
export interface PerceptionProfileUpdateEvent {
  type: "CUSTOM";
  dynaep_type: "AEP_PERCEPTION_PROFILE_UPDATE";
  userId: string;
  modality: string;
  interactionType: string;
  interactionCount: number;
  confidenceScore: number;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Broadcast when the perception governance configuration changes
 * at runtime. This includes modality override loading, engine config
 * updates and profile resets. Agents receiving this event should
 * re-query perception bounds if they cache them locally.
 */
export interface PerceptionConfigChangeEvent {
  type: "CUSTOM";
  dynaep_type: "AEP_PERCEPTION_CONFIG_CHANGE";
  changeType: "modality_override" | "engine_config" | "profile_reset" | "profile_prune";
  affectedModalities: string[];
  affectedUserIds: string[];
  description: string;
  bridgeTimestamp: BridgeTimestamp;
}

// ---------------------------------------------------------------------------
// Union Type
// ---------------------------------------------------------------------------

/**
 * Discriminated union of all four perception event types. Use the
 * dynaep_type field to narrow to a specific variant.
 */
export type PerceptionEvent =
  | PerceptionViolationEvent
  | GovernedEnvelopeEvent
  | PerceptionProfileUpdateEvent
  | PerceptionConfigChangeEvent;

// ---------------------------------------------------------------------------
// Type Guard Functions
// ---------------------------------------------------------------------------

/**
 * Returns true if the given event is a PerceptionViolationEvent.
 */
export function isPerceptionViolationEvent(e: unknown): e is PerceptionViolationEvent {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return obj.type === "CUSTOM" && obj.dynaep_type === "AEP_PERCEPTION_VIOLATION";
}

/**
 * Returns true if the given event is a GovernedEnvelopeEvent.
 */
export function isGovernedEnvelopeEvent(e: unknown): e is GovernedEnvelopeEvent {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return obj.type === "CUSTOM" && obj.dynaep_type === "AEP_GOVERNED_ENVELOPE";
}

/**
 * Returns true if the given event is a PerceptionProfileUpdateEvent.
 */
export function isPerceptionProfileUpdateEvent(e: unknown): e is PerceptionProfileUpdateEvent {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return obj.type === "CUSTOM" && obj.dynaep_type === "AEP_PERCEPTION_PROFILE_UPDATE";
}

/**
 * Returns true if the given event is a PerceptionConfigChangeEvent.
 */
export function isPerceptionConfigChangeEvent(e: unknown): e is PerceptionConfigChangeEvent {
  if (typeof e !== "object" || e === null) return false;
  const obj = e as Record<string, unknown>;
  return obj.type === "CUSTOM" && obj.dynaep_type === "AEP_PERCEPTION_CONFIG_CHANGE";
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Parameters for creating a PerceptionViolationEvent. The type and
 * dynaep_type fields are set automatically by the factory.
 */
export interface PerceptionViolationParams {
  targetId: string;
  modality: string;
  violations: PerceptionViolation[];
  originalAnnotations: TemporalAnnotation;
  clampedAnnotations: TemporalAnnotation;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Create a PerceptionViolationEvent with the correct type discriminators.
 */
export function createPerceptionViolationEvent(params: PerceptionViolationParams): PerceptionViolationEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_PERCEPTION_VIOLATION",
    targetId: params.targetId,
    modality: params.modality,
    violations: params.violations,
    originalAnnotations: params.originalAnnotations,
    clampedAnnotations: params.clampedAnnotations,
    bridgeTimestamp: params.bridgeTimestamp,
  };
}

/**
 * Parameters for creating a GovernedEnvelopeEvent. The type and
 * dynaep_type fields are set automatically by the factory.
 */
export interface GovernedEnvelopeParams {
  targetId: string;
  modality: string;
  originalAnnotations: TemporalAnnotation;
  governedAnnotations: TemporalAnnotation;
  adaptiveAnnotations: TemporalAnnotation;
  applied: "original" | "governed" | "adaptive";
  violationCount: number;
  profileUsed: string | null;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Create a GovernedEnvelopeEvent with the correct type discriminators.
 */
export function createGovernedEnvelopeEvent(params: GovernedEnvelopeParams): GovernedEnvelopeEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_GOVERNED_ENVELOPE",
    targetId: params.targetId,
    modality: params.modality,
    originalAnnotations: params.originalAnnotations,
    governedAnnotations: params.governedAnnotations,
    adaptiveAnnotations: params.adaptiveAnnotations,
    applied: params.applied,
    violationCount: params.violationCount,
    profileUsed: params.profileUsed,
    bridgeTimestamp: params.bridgeTimestamp,
  };
}

/**
 * Parameters for creating a PerceptionProfileUpdateEvent. The type
 * and dynaep_type fields are set automatically by the factory.
 */
export interface PerceptionProfileUpdateParams {
  userId: string;
  modality: string;
  interactionType: string;
  interactionCount: number;
  confidenceScore: number;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Create a PerceptionProfileUpdateEvent with the correct type discriminators.
 */
export function createPerceptionProfileUpdateEvent(params: PerceptionProfileUpdateParams): PerceptionProfileUpdateEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_PERCEPTION_PROFILE_UPDATE",
    userId: params.userId,
    modality: params.modality,
    interactionType: params.interactionType,
    interactionCount: params.interactionCount,
    confidenceScore: params.confidenceScore,
    bridgeTimestamp: params.bridgeTimestamp,
  };
}

/**
 * Parameters for creating a PerceptionConfigChangeEvent. The type
 * and dynaep_type fields are set automatically by the factory.
 */
export interface PerceptionConfigChangeParams {
  changeType: "modality_override" | "engine_config" | "profile_reset" | "profile_prune";
  affectedModalities: string[];
  affectedUserIds: string[];
  description: string;
  bridgeTimestamp: BridgeTimestamp;
}

/**
 * Create a PerceptionConfigChangeEvent with the correct type discriminators.
 */
export function createPerceptionConfigChangeEvent(params: PerceptionConfigChangeParams): PerceptionConfigChangeEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_PERCEPTION_CONFIG_CHANGE",
    changeType: params.changeType,
    affectedModalities: params.affectedModalities,
    affectedUserIds: params.affectedUserIds,
    description: params.description,
    bridgeTimestamp: params.bridgeTimestamp,
  };
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

/**
 * Recursively sort all object keys in a value so that JSON output
 * is deterministic regardless of property insertion order.
 */
function sortKeysDeep(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }

  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    const keys = Object.keys(obj).sort();
    for (const key of keys) {
      sorted[key] = sortKeysDeep(obj[key]);
    }
    return sorted;
  }

  return value;
}

/**
 * Serialize a PerceptionEvent to a JSON string with deterministic
 * key ordering. Produces stable output suitable for hashing, logging
 * and wire transmission.
 */
export function serializePerceptionEvent(event: PerceptionEvent): string {
  const sorted = sortKeysDeep(event);
  return JSON.stringify(sorted);
}
