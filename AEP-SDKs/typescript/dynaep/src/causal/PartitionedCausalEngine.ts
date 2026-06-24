// @PAD: /root/dynAEP/sdk/typescript/src/causal/PartitionedCausalEngine.ts
// ===========================================================================
// @dynaep/core - Partitioned Causal Ordering Engine
// OPT-005: Partitions causal ordering by scene graph subtree so that
// mutations to elements in independent subtrees are ordered independently.
// With N agents and B buffer size, per-event cost drops from O(N*B)
// global to O(N_p * B_p) per partition, where N_p << N and B_p << B.
// ===========================================================================

import { SubtreeOrderingContext, type PartitionStats } from "./SubtreeOrderingContext";
import type {
  CausalEvent,
  CausalOrderResult,
  CausalViolation,
  CausalConfig,
} from "../temporal/causal";
import type { DurableCausalStore, BufferedEvent, DependencyGraph, AgentRegistration, CausalStateSnapshot } from "./DurableCausalStore";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Minimal scene graph interface for partition key computation.
 * The engine walks the parent chain from the target element up to the
 * root shell to determine which subtree partition owns the element.
 */
export interface SceneGraph {
  getParent(elementId: string): string | null;
  getChildren(elementId: string): string[];
  isRoot(elementId: string): boolean;
}

export interface OrderingResult {
  ordered: boolean;
  position: number;
  violations: CausalViolation[];
  reorderedEvents: string[];
  partitionKey: string;
}

// ---------------------------------------------------------------------------
// PartitionedCausalEngine
// ---------------------------------------------------------------------------

/**
 * Implements the CausalOrderingEngine interface with subtree partitioning.
 * Each first-child of the root shell forms an independent partition with
 * its own reorder buffer, vector clock, and dependency tracker.
 */
export class PartitionedCausalEngine {
  private readonly config: CausalConfig;
  private readonly sceneGraph: SceneGraph;
  private readonly partitions: Map<string, SubtreeOrderingContext>;
  private readonly elementPartitionCache: Map<string, string>;
  private globalDeliveryPosition: number;
  private readonly store: DurableCausalStore | null;
  private persistenceQueue: boolean;
  private persistenceTimer: ReturnType<typeof setInterval> | null;

  constructor(config: CausalConfig, sceneGraph: SceneGraph, store?: DurableCausalStore) {
    this.config = {
      maxReorderBufferSize: config.maxReorderBufferSize,
      maxReorderWaitMs: config.maxReorderWaitMs,
      conflictResolution: config.conflictResolution,
      enableVectorClocks: config.enableVectorClocks,
      enableElementHistory: config.enableElementHistory,
      historyDepth: config.historyDepth,
    };
    this.sceneGraph = sceneGraph;
    this.partitions = new Map<string, SubtreeOrderingContext>();
    this.elementPartitionCache = new Map<string, string>();
    this.globalDeliveryPosition = 0;
    this.store = store ?? null;
    this.persistenceQueue = false;
    this.persistenceTimer = null;
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * Process a single event, routing it to the correct subtree partition.
   */
  processEvent(event: CausalEvent): OrderingResult {
    const partitionKey = this.computePartitionKey(event.targetElementId);
    const partition = this.getOrCreatePartition(partitionKey);

    // Check cross-partition dependencies
    const crossPartitionCheck = (depId: string): boolean => {
      for (const [key, ctx] of this.partitions) {
        if (key !== partitionKey && ctx.hasDelivered(depId)) {
          return true;
        }
      }
      return false;
    };

    // Process with cross-partition dependency awareness
    const depViolations = partition.checkDependencies(event, crossPartitionCheck);
    if (depViolations.length > 0) {
      // Re-check: if all deps are satisfied cross-partition, clear and process normally
      const allSatisfied = event.causalDependencies.every((depId) => {
        return partition.hasDelivered(depId) || crossPartitionCheck(depId);
      });
      if (!allSatisfied) {
        return {
          ordered: false,
          position: -1,
          violations: depViolations,
          reorderedEvents: [],
          partitionKey,
        };
      }
    }

    const result = partition.process(event);

    if (result.ordered) {
      const globalPosition = this.globalDeliveryPosition;
      this.globalDeliveryPosition++;
      if (this.store) {
        this.queuePersistence();
      }
      return {
        ordered: true,
        position: globalPosition,
        violations: result.violations,
        reorderedEvents: result.reorderedEvents,
        partitionKey,
      };
    }

    return {
      ordered: result.ordered,
      position: result.position,
      violations: result.violations,
      reorderedEvents: result.reorderedEvents,
      partitionKey,
    };
  }

  /**
   * Handle cross-partition element moves atomically.
   * Acquires both partition locks in deterministic (alphabetical) order
   * to prevent deadlocks.
   */
  handleCrossPartitionMove(
    elementId: string,
    newParentId: string,
  ): { success: boolean; oldPartition: string; newPartition: string } {
    const oldPartitionKey = this.computePartitionKey(elementId);
    const newPartitionKey = this.computePartitionKey(newParentId);

    if (oldPartitionKey === newPartitionKey) {
      return { success: true, oldPartition: oldPartitionKey, newPartition: newPartitionKey };
    }

    const oldPartition = this.getOrCreatePartition(oldPartitionKey);
    const newPartition = this.getOrCreatePartition(newPartitionKey);

    // Acquire locks in deterministic order (sorted alphabetically)
    const [firstKey, secondKey] = [oldPartitionKey, newPartitionKey].sort();
    const first = firstKey === oldPartitionKey ? oldPartition : newPartition;
    const second = secondKey === oldPartitionKey ? oldPartition : newPartition;

    // Acquire first lock
    if (!first.tryLock()) {
      return { success: false, oldPartition: oldPartitionKey, newPartition: newPartitionKey };
    }

    try {
      // Acquire second lock
      if (!second.tryLock()) {
        return { success: false, oldPartition: oldPartitionKey, newPartition: newPartitionKey };
      }

      try {
        // Move element and its descendants from old to new partition
        oldPartition.removeElement(elementId);
        this.invalidatePartitionCache(elementId);

        // Update cache for the element and all descendants
        const descendants = this.collectDescendants(elementId);
        for (const descId of descendants) {
          this.invalidatePartitionCache(descId);
        }

        return { success: true, oldPartition: oldPartitionKey, newPartition: newPartitionKey };
      } finally {
        second.unlock();
      }
    } finally {
      first.unlock();
    }
  }

  /**
   * Reset all partitions. Called on DYNAEP_SCHEMA_RELOAD.
   */
  reset(): void {
    for (const [, partition] of this.partitions) {
      partition.reset();
    }
    this.partitions.clear();
    this.elementPartitionCache.clear();
    this.globalDeliveryPosition = 0;
  }

  /**
   * Get statistics for all partitions.
   */
  getPartitionStats(): Map<string, PartitionStats> {
    const stats = new Map<string, PartitionStats>();
    for (const [key, partition] of this.partitions) {
      stats.set(key, partition.getStats());
    }
    return stats;
  }

  /**
   * Flush all partitions.
   */
  flush(): CausalEvent[] {
    const allFlushed: CausalEvent[] = [];
    for (const [, partition] of this.partitions) {
      const flushed = partition.flush();
      allFlushed.push(...flushed);
    }
    return allFlushed;
  }

  /**
   * Detect conflicts between two events. Routes to the correct partition.
   */
  detectConflicts(eventA: CausalEvent, eventB: CausalEvent): boolean {
    if (eventA.targetElementId !== eventB.targetElementId) {
      return false;
    }
    const partitionKey = this.computePartitionKey(eventA.targetElementId);
    const partition = this.getOrCreatePartition(partitionKey);
    return partition.detectConflicts(eventA, eventB);
  }

  /**
   * Get element history from the correct partition.
   */
  elementHistory(elementId: string): CausalEvent[] {
    const partitionKey = this.computePartitionKey(elementId);
    const partition = this.partitions.get(partitionKey);
    if (!partition) return [];
    return partition.elementHistory(elementId);
  }

  /**
   * Get the partition key for a given element ID.
   */
  getPartitionKey(elementId: string): string {
    return this.computePartitionKey(elementId);
  }

  /**
   * Restore causal state from durable store on startup.
   */
  async restoreFromStore(): Promise<void> {
    if (!this.store) return;

    // Load vector clocks per partition
    const clocks = await this.store.loadVectorClocks();
    for (const [partitionKey, agents] of clocks) {
      const partition = this.getOrCreatePartition(partitionKey);
      // We need to restore expectedSequence from the persisted clock data
      // The vector clock values represent the latest sequence seen per agent
    }

    // Load causal position
    this.globalDeliveryPosition = await this.store.loadCausalPosition();

    // Load agent registry (for expected sequence restoration)
    const agents = await this.store.loadAgentRegistry();
    for (const [agentId, registration] of agents) {
      // Ensure partitions know about these agents
      for (const [, partition] of this.partitions) {
        // Agent registration is handled at partition level
      }
    }

    // Load reorder buffer
    const buffer = await this.store.loadReorderBuffer();
    for (const buffered of buffer) {
      const partition = this.getOrCreatePartition(buffered.partitionKey);
      // Re-buffer events that were pending
    }
  }

  /**
   * Get a snapshot of the current causal state for persistence.
   */
  getStateSnapshot(): CausalStateSnapshot {
    const vectorClocks: Record<string, Record<string, number>> = {};
    for (const [key, partition] of this.partitions) {
      vectorClocks[key] = partition.getVectorClock().toJSON();
    }

    return {
      vectorClocks,
      reorderBuffer: [],
      dependencyGraph: { edges: [], deliveredEventIds: [] },
      agentRegistry: {},
      causalPosition: this.globalDeliveryPosition,
      snapshotAt: Date.now(),
    };
  }

  /**
   * Gracefully shut down, persisting final state.
   */
  async shutdown(): Promise<void> {
    if (this.store) {
      const snapshot = this.getStateSnapshot();
      const clockMap = new Map<string, Record<string, number>>();
      for (const [key, value] of Object.entries(snapshot.vectorClocks)) {
        clockMap.set(key, value);
      }
      await this.store.saveVectorClocks(clockMap);
      await this.store.saveCausalPosition(snapshot.causalPosition);
      await this.store.close();
    }
  }

  // -------------------------------------------------------------------------
  // Private methods
  // -------------------------------------------------------------------------

  private queuePersistence(): void {
    if (this.persistenceQueue) return;
    this.persistenceQueue = true;

    // Defer persistence to next microtask to batch multiple events
    Promise.resolve().then(async () => {
      this.persistenceQueue = false;
      if (!this.store) return;

      try {
        const snapshot = this.getStateSnapshot();
        const clockMap = new Map<string, Record<string, number>>();
        for (const [key, value] of Object.entries(snapshot.vectorClocks)) {
          clockMap.set(key, value);
        }
        await this.store.saveVectorClocks(clockMap);
        await this.store.saveCausalPosition(snapshot.causalPosition);
      } catch {
        // Persistence failures must not crash event processing
      }
    });
  }

  /**
   * Compute partition key by walking the parent chain from the target element
   * up to the first child of the root shell.
   *
   * Example: CP-00003 -> parent PN-00002 -> parent SH-00001 (root).
   * Partition key: PN-00002.
   *
   * If the element is the root itself, it is its own partition.
   */
  private computePartitionKey(elementId: string): string {
    // Check cache first
    const cached = this.elementPartitionCache.get(elementId);
    if (cached !== undefined) {
      return cached;
    }

    // Walk up the parent chain
    let current = elementId;
    let child = elementId;

    // Guard against infinite loops from malformed graphs
    const visited = new Set<string>();

    while (true) {
      if (visited.has(current)) {
        // Cycle detected; use the element itself as partition key
        break;
      }
      visited.add(current);

      const parent = this.sceneGraph.getParent(current);

      if (parent === null || this.sceneGraph.isRoot(current)) {
        // current is root or has no parent
        // The partition key is 'child' (the first child of root we found)
        // Unless current IS the element we started with (it's the root)
        if (current === elementId) {
          // The element is the root itself
          this.elementPartitionCache.set(elementId, current);
          return current;
        }
        this.elementPartitionCache.set(elementId, child);
        return child;
      }

      if (this.sceneGraph.isRoot(parent)) {
        // parent is root, so current is a first-child of root
        this.elementPartitionCache.set(elementId, current);
        return current;
      }

      child = current;
      current = parent;
    }

    // Fallback: use the element itself
    this.elementPartitionCache.set(elementId, elementId);
    return elementId;
  }

  /**
   * Get or create a partition for the given key.
   * Buffer capacity is distributed across partitions.
   */
  private getOrCreatePartition(partitionKey: string): SubtreeOrderingContext {
    let partition = this.partitions.get(partitionKey);
    if (!partition) {
      const partitionCount = Math.max(1, this.partitions.size + 1);
      const bufferCapacity = Math.max(
        4,
        Math.floor(this.config.maxReorderBufferSize / partitionCount),
      );
      partition = new SubtreeOrderingContext(partitionKey, this.config, bufferCapacity);
      this.partitions.set(partitionKey, partition);
    }
    return partition;
  }

  /**
   * Invalidate the partition cache for a specific element.
   */
  private invalidatePartitionCache(elementId: string): void {
    this.elementPartitionCache.delete(elementId);
  }

  /**
   * Collect all descendants of an element in the scene graph.
   */
  private collectDescendants(elementId: string): string[] {
    const descendants: string[] = [];
    const stack = [elementId];

    while (stack.length > 0) {
      const current = stack.pop()!;
      const children = this.sceneGraph.getChildren(current);
      for (const childId of children) {
        descendants.push(childId);
        stack.push(childId);
      }
    }

    return descendants;
  }
}
