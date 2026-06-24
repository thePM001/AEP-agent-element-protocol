// @PAD: /root/dynAEP/sdk/typescript/src/causal/SubtreeOrderingContext.ts
// ===========================================================================
// @dynaep/core - Subtree Ordering Context
// OPT-005: Per-partition ordering logic for the PartitionedCausalEngine.
// Contains a sparse vector clock, reorder buffer, dependency tracker,
// and conflict detection scoped to a single scene graph subtree.
// ===========================================================================

import { SparseVectorClock } from "./SparseVectorClock";
import type {
  CausalEvent,
  CausalOrderResult,
  CausalViolation,
  CausalConfig,
} from "../temporal/causal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PartitionStats {
  partitionKey: string;
  agentCount: number;
  bufferSize: number;
  bufferCapacity: number;
  deliveredCount: number;
  conflictCount: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function cloneEvent(event: CausalEvent): CausalEvent {
  return {
    eventId: event.eventId,
    agentId: event.agentId,
    bridgeTimeMs: event.bridgeTimeMs,
    targetElementId: event.targetElementId,
    sequenceNumber: event.sequenceNumber,
    vectorClock: { ...event.vectorClock },
    causalDependencies: [...event.causalDependencies],
  };
}

// ---------------------------------------------------------------------------
// SubtreeOrderingContext
// ---------------------------------------------------------------------------

/**
 * Manages causal ordering for a single scene graph subtree partition.
 * Each partition has its own vector clock, reorder buffer, and delivery
 * tracking, preventing out-of-order events in one subtree from blocking
 * unrelated subtrees.
 */
export class SubtreeOrderingContext {
  readonly partitionKey: string;
  private vectorClock: SparseVectorClock;
  private expectedSequence: Map<string, number>;
  private reorderBuffer: CausalEvent[];
  private deliveredEventIds: Set<string>;
  private elementHistoryMap: Map<string, CausalEvent[]>;
  private deliveryPosition: number;
  private bufferTimers: Map<string, ReturnType<typeof setTimeout>>;
  private bufferCapacity: number;
  private config: CausalConfig;
  private conflictCount: number;
  private locked: boolean;

  constructor(partitionKey: string, config: CausalConfig, bufferCapacity: number) {
    this.partitionKey = partitionKey;
    this.config = config;
    this.bufferCapacity = bufferCapacity;
    this.vectorClock = new SparseVectorClock();
    this.expectedSequence = new Map<string, number>();
    this.reorderBuffer = [];
    this.deliveredEventIds = new Set<string>();
    this.elementHistoryMap = new Map<string, CausalEvent[]>();
    this.deliveryPosition = 0;
    this.bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();
    this.conflictCount = 0;
    this.locked = false;
  }

  /**
   * Acquire the partition lock. Used for cross-partition moves.
   * Returns true if lock was acquired, false if already locked.
   */
  tryLock(): boolean {
    if (this.locked) {
      return false;
    }
    this.locked = true;
    return true;
  }

  /**
   * Release the partition lock.
   */
  unlock(): void {
    this.locked = false;
  }

  /**
   * Check if the partition is currently locked.
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Check if an event has been delivered in this partition.
   */
  hasDelivered(eventId: string): boolean {
    return this.deliveredEventIds.has(eventId);
  }

  /**
   * Process a single causal event within this partition context.
   */
  process(event: CausalEvent): CausalOrderResult {
    const violations: CausalViolation[] = [];
    const reorderedEvents: string[] = [];

    // Auto-register unknown agents in this partition
    if (!this.expectedSequence.has(event.agentId)) {
      this.expectedSequence.set(event.agentId, 1);
    }

    // Duplicate check
    if (this.deliveredEventIds.has(event.eventId)) {
      violations.push({
        type: "duplicate_sequence",
        eventId: event.eventId,
        agentId: event.agentId,
        detail: `Event ${event.eventId} already delivered in partition ${this.partitionKey}`,
      });
      return { ordered: false, position: -1, violations, reorderedEvents };
    }

    const expected = this.expectedSequence.get(event.agentId)!;
    const incoming = event.sequenceNumber;

    // Clock regression
    if (incoming < expected) {
      violations.push({
        type: "agent_clock_regression",
        eventId: event.eventId,
        agentId: event.agentId,
        detail: `Agent ${event.agentId} sent seq ${incoming} but expected ${expected} in partition ${this.partitionKey}`,
      });
      return { ordered: false, position: -1, violations, reorderedEvents };
    }

    // Out-of-order: buffer
    if (incoming > expected) {
      violations.push({
        type: "out_of_order",
        eventId: event.eventId,
        agentId: event.agentId,
        detail: `Agent ${event.agentId} sent seq ${incoming} but expected ${expected} - buffering in partition ${this.partitionKey}`,
      });
      this.bufferEvent(event);
      this.scheduleBufferTimeout(event.eventId);
      return { ordered: false, position: -1, violations, reorderedEvents };
    }

    // Check dependencies (within this partition only by default)
    const depViolations = this.checkDependencies(event);
    if (depViolations.length > 0) {
      for (const v of depViolations) violations.push(v);
      this.bufferEvent(event);
      this.scheduleBufferTimeout(event.eventId);
      return { ordered: false, position: -1, violations, reorderedEvents };
    }

    // Deliver
    const position = this.deliverEvent(event);

    // Drain buffer
    const drained = this.drainBuffer();
    for (const id of drained) {
      reorderedEvents.push(id);
    }

    return { ordered: true, position, violations, reorderedEvents };
  }

  /**
   * Check if dependencies have been delivered. Can optionally check
   * a cross-partition dependency resolver.
   */
  checkDependencies(
    event: CausalEvent,
    crossPartitionCheck?: (depId: string) => boolean,
  ): CausalViolation[] {
    const missing: CausalViolation[] = [];
    for (const depId of event.causalDependencies) {
      const deliveredLocally = this.deliveredEventIds.has(depId);
      const deliveredCrossPartition = crossPartitionCheck ? crossPartitionCheck(depId) : false;
      if (!deliveredLocally && !deliveredCrossPartition) {
        missing.push({
          type: "missing_dependency",
          eventId: event.eventId,
          agentId: event.agentId,
          detail: `Event ${event.eventId} depends on ${depId} which has not been delivered`,
        });
      }
    }
    return missing;
  }

  /**
   * Detect conflicts between two events targeting the same element
   * using sparse vector clock comparison.
   */
  detectConflicts(eventA: CausalEvent, eventB: CausalEvent): boolean {
    if (eventA.targetElementId !== eventB.targetElementId) {
      return false;
    }
    const clockA = new SparseVectorClock(eventA.vectorClock);
    const clockB = new SparseVectorClock(eventB.vectorClock);
    const concurrent = clockA.isConcurrentWith(clockB);
    if (concurrent) {
      this.conflictCount++;
    }
    return concurrent;
  }

  /**
   * Get the sparse vector clock for this partition.
   */
  getVectorClock(): SparseVectorClock {
    return this.vectorClock.clone();
  }

  /**
   * Get element history within this partition.
   */
  elementHistory(elementId: string): CausalEvent[] {
    const history = this.elementHistoryMap.get(elementId);
    if (!history) return [];
    return history.map(cloneEvent);
  }

  /**
   * Flush all buffered events in best-effort order.
   */
  flush(): CausalEvent[] {
    const sorted = [...this.reorderBuffer].sort((a, b) => {
      const seqDiff = a.sequenceNumber - b.sequenceNumber;
      if (seqDiff !== 0) return seqDiff;
      return a.bridgeTimeMs - b.bridgeTimeMs;
    });

    const flushed: CausalEvent[] = [];
    for (const event of sorted) {
      this.deliverEvent(event);
      flushed.push(cloneEvent(event));
    }

    this.reorderBuffer = [];
    for (const [, timer] of this.bufferTimers) {
      clearTimeout(timer);
    }
    this.bufferTimers.clear();

    return flushed;
  }

  /**
   * Reset all state in this partition.
   */
  reset(): void {
    this.vectorClock = new SparseVectorClock();
    this.expectedSequence = new Map<string, number>();
    for (const [, timer] of this.bufferTimers) {
      clearTimeout(timer);
    }
    this.bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();
    this.reorderBuffer = [];
    this.deliveredEventIds = new Set<string>();
    this.elementHistoryMap = new Map<string, CausalEvent[]>();
    this.deliveryPosition = 0;
    this.conflictCount = 0;
    this.locked = false;
  }

  /**
   * Remove tracking for an element (used when element moves to another partition).
   */
  removeElement(elementId: string): void {
    this.elementHistoryMap.delete(elementId);
    // Remove buffered events targeting this element
    this.reorderBuffer = this.reorderBuffer.filter(
      (e) => e.targetElementId !== elementId,
    );
  }

  /**
   * Get statistics for this partition.
   */
  getStats(): PartitionStats {
    return {
      partitionKey: this.partitionKey,
      agentCount: this.expectedSequence.size,
      bufferSize: this.reorderBuffer.length,
      bufferCapacity: this.bufferCapacity,
      deliveredCount: this.deliveryPosition,
      conflictCount: this.conflictCount,
    };
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  private deliverEvent(event: CausalEvent): number {
    if (this.config.enableVectorClocks) {
      const incoming = new SparseVectorClock(event.vectorClock);
      this.vectorClock.merge(incoming);
      this.vectorClock.increment(event.agentId);
    }

    this.expectedSequence.set(event.agentId, event.sequenceNumber + 1);
    this.deliveredEventIds.add(event.eventId);

    const position = this.deliveryPosition;
    this.deliveryPosition++;

    if (this.config.enableElementHistory) {
      this.recordElementHistory(event);
    }

    const timer = this.bufferTimers.get(event.eventId);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.bufferTimers.delete(event.eventId);
    }

    return position;
  }

  private bufferEvent(event: CausalEvent): void {
    const cloned = cloneEvent(event);
    this.reorderBuffer.push(cloned);

    if (this.reorderBuffer.length > this.bufferCapacity) {
      this.reorderBuffer.sort((a, b) => a.bridgeTimeMs - b.bridgeTimeMs);
      const evicted = this.reorderBuffer.shift();
      if (evicted) {
        this.deliverEvent(evicted);
      }
    }
  }

  private scheduleBufferTimeout(eventId: string): void {
    const existing = this.bufferTimers.get(eventId);
    if (existing !== undefined) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      const idx = this.reorderBuffer.findIndex((e) => e.eventId === eventId);
      if (idx >= 0) {
        const [timedOut] = this.reorderBuffer.splice(idx, 1);
        this.deliverEvent(timedOut);
      }
      this.bufferTimers.delete(eventId);
    }, this.config.maxReorderWaitMs);

    this.bufferTimers.set(eventId, timer);
  }

  private recordElementHistory(event: CausalEvent): void {
    const elementId = event.targetElementId;
    let history = this.elementHistoryMap.get(elementId);
    if (!history) {
      history = [];
      this.elementHistoryMap.set(elementId, history);
    }
    history.push(cloneEvent(event));
    if (history.length > this.config.historyDepth) {
      history.splice(0, history.length - this.config.historyDepth);
    }
  }

  private drainBuffer(): string[] {
    const delivered: string[] = [];
    let progress = true;

    while (progress) {
      progress = false;
      const idx = this.reorderBuffer.findIndex((buffered) => {
        const expected = this.expectedSequence.get(buffered.agentId);
        if (expected === undefined) return false;
        if (buffered.sequenceNumber !== expected) return false;
        const depCheck = this.checkDependencies(buffered);
        return depCheck.length === 0;
      });

      if (idx >= 0) {
        const [next] = this.reorderBuffer.splice(idx, 1);
        this.deliverEvent(next);
        delivered.push(next.eventId);
        progress = true;
      }
    }

    return delivered;
  }
}
