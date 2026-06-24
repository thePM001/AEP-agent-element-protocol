// @PAD: /root/dynAEP/sdk/typescript/src/temporal/authority.ts
// ===========================================================================
// @dynaep/core - Stack-Wide Temporal Authority
// Establishes dynAEP-TA as the sole time source for the entire protocol
// stack. Any component that needs a timestamp, duration measurement or
// temporal comparison MUST obtain it from this authority.
// ===========================================================================

import type { BridgeClock, BridgeTimestamp } from "./clock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TemporalAuditEntry {
  eventId: string;
  elementId: string;
  bridgeTimeMs: number;
  agentId: string;
  mutationType: string;
  causalPosition: number;
}

export interface TemporalAuthorityConfig {
  auditTrailDepth: number;
  mutationTrackingEnabled: boolean;
  stalenessBroadcastIntervalMs: number;
}

export interface TemporalAuthority {
  readonly clock: BridgeClock;
  now(): number;
  lastMutationTime(elementId: string): number | null;
  mutationFrequency(elementId: string, windowSeconds: number): number;
  isStale(referenceTimestampMs: number, maxAgeMs: number): boolean;
  elapsed(sinceMs: number): number;
  durationBetween(eventIdA: string, eventIdB: string): number | null;
  recordMutation(elementId: string, eventId: string, bridgeTimeMs: number): void;
  auditTrail(elementId: string, limit: number): TemporalAuditEntry[];
}

// ---------------------------------------------------------------------------
// Mutation Record (internal)
// ---------------------------------------------------------------------------

interface MutationRecord {
  eventId: string;
  elementId: string;
  bridgeTimeMs: number;
  agentId: string;
  mutationType: string;
  causalPosition: number;
}

// ---------------------------------------------------------------------------
// DynAEPTemporalAuthority
// ---------------------------------------------------------------------------

export class DynAEPTemporalAuthority implements TemporalAuthority {
  readonly clock: BridgeClock;
  private readonly config: TemporalAuthorityConfig;
  private readonly elementMutations: Map<string, MutationRecord[]>;
  private readonly eventTimestamps: Map<string, number>;
  private positionCounter: number;

  constructor(clock: BridgeClock, config: TemporalAuthorityConfig) {
    this.clock = clock;
    this.config = {
      auditTrailDepth: config.auditTrailDepth,
      mutationTrackingEnabled: config.mutationTrackingEnabled,
      stalenessBroadcastIntervalMs: config.stalenessBroadcastIntervalMs,
    };
    this.elementMutations = new Map();
    this.eventTimestamps = new Map();
    this.positionCounter = 0;
  }

  /**
   * Return the bridge-authoritative current time in milliseconds.
   * Every stack component calls this instead of Date.now().
   */
  now(): number {
    const bridgeTime = this.clock.now();
    return bridgeTime;
  }

  /**
   * Return the timestamp of the most recent mutation to an element.
   * Returns null if no mutations have been recorded for the element.
   */
  lastMutationTime(elementId: string): number | null {
    const records = this.elementMutations.get(elementId);
    if (!records || records.length === 0) {
      return null;
    }
    const lastRecord = records[records.length - 1];
    return lastRecord.bridgeTimeMs;
  }

  /**
   * Compute the number of mutations per second for an element
   * within the specified trailing time window.
   */
  mutationFrequency(elementId: string, windowSeconds: number): number {
    const records = this.elementMutations.get(elementId);
    if (!records || records.length === 0) {
      return 0;
    }

    const currentTime = this.now();
    const windowMs = windowSeconds * 1000;
    const windowStart = currentTime - windowMs;
    let mutationsInWindow = 0;

    for (let i = records.length - 1; i >= 0; i--) {
      if (records[i].bridgeTimeMs >= windowStart) {
        mutationsInWindow += 1;
      } else {
        break;
      }
    }

    if (windowSeconds <= 0) {
      return 0;
    }

    const frequency = mutationsInWindow / windowSeconds;
    return frequency;
  }

  /**
   * Determine whether a reference timestamp is stale relative to
   * the authoritative bridge time and the specified maximum age.
   */
  isStale(referenceTimestampMs: number, maxAgeMs: number): boolean {
    const currentTime = this.now();
    const age = currentTime - referenceTimestampMs;
    const stale = age > maxAgeMs;
    return stale;
  }

  /**
   * Return the number of milliseconds elapsed since the given
   * reference timestamp, as measured by the authoritative clock.
   */
  elapsed(sinceMs: number): number {
    const currentTime = this.now();
    const elapsedMs = currentTime - sinceMs;
    return elapsedMs;
  }

  /**
   * Return the authoritative duration in milliseconds between two
   * recorded events. Returns null if either event is not found.
   */
  durationBetween(eventIdA: string, eventIdB: string): number | null {
    const timeA = this.eventTimestamps.get(eventIdA);
    const timeB = this.eventTimestamps.get(eventIdB);

    if (timeA === undefined || timeB === undefined) {
      return null;
    }

    const duration = Math.abs(timeB - timeA);
    return duration;
  }

  /**
   * Record a mutation event for temporal tracking. Stores the
   * mutation in the per-element audit trail and records the event
   * timestamp for cross-event duration queries.
   */
  recordMutation(
    elementId: string,
    eventId: string,
    bridgeTimeMs: number,
    agentId?: string,
    mutationType?: string,
  ): void {
    if (!this.config.mutationTrackingEnabled) {
      return;
    }

    this.positionCounter += 1;

    const record: MutationRecord = {
      eventId,
      elementId,
      bridgeTimeMs,
      agentId: agentId ?? "bridge",
      mutationType: mutationType ?? "mutation",
      causalPosition: this.positionCounter,
    };

    let records = this.elementMutations.get(elementId);
    if (!records) {
      records = [];
      this.elementMutations.set(elementId, records);
    }

    records.push(record);

    // Enforce audit trail depth limit
    if (records.length > this.config.auditTrailDepth) {
      const excess = records.length - this.config.auditTrailDepth;
      records.splice(0, excess);
    }

    // Store event timestamp for cross-event queries
    this.eventTimestamps.set(eventId, bridgeTimeMs);

    // Cap event timestamp map to prevent unbounded growth
    if (this.eventTimestamps.size > this.config.auditTrailDepth * 10) {
      const entries = Array.from(this.eventTimestamps.entries());
      entries.sort((a, b) => a[1] - b[1]);
      const toRemove = entries.slice(0, entries.length - this.config.auditTrailDepth * 5);
      for (const [key] of toRemove) {
        this.eventTimestamps.delete(key);
      }
    }
  }

  /**
   * Return the temporal audit trail for an element, ordered
   * chronologically and limited to the specified depth.
   */
  auditTrail(elementId: string, limit: number): TemporalAuditEntry[] {
    const records = this.elementMutations.get(elementId);
    if (!records || records.length === 0) {
      return [];
    }

    const effectiveLimit = Math.min(limit, records.length);
    const startIndex = records.length - effectiveLimit;
    const trail: TemporalAuditEntry[] = [];

    for (let i = startIndex; i < records.length; i++) {
      const rec = records[i];
      trail.push({
        eventId: rec.eventId,
        elementId: rec.elementId,
        bridgeTimeMs: rec.bridgeTimeMs,
        agentId: rec.agentId,
        mutationType: rec.mutationType,
        causalPosition: rec.causalPosition,
      });
    }

    return trail;
  }
}
