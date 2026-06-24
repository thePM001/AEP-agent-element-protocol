// @PAD: /root/dynAEP/sdk/typescript/src/causal/SqliteCausalStore.ts
// ===========================================================================
// @dynaep/core - SQLite Durable Causal Store
// TA-3.1: SQLite backend for persisting causal ordering state.
// Uses better-sqlite3 (synchronous API, no async overhead for reads).
// Writes use transactions for atomicity.
// ===========================================================================

import type {
  DurableCausalStore,
  BufferedEvent,
  DependencyGraph,
  AgentRegistration,
} from "./DurableCausalStore";

// ---------------------------------------------------------------------------
// Types for better-sqlite3 (optional dependency)
// ---------------------------------------------------------------------------

interface BetterSqliteDatabase {
  prepare(sql: string): BetterSqliteStatement;
  exec(sql: string): void;
  transaction<T>(fn: (...args: unknown[]) => T): (...args: unknown[]) => T;
  close(): void;
}

interface BetterSqliteStatement {
  run(...params: unknown[]): { changes: number };
  get(...params: unknown[]): Record<string, unknown> | undefined;
  all(...params: unknown[]): Record<string, unknown>[];
}

// ---------------------------------------------------------------------------
// SqliteCausalStore
// ---------------------------------------------------------------------------

/**
 * SQLite-based durable causal store using better-sqlite3.
 *
 * Tables:
 * - vector_clocks: partition_key, agent_id, sequence
 * - reorder_buffer: event_id, partition_key, event_json, buffered_at
 * - dependencies: event_id, depends_on, partition_key
 * - delivered_events: event_id (set of delivered event IDs)
 * - agents: agent_id, registered_at, last_sequence, last_event_id, capabilities
 * - metadata: key, value (stores causal_position, snapshot_at)
 */
export class SqliteCausalStore implements DurableCausalStore {
  private db: BetterSqliteDatabase | null;
  private readonly dbPath: string;

  constructor(dbPath: string) {
    this.dbPath = dbPath;
    this.db = null;
    this.initializeDatabase();
  }

  // -------------------------------------------------------------------------
  // DurableCausalStore Implementation
  // -------------------------------------------------------------------------

  async saveVectorClocks(clocks: Map<string, Record<string, number>>): Promise<void> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      db.prepare("DELETE FROM vector_clocks").run();
      const insert = db.prepare(
        "INSERT INTO vector_clocks (partition_key, agent_id, sequence) VALUES (?, ?, ?)"
      );
      for (const [partitionKey, agents] of clocks) {
        for (const [agentId, sequence] of Object.entries(agents)) {
          insert.run(partitionKey, agentId, sequence);
        }
      }
      this.updateMetadata("snapshot_at", Date.now().toString());
    });
    txn();
  }

  async loadVectorClocks(): Promise<Map<string, Record<string, number>>> {
    const db = this.getDb();
    const rows = db.prepare("SELECT partition_key, agent_id, sequence FROM vector_clocks").all();
    const clocks = new Map<string, Record<string, number>>();
    for (const row of rows) {
      const pk = row["partition_key"] as string;
      const agentId = row["agent_id"] as string;
      const seq = row["sequence"] as number;
      if (!clocks.has(pk)) {
        clocks.set(pk, {});
      }
      clocks.get(pk)![agentId] = seq;
    }
    return clocks;
  }

  async saveReorderBuffer(events: BufferedEvent[]): Promise<void> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      db.prepare("DELETE FROM reorder_buffer").run();
      const insert = db.prepare(
        "INSERT INTO reorder_buffer (event_id, partition_key, event_json, buffered_at) VALUES (?, ?, ?, ?)"
      );
      for (const buffered of events) {
        insert.run(
          buffered.event.eventId,
          buffered.partitionKey,
          JSON.stringify(buffered),
          buffered.bufferedAt,
        );
      }
      this.updateMetadata("snapshot_at", Date.now().toString());
    });
    txn();
  }

  async loadReorderBuffer(): Promise<BufferedEvent[]> {
    const db = this.getDb();
    const rows = db.prepare("SELECT event_json FROM reorder_buffer ORDER BY buffered_at").all();
    return rows.map((row) => JSON.parse(row["event_json"] as string) as BufferedEvent);
  }

  async saveDependencyGraph(graph: DependencyGraph): Promise<void> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      db.prepare("DELETE FROM dependencies").run();
      db.prepare("DELETE FROM delivered_events").run();
      const insertDep = db.prepare(
        "INSERT INTO dependencies (event_id, depends_on, partition_key) VALUES (?, ?, ?)"
      );
      for (const edge of graph.edges) {
        insertDep.run(edge.eventId, edge.dependsOn, edge.partitionKey);
      }
      const insertDelivered = db.prepare(
        "INSERT INTO delivered_events (event_id) VALUES (?)"
      );
      for (const eventId of graph.deliveredEventIds) {
        insertDelivered.run(eventId);
      }
      this.updateMetadata("snapshot_at", Date.now().toString());
    });
    txn();
  }

  async loadDependencyGraph(): Promise<DependencyGraph> {
    const db = this.getDb();
    const edgeRows = db.prepare("SELECT event_id, depends_on, partition_key FROM dependencies").all();
    const deliveredRows = db.prepare("SELECT event_id FROM delivered_events").all();
    return {
      edges: edgeRows.map((row) => ({
        eventId: row["event_id"] as string,
        dependsOn: row["depends_on"] as string,
        partitionKey: row["partition_key"] as string,
      })),
      deliveredEventIds: deliveredRows.map((row) => row["event_id"] as string),
    };
  }

  async saveAgentRegistry(agents: Map<string, AgentRegistration>): Promise<void> {
    const db = this.getDb();
    const txn = db.transaction(() => {
      db.prepare("DELETE FROM agents").run();
      const insert = db.prepare(
        "INSERT INTO agents (agent_id, registered_at, last_sequence, last_event_id, capabilities) VALUES (?, ?, ?, ?, ?)"
      );
      for (const [, agent] of agents) {
        insert.run(
          agent.agentId,
          agent.registeredAt,
          agent.lastSequence,
          agent.lastEventId,
          JSON.stringify(agent.capabilities),
        );
      }
      this.updateMetadata("snapshot_at", Date.now().toString());
    });
    txn();
  }

  async loadAgentRegistry(): Promise<Map<string, AgentRegistration>> {
    const db = this.getDb();
    const rows = db.prepare(
      "SELECT agent_id, registered_at, last_sequence, last_event_id, capabilities FROM agents"
    ).all();
    const agents = new Map<string, AgentRegistration>();
    for (const row of rows) {
      const agentId = row["agent_id"] as string;
      agents.set(agentId, {
        agentId,
        registeredAt: row["registered_at"] as number,
        lastSequence: row["last_sequence"] as number,
        lastEventId: (row["last_event_id"] as string) ?? null,
        capabilities: JSON.parse((row["capabilities"] as string) ?? "[]"),
      });
    }
    return agents;
  }

  async saveCausalPosition(position: number): Promise<void> {
    this.updateMetadata("causal_position", position.toString());
    this.updateMetadata("snapshot_at", Date.now().toString());
  }

  async loadCausalPosition(): Promise<number> {
    const value = this.getMetadata("causal_position");
    return value !== null ? parseInt(value, 10) : 0;
  }

  async getStateAge(): Promise<Date | null> {
    const value = this.getMetadata("snapshot_at");
    if (value === null) return null;
    const ts = parseInt(value, 10);
    if (isNaN(ts) || ts === 0) return null;
    return new Date(ts);
  }

  async compact(): Promise<void> {
    // SQLite doesn't need compaction in the same way as file-based stores.
    // Run VACUUM to reclaim space.
    const db = this.getDb();
    db.exec("VACUUM");
  }

  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // -------------------------------------------------------------------------
  // Private
  // -------------------------------------------------------------------------

  private getDb(): BetterSqliteDatabase {
    if (!this.db) {
      throw new Error("SqliteCausalStore: database not initialized");
    }
    return this.db;
  }

  private initializeDatabase(): void {
    try {
      // Dynamic import of better-sqlite3
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const Database = require("better-sqlite3");
      this.db = new Database(this.dbPath) as BetterSqliteDatabase;

      // Enable WAL mode for better concurrent performance
      this.db!.exec("PRAGMA journal_mode = WAL");
      this.db!.exec("PRAGMA synchronous = NORMAL");

      // Create tables
      this.db!.exec(`
        CREATE TABLE IF NOT EXISTS vector_clocks (
          partition_key TEXT NOT NULL,
          agent_id TEXT NOT NULL,
          sequence INTEGER NOT NULL,
          PRIMARY KEY (partition_key, agent_id)
        );

        CREATE TABLE IF NOT EXISTS reorder_buffer (
          event_id TEXT PRIMARY KEY,
          partition_key TEXT NOT NULL,
          event_json TEXT NOT NULL,
          buffered_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS dependencies (
          event_id TEXT NOT NULL,
          depends_on TEXT NOT NULL,
          partition_key TEXT NOT NULL,
          PRIMARY KEY (event_id, depends_on)
        );

        CREATE TABLE IF NOT EXISTS delivered_events (
          event_id TEXT PRIMARY KEY
        );

        CREATE TABLE IF NOT EXISTS agents (
          agent_id TEXT PRIMARY KEY,
          registered_at INTEGER NOT NULL,
          last_sequence INTEGER NOT NULL,
          last_event_id TEXT,
          capabilities TEXT NOT NULL DEFAULT '[]'
        );

        CREATE TABLE IF NOT EXISTS metadata (
          key TEXT PRIMARY KEY,
          value TEXT NOT NULL
        );
      `);
    } catch {
      // better-sqlite3 not available - store remains non-functional
      if (typeof console !== "undefined") {
        console.warn(
          "[SqliteCausalStore] better-sqlite3 not available. " +
          "Install it with: npm install better-sqlite3"
        );
      }
    }
  }

  private updateMetadata(key: string, value: string): void {
    const db = this.getDb();
    db.prepare(
      "INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)"
    ).run(key, value);
  }

  private getMetadata(key: string): string | null {
    const db = this.getDb();
    const row = db.prepare("SELECT value FROM metadata WHERE key = ?").get(key);
    if (!row) return null;
    return row["value"] as string;
  }
}
