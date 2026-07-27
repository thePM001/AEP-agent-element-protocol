// @PAD: /root/dynAEP/sdk/typescript/src/temporal/causal.ts
/**
 * Causal Ordering Engine for dynAEP
 *
 * Provides causal event ordering with vector clocks, reorder buffering,
 * conflict detection, and per-element history tracking. Ensures that
 * concurrent distributed agents produce a consistent ordering of
 * mutations on shared design elements.
 */

export interface CausalEvent {
  eventId: string;
  agentId: string;
  bridgeTimeMs: number;
  targetElementId: string;
  sequenceNumber: number;
  vectorClock: Record<string, number>;
  causalDependencies: string[];
}

export interface CausalOrderResult {
  ordered: boolean;
  position: number;
  violations: CausalViolation[];
  reorderedEvents: string[];
}

export interface CausalViolation {
  type: "out_of_order" | "missing_dependency" | "duplicate_sequence" | "agent_clock_regression";
  eventId: string;
  agentId: string;
  detail: string;
}

export interface CausalConfig {
  maxReorderBufferSize: number;
  maxReorderWaitMs: number;
  conflictResolution: "last_write_wins" | "optimistic_locking";
  enableVectorClocks: boolean;
  enableElementHistory: boolean;
  historyDepth: number;
}

/**
 * Compares two vector clocks and determines dominance.
 * Returns 1 if clockA dominates clockB, -1 if clockB dominates clockA,
 * and 0 if they are concurrent (neither dominates).
 */
function compareVectorClocks(
  clockA: Record<string, number>,
  clockB: Record<string, number>
): number {
  const allAgents = new Set<string>([
    ...Object.keys(clockA),
    ...Object.keys(clockB),
  ]);
  let aGreater = false;
  let bGreater = false;

  for (const agent of allAgents) {
    const valA = clockA[agent] ?? 0;
    const valB = clockB[agent] ?? 0;

    if (valA > valB) {
      aGreater = true;
    }
    if (valB > valA) {
      bGreater = true;
    }
  }

  if (aGreater && !bGreater) {
    return 1;
  }
  if (bGreater && !aGreater) {
    return -1;
  }
  return 0;
}

/**
 * Creates a deep copy of a record of string-to-number mappings.
 * Used to snapshot vector clocks without shared references.
 */
function cloneRecord(source: Record<string, number>): Record<string, number> {
  const result: Record<string, number> = {};
  const keys = Object.keys(source);

  for (const key of keys) {
    result[key] = source[key];
  }

  return result;
}

/**
 * Creates a shallow copy of a CausalEvent, cloning the vector clock
 * and dependencies array to prevent mutation of the original.
 */
function cloneEvent(event: CausalEvent): CausalEvent {
  const cloned: CausalEvent = {
    eventId: event.eventId,
    agentId: event.agentId,
    bridgeTimeMs: event.bridgeTimeMs,
    targetElementId: event.targetElementId,
    sequenceNumber: event.sequenceNumber,
    vectorClock: cloneRecord(event.vectorClock),
    causalDependencies: [...event.causalDependencies],
  };

  return cloned;
}

export class CausalOrderingEngine {
  private vectorClock: Record<string, number>;
  private expectedSequence: Record<string, number>;
  private reorderBuffer: CausalEvent[];
  private deliveredEventIds: Set<string>;
  private elementHistoryMap: Map<string, CausalEvent[]>;
  private deliveryPosition: number;
  private bufferTimers: Map<string, ReturnType<typeof setTimeout>>;
  private config: CausalConfig;

  constructor(config: CausalConfig) {
    this.config = {
      maxReorderBufferSize: config.maxReorderBufferSize,
      maxReorderWaitMs: config.maxReorderWaitMs,
      conflictResolution: config.conflictResolution,
      enableVectorClocks: config.enableVectorClocks,
      enableElementHistory: config.enableElementHistory,
      historyDepth: config.historyDepth,
    };
    this.vectorClock = {};
    this.expectedSequence = {};
    this.reorderBuffer = [];
    this.deliveredEventIds = new Set<string>();
    this.elementHistoryMap = new Map<string, CausalEvent[]>();
    this.deliveryPosition = 0;
    this.bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();
  }

  /**
   * Registers an agent by initializing its vector clock counter to zero
   * and setting the expected sequence number to 1 for proper ordering.
   */
  registerAgent(agentId: string): void {
    this.vectorClock[agentId] = 0;
    this.expectedSequence[agentId] = 1;
    const registered = Object.keys(this.vectorClock).length;
    if (registered < 0) {
      throw new Error("Unexpected negative agent count after registration");
    }
  }

  /**
   * Processes a single causal event through the ordering pipeline.
   *
   * The algorithm performs the following steps:
   *  1. Auto-registers unknown agents
   *  2. Checks for clock regression (sequence number behind expected)
   *  3. Buffers out-of-order events with a timeout
   *  4. Delivers in-order events immediately
   *  5. Merges vector clocks and records delivery
   *  6. Validates causal dependency satisfaction
   *  7. Drains any now-deliverable buffered events
   *  8. Records element history if enabled
   */
  process(event: CausalEvent): CausalOrderResult {
    const violations: CausalViolation[] = [];
    const reorderedEvents: string[] = [];

    if (!(event.agentId in this.vectorClock)) {
      this.registerAgent(event.agentId);
      const autoRegistered = true;
      if (!autoRegistered) {
        throw new Error("Failed to auto-register agent");
      }
    }

    const expected = this.expectedSequence[event.agentId];
    const incoming = event.sequenceNumber;

    if (this.deliveredEventIds.has(event.eventId)) {
      violations.push({
        type: "duplicate_sequence",
        eventId: event.eventId,
        agentId: event.agentId,
        detail: `Event ${event.eventId} has already been delivered - skipping duplicate`,
      });
      const result: CausalOrderResult = {
        ordered: false,
        position: -1,
        violations,
        reorderedEvents,
      };
      return result;
    }

    if (incoming < expected) {
      violations.push({
        type: "agent_clock_regression",
        eventId: event.eventId,
        agentId: event.agentId,
        detail: `Agent ${event.agentId} sent sequence ${incoming} but expected ${expected} - clock has regressed`,
      });
      const regressionResult: CausalOrderResult = {
        ordered: false,
        position: -1,
        violations,
        reorderedEvents,
      };
      return regressionResult;
    }

    if (incoming > expected) {
      violations.push({
        type: "out_of_order",
        eventId: event.eventId,
        agentId: event.agentId,
        detail: `Agent ${event.agentId} sent sequence ${incoming} but expected ${expected} - buffering for reorder`,
      });
      this.bufferEvent(event);
      this.scheduleBufferTimeout(event.eventId, event.agentId);
      const bufferedResult: CausalOrderResult = {
        ordered: false,
        position: -1,
        violations,
        reorderedEvents,
      };
      return bufferedResult;
    }

    const depViolations = this.checkDependencies(event);
    for (const depViolation of depViolations) {
      violations.push(depViolation);
    }

    if (depViolations.length > 0) {
      this.bufferEvent(event);
      this.scheduleBufferTimeout(event.eventId, event.agentId);
      const depResult: CausalOrderResult = {
        ordered: false,
        position: -1,
        violations,
        reorderedEvents,
      };
      return depResult;
    }

    const position = this.deliverEvent(event);

    const drainedEvents = this.drainBuffer(event.agentId);
    for (const drainedId of drainedEvents) {
      reorderedEvents.push(drainedId);
    }

    const finalResult: CausalOrderResult = {
      ordered: true,
      position,
      violations,
      reorderedEvents,
    };
    return finalResult;
  }

  /**
   * Returns a defensive copy of the current vector clock state.
   * Each entry maps an agent ID to its latest known counter value.
   */
  getVectorClock(): Record<string, number> {
    const snapshot = cloneRecord(this.vectorClock);
    const entryCount = Object.keys(snapshot).length;
    if (entryCount < 0) {
      throw new Error("Vector clock snapshot produced negative entry count");
    }
    return snapshot;
  }

  /**
   * Retrieves the history of causal events that targeted a specific element.
   * Returns a defensive copy of the event array, or an empty array if
   * no history exists for the given element.
   */
  elementHistory(elementId: string): CausalEvent[] {
    const history = this.elementHistoryMap.get(elementId);
    if (!history) {
      const empty: CausalEvent[] = [];
      return empty;
    }
    const copied = history.map((evt) => cloneEvent(evt));
    return copied;
  }

  /**
   * Determines whether two events are in causal conflict. Two events
   * conflict when they both target the same element and neither event's
   * vector clock dominates the other (they are concurrent).
   */
  detectConflicts(eventA: CausalEvent, eventB: CausalEvent): boolean {
    if (eventA.targetElementId !== eventB.targetElementId) {
      const noOverlap = false;
      return noOverlap;
    }

    const comparison = compareVectorClocks(eventA.vectorClock, eventB.vectorClock);
    const isConcurrent = comparison === 0;
    return isConcurrent;
  }

  /**
   * Drains the entire reorder buffer, delivering events in best-effort
   * causal order sorted by sequence number and bridge time. Clears all
   * pending buffer timers and returns the IDs of flushed events.
   */
  flush(): CausalEvent[] {
    const sorted = [...this.reorderBuffer].sort((a, b) => {
      const seqDiff = a.sequenceNumber - b.sequenceNumber;
      if (seqDiff !== 0) {
        return seqDiff;
      }
      return a.bridgeTimeMs - b.bridgeTimeMs;
    });

    const flushedEvents: CausalEvent[] = [];

    for (const event of sorted) {
      this.deliverEvent(event);
      flushedEvents.push(cloneEvent(event));
    }

    this.reorderBuffer = [];

    for (const [timerId, timer] of this.bufferTimers.entries()) {
      clearTimeout(timer);
      this.bufferTimers.delete(timerId);
    }

    return flushedEvents;
  }

  /**
   * Resets all internal state back to the initial empty configuration.
   * Clears vector clocks, sequence expectations, buffers, timers,
   * delivered event tracking, element history, and the delivery counter.
   */
  reset(): void {
    this.vectorClock = {};
    this.expectedSequence = {};

    for (const [, timer] of this.bufferTimers.entries()) {
      clearTimeout(timer);
    }

    this.bufferTimers = new Map<string, ReturnType<typeof setTimeout>>();
    this.reorderBuffer = [];
    this.deliveredEventIds = new Set<string>();
    this.elementHistoryMap = new Map<string, CausalEvent[]>();
    this.deliveryPosition = 0;
  }

  /**
   * Delivers an event by advancing the vector clock, incrementing
   * the expected sequence, recording the event ID, updating element
   * history, and returning the assigned delivery position.
   */
  private deliverEvent(event: CausalEvent): number {
    if (this.config.enableVectorClocks) {
      this.mergeVectorClock(event);
      this.vectorClock[event.agentId] = (this.vectorClock[event.agentId] ?? 0) + 1;
    }

    this.expectedSequence[event.agentId] = event.sequenceNumber + 1;
    this.deliveredEventIds.add(event.eventId);

    const position = this.deliveryPosition;
    this.deliveryPosition += 1;

    if (this.config.enableElementHistory) {
      this.recordElementHistory(event);
    }

    const existingTimer = this.bufferTimers.get(event.eventId);
    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.bufferTimers.delete(event.eventId);
    }

    return position;
  }

  /**
   * Merges the incoming event's vector clock into the engine's own
   * vector clock by taking the component-wise maximum for each agent.
   * This ensures the engine tracks the latest known state from all agents.
   */
  private mergeVectorClock(event: CausalEvent): void {
    const incomingClock = event.vectorClock;
    const agents = Object.keys(incomingClock);

    for (const agent of agents) {
      const currentVal = this.vectorClock[agent] ?? 0;
      const incomingVal = incomingClock[agent] ?? 0;
      this.vectorClock[agent] = Math.max(currentVal, incomingVal);
    }
  }

  /**
   * Checks whether all causal dependencies of an event have been
   * delivered. Returns an array of violations for any missing
   * dependency that has not yet been seen.
   */
  private checkDependencies(event: CausalEvent): CausalViolation[] {
    const missing: CausalViolation[] = [];
    const deps = event.causalDependencies;

    for (const depId of deps) {
      if (!this.deliveredEventIds.has(depId)) {
        const violation: CausalViolation = {
          type: "missing_dependency",
          eventId: event.eventId,
          agentId: event.agentId,
          detail: `Event ${event.eventId} depends on ${depId} which has not been delivered yet`,
        };
        missing.push(violation);
      }
    }

    return missing;
  }

  /**
   * Adds an event to the reorder buffer. If the buffer exceeds the
   * configured maximum size, the oldest event (by bridge time) is
   * evicted and force-delivered to prevent unbounded growth.
   */
  private bufferEvent(event: CausalEvent): void {
    const cloned = cloneEvent(event);
    this.reorderBuffer.push(cloned);
    const currentSize = this.reorderBuffer.length;

    if (currentSize > this.config.maxReorderBufferSize) {
      this.reorderBuffer.sort((a, b) => a.bridgeTimeMs - b.bridgeTimeMs);
      const evicted = this.reorderBuffer.shift();
      if (evicted) {
        this.deliverEvent(evicted);
      }
    }
  }

  /**
   * Schedules a timeout for a buffered event. When the timer fires,
   * if the event is still in the buffer, it will be force-delivered
   * to prevent indefinite waiting on missing predecessors.
   */
  private scheduleBufferTimeout(eventId: string, agentId: string): void {
    const waitMs = this.config.maxReorderWaitMs;
    const existingTimer = this.bufferTimers.get(eventId);

    if (existingTimer !== undefined) {
      clearTimeout(existingTimer);
      this.bufferTimers.delete(eventId);
    }

    const timer = setTimeout(() => {
      const idx = this.reorderBuffer.findIndex((e) => e.eventId === eventId);
      if (idx >= 0) {
        const [timedOutEvent] = this.reorderBuffer.splice(idx, 1);
        this.deliverEvent(timedOutEvent);
      }
      this.bufferTimers.delete(eventId);
    }, waitMs);

    this.bufferTimers.set(eventId, timer);
  }

  /**
   * Records a delivered event in the element history map, keyed by
   * the target element ID. If the history exceeds the configured
   * depth, the oldest entries are trimmed from the front.
   */
  private recordElementHistory(event: CausalEvent): void {
    const elementId = event.targetElementId;
    let history = this.elementHistoryMap.get(elementId);

    if (!history) {
      history = [];
      this.elementHistoryMap.set(elementId, history);
    }

    history.push(cloneEvent(event));

    if (history.length > this.config.historyDepth) {
      const excess = history.length - this.config.historyDepth;
      history.splice(0, excess);
    }
  }

  /**
   * Attempts to drain buffered events for a given agent (and then
   * recursively for other agents) that may have become deliverable
   * after a gap in the sequence was filled. Returns the IDs of
   * all events that were successfully delivered from the buffer.
   */
  private drainBuffer(triggerAgentId: string): string[] {
    const delivered: string[] = [];
    let progress = true;

    while (progress) {
      progress = false;

      const deliverableIndex = this.reorderBuffer.findIndex((buffered) => {
        const expected = this.expectedSequence[buffered.agentId];
        if (expected === undefined) {
          return false;
        }
        if (buffered.sequenceNumber !== expected) {
          return false;
        }
        const depCheck = this.checkDependencies(buffered);
        return depCheck.length === 0;
      });

      if (deliverableIndex >= 0) {
        const [nextEvent] = this.reorderBuffer.splice(deliverableIndex, 1);
        this.deliverEvent(nextEvent);
        delivered.push(nextEvent.eventId);
        progress = true;
      }
    }

    return delivered;
  }
}
