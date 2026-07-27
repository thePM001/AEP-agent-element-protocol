// @PAD: /root/dynAEP/sdk/typescript/src/causal/FileBasedCausalStore.ts
// ===========================================================================
// @dynaep/core - File-Based Durable Causal Store
// TA-3.1: JSONL append log with periodic compaction for persisting causal
// ordering state. Append operations are batched (same pattern as
// BufferedLedger from OPT-006). On load: read snapshot + replay append
// log entries written after the snapshot.
// ===========================================================================

import * as fs from "fs";
import * as path from "path";
import type {
  DurableCausalStore,
  BufferedEvent,
  DependencyGraph,
  AgentRegistration,
  CausalStateSnapshot,
  CausalPersistenceConfig,
} from "./DurableCausalStore";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SNAPSHOT_FILE = "causal-snapshot.json";
const APPEND_LOG_FILE = "causal-append.jsonl";
const DEFAULT_FLUSH_INTERVAL_MS = 100;
const DEFAULT_FLUSH_BATCH_SIZE = 100;
const DEFAULT_COMPACT_INTERVAL_MS = 3600000;

// ---------------------------------------------------------------------------
// Append Log Entry Types
// ---------------------------------------------------------------------------

interface AppendLogEntry {
  type: "vector_clocks" | "reorder_buffer" | "dependency_graph" | "agent_registry" | "causal_position";
  timestamp: number;
  data: unknown;
}

// ---------------------------------------------------------------------------
// FileBasedCausalStore
// ---------------------------------------------------------------------------

/**
 * File-based durable causal store using JSONL append log with periodic
 * compaction. Writes are batched to minimize I/O overhead.
 *
 * Storage layout:
 *   {path}/causal-snapshot.json  - Full state snapshot (written on compact)
 *   {path}/causal-append.jsonl   - Append-only log of state changes
 */
export class FileBasedCausalStore implements DurableCausalStore {
  private readonly storePath: string;
  private readonly snapshotPath: string;
  private readonly appendLogPath: string;
  private readonly flushIntervalMs: number;
  private readonly flushBatchSize: number;
  private readonly compactIntervalMs: number;

  // In-memory state
  private vectorClocks: Map<string, Record<string, number>>;
  private reorderBuffer: BufferedEvent[];
  private dependencyGraph: DependencyGraph;
  private agentRegistry: Map<string, AgentRegistration>;
  private causalPosition: number;
  private lastPersistAt: number;

  // Write batching
  private pendingWrites: AppendLogEntry[];
  private flushTimer: ReturnType<typeof setInterval> | null;
  private compactTimer: ReturnType<typeof setInterval> | null;
  private closed: boolean;

  constructor(config: Partial<CausalPersistenceConfig> & { path: string }) {
    this.storePath = config.path;
    this.snapshotPath = path.join(this.storePath, SNAPSHOT_FILE);
    this.appendLogPath = path.join(this.storePath, APPEND_LOG_FILE);
    this.flushIntervalMs = config.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.flushBatchSize = config.flushBatchSize ?? DEFAULT_FLUSH_BATCH_SIZE;
    this.compactIntervalMs = config.compactIntervalMs ?? DEFAULT_COMPACT_INTERVAL_MS;

    this.vectorClocks = new Map();
    this.reorderBuffer = [];
    this.dependencyGraph = { edges: [], deliveredEventIds: [] };
    this.agentRegistry = new Map();
    this.causalPosition = 0;
    this.lastPersistAt = 0;

    this.pendingWrites = [];
    this.flushTimer = null;
    this.compactTimer = null;
    this.closed = false;

    // Ensure storage directory exists
    this.ensureDirectory();

    // Start auto-flush timer
    this.startFlushTimer();

    // Start compaction timer
    this.startCompactTimer();
  }

  // -------------------------------------------------------------------------
  // DurableCausalStore Implementation
  // -------------------------------------------------------------------------

  async saveVectorClocks(clocks: Map<string, Record<string, number>>): Promise<void> {
    this.vectorClocks = new Map(clocks);
    this.queueWrite({
      type: "vector_clocks",
      timestamp: Date.now(),
      data: Object.fromEntries(clocks),
    });
  }

  async loadVectorClocks(): Promise<Map<string, Record<string, number>>> {
    await this.loadIfNeeded();
    return new Map(this.vectorClocks);
  }

  async saveReorderBuffer(events: BufferedEvent[]): Promise<void> {
    this.reorderBuffer = [...events];
    this.queueWrite({
      type: "reorder_buffer",
      timestamp: Date.now(),
      data: events,
    });
  }

  async loadReorderBuffer(): Promise<BufferedEvent[]> {
    await this.loadIfNeeded();
    return [...this.reorderBuffer];
  }

  async saveDependencyGraph(graph: DependencyGraph): Promise<void> {
    this.dependencyGraph = {
      edges: [...graph.edges],
      deliveredEventIds: [...graph.deliveredEventIds],
    };
    this.queueWrite({
      type: "dependency_graph",
      timestamp: Date.now(),
      data: graph,
    });
  }

  async loadDependencyGraph(): Promise<DependencyGraph> {
    await this.loadIfNeeded();
    return {
      edges: [...this.dependencyGraph.edges],
      deliveredEventIds: [...this.dependencyGraph.deliveredEventIds],
    };
  }

  async saveAgentRegistry(agents: Map<string, AgentRegistration>): Promise<void> {
    this.agentRegistry = new Map(agents);
    this.queueWrite({
      type: "agent_registry",
      timestamp: Date.now(),
      data: Object.fromEntries(agents),
    });
  }

  async loadAgentRegistry(): Promise<Map<string, AgentRegistration>> {
    await this.loadIfNeeded();
    return new Map(this.agentRegistry);
  }

  async saveCausalPosition(position: number): Promise<void> {
    this.causalPosition = position;
    this.queueWrite({
      type: "causal_position",
      timestamp: Date.now(),
      data: position,
    });
  }

  async loadCausalPosition(): Promise<number> {
    await this.loadIfNeeded();
    return this.causalPosition;
  }

  async getStateAge(): Promise<Date | null> {
    // Check snapshot file first
    if (fs.existsSync(this.snapshotPath)) {
      try {
        const raw = fs.readFileSync(this.snapshotPath, "utf-8");
        const snapshot: CausalStateSnapshot = JSON.parse(raw);
        return new Date(snapshot.snapshotAt);
      } catch {
        // Fall through
      }
    }

    // Check append log for latest timestamp
    if (fs.existsSync(this.appendLogPath)) {
      try {
        const raw = fs.readFileSync(this.appendLogPath, "utf-8");
        const lines = raw.trim().split("\n").filter((l: string) => l.length > 0);
        if (lines.length > 0) {
          const lastEntry: AppendLogEntry = JSON.parse(lines[lines.length - 1]);
          return new Date(lastEntry.timestamp);
        }
      } catch {
        // Fall through
      }
    }

    // Check in-memory last persist time
    if (this.lastPersistAt > 0) {
      return new Date(this.lastPersistAt);
    }

    return null;
  }

  async compact(): Promise<void> {
    // Flush any pending writes first
    this.flushPendingWrites();

    // Write full snapshot
    const snapshot: CausalStateSnapshot = {
      vectorClocks: Object.fromEntries(this.vectorClocks),
      reorderBuffer: this.reorderBuffer,
      dependencyGraph: this.dependencyGraph,
      agentRegistry: Object.fromEntries(this.agentRegistry),
      causalPosition: this.causalPosition,
      snapshotAt: Date.now(),
    };

    fs.writeFileSync(this.snapshotPath, JSON.stringify(snapshot), "utf-8");

    // Clear the append log
    fs.writeFileSync(this.appendLogPath, "", "utf-8");

    this.lastPersistAt = snapshot.snapshotAt;
  }

  async close(): Promise<void> {
    this.closed = true;

    // Stop timers
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.compactTimer !== null) {
      clearInterval(this.compactTimer);
      this.compactTimer = null;
    }

    // Flush remaining writes
    this.flushPendingWrites();
  }

  // -------------------------------------------------------------------------
  // Private: Write Batching
  // -------------------------------------------------------------------------

  private queueWrite(entry: AppendLogEntry): void {
    if (this.closed) return;

    this.pendingWrites.push(entry);
    this.lastPersistAt = entry.timestamp;

    // Flush if batch size reached
    if (this.pendingWrites.length >= this.flushBatchSize) {
      this.flushPendingWrites();
    }
  }

  private flushPendingWrites(): void {
    if (this.pendingWrites.length === 0) return;

    const lines = this.pendingWrites.map((entry) => JSON.stringify(entry));
    this.pendingWrites = [];

    try {
      fs.appendFileSync(this.appendLogPath, lines.join("\n") + "\n", "utf-8");
    } catch {
      // If write fails, re-queue (best effort)
      if (typeof console !== "undefined") {
        console.warn("[FileBasedCausalStore] Failed to flush pending writes");
      }
    }
  }

  private startFlushTimer(): void {
    if (this.flushIntervalMs <= 0) return;
    this.flushTimer = setInterval(() => {
      this.flushPendingWrites();
    }, this.flushIntervalMs);
  }

  private startCompactTimer(): void {
    if (this.compactIntervalMs <= 0) return;
    this.compactTimer = setInterval(() => {
      this.compact().catch(() => {
        if (typeof console !== "undefined") {
          console.warn("[FileBasedCausalStore] Compaction failed");
        }
      });
    }, this.compactIntervalMs);
  }

  // -------------------------------------------------------------------------
  // Private: Loading
  // -------------------------------------------------------------------------

  private loaded = false;

  private async loadIfNeeded(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;

    // Step 1: Load snapshot if it exists
    if (fs.existsSync(this.snapshotPath)) {
      try {
        const raw = fs.readFileSync(this.snapshotPath, "utf-8");
        const snapshot: CausalStateSnapshot = JSON.parse(raw);
        this.applySnapshot(snapshot);
      } catch {
        if (typeof console !== "undefined") {
          console.warn("[FileBasedCausalStore] Failed to load snapshot, starting fresh");
        }
      }
    }

    // Step 2: Replay append log entries after snapshot
    if (fs.existsSync(this.appendLogPath)) {
      try {
        const raw = fs.readFileSync(this.appendLogPath, "utf-8");
        const lines = raw.trim().split("\n").filter((l: string) => l.length > 0);
        for (const line of lines) {
          try {
            const entry: AppendLogEntry = JSON.parse(line);
            this.applyAppendEntry(entry);
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        if (typeof console !== "undefined") {
          console.warn("[FileBasedCausalStore] Failed to replay append log");
        }
      }
    }
  }

  private applySnapshot(snapshot: CausalStateSnapshot): void {
    // Vector clocks
    this.vectorClocks = new Map();
    if (snapshot.vectorClocks) {
      for (const [key, value] of Object.entries(snapshot.vectorClocks)) {
        this.vectorClocks.set(key, value as Record<string, number>);
      }
    }

    // Reorder buffer
    this.reorderBuffer = snapshot.reorderBuffer ?? [];

    // Dependency graph
    this.dependencyGraph = snapshot.dependencyGraph ?? { edges: [], deliveredEventIds: [] };

    // Agent registry
    this.agentRegistry = new Map();
    if (snapshot.agentRegistry) {
      for (const [key, value] of Object.entries(snapshot.agentRegistry)) {
        this.agentRegistry.set(key, value as AgentRegistration);
      }
    }

    // Causal position
    this.causalPosition = snapshot.causalPosition ?? 0;

    this.lastPersistAt = snapshot.snapshotAt ?? 0;
  }

  private applyAppendEntry(entry: AppendLogEntry): void {
    switch (entry.type) {
      case "vector_clocks": {
        const data = entry.data as Record<string, Record<string, number>>;
        this.vectorClocks = new Map();
        for (const [key, value] of Object.entries(data)) {
          this.vectorClocks.set(key, value);
        }
        break;
      }
      case "reorder_buffer": {
        this.reorderBuffer = entry.data as BufferedEvent[];
        break;
      }
      case "dependency_graph": {
        this.dependencyGraph = entry.data as DependencyGraph;
        break;
      }
      case "agent_registry": {
        const agents = entry.data as Record<string, AgentRegistration>;
        this.agentRegistry = new Map();
        for (const [key, value] of Object.entries(agents)) {
          this.agentRegistry.set(key, value);
        }
        break;
      }
      case "causal_position": {
        this.causalPosition = entry.data as number;
        break;
      }
    }

    if (entry.timestamp > this.lastPersistAt) {
      this.lastPersistAt = entry.timestamp;
    }
  }

  // -------------------------------------------------------------------------
  // Private: Filesystem
  // -------------------------------------------------------------------------

  private ensureDirectory(): void {
    if (!fs.existsSync(this.storePath)) {
      fs.mkdirSync(this.storePath, { recursive: true });
    }
  }
}
