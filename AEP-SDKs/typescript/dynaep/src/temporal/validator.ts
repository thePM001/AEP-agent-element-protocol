// @PAD: /root/dynAEP/sdk/typescript/src/temporal/validator.ts
// ===========================================================================
// @dynaep/temporal - Temporal Validator
// Validates AG-UI event timestamps against the BridgeClock, detecting drift,
// future timestamps, stale events, and causal ordering violations.
// Every event passing through validation receives a BridgeTimestamp annotation.
// ===========================================================================

import type { BridgeClock, BridgeTimestamp } from "./clock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemporalViolation {
  type: "drift_exceeded" | "future_timestamp" | "stale_event" | "causal_violation";
  detail: string;
  agentTimeMs: number | null;
  bridgeTimeMs: number;
  thresholdMs: number;
}

export interface TemporalValidationResult {
  accepted: boolean;
  bridgeTimestamp: BridgeTimestamp;
  violations: TemporalViolation[];
  warnings: string[];
}

export interface TemporalValidatorConfig {
  maxDriftMs: number;
  maxFutureMs: number;
  maxStalenessMs: number;
  overwriteTimestamps: boolean;
  logRejections: boolean;
  mode: "strict" | "permissive" | "log_only";
}

interface AGUIEvent {
  type: string;
  timestamp?: number;
  dynaep_type?: string;
  target_id?: string;
  _temporal?: any;
  [key: string]: any;
}

// ---------------------------------------------------------------------------
// Rejection Log Entry (internal bookkeeping)
// ---------------------------------------------------------------------------

interface RejectionLogEntry {
  eventType: string;
  violations: TemporalViolation[];
  recordedAt: number;
}

// ---------------------------------------------------------------------------
// TemporalValidator
// ---------------------------------------------------------------------------

export class TemporalValidator {
  private readonly clock: BridgeClock;
  private readonly config: TemporalValidatorConfig;
  private readonly rejectionLog: RejectionLogEntry[];
  private lastValidatedBridgeMs: number;

  constructor(clock: BridgeClock, config: TemporalValidatorConfig) {
    this.clock = clock;
    this.config = config;
    this.rejectionLog = [];
    this.lastValidatedBridgeMs = 0;
  }

  // -------------------------------------------------------------------------
  // Primary validation entry point
  // -------------------------------------------------------------------------

  validate(event: AGUIEvent): TemporalValidationResult {
    const violations: TemporalViolation[] = [];
    const warnings: string[] = [];

    // Step 1: Read the agent-supplied timestamp (may be absent)
    const agentTimeMs: number | null =
      typeof event.timestamp === "number" ? event.timestamp : null;

    // Step 2: Produce the authoritative BridgeTimestamp from the clock
    const bridgeTimestamp: BridgeTimestamp = this.clock.stamp(
      agentTimeMs !== null ? agentTimeMs : undefined,
    );
    const bridgeTimeMs: number = bridgeTimestamp.bridgeTimeMs;

    // Step 3: Overwrite the event timestamp when configured to do so
    if (this.config.overwriteTimestamps) {
      event.timestamp = bridgeTimeMs;
      warnings.push(
        "Agent timestamp overwritten with bridge time " + String(bridgeTimeMs),
      );
    }

    // Step 4: Check drift between agent time and bridge time
    if (agentTimeMs !== null) {
      const driftResult = this.checkDrift(agentTimeMs);
      if (!driftResult.withinTolerance) {
        const driftViolation: TemporalViolation = {
          type: "drift_exceeded",
          detail:
            "Drift of " +
            String(driftResult.driftMs) +
            "ms exceeds maximum allowed " +
            String(this.config.maxDriftMs) +
            "ms",
          agentTimeMs,
          bridgeTimeMs,
          thresholdMs: this.config.maxDriftMs,
        };
        violations.push(driftViolation);
      }
    }

    // Step 5: Check for future timestamps
    if (agentTimeMs !== null) {
      const isFuture = this.checkFutureTimestamp(agentTimeMs);
      if (isFuture) {
        const futureViolation: TemporalViolation = {
          type: "future_timestamp",
          detail:
            "Agent timestamp " +
            String(agentTimeMs) +
            "ms is beyond the allowed future window of " +
            String(this.config.maxFutureMs) +
            "ms past bridge time",
          agentTimeMs,
          bridgeTimeMs,
          thresholdMs: this.config.maxFutureMs,
        };
        violations.push(futureViolation);
      }
    }

    // Step 6: Check for staleness
    if (agentTimeMs !== null) {
      const isStale = this.checkStaleness(agentTimeMs);
      if (isStale) {
        const staleViolation: TemporalViolation = {
          type: "stale_event",
          detail:
            "Event is " +
            String(bridgeTimeMs - agentTimeMs) +
            "ms old, exceeding staleness limit of " +
            String(this.config.maxStalenessMs) +
            "ms",
          agentTimeMs,
          bridgeTimeMs,
          thresholdMs: this.config.maxStalenessMs,
        };
        violations.push(staleViolation);
      }
    }

    // Step 7: Attach BridgeTimestamp metadata to the event
    event._temporal = {
      bridgeTimeMs: bridgeTimestamp.bridgeTimeMs,
      driftMs: bridgeTimestamp.driftMs,
      source: bridgeTimestamp.source,
      validatedAt: Date.now(),
    };

    // Update tracking for causal ordering checks
    this.lastValidatedBridgeMs = bridgeTimeMs;

    // Step 8-10: Determine acceptance based on the configured mode
    const accepted = this.resolveAcceptance(violations, warnings, event);

    const result: TemporalValidationResult = {
      accepted,
      bridgeTimestamp,
      violations,
      warnings,
    };

    return result;
  }

  // -------------------------------------------------------------------------
  // Drift check - compares agent time against current bridge time
  // -------------------------------------------------------------------------

  checkDrift(agentTimeMs: number): { withinTolerance: boolean; driftMs: number } {
    const currentBridgeMs: number = this.clock.now();
    const driftMs: number = Math.abs(agentTimeMs - currentBridgeMs);
    const withinTolerance: boolean = driftMs <= this.config.maxDriftMs;
    return { withinTolerance, driftMs };
  }

  // -------------------------------------------------------------------------
  // Future timestamp check - true if the agent time is too far ahead
  // -------------------------------------------------------------------------

  checkFutureTimestamp(agentTimeMs: number): boolean {
    const currentBridgeMs: number = this.clock.now();
    const aheadMs: number = agentTimeMs - currentBridgeMs;
    const exceedsFutureWindow: boolean = aheadMs > this.config.maxFutureMs;
    return exceedsFutureWindow;
  }

  // -------------------------------------------------------------------------
  // Staleness check - true if the event is too old relative to bridge time
  // -------------------------------------------------------------------------

  checkStaleness(agentTimeMs: number): boolean {
    const currentBridgeMs: number = this.clock.now();
    const ageMs: number = currentBridgeMs - agentTimeMs;
    const isBeyondStalenessLimit: boolean = ageMs > this.config.maxStalenessMs;
    return isBeyondStalenessLimit;
  }

  // -------------------------------------------------------------------------
  // Batch validation - processes each event in order
  // -------------------------------------------------------------------------

  validateBatch(events: AGUIEvent[]): TemporalValidationResult[] {
    const results: TemporalValidationResult[] = [];
    const batchSize: number = events.length;

    for (let idx = 0; idx < batchSize; idx++) {
      const currentEvent: AGUIEvent = events[idx];
      const result: TemporalValidationResult = this.validate(currentEvent);
      results.push(result);
    }

    return results;
  }

  // -------------------------------------------------------------------------
  // Internal: resolve acceptance based on mode and violation state
  // -------------------------------------------------------------------------

  private resolveAcceptance(
    violations: TemporalViolation[],
    warnings: string[],
    event: AGUIEvent,
  ): boolean {
    const mode = this.config.mode;
    const hasViolations = violations.length > 0;

    if (mode === "strict") {
      // In strict mode, any violation results in rejection
      if (hasViolations && this.config.logRejections) {
        this.recordRejection(event, violations);
      }
      return !hasViolations;
    }

    if (mode === "permissive") {
      // In permissive mode, we always accept but record violations as warnings
      if (hasViolations) {
        for (const v of violations) {
          warnings.push("[permissive] " + v.type + ": " + v.detail);
        }
        if (this.config.logRejections) {
          this.recordRejection(event, violations);
        }
      }
      return true;
    }

    // log_only mode: accept everything, log all violations silently
    if (hasViolations) {
      this.recordRejection(event, violations);
      for (const v of violations) {
        warnings.push("[log_only] " + v.type + ": " + v.detail);
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Internal: record a rejection to the in-memory log
  // -------------------------------------------------------------------------

  private recordRejection(
    event: AGUIEvent,
    violations: TemporalViolation[],
  ): void {
    const entry: RejectionLogEntry = {
      eventType: event.type || "unknown",
      violations: violations.slice(),
      recordedAt: Date.now(),
    };
    this.rejectionLog.push(entry);

    // Cap the log at 500 entries to prevent unbounded growth
    if (this.rejectionLog.length > 500) {
      this.rejectionLog.splice(0, this.rejectionLog.length - 500);
    }
  }
}
