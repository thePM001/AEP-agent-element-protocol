// @PAD: /root/dynAEP/sdk/typescript/src/causal/ExternalCausalStore.ts
// ===========================================================================
// @dynaep/core - External Durable Causal Store Adapter
// TA-3.1: Adapter interface for external stores (Redis, PostgreSQL).
// Provides a generic key-value interface with JSON serialization.
// Concrete adapters NOT implemented in this prompt (interface only).
// ===========================================================================

import type {
  DurableCausalStore,
  BufferedEvent,
  DependencyGraph,
  AgentRegistration,
} from "./DurableCausalStore";

// ---------------------------------------------------------------------------
// External Backend Interface
// ---------------------------------------------------------------------------

/**
 * Generic key-value interface for external storage backends.
 * Concrete implementations for Redis, PostgreSQL, etc. implement this
 * interface and are injected into ExternalCausalStore.
 */
export interface ExternalKeyValueBackend {
  /** Store a value under the given key. */
  set(key: string, value: string): Promise<void>;

  /** Retrieve a value by key. Returns null if not found. */
  get(key: string): Promise<string | null>;

  /** Delete a key. */
  delete(key: string): Promise<void>;

  /** Check if a key exists. */
  exists(key: string): Promise<boolean>;

  /** Close the connection. */
  close(): Promise<void>;

  /** Check if the backend is connected. */
  isConnected(): boolean;
}

// ---------------------------------------------------------------------------
// Key Constants
// ---------------------------------------------------------------------------

const KEY_VECTOR_CLOCKS = "dynaep:causal:vector_clocks";
const KEY_REORDER_BUFFER = "dynaep:causal:reorder_buffer";
const KEY_DEPENDENCY_GRAPH = "dynaep:causal:dependency_graph";
const KEY_AGENT_REGISTRY = "dynaep:causal:agent_registry";
const KEY_CAUSAL_POSITION = "dynaep:causal:position";
const KEY_STATE_AGE = "dynaep:causal:state_age";

// ---------------------------------------------------------------------------
// ExternalCausalStore
// ---------------------------------------------------------------------------

/**
 * Adapter for external storage backends. Serializes all causal state
 * to JSON and stores it via a generic key-value interface.
 *
 * To use:
 * 1. Implement ExternalKeyValueBackend for your storage system
 * 2. Pass it to ExternalCausalStore constructor
 *
 * Example (pseudocode):
 *   const redisBackend = new RedisKeyValueBackend(redisClient);
 *   const store = new ExternalCausalStore(redisBackend);
 */
export class ExternalCausalStore implements DurableCausalStore {
  private readonly backend: ExternalKeyValueBackend;

  constructor(backend: ExternalKeyValueBackend) {
    this.backend = backend;
  }

  async saveVectorClocks(clocks: Map<string, Record<string, number>>): Promise<void> {
    const serialized = JSON.stringify(Object.fromEntries(clocks));
    await this.backend.set(KEY_VECTOR_CLOCKS, serialized);
    await this.updateStateAge();
  }

  async loadVectorClocks(): Promise<Map<string, Record<string, number>>> {
    const raw = await this.backend.get(KEY_VECTOR_CLOCKS);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, Record<string, number>>;
    return new Map(Object.entries(parsed));
  }

  async saveReorderBuffer(events: BufferedEvent[]): Promise<void> {
    const serialized = JSON.stringify(events);
    await this.backend.set(KEY_REORDER_BUFFER, serialized);
    await this.updateStateAge();
  }

  async loadReorderBuffer(): Promise<BufferedEvent[]> {
    const raw = await this.backend.get(KEY_REORDER_BUFFER);
    if (!raw) return [];
    return JSON.parse(raw) as BufferedEvent[];
  }

  async saveDependencyGraph(graph: DependencyGraph): Promise<void> {
    const serialized = JSON.stringify(graph);
    await this.backend.set(KEY_DEPENDENCY_GRAPH, serialized);
    await this.updateStateAge();
  }

  async loadDependencyGraph(): Promise<DependencyGraph> {
    const raw = await this.backend.get(KEY_DEPENDENCY_GRAPH);
    if (!raw) return { edges: [], deliveredEventIds: [] };
    return JSON.parse(raw) as DependencyGraph;
  }

  async saveAgentRegistry(agents: Map<string, AgentRegistration>): Promise<void> {
    const serialized = JSON.stringify(Object.fromEntries(agents));
    await this.backend.set(KEY_AGENT_REGISTRY, serialized);
    await this.updateStateAge();
  }

  async loadAgentRegistry(): Promise<Map<string, AgentRegistration>> {
    const raw = await this.backend.get(KEY_AGENT_REGISTRY);
    if (!raw) return new Map();
    const parsed = JSON.parse(raw) as Record<string, AgentRegistration>;
    return new Map(Object.entries(parsed));
  }

  async saveCausalPosition(position: number): Promise<void> {
    await this.backend.set(KEY_CAUSAL_POSITION, position.toString());
    await this.updateStateAge();
  }

  async loadCausalPosition(): Promise<number> {
    const raw = await this.backend.get(KEY_CAUSAL_POSITION);
    if (!raw) return 0;
    return parseInt(raw, 10);
  }

  async getStateAge(): Promise<Date | null> {
    const raw = await this.backend.get(KEY_STATE_AGE);
    if (!raw) return null;
    const ts = parseInt(raw, 10);
    if (isNaN(ts) || ts === 0) return null;
    return new Date(ts);
  }

  async compact(): Promise<void> {
    // External stores typically don't need compaction.
    // This is a no-op by default.
  }

  async close(): Promise<void> {
    await this.backend.close();
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private async updateStateAge(): Promise<void> {
    await this.backend.set(KEY_STATE_AGE, Date.now().toString());
  }
}
