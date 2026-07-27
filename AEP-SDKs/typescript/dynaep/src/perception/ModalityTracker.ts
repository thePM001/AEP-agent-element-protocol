// @PAD: /root/dynAEP/sdk/typescript/src/perception/ModalityTracker.ts
// ===========================================================================
// @dynaep/core - Modality Tracker
// OPT-010: Provides atomic read-evaluate-update for the cross-modality
// constraint. Maintains active modality state and injects it into Rego
// input for the perception policy evaluation.
//
// In Node.js single-threaded event loop, the sequence
//   getActiveState() -> evaluate() -> recordActivation()
// is naturally atomic within a single synchronous execution frame.
// If Rego evaluation is ever made async, this section must be wrapped
// in a serialization mechanism.
// ===========================================================================

import type { BridgeClock } from "../temporal/clock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PerceptionConfig {
  maxSimultaneousModalities: number;
}

export interface ModalityState {
  activeCount: number;
  activeModalities: string[];
}

export interface ModalityInfo {
  modality: string;
  eventId: string;
  startedAt: number;
  estimatedDurationMs: number;
}

// ---------------------------------------------------------------------------
// ModalityTracker
// ---------------------------------------------------------------------------

/**
 * Tracks active output modalities and enforces the cross-modality ceiling.
 *
 * THREAD SAFETY (Node.js):
 * The getActiveState -> Rego evaluate -> recordActivation sequence is
 * naturally atomic in Node.js's single-threaded event loop because no
 * other microtask or macrotask can interleave between synchronous calls.
 *
 * THREAD SAFETY (Python):
 * The Python mirror must wrap the same sequence with threading.Lock.
 */
export class ModalityTracker {
  private readonly maxSimultaneous: number;
  private readonly bridgeClock: BridgeClock;
  private readonly activeModalities: Map<string, ModalityInfo>;

  constructor(config: PerceptionConfig, bridgeClock: BridgeClock) {
    this.maxSimultaneous = config.maxSimultaneousModalities;
    this.bridgeClock = bridgeClock;
    this.activeModalities = new Map<string, ModalityInfo>();
  }

  /**
   * Returns the current active modality count and list.
   * Expires completed modalities based on estimated duration before
   * returning the count. This ensures the Rego policy receives
   * accurate state on every evaluation.
   *
   * Uses bridgeClock.now() for all time comparisons - never Date.now().
   */
  getActiveState(): ModalityState {
    this.expireCompletedModalities();

    const activeModalities: string[] = [];
    for (const [modality] of this.activeModalities) {
      activeModalities.push(modality);
    }

    return {
      activeCount: activeModalities.length,
      activeModalities,
    };
  }

  /**
   * Record a new active modality. Called ONLY after successful Rego
   * evaluation that permits the activation.
   *
   * ATOMICITY: In Node.js, this MUST be called synchronously after
   * getActiveState() and Rego evaluation, with no await in between.
   */
  recordActivation(
    modality: string,
    eventId: string,
    durationMs: number,
  ): void {
    const now = this.bridgeClock.now();
    this.activeModalities.set(modality, {
      modality,
      eventId,
      startedAt: now,
      estimatedDurationMs: durationMs,
    });
  }

  /**
   * Explicitly marks a modality as completed. For events that signal
   * completion before the estimated duration expires.
   */
  recordCompletion(modality: string): void {
    this.activeModalities.delete(modality);
  }

  /**
   * Full state for debugging and monitoring.
   */
  getActiveModalities(): Map<string, ModalityInfo> {
    this.expireCompletedModalities();
    const snapshot = new Map<string, ModalityInfo>();
    for (const [key, info] of this.activeModalities) {
      snapshot.set(key, { ...info });
    }
    return snapshot;
  }

  /**
   * Return the maximum simultaneous modalities ceiling.
   */
  getMaxSimultaneous(): number {
    return this.maxSimultaneous;
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  /**
   * Expire modalities whose estimated duration has elapsed.
   * Uses bridge-authoritative time for all comparisons.
   */
  private expireCompletedModalities(): void {
    const now = this.bridgeClock.now();
    const expired: string[] = [];

    for (const [modality, info] of this.activeModalities) {
      if (now > info.startedAt + info.estimatedDurationMs) {
        expired.push(modality);
      }
    }

    for (const modality of expired) {
      this.activeModalities.delete(modality);
    }
  }
}
