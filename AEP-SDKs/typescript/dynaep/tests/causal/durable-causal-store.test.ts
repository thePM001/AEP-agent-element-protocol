// @PAD: /root/dynAEP/sdk/typescript/tests/causal/durable-causal-store.test.ts
// ===========================================================================
// Tests for TA-3.1: Durable Causal State
// Tests FileBasedCausalStore, SqliteCausalStore, ExternalCausalStore, and
// PartitionedCausalEngine persistence integration.
// ===========================================================================

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { FileBasedCausalStore } from "../../src/causal/FileBasedCausalStore";
import { ExternalCausalStore, type ExternalKeyValueBackend } from "../../src/causal/ExternalCausalStore";
import { SqliteCausalStore } from "../../src/causal/SqliteCausalStore";
import { PartitionedCausalEngine, type SceneGraph } from "../../src/causal/PartitionedCausalEngine";
import type {
  BufferedEvent,
  DependencyGraph,
  AgentRegistration,
  CausalStateSnapshot,
} from "../../src/causal/DurableCausalStore";
import type { CausalEvent, CausalConfig } from "../../src/temporal/causal";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;
const asyncTests: Promise<void>[] = [];

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      const tracked = result
        .then(() => { passed++; console.log(`  PASS: ${name}`); })
        .catch((e: any) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
      asyncTests.push(tracked);
    } else {
      passed++;
      console.log(`  PASS: ${name}`);
    }
  } catch (e: any) {
    failed++;
    console.log(`  FAIL: ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dynaep-test-causal-"));
}

function cleanupDir(dir: string): void {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {
    // best effort
  }
}

function makeCausalEvent(overrides: Partial<CausalEvent> = {}): CausalEvent {
  return {
    eventId: overrides.eventId ?? "evt-001",
    agentId: overrides.agentId ?? "agent-A",
    bridgeTimeMs: overrides.bridgeTimeMs ?? Date.now(),
    targetElementId: overrides.targetElementId ?? "CP-00001",
    sequenceNumber: overrides.sequenceNumber ?? 1,
    vectorClock: overrides.vectorClock ?? { "agent-A": 1 },
    causalDependencies: overrides.causalDependencies ?? [],
  };
}

function makeBufferedEvent(overrides: Partial<BufferedEvent> = {}): BufferedEvent {
  return {
    event: overrides.event ?? makeCausalEvent(),
    bufferedAt: overrides.bufferedAt ?? Date.now(),
    partitionKey: overrides.partitionKey ?? "PN-00001",
  };
}

function makeAgentRegistration(overrides: Partial<AgentRegistration> = {}): AgentRegistration {
  return {
    agentId: overrides.agentId ?? "agent-A",
    registeredAt: overrides.registeredAt ?? Date.now(),
    lastSequence: overrides.lastSequence ?? 5,
    lastEventId: overrides.lastEventId ?? "evt-005",
    capabilities: overrides.capabilities ?? ["read", "write"],
  };
}

function createFileStore(dir?: string): { store: FileBasedCausalStore; dir: string } {
  const d = dir ?? makeTempDir();
  const store = new FileBasedCausalStore({
    path: d,
    flushIntervalMs: 0,       // disable auto-flush timer for AEP-NOSHIP/tests
    compactIntervalMs: 0,     // disable auto-compact timer for AEP-NOSHIP/tests
    flushBatchSize: 1,        // flush on every write for determinism
  });
  return { store, dir: d };
}

// Mock scene graph for PartitionedCausalEngine AEP-NOSHIP/tests
class MockSceneGraph implements SceneGraph {
  private parents: Map<string, string | null> = new Map();
  private childMap: Map<string, string[]> = new Map();

  constructor() {
    this.parents.set("SH-ROOT", null);
    this.addChild("SH-ROOT", "PN-00001");
    this.addChild("PN-00001", "CP-00001");
    this.addChild("PN-00001", "CP-00002");
  }

  private addChild(parent: string, child: string): void {
    this.parents.set(child, parent);
    const children = this.childMap.get(parent) ?? [];
    children.push(child);
    this.childMap.set(parent, children);
  }

  getParent(elementId: string): string | null {
    return this.parents.get(elementId) ?? null;
  }

  getChildren(elementId: string): string[] {
    return this.childMap.get(elementId) ?? [];
  }

  isRoot(elementId: string): boolean {
    return elementId === "SH-ROOT";
  }
}

// Mock ExternalKeyValueBackend using an in-memory Map
class InMemoryKeyValueBackend implements ExternalKeyValueBackend {
  private store: Map<string, string> = new Map();
  private connected: boolean = true;
  public closeCalled: boolean = false;

  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }

  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.store.delete(key);
  }

  async exists(key: string): Promise<boolean> {
    return this.store.has(key);
  }

  async close(): Promise<void> {
    this.connected = false;
    this.closeCalled = true;
  }

  isConnected(): boolean {
    return this.connected;
  }

  getStoreSize(): number {
    return this.store.size;
  }
}

// ---------------------------------------------------------------------------
// FileBasedCausalStore Tests
// ---------------------------------------------------------------------------

console.log("\n=== TA-3.1: Durable Causal State Tests ===\n");
console.log("--- FileBasedCausalStore ---\n");

test("FileStore: save and load empty vector clocks", async () => {
  const { store, dir } = createFileStore();
  try {
    const empty = new Map<string, Record<string, number>>();
    await store.saveVectorClocks(empty);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadVectorClocks();
    assert(loaded.size === 0, `Expected 0 entries, got ${loaded.size}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load single-partition vector clock", async () => {
  const { store, dir } = createFileStore();
  try {
    const clocks = new Map<string, Record<string, number>>();
    clocks.set("PN-00001", { "agent-A": 5, "agent-B": 3 });
    await store.saveVectorClocks(clocks);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadVectorClocks();
    assert(loaded.size === 1, `Expected 1 partition, got ${loaded.size}`);
    assert(loaded.has("PN-00001"), "Missing partition PN-00001");
    const clock = loaded.get("PN-00001")!;
    assert(clock["agent-A"] === 5, `Expected agent-A=5, got ${clock["agent-A"]}`);
    assert(clock["agent-B"] === 3, `Expected agent-B=3, got ${clock["agent-B"]}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load multi-partition vector clocks", async () => {
  const { store, dir } = createFileStore();
  try {
    const clocks = new Map<string, Record<string, number>>();
    clocks.set("PN-00001", { "agent-A": 5 });
    clocks.set("PN-00002", { "agent-B": 7 });
    clocks.set("PN-00003", { "agent-C": 1, "agent-D": 9 });
    await store.saveVectorClocks(clocks);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadVectorClocks();
    assert(loaded.size === 3, `Expected 3 partitions, got ${loaded.size}`);
    assert(loaded.get("PN-00002")!["agent-B"] === 7, "PN-00002 agent-B should be 7");
    assert(loaded.get("PN-00003")!["agent-D"] === 9, "PN-00003 agent-D should be 9");
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load empty reorder buffer", async () => {
  const { store, dir } = createFileStore();
  try {
    await store.saveReorderBuffer([]);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadReorderBuffer();
    assert(loaded.length === 0, `Expected 0 events, got ${loaded.length}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load reorder buffer with events", async () => {
  const { store, dir } = createFileStore();
  try {
    const events = [
      makeBufferedEvent({ partitionKey: "PN-00001" }),
      makeBufferedEvent({ partitionKey: "PN-00002", event: makeCausalEvent({ eventId: "evt-002" }) }),
    ];
    await store.saveReorderBuffer(events);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadReorderBuffer();
    assert(loaded.length === 2, `Expected 2 events, got ${loaded.length}`);
    assert(loaded[0].partitionKey === "PN-00001", `Expected PN-00001, got ${loaded[0].partitionKey}`);
    assert(loaded[1].event.eventId === "evt-002", `Expected evt-002, got ${loaded[1].event.eventId}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load empty dependency graph", async () => {
  const { store, dir } = createFileStore();
  try {
    const graph: DependencyGraph = { edges: [], deliveredEventIds: [] };
    await store.saveDependencyGraph(graph);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadDependencyGraph();
    assert(loaded.edges.length === 0, `Expected 0 edges, got ${loaded.edges.length}`);
    assert(loaded.deliveredEventIds.length === 0, `Expected 0 delivered, got ${loaded.deliveredEventIds.length}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load dependency graph with edges", async () => {
  const { store, dir } = createFileStore();
  try {
    const graph: DependencyGraph = {
      edges: [
        { eventId: "evt-002", dependsOn: "evt-001", partitionKey: "PN-00001" },
        { eventId: "evt-003", dependsOn: "evt-002", partitionKey: "PN-00001" },
      ],
      deliveredEventIds: ["evt-001", "evt-002"],
    };
    await store.saveDependencyGraph(graph);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadDependencyGraph();
    assert(loaded.edges.length === 2, `Expected 2 edges, got ${loaded.edges.length}`);
    assert(loaded.edges[0].eventId === "evt-002", `Expected evt-002, got ${loaded.edges[0].eventId}`);
    assert(loaded.edges[0].dependsOn === "evt-001", `Expected depends on evt-001`);
    assert(loaded.deliveredEventIds.length === 2, `Expected 2 delivered, got ${loaded.deliveredEventIds.length}`);
    assert(loaded.deliveredEventIds.includes("evt-001"), "Should include evt-001");
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load empty agent registry", async () => {
  const { store, dir } = createFileStore();
  try {
    const agents = new Map<string, AgentRegistration>();
    await store.saveAgentRegistry(agents);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadAgentRegistry();
    assert(loaded.size === 0, `Expected 0 agents, got ${loaded.size}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load single agent registry", async () => {
  const { store, dir } = createFileStore();
  try {
    const agents = new Map<string, AgentRegistration>();
    agents.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));
    await store.saveAgentRegistry(agents);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadAgentRegistry();
    assert(loaded.size === 1, `Expected 1 agent, got ${loaded.size}`);
    assert(loaded.has("agent-A"), "Missing agent-A");
    const agent = loaded.get("agent-A")!;
    assert(agent.lastSequence === 10, `Expected lastSequence=10, got ${agent.lastSequence}`);
    assert(agent.capabilities.length === 2, `Expected 2 capabilities, got ${agent.capabilities.length}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load multi-agent registry", async () => {
  const { store, dir } = createFileStore();
  try {
    const agents = new Map<string, AgentRegistration>();
    agents.set("agent-A", makeAgentRegistration({ agentId: "agent-A" }));
    agents.set("agent-B", makeAgentRegistration({ agentId: "agent-B", lastSequence: 20, capabilities: ["read"] }));
    agents.set("agent-C", makeAgentRegistration({ agentId: "agent-C", lastSequence: 1, lastEventId: null, capabilities: [] }));
    await store.saveAgentRegistry(agents);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadAgentRegistry();
    assert(loaded.size === 3, `Expected 3 agents, got ${loaded.size}`);
    assert(loaded.get("agent-B")!.lastSequence === 20, "agent-B lastSequence should be 20");
    assert(loaded.get("agent-C")!.capabilities.length === 0, "agent-C should have 0 capabilities");
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: save and load causal position", async () => {
  const { store, dir } = createFileStore();
  try {
    await store.saveCausalPosition(42);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadCausalPosition();
    assert(loaded === 42, `Expected position 42, got ${loaded}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: load causal position defaults to 0 when empty", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const loaded = await store.loadCausalPosition();
    assert(loaded === 0, `Expected position 0, got ${loaded}`);
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: getStateAge returns correct timestamp after save", async () => {
  const { store, dir } = createFileStore();
  try {
    const before = Date.now();
    await store.saveCausalPosition(1);
    const age = await store.getStateAge();
    const after = Date.now();
    assert(age !== null, "State age should not be null after save");
    assert(age!.getTime() >= before, `State age ${age!.getTime()} should be >= ${before}`);
    assert(age!.getTime() <= after, `State age ${age!.getTime()} should be <= ${after}`);
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: getStateAge returns null when no state persisted", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    // Reset the loaded flag by using a fresh store on a fresh directory
    const freshDir = makeTempDir();
    const { store: freshStore } = createFileStore(freshDir);
    const age = await freshStore.getStateAge();
    assert(age === null, `Expected null state age, got ${age}`);
    await freshStore.close();
    await store.close();
    cleanupDir(freshDir);
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: compaction writes snapshot and clears append log", async () => {
  const { store, dir } = createFileStore();
  try {
    // Write some data through the append log
    const clocks = new Map<string, Record<string, number>>();
    clocks.set("PN-00001", { "agent-A": 3 });
    await store.saveVectorClocks(clocks);
    await store.saveCausalPosition(10);

    // Verify append log has content
    const appendLogPath = path.join(dir, "causal-append.jsonl");
    const appendBefore = fs.readFileSync(appendLogPath, "utf-8");
    assert(appendBefore.trim().length > 0, "Append log should have content before compaction");

    // Compact
    await store.compact();

    // Verify snapshot exists
    const snapshotPath = path.join(dir, "causal-snapshot.json");
    assert(fs.existsSync(snapshotPath), "Snapshot file should exist after compaction");

    // Verify append log is cleared
    const appendAfter = fs.readFileSync(appendLogPath, "utf-8");
    assert(appendAfter.trim().length === 0, "Append log should be empty after compaction");

    // Verify snapshot content
    const snapshot: CausalStateSnapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf-8"));
    assert(snapshot.causalPosition === 10, `Expected position 10 in snapshot, got ${snapshot.causalPosition}`);
    assert(snapshot.vectorClocks["PN-00001"]["agent-A"] === 3, "Snapshot should contain vector clock data");
    assert(snapshot.snapshotAt > 0, "Snapshot should have a valid timestamp");
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: close stops timers and flushes writes", async () => {
  const dir = makeTempDir();
  // Use a store with a timer (non-zero flush interval) to verify close stops it
  const store = new FileBasedCausalStore({
    path: dir,
    flushIntervalMs: 60000,     // long timer
    compactIntervalMs: 60000,   // long timer
    flushBatchSize: 1000,       // large batch so writes are queued
  });
  try {
    // Queue some writes (batch size is large, so they stay pending)
    await store.saveCausalPosition(99);

    // Close should flush pending writes
    await store.close();

    // Verify the data was flushed to disk
    const { store: store2 } = createFileStore(dir);
    const pos = await store2.loadCausalPosition();
    assert(pos === 99, `Expected position 99 after close, got ${pos}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: write batching - multiple saves before flush", async () => {
  const dir = makeTempDir();
  // Use large batch size to accumulate writes
  const store = new FileBasedCausalStore({
    path: dir,
    flushIntervalMs: 0,
    compactIntervalMs: 0,
    flushBatchSize: 100, // large: writes are queued
  });
  try {
    // Queue multiple writes
    await store.saveCausalPosition(1);
    await store.saveCausalPosition(2);
    await store.saveCausalPosition(3);

    // Before close, append log may be empty (writes are pending)
    // Close flushes all pending writes
    await store.close();

    // Verify the last value persisted
    const { store: store2 } = createFileStore(dir);
    const pos = await store2.loadCausalPosition();
    assert(pos === 3, `Expected position 3, got ${pos}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: append log replay - entries applied in order", async () => {
  const { store, dir } = createFileStore();
  try {
    // Write multiple vector clock updates
    const clocks1 = new Map<string, Record<string, number>>();
    clocks1.set("PN-00001", { "agent-A": 1 });
    await store.saveVectorClocks(clocks1);

    const clocks2 = new Map<string, Record<string, number>>();
    clocks2.set("PN-00001", { "agent-A": 5, "agent-B": 3 });
    await store.saveVectorClocks(clocks2);

    await store.close();

    // Re-open and verify last update wins
    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadVectorClocks();
    assert(loaded.get("PN-00001")!["agent-A"] === 5, "Should have latest agent-A=5");
    assert(loaded.get("PN-00001")!["agent-B"] === 3, "Should have latest agent-B=3");
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: snapshot + append log - snapshot loaded first, then entries overlay", async () => {
  const { store, dir } = createFileStore();
  try {
    // Write initial data and compact to create snapshot
    const clocks = new Map<string, Record<string, number>>();
    clocks.set("PN-00001", { "agent-A": 5 });
    await store.saveVectorClocks(clocks);
    await store.saveCausalPosition(10);
    await store.compact();

    // Write additional data to append log (after snapshot)
    await store.saveCausalPosition(20);
    await store.close();

    // Re-open: should load snapshot first, then replay append log
    const { store: store2 } = createFileStore(dir);
    const pos = await store2.loadCausalPosition();
    assert(pos === 20, `Expected position 20 (append log override), got ${pos}`);

    // Vector clocks from snapshot should still be there
    const loadedClocks = await store2.loadVectorClocks();
    assert(loadedClocks.get("PN-00001")!["agent-A"] === 5, "Snapshot vector clock should persist");
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: corrupted append log line skipped", async () => {
  const { store, dir } = createFileStore();
  try {
    // Write valid data
    await store.saveCausalPosition(42);
    await store.close();

    // Inject a corrupted line into the append log
    const appendLogPath = path.join(dir, "causal-append.jsonl");
    fs.appendFileSync(appendLogPath, "THIS IS NOT VALID JSON\n", "utf-8");

    // Write another valid line after the corrupted one
    fs.appendFileSync(
      appendLogPath,
      JSON.stringify({ type: "causal_position", timestamp: Date.now(), data: 100 }) + "\n",
      "utf-8"
    );

    // Re-open and verify the valid entries were applied (corrupted line skipped)
    const { store: store2 } = createFileStore(dir);
    const pos = await store2.loadCausalPosition();
    assert(pos === 100, `Expected position 100 (skipping corrupt line), got ${pos}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: load vector clocks returns empty map when no data", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const loaded = await store.loadVectorClocks();
    assert(loaded.size === 0, `Expected empty map, got size ${loaded.size}`);
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: load reorder buffer returns empty array when no data", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const loaded = await store.loadReorderBuffer();
    assert(loaded.length === 0, `Expected empty array, got length ${loaded.length}`);
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: load dependency graph returns empty when no data", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const loaded = await store.loadDependencyGraph();
    assert(loaded.edges.length === 0, "Expected empty edges");
    assert(loaded.deliveredEventIds.length === 0, "Expected empty delivered IDs");
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: load agent registry returns empty map when no data", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const loaded = await store.loadAgentRegistry();
    assert(loaded.size === 0, `Expected empty map, got size ${loaded.size}`);
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: ensures storage directory is created", async () => {
  const dir = path.join(os.tmpdir(), `dynaep-test-ensure-dir-${Date.now()}`);
  try {
    assert(!fs.existsSync(dir), "Directory should not exist before store creation");
    const store = new FileBasedCausalStore({
      path: dir,
      flushIntervalMs: 0,
      compactIntervalMs: 0,
      flushBatchSize: 1,
    });
    assert(fs.existsSync(dir), "Directory should be created by store constructor");
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("FileStore: overwriting vector clocks replaces previous data", async () => {
  const { store, dir } = createFileStore();
  try {
    const clocks1 = new Map<string, Record<string, number>>();
    clocks1.set("PN-00001", { "agent-A": 1 });
    clocks1.set("PN-00002", { "agent-B": 2 });
    await store.saveVectorClocks(clocks1);

    // Overwrite with different data
    const clocks2 = new Map<string, Record<string, number>>();
    clocks2.set("PN-00003", { "agent-C": 10 });
    await store.saveVectorClocks(clocks2);
    await store.close();

    const { store: store2 } = createFileStore(dir);
    const loaded = await store2.loadVectorClocks();
    // The latest save should replace the previous one
    assert(loaded.size === 1, `Expected 1 partition (overwritten), got ${loaded.size}`);
    assert(loaded.has("PN-00003"), "Should have PN-00003 from latest save");
    assert(!loaded.has("PN-00001"), "Should NOT have PN-00001 from earlier save");
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

// ---------------------------------------------------------------------------
// SqliteCausalStore Tests (graceful skip if better-sqlite3 not available)
// ---------------------------------------------------------------------------

console.log("\n--- SqliteCausalStore ---\n");

let sqliteAvailable = false;
try {
  require("better-sqlite3");
  sqliteAvailable = true;
} catch {
  console.log("  SKIP: better-sqlite3 not available, skipping SQLite tests\n");
}

if (sqliteAvailable) {
  test("SqliteStore: save and load vector clocks", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const clocks = new Map<string, Record<string, number>>();
      clocks.set("PN-00001", { "agent-A": 5, "agent-B": 3 });
      await store.saveVectorClocks(clocks);

      const loaded = await store.loadVectorClocks();
      assert(loaded.size === 1, `Expected 1 partition, got ${loaded.size}`);
      assert(loaded.get("PN-00001")!["agent-A"] === 5, "agent-A should be 5");
      assert(loaded.get("PN-00001")!["agent-B"] === 3, "agent-B should be 3");
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: save and load reorder buffer", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const events = [
        makeBufferedEvent({ partitionKey: "PN-00001" }),
        makeBufferedEvent({ partitionKey: "PN-00002", event: makeCausalEvent({ eventId: "evt-002" }) }),
      ];
      await store.saveReorderBuffer(events);

      const loaded = await store.loadReorderBuffer();
      assert(loaded.length === 2, `Expected 2 events, got ${loaded.length}`);
      assert(loaded[0].partitionKey === "PN-00001", "First event partition should be PN-00001");
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: save and load dependency graph", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const graph: DependencyGraph = {
        edges: [
          { eventId: "evt-002", dependsOn: "evt-001", partitionKey: "PN-00001" },
        ],
        deliveredEventIds: ["evt-001"],
      };
      await store.saveDependencyGraph(graph);

      const loaded = await store.loadDependencyGraph();
      assert(loaded.edges.length === 1, `Expected 1 edge, got ${loaded.edges.length}`);
      assert(loaded.edges[0].eventId === "evt-002", "Edge eventId should be evt-002");
      assert(loaded.deliveredEventIds.length === 1, `Expected 1 delivered, got ${loaded.deliveredEventIds.length}`);
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: save and load agent registry", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const agents = new Map<string, AgentRegistration>();
      agents.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));
      await store.saveAgentRegistry(agents);

      const loaded = await store.loadAgentRegistry();
      assert(loaded.size === 1, `Expected 1 agent, got ${loaded.size}`);
      assert(loaded.get("agent-A")!.lastSequence === 10, "lastSequence should be 10");
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: save and load causal position", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      await store.saveCausalPosition(77);
      const loaded = await store.loadCausalPosition();
      assert(loaded === 77, `Expected 77, got ${loaded}`);
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: getStateAge returns correct timestamp", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const before = Date.now();
      await store.saveCausalPosition(1);
      const age = await store.getStateAge();
      const after = Date.now();
      assert(age !== null, "State age should not be null");
      assert(age!.getTime() >= before, "Age should be >= before");
      assert(age!.getTime() <= after, "Age should be <= after");
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: getStateAge returns null when no state", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const age = await store.getStateAge();
      assert(age === null, `Expected null, got ${age}`);
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });

  test("SqliteStore: transaction atomicity - vector clock replace is atomic", async () => {
    const dbPath = path.join(os.tmpdir(), `dynaep-sqlite-test-${Date.now()}.db`);
    try {
      const store = new SqliteCausalStore(dbPath);
      const clocks1 = new Map<string, Record<string, number>>();
      clocks1.set("PN-00001", { "agent-A": 5 });
      clocks1.set("PN-00002", { "agent-B": 3 });
      await store.saveVectorClocks(clocks1);

      // Overwrite with new data
      const clocks2 = new Map<string, Record<string, number>>();
      clocks2.set("PN-00003", { "agent-C": 10 });
      await store.saveVectorClocks(clocks2);

      const loaded = await store.loadVectorClocks();
      // Transaction deletes old + inserts new atomically
      assert(loaded.size === 1, `Expected 1 partition after replace, got ${loaded.size}`);
      assert(loaded.has("PN-00003"), "Should have PN-00003");
      assert(!loaded.has("PN-00001"), "Should NOT have PN-00001");
      await store.close();
    } finally {
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    }
  });
}

// ---------------------------------------------------------------------------
// ExternalCausalStore Tests
// ---------------------------------------------------------------------------

console.log("\n--- ExternalCausalStore ---\n");

test("ExternalStore: save and load empty vector clocks", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  const empty = new Map<string, Record<string, number>>();
  await store.saveVectorClocks(empty);

  const loaded = await store.loadVectorClocks();
  assert(loaded.size === 0, `Expected 0 entries, got ${loaded.size}`);
  await store.close();
});

test("ExternalStore: save and load vector clocks", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  const clocks = new Map<string, Record<string, number>>();
  clocks.set("PN-00001", { "agent-A": 5, "agent-B": 3 });
  await store.saveVectorClocks(clocks);

  const loaded = await store.loadVectorClocks();
  assert(loaded.size === 1, `Expected 1 partition, got ${loaded.size}`);
  assert(loaded.get("PN-00001")!["agent-A"] === 5, "agent-A should be 5");
  await store.close();
});

test("ExternalStore: save and load reorder buffer", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  const events = [makeBufferedEvent()];
  await store.saveReorderBuffer(events);

  const loaded = await store.loadReorderBuffer();
  assert(loaded.length === 1, `Expected 1 event, got ${loaded.length}`);
  assert(loaded[0].partitionKey === "PN-00001", "Partition key should match");
  await store.close();
});

test("ExternalStore: save and load dependency graph", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  const graph: DependencyGraph = {
    edges: [{ eventId: "evt-002", dependsOn: "evt-001", partitionKey: "PN-00001" }],
    deliveredEventIds: ["evt-001"],
  };
  await store.saveDependencyGraph(graph);

  const loaded = await store.loadDependencyGraph();
  assert(loaded.edges.length === 1, `Expected 1 edge, got ${loaded.edges.length}`);
  assert(loaded.deliveredEventIds.length === 1, `Expected 1 delivered, got ${loaded.deliveredEventIds.length}`);
  await store.close();
});

test("ExternalStore: save and load agent registry", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  const agents = new Map<string, AgentRegistration>();
  agents.set("agent-A", makeAgentRegistration());
  await store.saveAgentRegistry(agents);

  const loaded = await store.loadAgentRegistry();
  assert(loaded.size === 1, `Expected 1 agent, got ${loaded.size}`);
  assert(loaded.has("agent-A"), "Should have agent-A");
  await store.close();
});

test("ExternalStore: save and load causal position", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  await store.saveCausalPosition(55);
  const loaded = await store.loadCausalPosition();
  assert(loaded === 55, `Expected 55, got ${loaded}`);
  await store.close();
});

test("ExternalStore: load returns defaults when no data", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  const clocks = await store.loadVectorClocks();
  assert(clocks.size === 0, "Vector clocks should default to empty map");

  const buffer = await store.loadReorderBuffer();
  assert(buffer.length === 0, "Reorder buffer should default to empty array");

  const graph = await store.loadDependencyGraph();
  assert(graph.edges.length === 0, "Dependency graph edges should be empty");
  assert(graph.deliveredEventIds.length === 0, "Delivered event IDs should be empty");

  const agents = await store.loadAgentRegistry();
  assert(agents.size === 0, "Agent registry should default to empty map");

  const pos = await store.loadCausalPosition();
  assert(pos === 0, `Causal position should default to 0, got ${pos}`);

  await store.close();
});

test("ExternalStore: state age tracking", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  // Initially null
  const ageBefore = await store.getStateAge();
  assert(ageBefore === null, "State age should be null initially");

  // After save, should be set
  const before = Date.now();
  await store.saveCausalPosition(1);
  const ageAfter = await store.getStateAge();
  const after = Date.now();
  assert(ageAfter !== null, "State age should not be null after save");
  assert(ageAfter!.getTime() >= before, "Age should be >= before");
  assert(ageAfter!.getTime() <= after, "Age should be <= after");
  await store.close();
});

test("ExternalStore: close delegates to backend", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  assert(backend.isConnected(), "Backend should be connected initially");
  assert(!backend.closeCalled, "Close should not have been called yet");

  await store.close();

  assert(backend.closeCalled, "Close should have been called on backend");
  assert(!backend.isConnected(), "Backend should be disconnected after close");
});

test("ExternalStore: compact is a no-op", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  // Should not throw
  await store.compact();
  assert(true, "Compact should not throw");
  await store.close();
});

test("ExternalStore: each save updates state age", async () => {
  const backend = new InMemoryKeyValueBackend();
  const store = new ExternalCausalStore(backend);

  await store.saveCausalPosition(1);
  const age1 = await store.getStateAge();

  // Small delay to ensure timestamp changes
  await new Promise((r) => setTimeout(r, 5));

  await store.saveVectorClocks(new Map());
  const age2 = await store.getStateAge();

  assert(age1 !== null && age2 !== null, "Both ages should be non-null");
  assert(age2!.getTime() >= age1!.getTime(), "Second age should be >= first");
  await store.close();
});

// ---------------------------------------------------------------------------
// PartitionedCausalEngine Persistence Integration Tests
// ---------------------------------------------------------------------------

console.log("\n--- PartitionedCausalEngine Persistence Integration ---\n");

function makeConfig(): CausalConfig {
  return {
    maxReorderBufferSize: 100,
    maxReorderWaitMs: 5000,
    conflictResolution: "last_write_wins",
    enableVectorClocks: true,
    enableElementHistory: true,
    historyDepth: 50,
  };
}

test("Engine: processEvent triggers persistence to store", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const sceneGraph = new MockSceneGraph();
    const engine = new PartitionedCausalEngine(makeConfig(), sceneGraph, store);

    const event = makeCausalEvent({
      eventId: "evt-001",
      agentId: "agent-A",
      targetElementId: "CP-00001",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 1 },
    });

    const result = engine.processEvent(event);
    assert(result.ordered === true, "Event should be ordered");

    // Allow microtask persistence to complete
    await new Promise((r) => setTimeout(r, 50));

    // Verify state was persisted
    const { store: store2 } = createFileStore(dir);
    const pos = await store2.loadCausalPosition();
    assert(pos >= 1, `Expected causal position >= 1, got ${pos}`);
    await store2.close();
    await store.close();
  } finally {
    cleanupDir(dir);
  }
});

test("Engine: getStateSnapshot returns correct data", () => {
  const dir = makeTempDir();
  try {
    const sceneGraph = new MockSceneGraph();
    const engine = new PartitionedCausalEngine(makeConfig(), sceneGraph);

    // Process some events
    const event1 = makeCausalEvent({
      eventId: "evt-001",
      agentId: "agent-A",
      targetElementId: "CP-00001",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 1 },
    });
    engine.processEvent(event1);

    const snapshot = engine.getStateSnapshot();
    assert(snapshot.causalPosition === 1, `Expected position 1, got ${snapshot.causalPosition}`);
    assert(snapshot.snapshotAt > 0, "Snapshot should have a timestamp");
    assert(typeof snapshot.vectorClocks === "object", "Should have vector clocks");
  } finally {
    cleanupDir(dir);
  }
});

test("Engine: shutdown persists and closes store", async () => {
  const dir = makeTempDir();
  try {
    const { store } = createFileStore(dir);
    const sceneGraph = new MockSceneGraph();
    const engine = new PartitionedCausalEngine(makeConfig(), sceneGraph, store);

    const event = makeCausalEvent({
      eventId: "evt-001",
      agentId: "agent-A",
      targetElementId: "CP-00001",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 1 },
    });
    engine.processEvent(event);

    // Shutdown should persist final state
    await engine.shutdown();

    // Verify state was persisted
    const { store: store2 } = createFileStore(dir);
    const pos = await store2.loadCausalPosition();
    assert(pos === 1, `Expected position 1 after shutdown, got ${pos}`);
    await store2.close();
  } finally {
    cleanupDir(dir);
  }
});

test("Engine: restoreFromStore loads causal position", async () => {
  const dir = makeTempDir();
  try {
    // Write initial state
    const { store: store1 } = createFileStore(dir);
    await store1.saveCausalPosition(42);
    const clocks = new Map<string, Record<string, number>>();
    clocks.set("PN-00001", { "agent-A": 10 });
    await store1.saveVectorClocks(clocks);
    await store1.close();

    // Create engine and restore
    const { store: store2 } = createFileStore(dir);
    const sceneGraph = new MockSceneGraph();
    const engine = new PartitionedCausalEngine(makeConfig(), sceneGraph, store2);

    await engine.restoreFromStore();

    // The global delivery position should be restored
    const snapshot = engine.getStateSnapshot();
    assert(snapshot.causalPosition === 42, `Expected restored position 42, got ${snapshot.causalPosition}`);
    await engine.shutdown();
  } finally {
    cleanupDir(dir);
  }
});

test("Engine: round-trip through shutdown and restore", async () => {
  const dir = makeTempDir();
  try {
    // Phase 1: Create engine, process events, shutdown
    const { store: store1 } = createFileStore(dir);
    const sceneGraph = new MockSceneGraph();
    const engine1 = new PartitionedCausalEngine(makeConfig(), sceneGraph, store1);

    for (let i = 1; i <= 5; i++) {
      engine1.processEvent(makeCausalEvent({
        eventId: `evt-${String(i).padStart(3, "0")}`,
        agentId: "agent-A",
        targetElementId: "CP-00001",
        sequenceNumber: i,
        vectorClock: { "agent-A": i },
      }));
    }

    await engine1.shutdown();

    // Phase 2: Create new engine, restore, verify
    const { store: store2 } = createFileStore(dir);
    const engine2 = new PartitionedCausalEngine(makeConfig(), sceneGraph, store2);
    await engine2.restoreFromStore();

    const snapshot = engine2.getStateSnapshot();
    assert(snapshot.causalPosition === 5, `Expected restored position 5, got ${snapshot.causalPosition}`);
    await engine2.shutdown();
  } finally {
    cleanupDir(dir);
  }
});

test("Engine: shutdown without store is a no-op", async () => {
  const sceneGraph = new MockSceneGraph();
  const engine = new PartitionedCausalEngine(makeConfig(), sceneGraph);

  // Should not throw
  await engine.shutdown();
  assert(true, "Shutdown without store should not throw");
});

test("Engine: restoreFromStore without store is a no-op", async () => {
  const sceneGraph = new MockSceneGraph();
  const engine = new PartitionedCausalEngine(makeConfig(), sceneGraph);

  // Should not throw
  await engine.restoreFromStore();
  assert(true, "restoreFromStore without store should not throw");
});

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

Promise.all(asyncTests).then(() => {
  setTimeout(() => {
    console.log(`\n--- Results: ${passed} passed, ${failed} failed ---\n`);
    if (failed > 0) process.exit(1);
  }, 200);
});
