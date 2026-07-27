// @PAD: /root/dynAEP/sdk/typescript/src/temporal/query-tool.ts
// ===========================================================================
// @dynaep/core - AG-UI Temporal Query Tool
// Provides a tool definition that agents can invoke to query temporal
// state, perception bounds, governed envelope history and adaptive
// profile data. Follows the AG-UI tool registration pattern used by
// the DynAEPBridge for aep_add_element and aep_query_graph.
// ===========================================================================

import type { PerceptionRegistry, ModalityProfile, TemporalAnnotation, PerceptionValidationResult } from "./perception-registry";
import type { PerceptionEngine, GovernedEnvelope, TemporalOutputEvent } from "./perception-engine";
import type { TemporalAuthority, TemporalAuditEntry } from "./authority";
import type { AdaptivePerceptionProfile } from "./perception-profile";
import type { AsyncBridgeClock } from "./AsyncBridgeClock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Supported query operations for the temporal query tool.
 * Each operation maps to a specific aspect of the TA-2 system.
 */
export type TemporalQueryOperation =
  | "list_modalities"
  | "get_modality_bounds"
  | "validate_annotations"
  | "get_profile"
  | "list_profiles"
  | "govern_preview"
  | "last_mutation_time"
  | "mutation_frequency"
  | "staleness_check"
  | "audit_trail"
  | "comfortable_range"
  | "clock_quality";

/**
 * Input parameters for a temporal query. The operation field selects
 * which query to run. Additional fields are operation-specific.
 */
export interface TemporalQueryInput {
  operation: TemporalQueryOperation;
  modality?: string;
  parameter?: string;
  annotations?: TemporalAnnotation;
  userId?: string;
  elementId?: string;
  windowSeconds?: number;
  maxAgeMs?: number;
  referenceTimestampMs?: number;
  limit?: number;
}

/**
 * Structured result returned by the temporal query tool.
 * Exactly one of the result fields will be populated based on
 * the operation that was executed.
 */
export interface TemporalQueryResult {
  operation: TemporalQueryOperation;
  success: boolean;
  error: string | null;
  modalities?: string[];
  modalityProfile?: ModalityProfile | null;
  validationResult?: PerceptionValidationResult;
  profile?: AdaptivePerceptionProfile | null;
  profileIds?: string[];
  governedEnvelope?: GovernedEnvelope;
  lastMutationTimeMs?: number | null;
  frequency?: number;
  isStale?: boolean;
  auditEntries?: TemporalAuditEntry[];
  comfortableRange?: { min: number; max: number } | null;
  clockQuality?: {
    sync_state: string;
    uncertainty_ns: number;
    sequence_token: number;
    sync_source: string;
    confidence_class: string;
    anomaly_flags: string[];
  } | null;
}

/**
 * AG-UI tool definition for the temporal query tool. This matches
 * the shape expected by DynAEPBridge.addTool() for registration
 * in the bridge tool catalogue.
 */
export interface TemporalQueryToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, ToolParameterSchema>;
}

export interface ToolParameterSchema {
  type: string;
  description: string;
  required: boolean;
  enum?: string[];
}

// ---------------------------------------------------------------------------
// Tool Definition
// ---------------------------------------------------------------------------

/**
 * Build the AG-UI tool definition for aep_temporal_query.
 * This function returns the static tool metadata that is registered
 * once during bridge initialization.
 */
export function buildTemporalQueryToolDefinition(): TemporalQueryToolDefinition {
  return {
    name: "aep_temporal_query",
    description: "Query the dynAEP temporal governance layer for perception bounds, adaptive profiles, governed envelope previews and temporal authority state.",
    parameters: {
      operation: {
        type: "string",
        description: "The query operation to execute.",
        required: true,
        enum: [
          "list_modalities",
          "get_modality_bounds",
          "validate_annotations",
          "get_profile",
          "list_profiles",
          "govern_preview",
          "last_mutation_time",
          "mutation_frequency",
          "staleness_check",
          "audit_trail",
          "comfortable_range",
          "clock_quality",
        ],
      },
      modality: {
        type: "string",
        description: "Target modality name (speech, haptic, notification, sensor, audio).",
        required: false,
      },
      parameter: {
        type: "string",
        description: "Specific parameter name within a modality.",
        required: false,
      },
      annotations: {
        type: "object",
        description: "Temporal annotations to validate or preview governance for.",
        required: false,
      },
      userId: {
        type: "string",
        description: "User ID for adaptive profile queries.",
        required: false,
      },
      elementId: {
        type: "string",
        description: "Element ID for temporal authority queries.",
        required: false,
      },
      windowSeconds: {
        type: "number",
        description: "Time window in seconds for mutation frequency queries.",
        required: false,
      },
      maxAgeMs: {
        type: "number",
        description: "Maximum age in milliseconds for staleness checks.",
        required: false,
      },
      referenceTimestampMs: {
        type: "number",
        description: "Reference timestamp in milliseconds for staleness checks.",
        required: false,
      },
      limit: {
        type: "number",
        description: "Maximum number of entries to return for audit trail queries.",
        required: false,
      },
    },
  };
}

// ---------------------------------------------------------------------------
// TemporalQueryTool
// ---------------------------------------------------------------------------

/**
 * Executes temporal queries against the TA-2 perception governance
 * layer and the TA-1 temporal authority. Each query operation is
 * dispatched to the appropriate subsystem and the result is returned
 * in a normalized TemporalQueryResult envelope.
 */
export class TemporalQueryTool {
  private readonly registry: PerceptionRegistry;
  private readonly engine: PerceptionEngine;
  private readonly authority: TemporalAuthority;
  private readonly clock: AsyncBridgeClock | null;

  constructor(
    registry: PerceptionRegistry,
    engine: PerceptionEngine,
    authority: TemporalAuthority,
    clock?: AsyncBridgeClock,
  ) {
    this.registry = registry;
    this.engine = engine;
    this.authority = authority;
    this.clock = clock ?? null;
  }

  /**
   * Execute a temporal query. This is the single entry point invoked
   * by the AG-UI tool dispatch layer when an agent calls
   * aep_temporal_query.
   */
  execute(input: TemporalQueryInput): TemporalQueryResult {
    switch (input.operation) {
      case "list_modalities":
        return this.listModalities();
      case "get_modality_bounds":
        return this.getModalityBounds(input);
      case "validate_annotations":
        return this.validateAnnotations(input);
      case "get_profile":
        return this.getProfile(input);
      case "list_profiles":
        return this.listProfiles();
      case "govern_preview":
        return this.governPreview(input);
      case "last_mutation_time":
        return this.lastMutationTime(input);
      case "mutation_frequency":
        return this.mutationFrequency(input);
      case "staleness_check":
        return this.stalenessCheck(input);
      case "audit_trail":
        return this.auditTrail(input);
      case "comfortable_range":
        return this.comfortableRange(input);
      case "clock_quality":
        return this.clockQuality();
      default:
        return {
          operation: input.operation,
          success: false,
          error: "Unknown operation: " + String(input.operation),
        };
    }
  }

  /**
   * List all registered perception modalities.
   */
  private listModalities(): TemporalQueryResult {
    const modalities = this.registry.listModalities();
    return {
      operation: "list_modalities",
      success: true,
      error: null,
      modalities,
    };
  }

  /**
   * Return the full perception profile for a named modality,
   * including all bounds and constraint rules.
   */
  private getModalityBounds(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.modality) {
      return {
        operation: "get_modality_bounds",
        success: false,
        error: "Missing required parameter: modality",
      };
    }

    const profile = this.registry.getModality(input.modality);
    return {
      operation: "get_modality_bounds",
      success: true,
      error: null,
      modalityProfile: profile,
    };
  }

  /**
   * Validate temporal annotations against the static perception
   * registry bounds for the specified modality.
   */
  private validateAnnotations(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.modality) {
      return {
        operation: "validate_annotations",
        success: false,
        error: "Missing required parameter: modality",
      };
    }

    if (!input.annotations) {
      return {
        operation: "validate_annotations",
        success: false,
        error: "Missing required parameter: annotations",
      };
    }

    const result = this.engine.validateStatic(input.modality, input.annotations);
    return {
      operation: "validate_annotations",
      success: true,
      error: null,
      validationResult: result,
    };
  }

  /**
   * Return the adaptive perception profile for a specific user.
   */
  private getProfile(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.userId) {
      return {
        operation: "get_profile",
        success: false,
        error: "Missing required parameter: userId",
      };
    }

    const profile = this.engine.getProfile(input.userId);
    return {
      operation: "get_profile",
      success: true,
      error: null,
      profile,
    };
  }

  /**
   * List all user IDs that have active adaptive profiles.
   */
  private listProfiles(): TemporalQueryResult {
    const profileIds = this.engine.listProfiles();
    return {
      operation: "list_profiles",
      success: true,
      error: null,
      profileIds,
    };
  }

  /**
   * Preview what the governed envelope would look like for a
   * hypothetical output event without actually dispatching it.
   * This allows agents to pre-check their annotations.
   */
  private governPreview(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.modality) {
      return {
        operation: "govern_preview",
        success: false,
        error: "Missing required parameter: modality",
      };
    }

    if (!input.annotations) {
      return {
        operation: "govern_preview",
        success: false,
        error: "Missing required parameter: annotations",
      };
    }

    const syntheticEvent: TemporalOutputEvent = {
      type: "CUSTOM",
      dynaep_type: "AEP_GOVERN_PREVIEW",
      targetId: "preview",
      modality: input.modality as "speech" | "haptic" | "notification" | "sensor" | "audio",
      temporalAnnotations: input.annotations,
      userId: input.userId || null,
    };

    const envelope = this.engine.govern(syntheticEvent);
    return {
      operation: "govern_preview",
      success: true,
      error: null,
      governedEnvelope: envelope,
    };
  }

  /**
   * Query the temporal authority for the last mutation time of
   * a specific element.
   */
  private lastMutationTime(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.elementId) {
      return {
        operation: "last_mutation_time",
        success: false,
        error: "Missing required parameter: elementId",
      };
    }

    const time = this.authority.lastMutationTime(input.elementId);
    return {
      operation: "last_mutation_time",
      success: true,
      error: null,
      lastMutationTimeMs: time,
    };
  }

  /**
   * Query the temporal authority for the mutation frequency of
   * a specific element within a trailing time window.
   */
  private mutationFrequency(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.elementId) {
      return {
        operation: "mutation_frequency",
        success: false,
        error: "Missing required parameter: elementId",
      };
    }

    const windowSec = input.windowSeconds ?? 60;
    const freq = this.authority.mutationFrequency(input.elementId, windowSec);
    return {
      operation: "mutation_frequency",
      success: true,
      error: null,
      frequency: freq,
    };
  }

  /**
   * Check whether a reference timestamp is stale relative to the
   * bridge-authoritative clock and a maximum age threshold.
   */
  private stalenessCheck(input: TemporalQueryInput): TemporalQueryResult {
    if (input.referenceTimestampMs === undefined || input.referenceTimestampMs === null) {
      return {
        operation: "staleness_check",
        success: false,
        error: "Missing required parameter: referenceTimestampMs",
      };
    }

    const maxAge = input.maxAgeMs ?? 30000;
    const stale = this.authority.isStale(input.referenceTimestampMs, maxAge);
    return {
      operation: "staleness_check",
      success: true,
      error: null,
      isStale: stale,
    };
  }

  /**
   * Return the temporal audit trail for a specific element,
   * limited to the requested number of entries.
   */
  private auditTrail(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.elementId) {
      return {
        operation: "audit_trail",
        success: false,
        error: "Missing required parameter: elementId",
      };
    }

    const entryLimit = input.limit ?? 50;
    const entries = this.authority.auditTrail(input.elementId, entryLimit);
    return {
      operation: "audit_trail",
      success: true,
      error: null,
      auditEntries: entries,
    };
  }

  /**
   * Return the comfortable range for a specific parameter within
   * a modality. Agents use this to understand the sweet spot for
   * their temporal annotations.
   */
  private comfortableRange(input: TemporalQueryInput): TemporalQueryResult {
    if (!input.modality) {
      return {
        operation: "comfortable_range",
        success: false,
        error: "Missing required parameter: modality",
      };
    }

    if (!input.parameter) {
      return {
        operation: "comfortable_range",
        success: false,
        error: "Missing required parameter: parameter",
      };
    }

    const range = this.registry.comfortableRange(input.modality, input.parameter);
    return {
      operation: "comfortable_range",
      success: true,
      error: null,
      comfortableRange: range,
    };
  }

  /**
   * TA-3.2: Return the current TIM-compatible clock quality metadata
   * from the bridge clock's ClockQualityTracker.
   */
  private clockQuality(): TemporalQueryResult {
    if (!this.clock) {
      return {
        operation: "clock_quality",
        success: false,
        error: "Bridge clock not available for clock quality queries",
      };
    }

    const quality = this.clock.getClockQuality();
    return {
      operation: "clock_quality",
      success: true,
      error: null,
      clockQuality: quality,
    };
  }
}
