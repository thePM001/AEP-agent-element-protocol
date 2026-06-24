// @PAD: /root/dynAEP/sdk/typescript/src/causal/DurableCausalStore.ts
// ===========================================================================
// @dynaep/core - Durable Causal State Store Interface
// TA-3.1: Defines the interface for persisting causal ordering state across
// bridge restarts. Implementations include file-based (JSONL append log),
// SQLite, and external (Redis/PostgreSQL) adapters.
// ===========================================================================

import type { SparseVectorClock } from "./SparseVectorClock";
import type { CausalEvent } from "../temporal/causal";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A buffered event stored in the reorder buffer, awaiting delivery.
 * Contains the event plus metadata about when it was buffered.
 */
export interface BufferedEvent {
  event: CausalEvent;
  bufferedAt: number;
  partitionKey: string;
}

/**
 * Dependency graph edge: one event depends on another.
 */
export interface DependencyEdge {
  eventId: string;
  dependsOn: string;
  partitionKey: string;
}

/**
 * Serializable dependency graph for persistence.
 */
export interface DependencyGraph {
  edges: DependencyEdge[];
  deliveredEventIds: string[];
}

/**
 * Agent registration record for persistence.
 */
export interface AgentRegistration {
  agentId: string;
  registeredAt: number;
  lastSequence: number;
  lastEventId: string | null;
  capabilities: string[];
}

/**
 * Complete snapshot of all causal state for persistence.
 */
export interface CausalStateSnapshot {
  vectorClocks: Record<string, Record<string, number>>;
  reorderBuffer: BufferedEvent[];
  dependencyGraph: DependencyGraph;
  agentRegistry: Record<string, AgentRegistration>;
  causalPosition: number;
  snapshotAt: number;
}

/**
 * Configuration for causal state persistence.
 */
export interface CausalPersistenceConfig {
  enabled: boolean;
  backend: "file" | "sqlite" | "external";
  path: string;
  flushIntervalMs: number;
  flushBatchSize: number;
  compactIntervalMs: number;
  recoveryOnStartup: boolean;
  maxRecoveryGapMs: number;
}

// ---------------------------------------------------------------------------
// Interface
// ---------------------------------------------------------------------------

/**
 * Interface for durable causal state storage. Implementations persist
 * all causal ordering state so that the bridge can recover from crashes
 * without losing vector clocks, reorder buffer contents, or dependency
 * tracking.
 *
 * All methods are async to accommodate both file and network-based backends.
 */
export interface DurableCausalStore {
  /**
   * Save all vector clocks (keyed by partition key, each containing
   * agent-to-sequence mappings).
   */
  saveVectorClocks(clocks: Map<string, Record<string, number>>): Promise<void>;

  /**
   * Load all vector clocks from persistent storage.
   * Returns an empty Map if no state has been persisted.
   */
  loadVectorClocks(): Promise<Map<string, Record<string, number>>>;

  /**
   * Save the current reorder buffer contents.
   */
  saveReorderBuffer(events: BufferedEvent[]): Promise<void>;

  /**
   * Load the reorder buffer from persistent storage.
   * Returns an empty array if no state has been persisted.
   */
  loadReorderBuffer(): Promise<BufferedEvent[]>;

  /**
   * Save the dependency graph (edges + delivered event IDs).
   */
  saveDependencyGraph(graph: DependencyGraph): Promise<void>;

  /**
   * Load the dependency graph from persistent storage.
   * Returns a graph with empty edges and deliveredEventIds if none exists.
   */
  loadDependencyGraph(): Promise<DependencyGraph>;

  /**
   * Save the agent registry (agent ID -> registration record).
   */
  saveAgentRegistry(agents: Map<string, AgentRegistration>): Promise<void>;

  /**
   * Load the agent registry from persistent storage.
   * Returns an empty Map if no state has been persisted.
   */
  loadAgentRegistry(): Promise<Map<string, AgentRegistration>>;

  /**
   * Save the current global causal position counter.
   */
  saveCausalPosition(position: number): Promise<void>;

  /**
   * Load the global causal position counter.
   * Returns 0 if no state has been persisted.
   */
  loadCausalPosition(): Promise<number>;

  /**
   * Get the age (timestamp) of the most recently persisted state.
   * Returns null if no state has been persisted.
   */
  getStateAge(): Promise<Date | null>;

  /**
   * Compact the store by replacing append logs with a single snapshot.
   * This reduces storage size and load time.
   */
  compact(): Promise<void>;

  /**
   * Close the store and release any resources (file handles, connections).
   */
  close(): Promise<void>;
}
