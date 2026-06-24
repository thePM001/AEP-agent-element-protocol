// @PAD: /root/dynAEP/sdk/typescript/tests/recovery/bridge-recovery-protocol.test.ts
// ===========================================================================
// Tests for TA-3.4: Bridge Recovery Protocol
// Tests BridgeRecoveryProtocol three-phase recovery: announce, re-register,
// and buffer replay.
// ===========================================================================

import {
  BridgeRecoveryProtocol,
  type RecoveryConfig,
  type RecoveryResult,
} from "../../src/recovery/BridgeRecoveryProtocol";
import type {
  DurableCausalStore,
  BufferedEvent,
  DependencyGraph,
  AgentRegistration,
  CausalStateSnapshot,
} from "../../src/causal/DurableCausalStore";
import type { CausalEvent, CausalConfig } from "../../src/temporal/causal";
import type { AgentReregisterEvent } from "../../src/temporal/events";

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
// Mock DurableCausalStore
// ---------------------------------------------------------------------------

class MockDurableCausalStore implements DurableCausalStore {
  vectorClocks: Map<string, Record<string, number>> = new Map();
  reorderBuffer: BufferedEvent[] = [];
  dependencyGraph: DependencyGraph = { edges: [], deliveredEventIds: [] };
  agentRegistry: Map<string, AgentRegistration> = new Map();
  causalPosition: number = 0;
  stateAge: Date | null = null;
  loadError: boolean = false;
  closed: boolean = false;

  async saveVectorClocks(clocks: Map<string, Record<string, number>>): Promise<void> {
    this.vectorClocks = new Map(clocks);
  }
  async loadVectorClocks(): Promise<Map<string, Record<string, number>>> {
    if (this.loadError) throw new Error("load error");
    return new Map(this.vectorClocks);
  }
  async saveReorderBuffer(events: BufferedEvent[]): Promise<void> {
    this.reorderBuffer = [...events];
  }
  async loadReorderBuffer(): Promise<BufferedEvent[]> {
    if (this.loadError) throw new Error("load error");
    return [...this.reorderBuffer];
  }
  async saveDependencyGraph(graph: DependencyGraph): Promise<void> {
    this.dependencyGraph = { ...graph };
  }
  async loadDependencyGraph(): Promise<DependencyGraph> {
    if (this.loadError) throw new Error("load error");
    return { ...this.dependencyGraph };
  }
  async saveAgentRegistry(agents: Map<string, AgentRegistration>): Promise<void> {
    this.agentRegistry = new Map(agents);
  }
  async loadAgentRegistry(): Promise<Map<string, AgentRegistration>> {
    if (this.loadError) throw new Error("load error");
    return new Map(this.agentRegistry);
  }
  async saveCausalPosition(position: number): Promise<void> {
    this.causalPosition = position;
  }
  async loadCausalPosition(): Promise<number> {
    if (this.loadError) throw new Error("load error");
    return this.causalPosition;
  }
  async getStateAge(): Promise<Date | null> {
    return this.stateAge;
  }
  async compact(): Promise<void> {}
  async close(): Promise<void> {
    this.closed = true;
  }
}

// ---------------------------------------------------------------------------
// Mock PartitionedCausalEngine
// ---------------------------------------------------------------------------

class MockPartitionedCausalEngine {
  restored: boolean = false;
  resetCalled: boolean = false;
  processedEvents: CausalEvent[] = [];
  processEventResult: { ordered: boolean; reorderedEvents: any[]; violations: any[] } = {
    ordered: true,
    reorderedEvents: [],
    violations: [],
  };
  failProcessEvent: boolean = false;
  stateSnapshot: CausalStateSnapshot = {
    vectorClocks: {},
    reorderBuffer: [],
    dependencyGraph: { edges: [], deliveredEventIds: [] },
    agentRegistry: {},
    causalPosition: 0,
    snapshotAt: Date.now(),
  };

  async restoreFromStore(): Promise<void> {
    this.restored = true;
  }

  reset(): void {
    this.resetCalled = true;
    this.stateSnapshot = {
      vectorClocks: {},
      reorderBuffer: [],
      dependencyGraph: { edges: [], deliveredEventIds: [] },
      agentRegistry: {},
      causalPosition: 0,
      snapshotAt: Date.now(),
    };
  }

  processEvent(event: CausalEvent): { ordered: boolean; reorderedEvents: any[]; violations: any[] } {
    if (this.failProcessEvent) throw new Error("process failed");
    this.processedEvents.push(event);
    return { ...this.processEventResult };
  }

  getStateSnapshot(): CausalStateSnapshot {
    return { ...this.stateSnapshot };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<RecoveryConfig>): RecoveryConfig {
  return {
    maxRecoveryGapMs: 60000, // 60 seconds
    enabled: true,
    ...overrides,
  };
}

function makeAgentRegistration(overrides?: Partial<AgentRegistration>): AgentRegistration {
  return {
    agentId: overrides?.agentId ?? "agent-A",
    registeredAt: overrides?.registeredAt ?? Date.now() - 5000,
    lastSequence: overrides?.lastSequence ?? 10,
    lastEventId: overrides?.lastEventId ?? "evt-010",
    capabilities: overrides?.capabilities ?? ["read", "write"],
  };
}

function makeCausalEvent(overrides?: Partial<CausalEvent>): CausalEvent {
  return {
    eventId: overrides?.eventId ?? "evt-001",
    agentId: overrides?.agentId ?? "agent-A",
    bridgeTimeMs: overrides?.bridgeTimeMs ?? Date.now(),
    targetElementId: overrides?.targetElementId ?? "CP-00001",
    sequenceNumber: overrides?.sequenceNumber ?? 1,
    vectorClock: overrides?.vectorClock ?? { "agent-A": 1 },
    causalDependencies: overrides?.causalDependencies ?? [],
  };
}

function makeReregisterEvent(overrides?: Partial<AgentReregisterEvent>): AgentReregisterEvent {
  return {
    type: "CUSTOM",
    dynaep_type: "AEP_AGENT_REREGISTER",
    agentId: overrides?.agentId ?? "agent-A",
    lastSequence: overrides?.lastSequence ?? 10,
    lastEventId: overrides?.lastEventId ?? "evt-010",
    capabilities: overrides?.capabilities ?? ["read", "write"],
  };
}

function makeDefaultClockQuality(): { sync_state: string; confidence_class: string } {
  return { sync_state: "LOCKED", confidence_class: "A" };
}

function createProtocol(
  configOverrides?: Partial<RecoveryConfig>,
  store?: MockDurableCausalStore,
  engine?: MockPartitionedCausalEngine,
  clockQuality?: (() => { sync_state: string; confidence_class: string } | null),
): {
  protocol: BridgeRecoveryProtocol;
  store: MockDurableCausalStore;
  engine: MockPartitionedCausalEngine;
} {
  const s = store ?? new MockDurableCausalStore();
  const e = engine ?? new MockPartitionedCausalEngine();
  const cq = clockQuality ?? (() => makeDefaultClockQuality());
  const protocol = new BridgeRecoveryProtocol(
    makeConfig(configOverrides),
    s as any,
    e as any,
    cq,
  );
  return { protocol, store: s, engine: e };
}

// ===========================================================================
// Phase 1: Announce Recovery Tests
// ===========================================================================

console.log("\n=== TA-3.4: Bridge Recovery Protocol Tests ===\n");
console.log("--- Phase 1: Announce Recovery ---\n");

test("Phase1: recovery succeeds when state is within maxRecoveryGapMs", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000); // 5 seconds ago
  store.causalPosition = 42;
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A" }));
  store.vectorClocks.set("PN-00001", { "agent-A": 10 });

  const { protocol } = createProtocol({ maxRecoveryGapMs: 60000 }, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover successfully");
  assert(result.restoredCausalPosition === 42, `Expected position 42, got ${result.restoredCausalPosition}`);
  assert(result.restoredAgents.length === 1, `Expected 1 agent, got ${result.restoredAgents.length}`);
  assert(result.restoredAgents[0] === "agent-A", `Expected agent-A, got ${result.restoredAgents[0]}`);
});

test("Phase1: recovery fails (full reset) when state is too old", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 120000); // 2 minutes ago
  store.causalPosition = 42;

  const { protocol, engine } = createProtocol({ maxRecoveryGapMs: 60000 }, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === false, "Should not recover (state too old)");
  assert(result.source === "none", `Expected source "none", got ${result.source}`);
  assert(engine.resetCalled === true, "Engine should have been reset");
});

test("Phase1: recovery fails when no persisted state exists", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = null; // No persisted state

  const { protocol, engine } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === false, "Should not recover (no state)");
  assert(result.source === "none", `Expected source "none", got ${result.source}`);
  assert(engine.resetCalled === true, "Engine should have been reset");
});

test("Phase1: recovery fails when protocol is disabled", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 1000);
  store.causalPosition = 100;

  const { protocol, engine } = createProtocol({ enabled: false }, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === false, "Should not recover (disabled)");
  assert(engine.resetCalled === true, "Engine should have been reset");
});

test("Phase1: recovery restores causal position", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.causalPosition = 99;

  const { protocol, engine } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  assert(result.restoredCausalPosition === 99, `Expected 99, got ${result.restoredCausalPosition}`);
  assert(engine.restored === true, "Engine restoreFromStore should have been called");
});

test("Phase1: recovery restores agent registry", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));
  store.agentRegistry.set("agent-B", makeAgentRegistration({ agentId: "agent-B", lastSequence: 20 }));

  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  assert(result.restoredAgents.length === 2, `Expected 2 agents, got ${result.restoredAgents.length}`);
  assert(result.restoredAgents.includes("agent-A"), "Should include agent-A");
  assert(result.restoredAgents.includes("agent-B"), "Should include agent-B");
});

test("Phase1: recovery produces AEP_TEMPORAL_RECOVERY event", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.causalPosition = 42;
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A" }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const event = protocol.getRecoveryEvent();
  assert(event !== null, "Recovery event should exist");
  assert(event!.dynaep_type === "AEP_TEMPORAL_RECOVERY", `Expected AEP_TEMPORAL_RECOVERY, got ${event!.dynaep_type}`);
  assert(event!.restoredCausalPosition === 42, `Expected position 42, got ${event!.restoredCausalPosition}`);
  assert(event!.restoredAgents.length === 1, "Should have 1 restored agent");
  assert(event!.recoveredAt > 0, "Should have a recoveredAt timestamp");
});

test("Phase1: full reset produces AEP_TEMPORAL_RESET event", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = null;

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const event = protocol.getResetEvent();
  assert(event !== null, "Reset event should exist");
  assert(event!.dynaep_type === "AEP_TEMPORAL_RESET", `Expected AEP_TEMPORAL_RESET, got ${event!.dynaep_type}`);
  assert(event!.reason === "clock_resync", `Expected reason clock_resync, got ${event!.reason}`);
  assert(event!.resetAt > 0, "Should have a resetAt timestamp");
});

test("Phase1: RecoveryResult has correct fields", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 12000); // 12 seconds ago
  store.causalPosition = 55;
  store.agentRegistry.set("agent-X", makeAgentRegistration({ agentId: "agent-X" }));

  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(typeof result.recovered === "boolean", "recovered should be boolean");
  assert(typeof result.source === "string", "source should be string");
  assert(Array.isArray(result.restoredAgents), "restoredAgents should be array");
  assert(typeof result.restoredCausalPosition === "number", "restoredCausalPosition should be number");
  assert(typeof result.gapMs === "number", "gapMs should be number");
  assert(result.gapMs >= 12000, `gapMs should be >= 12000, got ${result.gapMs}`);
  assert(typeof result.droppedEvents === "number", "droppedEvents should be number");
  assert(typeof result.stateAge === "string", "stateAge should be string");
});

test("Phase1: error during loading falls back to reset", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.loadError = true; // Will cause loads to throw

  const { protocol, engine } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === false, "Should fall back to reset on error");
  assert(engine.resetCalled === true, "Engine should have been reset");
});

test("Phase1: source detection - file store", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);

  // MockDurableCausalStore constructor name does not include sqlite/external
  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  // Source detection uses constructor name; our mock is "MockDurableCausalStore" -> "file" fallback
  assert(result.source === "file", `Expected source "file" (fallback), got ${result.source}`);
});

test("Phase1: stateAge formatted correctly - seconds", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 42000); // 42 seconds ago

  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  assert(result.stateAge === "42s", `Expected "42s", got "${result.stateAge}"`);
});

test("Phase1: stateAge formatted correctly - minutes", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 192000); // 3m 12s ago

  const { protocol } = createProtocol({ maxRecoveryGapMs: 300000 }, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  assert(result.stateAge === "3m 12s", `Expected "3m 12s", got "${result.stateAge}"`);
});

test("Phase1: reset result has zero values", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = null;

  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === false, "Should not recover");
  assert(result.restoredAgents.length === 0, "No agents");
  assert(result.restoredCausalPosition === 0, "Position should be 0");
  assert(result.gapMs === 0, "Gap should be 0");
  assert(result.droppedEvents === 0, "No dropped events");
  assert(result.stateAge === "0s", `Expected "0s", got "${result.stateAge}"`);
});

// ===========================================================================
// Phase 2: Agent Re-registration Tests
// ===========================================================================

console.log("\n--- Phase 2: Agent Re-registration ---\n");

test("Phase2: known agent with matching sequence returns resumed", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A", lastSequence: 10 }),
  );

  assert(reply.status === "resumed", `Expected "resumed", got ${reply.status}`);
  assert(reply.agentId === "agent-A", `Expected agent-A, got ${reply.agentId}`);
  assert(reply.restoredSequence === 10, `Expected 10, got ${reply.restoredSequence}`);
  assert(reply.gapEvents === 0, `Expected 0 gap events, got ${reply.gapEvents}`);
});

test("Phase2: known agent with mismatched sequence returns reset", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A", lastSequence: 15 }),
  );

  assert(reply.status === "reset", `Expected "reset", got ${reply.status}`);
  assert(reply.restoredSequence === 10, `Expected restored seq 10, got ${reply.restoredSequence}`);
});

test("Phase2: unknown agent returns unknown", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A" }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-UNKNOWN" }),
  );

  assert(reply.status === "unknown", `Expected "unknown", got ${reply.status}`);
  assert(reply.restoredSequence === 0, `Expected 0, got ${reply.restoredSequence}`);
  assert(reply.gapEvents === 0, `Expected 0, got ${reply.gapEvents}`);
});

test("Phase2: no recovery performed returns unknown", () => {
  // Do NOT call attemptRecovery
  const { protocol } = createProtocol();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A" }),
  );

  assert(reply.status === "unknown", `Expected "unknown", got ${reply.status}`);
});

test("Phase2: gapEvents computed correctly", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  // Agent reports sequence 15, bridge has 10 -> gap of 5
  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A", lastSequence: 15 }),
  );

  assert(reply.gapEvents === 5, `Expected 5 gap events, got ${reply.gapEvents}`);
});

test("Phase2: gapEvents computed correctly when agent is behind bridge", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 20 }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  // Agent reports sequence 15, bridge has 20 -> gap of 5 (absolute)
  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A", lastSequence: 15 }),
  );

  assert(reply.gapEvents === 5, `Expected 5 gap events (absolute), got ${reply.gapEvents}`);
});

test("Phase2: bridgeClockState from getClockQuality", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));

  const { protocol } = createProtocol(
    {},
    store,
    undefined,
    () => ({ sync_state: "LOCKED", confidence_class: "A" }),
  );
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A", lastSequence: 10 }),
  );

  assert(reply.bridgeClockState.sync_state === "LOCKED", `Expected LOCKED, got ${reply.bridgeClockState.sync_state}`);
  assert(reply.bridgeClockState.confidence_class === "A", `Expected A, got ${reply.bridgeClockState.confidence_class}`);
});

test("Phase2: bridgeClockState defaults when getClockQuality returns null", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-A", makeAgentRegistration({ agentId: "agent-A", lastSequence: 10 }));

  const { protocol } = createProtocol(
    {},
    store,
    undefined,
    () => null, // Returns null
  );
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A", lastSequence: 10 }),
  );

  assert(reply.bridgeClockState.sync_state === "FREEWHEEL", `Expected FREEWHEEL, got ${reply.bridgeClockState.sync_state}`);
  assert(reply.bridgeClockState.confidence_class === "F", `Expected F, got ${reply.bridgeClockState.confidence_class}`);
});

test("Phase2: result has correct agentId", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.agentRegistry.set("agent-X", makeAgentRegistration({ agentId: "agent-X", lastSequence: 5 }));

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-X", lastSequence: 5 }),
  );

  assert(reply.agentId === "agent-X", `Expected agent-X, got ${reply.agentId}`);
  assert(reply.dynaep_type === "AEP_REREGISTER_RESULT", `Expected AEP_REREGISTER_RESULT, got ${reply.dynaep_type}`);
});

test("Phase2: after full reset, all agents are unknown", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = null; // Triggers full reset

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const reply = protocol.handleAgentReregister(
    makeReregisterEvent({ agentId: "agent-A" }),
  );

  assert(reply.status === "unknown", "Agent should be unknown after full reset");
});

// ===========================================================================
// Phase 3: Buffer Replay Tests
// ===========================================================================

console.log("\n--- Phase 3: Buffer Replay ---\n");

test("Phase3: buffered events replayed through engine", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  const event1 = makeCausalEvent({ eventId: "evt-001" });
  const event2 = makeCausalEvent({ eventId: "evt-002" });
  store.reorderBuffer = [
    { event: event1, bufferedAt: Date.now() - 2000, partitionKey: "PN-00001" },
    { event: event2, bufferedAt: Date.now() - 1000, partitionKey: "PN-00001" },
  ];

  const engine = new MockPartitionedCausalEngine();
  const { protocol } = createProtocol({}, store, engine);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  assert(engine.processedEvents.length === 2, `Expected 2 replayed events, got ${engine.processedEvents.length}`);
  assert(result.droppedEvents === 0, `Expected 0 dropped, got ${result.droppedEvents}`);
});

test("Phase3: failed events counted as droppedEvents", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.reorderBuffer = [
    { event: makeCausalEvent({ eventId: "evt-001" }), bufferedAt: Date.now() - 2000, partitionKey: "PN-00001" },
    { event: makeCausalEvent({ eventId: "evt-002" }), bufferedAt: Date.now() - 1000, partitionKey: "PN-00001" },
  ];

  const engine = new MockPartitionedCausalEngine();
  // First event orders, second does not
  let callCount = 0;
  engine.processEvent = (event: CausalEvent) => {
    callCount++;
    return {
      ordered: callCount === 1, // First succeeds, second fails
      reorderedEvents: [],
      violations: [],
    };
  };

  const { protocol } = createProtocol({}, store, engine);
  const result = await protocol.attemptRecovery();

  assert(result.droppedEvents === 1, `Expected 1 dropped event, got ${result.droppedEvents}`);
});

test("Phase3: empty buffer returns 0 droppedEvents", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.reorderBuffer = [];

  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  assert(result.recovered === true, "Should recover");
  assert(result.droppedEvents === 0, `Expected 0 dropped, got ${result.droppedEvents}`);
});

test("Phase3: events sorted by bufferedAt before replay", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);

  const event1 = makeCausalEvent({ eventId: "evt-late" });
  const event2 = makeCausalEvent({ eventId: "evt-early" });
  // Buffered in reverse order
  store.reorderBuffer = [
    { event: event1, bufferedAt: Date.now() - 1000, partitionKey: "PN-00001" },
    { event: event2, bufferedAt: Date.now() - 2000, partitionKey: "PN-00001" },
  ];

  const engine = new MockPartitionedCausalEngine();
  const replayOrder: string[] = [];
  engine.processEvent = (event: CausalEvent) => {
    replayOrder.push(event.eventId);
    return { ordered: true, reorderedEvents: [], violations: [] };
  };

  const { protocol } = createProtocol({}, store, engine);
  await protocol.attemptRecovery();

  assert(replayOrder.length === 2, `Expected 2 replayed, got ${replayOrder.length}`);
  assert(replayOrder[0] === "evt-early", `First replayed should be early, got ${replayOrder[0]}`);
  assert(replayOrder[1] === "evt-late", `Second replayed should be late, got ${replayOrder[1]}`);
});

test("Phase3: processEvent exception counts as dropped", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.reorderBuffer = [
    { event: makeCausalEvent({ eventId: "evt-001" }), bufferedAt: Date.now() - 1000, partitionKey: "PN-00001" },
  ];

  const engine = new MockPartitionedCausalEngine();
  engine.failProcessEvent = true;

  const { protocol } = createProtocol({}, store, engine);
  const result = await protocol.attemptRecovery();

  assert(result.droppedEvents === 1, `Expected 1 dropped (exception), got ${result.droppedEvents}`);
});

// ===========================================================================
// Accessor Tests
// ===========================================================================

console.log("\n--- Accessors ---\n");

test("Accessor: getRecoveryResult returns null before recovery", () => {
  const { protocol } = createProtocol();
  const result = protocol.getRecoveryResult();
  assert(result === null, "Should be null before attemptRecovery");
});

test("Accessor: getRecoveryEvent populated after successful recovery", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const event = protocol.getRecoveryEvent();
  assert(event !== null, "Recovery event should be populated");
  assert(event!.type === "CUSTOM", "Should be CUSTOM type");
  assert(event!.dynaep_type === "AEP_TEMPORAL_RECOVERY", "Should be AEP_TEMPORAL_RECOVERY");
});

test("Accessor: getResetEvent populated after full reset", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = null;

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const resetEvt = protocol.getResetEvent();
  assert(resetEvt !== null, "Reset event should be populated");
  assert(resetEvt!.dynaep_type === "AEP_TEMPORAL_RESET", "Should be AEP_TEMPORAL_RESET");

  const recoveryEvt = protocol.getRecoveryEvent();
  assert(recoveryEvt === null, "Recovery event should be null after reset");
});

test("Accessor: getRecoveryResult populated after recovery", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.causalPosition = 33;

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const result = protocol.getRecoveryResult();
  assert(result !== null, "Should be populated");
  assert(result!.recovered === true, "Should show recovered");
  assert(result!.restoredCausalPosition === 33, `Expected 33, got ${result!.restoredCausalPosition}`);
});

test("Accessor: recovery event has merged vector clock", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);
  store.vectorClocks.set("PN-00001", { "agent-A": 5, "agent-B": 3 });
  store.vectorClocks.set("PN-00002", { "agent-A": 2, "agent-B": 7 });

  const { protocol } = createProtocol({}, store);
  await protocol.attemptRecovery();

  const event = protocol.getRecoveryEvent();
  assert(event !== null, "Recovery event should exist");
  // Merged should be component-wise max
  assert(event!.restoredVectorClock["agent-A"] === 5, `Expected agent-A=5, got ${event!.restoredVectorClock["agent-A"]}`);
  assert(event!.restoredVectorClock["agent-B"] === 7, `Expected agent-B=7, got ${event!.restoredVectorClock["agent-B"]}`);
});

test("Accessor: recovery event source matches result source", async () => {
  const store = new MockDurableCausalStore();
  store.stateAge = new Date(Date.now() - 5000);

  const { protocol } = createProtocol({}, store);
  const result = await protocol.attemptRecovery();

  const event = protocol.getRecoveryEvent();
  assert(event !== null, "Recovery event should exist");
  assert(event!.source === result.source, `Event source ${event!.source} should match result source ${result.source}`);
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
