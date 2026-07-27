// @PAD: /root/dynAEP/sdk/typescript/src/recovery/BridgeRecoveryProtocol.ts
// ===========================================================================
// @dynaep/core - Bridge Recovery Protocol
// TA-3.4: Three-phase recovery protocol for bridge restarts. On restart the
// bridge checks for persisted causal state, announces recovery to agents,
// handles agent re-registration, and replays any buffered events from the
// durable store. This eliminates full resets when the bridge can recover
// within maxRecoveryGapMs of the last persisted snapshot.
//
// Phase 1: Announce Recovery  - load persisted state, emit RECOVERY or RESET
// Phase 2: Agent Re-register  - accept AEP_AGENT_REREGISTER, compare sequences
// Phase 3: Buffer Replay      - replay reorder buffer through causal engine
// ===========================================================================

import type { DurableCausalStore, AgentRegistration } from "../causal/DurableCausalStore";
import type { PartitionedCausalEngine } from "../causal/PartitionedCausalEngine";
import type {
  AgentReregisterEvent,
  ReregisterResultEvent,
  TemporalRecoveryEvent,
  TemporalResetEvent,
} from "../temporal/events";
import {
  createTemporalRecoveryEvent,
  createReregisterResultEvent,
  createTemporalResetEvent,
} from "../temporal/events";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Configuration for the bridge recovery protocol.
 *
 * @property maxRecoveryGapMs - Maximum age (in milliseconds) of persisted
 *   state that the bridge will accept for recovery. State older than this
 *   triggers a full reset instead.
 * @property enabled - When false, the protocol always falls back to a full
 *   reset regardless of persisted state.
 */
export interface RecoveryConfig {
  maxRecoveryGapMs: number;
  enabled: boolean;
}

/**
 * Result of a recovery attempt, capturing what was restored (or not)
 * and any events lost during the gap.
 *
 * @property recovered - True if persisted state was loaded successfully.
 * @property source - Backend that provided the state, or "none" if recovery
 *   was skipped or failed.
 * @property restoredAgents - Agent IDs found in the persisted registry.
 * @property restoredCausalPosition - Global causal position counter restored
 *   from the durable store.
 * @property gapMs - Milliseconds between the persisted snapshot and the
 *   current wall-clock time.
 * @property droppedEvents - Number of buffered events that failed replay
 *   during Phase 3.
 * @property stateAge - Human-readable description of the snapshot age
 *   (e.g. "12s", "3m 45s", "2h 10m").
 */
export interface RecoveryResult {
  recovered: boolean;
  source: "file" | "sqlite" | "external" | "none";
  restoredAgents: string[];
  restoredCausalPosition: number;
  gapMs: number;
  droppedEvents: number;
  stateAge: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Format a duration in milliseconds as a human-readable age string.
 * Produces compact output: "0s", "42s", "3m 12s", "1h 5m", "2d 3h".
 */
function formatAge(ms: number): string {
  if (ms < 0) ms = 0;

  const totalSeconds = Math.floor(ms / 1000);

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const totalMinutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  if (totalMinutes < 60) {
    return remainingSeconds > 0
      ? `${totalMinutes}m ${remainingSeconds}s`
      : `${totalMinutes}m`;
  }

  const totalHours = Math.floor(totalMinutes / 60);
  const remainingMinutes = totalMinutes % 60;

  if (totalHours < 24) {
    return remainingMinutes > 0
      ? `${totalHours}h ${remainingMinutes}m`
      : `${totalHours}h`;
  }

  const totalDays = Math.floor(totalHours / 24);
  const remainingHours = totalHours % 24;

  return remainingHours > 0
    ? `${totalDays}d ${remainingHours}h`
    : `${totalDays}d`;
}

// ---------------------------------------------------------------------------
// BridgeRecoveryProtocol
// ---------------------------------------------------------------------------

/**
 * Three-phase bridge recovery protocol (TA-3.4).
 *
 * Coordinates the recovery of causal ordering state after a bridge restart
 * by loading persisted snapshots, re-registering agents, and replaying
 * buffered events. Emits the appropriate temporal events so that agents
 * can decide whether to resume or reset their own state.
 *
 * Usage:
 * ```ts
 * const protocol = new BridgeRecoveryProtocol(config, store, engine, () =>
 *   clock.getClockQuality(),
 * );
 *
 * const result = await protocol.attemptRecovery();
 * // Emit result.recoveryEvent or result.resetEvent to agents
 *
 * // As agents re-register:
 * const reply = protocol.handleAgentReregister(reregisterEvent);
 * // Send reply back to the agent
 * ```
 */
export class BridgeRecoveryProtocol {
  private readonly config: RecoveryConfig;
  private readonly store: DurableCausalStore;
  private readonly engine: PartitionedCausalEngine;
  private readonly getClockQuality: () => { sync_state: string; confidence_class: string } | null;

  /** Persisted agent registry loaded during Phase 1, keyed by agentId. */
  private restoredAgents: Map<string, AgentRegistration> | null;

  /** Result of the most recent recovery attempt, or null if not yet run. */
  private recoveryResult: RecoveryResult | null;

  /** The recovery event emitted during Phase 1 (if recovery succeeded). */
  private recoveryEvent: TemporalRecoveryEvent | null;

  /** The reset event emitted during Phase 1 (if recovery was skipped). */
  private resetEvent: TemporalResetEvent | null;

  constructor(
    config: RecoveryConfig,
    store: DurableCausalStore,
    engine: PartitionedCausalEngine,
    getClockQuality: () => { sync_state: string; confidence_class: string } | null,
  ) {
    this.config = Object.freeze({ ...config });
    this.store = store;
    this.engine = engine;
    this.getClockQuality = getClockQuality;
    this.restoredAgents = null;
    this.recoveryResult = null;
    this.recoveryEvent = null;
    this.resetEvent = null;
  }

  // -------------------------------------------------------------------------
  // Phase 1: Announce Recovery
  // -------------------------------------------------------------------------

  /**
   * Attempt to recover causal state from the durable store.
   *
   * If persisted state exists and its age is within `maxRecoveryGapMs`,
   * the state is loaded into the causal engine and an
   * `AEP_TEMPORAL_RECOVERY` event is produced. Otherwise the engine is
   * fully reset and an `AEP_TEMPORAL_RESET` event is produced instead.
   *
   * After calling this method, use `getRecoveryEvent()` or
   * `getResetEvent()` to obtain the event that should be broadcast to
   * agents.
   *
   * @returns The recovery result describing what was restored.
   */
  async attemptRecovery(): Promise<RecoveryResult> {
    // If the protocol is disabled, always fall back to full reset
    if (!this.config.enabled) {
      return this.performFullReset("manual");
    }

    // Check for persisted state age
    const stateDate = await this.store.getStateAge();

    if (stateDate === null) {
      // No persisted state exists - full reset
      return this.performFullReset("clock_resync");
    }

    const now = Date.now();
    const gapMs = now - stateDate.getTime();

    if (gapMs > this.config.maxRecoveryGapMs) {
      // State is too old - full reset
      return this.performFullReset("clock_resync");
    }

    // State is within recovery window - attempt to load it
    try {
      // Restore causal engine state from the durable store
      await this.engine.restoreFromStore();

      // Load the agent registry for Phase 2
      this.restoredAgents = await this.store.loadAgentRegistry();

      // Get the restored causal position
      const causalPosition = await this.store.loadCausalPosition();

      // Get the restored vector clocks for the recovery event
      const vectorClocks = await this.store.loadVectorClocks();
      const mergedVectorClock: Record<string, number> = {};
      for (const [, agentClocks] of vectorClocks) {
        for (const [agentId, seq] of Object.entries(agentClocks)) {
          const current = mergedVectorClock[agentId] ?? 0;
          if (seq > current) {
            mergedVectorClock[agentId] = seq;
          }
        }
      }

      // Replay buffered events (Phase 3)
      const droppedEvents = await this.replayBufferedEvents();

      // Build the agent ID list from the registry
      const agentIds = Array.from(this.restoredAgents.keys());

      // Determine storage backend source from config
      const source = await this.detectSource();

      // Format the state age for the event
      const stateAge = formatAge(gapMs);

      // Build the recovery result
      const result: RecoveryResult = {
        recovered: true,
        source,
        restoredAgents: agentIds,
        restoredCausalPosition: causalPosition,
        gapMs,
        droppedEvents,
        stateAge,
      };
      this.recoveryResult = result;

      // Emit the AEP_TEMPORAL_RECOVERY event
      this.recoveryEvent = createTemporalRecoveryEvent({
        recoveredAt: now,
        restoredAgents: agentIds,
        restoredVectorClock: mergedVectorClock,
        restoredCausalPosition: causalPosition,
        stateAge,
        gapMs,
        droppedEvents,
        source,
      });

      return result;
    } catch {
      // Recovery failed - fall back to full reset
      return this.performFullReset("clock_resync");
    }
  }

  // -------------------------------------------------------------------------
  // Phase 2: Agent Re-registration
  // -------------------------------------------------------------------------

  /**
   * Handle an `AEP_AGENT_REREGISTER` event from an agent.
   *
   * Compares the agent's reported `lastSequence` against the persisted
   * registry to determine whether the agent can resume, must reset, or
   * is unknown to the bridge.
   *
   * @param event - The re-registration event sent by the agent.
   * @returns A `ReregisterResultEvent` to send back to the agent.
   */
  handleAgentReregister(event: AgentReregisterEvent): ReregisterResultEvent {
    const { agentId, lastSequence } = event;

    // Get the current bridge clock state for the response
    const clockQuality = this.getClockQuality();
    const bridgeClockState = clockQuality
      ? { sync_state: clockQuality.sync_state, confidence_class: clockQuality.confidence_class }
      : { sync_state: "FREEWHEEL", confidence_class: "F" };

    // If no recovery has been performed or agents were not restored,
    // the agent is unknown
    if (!this.restoredAgents) {
      return createReregisterResultEvent({
        agentId,
        status: "unknown",
        restoredSequence: 0,
        gapEvents: 0,
        bridgeClockState,
      });
    }

    const registration = this.restoredAgents.get(agentId);

    if (!registration) {
      // Agent is not in the persisted registry
      return createReregisterResultEvent({
        agentId,
        status: "unknown",
        restoredSequence: 0,
        gapEvents: 0,
        bridgeClockState,
      });
    }

    // Agent is known - compare sequences
    if (registration.lastSequence === lastSequence) {
      // Sequences match: agent can resume from where it left off
      return createReregisterResultEvent({
        agentId,
        status: "resumed",
        restoredSequence: registration.lastSequence,
        gapEvents: 0,
        bridgeClockState,
      });
    }

    // Sequences differ: agent must reset its state
    const gapEvents = Math.abs(lastSequence - registration.lastSequence);

    return createReregisterResultEvent({
      agentId,
      status: "reset",
      restoredSequence: registration.lastSequence,
      gapEvents,
      bridgeClockState,
    });
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Return the result of the most recent recovery attempt.
   * Returns null if `attemptRecovery()` has not been called yet.
   */
  getRecoveryResult(): RecoveryResult | null {
    return this.recoveryResult;
  }

  /**
   * Return the `AEP_TEMPORAL_RECOVERY` event produced during Phase 1.
   * Returns null if recovery was not attempted or fell back to reset.
   */
  getRecoveryEvent(): TemporalRecoveryEvent | null {
    return this.recoveryEvent;
  }

  /**
   * Return the `AEP_TEMPORAL_RESET` event produced during Phase 1.
   * Returns null if recovery succeeded (no reset was needed).
   */
  getResetEvent(): TemporalResetEvent | null {
    return this.resetEvent;
  }

  // -------------------------------------------------------------------------
  // Private Helpers
  // -------------------------------------------------------------------------

  /**
   * Perform a full reset of the causal engine and produce an
   * `AEP_TEMPORAL_RESET` event. Used when persisted state is missing,
   * too old, or failed to load.
   */
  private performFullReset(
    reason: "schema_reload" | "clock_resync" | "manual",
  ): RecoveryResult {
    // Capture the old vector clock before resetting
    const snapshot = this.engine.getStateSnapshot();
    const oldVectorClock: Record<string, number> = {};
    for (const [, agentClocks] of Object.entries(snapshot.vectorClocks)) {
      for (const [agentId, seq] of Object.entries(agentClocks)) {
        const current = oldVectorClock[agentId] ?? 0;
        if (seq > current) {
          oldVectorClock[agentId] = seq;
        }
      }
    }

    // Reset the engine
    this.engine.reset();

    // Emit AEP_TEMPORAL_RESET
    this.resetEvent = createTemporalResetEvent({
      reason,
      oldVectorClock,
      newVectorClock: {},
      resetAt: Date.now(),
    });

    // Clear any stale recovery state
    this.restoredAgents = null;
    this.recoveryEvent = null;

    const result: RecoveryResult = {
      recovered: false,
      source: "none",
      restoredAgents: [],
      restoredCausalPosition: 0,
      gapMs: 0,
      droppedEvents: 0,
      stateAge: "0s",
    };
    this.recoveryResult = result;

    return result;
  }

  /**
   * Phase 3: Replay buffered events from the durable store through the
   * causal engine. Returns the count of events that failed to replay
   * (dropped events).
   */
  private async replayBufferedEvents(): Promise<number> {
    const buffer = await this.store.loadReorderBuffer();

    if (buffer.length === 0) {
      return 0;
    }

    let droppedEvents = 0;

    // Sort buffered events by their bufferedAt timestamp to replay in order
    const sorted = [...buffer].sort((a, b) => a.bufferedAt - b.bufferedAt);

    for (const buffered of sorted) {
      try {
        const result = this.engine.processEvent(buffered.event);
        if (!result.ordered) {
          droppedEvents++;
        }
      } catch {
        // Event failed to replay - count as dropped
        droppedEvents++;
      }
    }

    return droppedEvents;
  }

  /**
   * Detect the storage backend source by attempting to determine what
   * kind of durable store is in use. Falls back to "file" if the
   * backend cannot be determined.
   */
  private async detectSource(): Promise<"file" | "sqlite" | "external"> {
    // The DurableCausalStore interface does not expose its backend type
    // directly. We infer it from the constructor name or prototype chain
    // of the store instance.
    const ctorName = this.store.constructor?.name?.toLowerCase() ?? "";

    if (ctorName.includes("sqlite")) {
      return "sqlite";
    }
    if (ctorName.includes("redis") || ctorName.includes("postgres") || ctorName.includes("external")) {
      return "external";
    }

    return "file";
  }
}
