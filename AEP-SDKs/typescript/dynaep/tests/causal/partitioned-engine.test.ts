// @PAD: /root/dynAEP/sdk/typescript/tests/causal/partitioned-engine.test.ts
// ===========================================================================
// Tests for PartitionedCausalEngine - OPT-005 Subtree Partitioning
// ===========================================================================

import {
  PartitionedCausalEngine,
  type SceneGraph,
} from "../../src/causal/PartitionedCausalEngine";
import { SparseVectorClock } from "../../src/causal/SparseVectorClock";
import type { CausalConfig, CausalEvent } from "../../src/temporal/causal";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void | Promise<void>): void {
  try {
    const result = fn();
    if (result instanceof Promise) {
      result.then(() => { passed++; console.log(`  PASS: ${name}`); })
            .catch((e: any) => { failed++; console.log(`  FAIL: ${name}: ${e.message}`); });
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
// Mock Scene Graph
// ---------------------------------------------------------------------------

class MockSceneGraph implements SceneGraph {
  private parents: Map<string, string | null> = new Map();

  constructor(subtreeCount: number, elementsPerSubtree: number) {
    this.parents.set("SH-00001", null); // root
    for (let s = 0; s < subtreeCount; s++) {
      const subtreeRoot = `PN-${String(s + 1).padStart(5, "0")}`;
      this.parents.set(subtreeRoot, "SH-00001");
      for (let e = 0; e < elementsPerSubtree; e++) {
        const elemId = `CP-${String(s * 1000 + e + 1).padStart(5, "0")}`;
        this.parents.set(elemId, subtreeRoot);
      }
    }
  }

  getParent(elementId: string): string | null {
    return this.parents.get(elementId) ?? null;
  }

  getChildren(elementId: string): string[] {
    const children: string[] = [];
    for (const [id, parent] of this.parents) {
      if (parent === elementId) children.push(id);
    }
    return children;
  }

  isRoot(elementId: string): boolean {
    return elementId === "SH-00001";
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<CausalConfig>): CausalConfig {
  return {
    maxReorderBufferSize: 64,
    maxReorderWaitMs: 5000,
    conflictResolution: "last_write_wins",
    enableVectorClocks: true,
    enableElementHistory: true,
    historyDepth: 50,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CausalEvent> & { eventId: string; agentId: string; sequenceNumber: number; targetElementId: string }): CausalEvent {
  return {
    bridgeTimeMs: Date.now(),
    vectorClock: {},
    causalDependencies: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("=== OPT-005: Partitioned Causal Engine Tests ===\n");

// SparseVectorClock AEP-NOSHIP/tests

test("SparseVectorClock: increment and get", () => {
  const clock = new SparseVectorClock();
  assert(clock.get("a") === 0, "Absent agent should return 0");
  clock.increment("a");
  assert(clock.get("a") === 1, "After increment should be 1");
  clock.increment("a");
  assert(clock.get("a") === 2, "After second increment should be 2");
  assert(clock.size === 1, "Should track 1 agent");
});

test("SparseVectorClock: merge takes component-wise max", () => {
  const a = new SparseVectorClock({ "x": 3, "y": 1 });
  const b = new SparseVectorClock({ "x": 1, "y": 5, "z": 2 });
  a.merge(b);
  assert(a.get("x") === 3, "x should remain 3 (max of 3,1)");
  assert(a.get("y") === 5, "y should be 5 (max of 1,5)");
  assert(a.get("z") === 2, "z should be 2 (merged from b)");
  assert(a.size === 3, "Should track 3 agents after merge");
});

test("SparseVectorClock: dominates correctly", () => {
  const a = new SparseVectorClock({ "x": 3, "y": 2 });
  const b = new SparseVectorClock({ "x": 2, "y": 1 });
  assert(a.dominates(b), "a should dominate b");
  assert(!b.dominates(a), "b should not dominate a");
});

test("SparseVectorClock: concurrent detection", () => {
  const a = new SparseVectorClock({ "x": 3, "y": 1 });
  const b = new SparseVectorClock({ "x": 1, "y": 3 });
  assert(a.isConcurrentWith(b), "a and b should be concurrent");
  assert(b.isConcurrentWith(a), "b and a should be concurrent");
});

test("SparseVectorClock: not concurrent when one dominates", () => {
  const a = new SparseVectorClock({ "x": 3, "y": 2 });
  const b = new SparseVectorClock({ "x": 2, "y": 1 });
  assert(!a.isConcurrentWith(b), "Should not be concurrent when a dominates b");
});

test("SparseVectorClock: clone is independent", () => {
  const a = new SparseVectorClock({ "x": 5 });
  const b = a.clone();
  b.increment("x");
  assert(a.get("x") === 5, "Original should be unchanged");
  assert(b.get("x") === 6, "Clone should be incremented");
});

test("SparseVectorClock: toJSON roundtrip", () => {
  const a = new SparseVectorClock({ "agent-1": 10, "agent-2": 5 });
  const json = a.toJSON();
  const b = new SparseVectorClock(json);
  assert(b.get("agent-1") === 10, "Should preserve agent-1 value");
  assert(b.get("agent-2") === 5, "Should preserve agent-2 value");
});

// PartitionedCausalEngine AEP-NOSHIP/tests

test("Routes events to correct subtree partitions", () => {
  const sg = new MockSceneGraph(3, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Events targeting different subtrees should get different partition keys
  const key1 = engine.getPartitionKey("CP-00001"); // subtree PN-00001
  const key2 = engine.getPartitionKey("CP-01001"); // subtree PN-00002
  const key3 = engine.getPartitionKey("CP-02001"); // subtree PN-00003

  assert(key1 === "PN-00001", `Partition key should be PN-00001, got ${key1}`);
  assert(key2 === "PN-00002", `Partition key should be PN-00002, got ${key2}`);
  assert(key3 === "PN-00003", `Partition key should be PN-00003, got ${key3}`);
});

test("Elements in same subtree share partition", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  const key1 = engine.getPartitionKey("CP-00001");
  const key2 = engine.getPartitionKey("CP-00002");
  const key3 = engine.getPartitionKey("CP-00003");

  assert(key1 === key2, "Elements in same subtree should share partition");
  assert(key2 === key3, "Elements in same subtree should share partition");
});

test("Root element is its own partition", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  const key = engine.getPartitionKey("SH-00001");
  assert(key === "SH-00001", `Root should be its own partition, got ${key}`);
});

test("Processes in-order events across partitions independently", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Agent-1 in subtree 1
  const r1 = engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));
  assert(r1.ordered, "First event should be ordered");
  assert(r1.partitionKey === "PN-00001", "Should route to PN-00001");

  // Agent-2 in subtree 2
  const r2 = engine.processEvent(makeEvent({
    eventId: "e-2", agentId: "agent-2", sequenceNumber: 1,
    targetElementId: "CP-01001",
  }));
  assert(r2.ordered, "Event in different subtree should be ordered independently");
  assert(r2.partitionKey === "PN-00002", "Should route to PN-00002");
});

test("Out-of-order events in one subtree do not block another", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Send seq=2 first in subtree 1 (out of order)
  const r1 = engine.processEvent(makeEvent({
    eventId: "e-2", agentId: "agent-1", sequenceNumber: 2,
    targetElementId: "CP-00001",
  }));
  assert(!r1.ordered, "Out-of-order event should be buffered");

  // Subtree 2 should still process normally
  const r2 = engine.processEvent(makeEvent({
    eventId: "e-1b", agentId: "agent-2", sequenceNumber: 1,
    targetElementId: "CP-01001",
  }));
  assert(r2.ordered, "Subtree 2 should not be affected by subtree 1 buffer");
});

test("Reorders buffered events when missing event arrives", () => {
  const sg = new MockSceneGraph(1, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Send seq=2 first (buffered)
  engine.processEvent(makeEvent({
    eventId: "e-2", agentId: "agent-1", sequenceNumber: 2,
    targetElementId: "CP-00001",
  }));

  // Send seq=1 (delivers both)
  const r = engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));
  assert(r.ordered, "Missing event should trigger delivery");
  assert(r.reorderedEvents.length > 0, "Should report reordered events");
});

test("Detects duplicate events within partition", () => {
  const sg = new MockSceneGraph(1, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));

  const r = engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));
  assert(!r.ordered, "Duplicate should not be ordered");
  assert(r.violations.some(v => v.type === "duplicate_sequence"), "Should report duplicate violation");
});

test("Detects clock regression within partition", () => {
  const sg = new MockSceneGraph(1, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  engine.processEvent(makeEvent({
    eventId: "e-2", agentId: "agent-1", sequenceNumber: 2,
    targetElementId: "CP-00001",
  }));

  // Drain buffer by sending seq=1
  engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));

  // Now expected is 3. Sending seq=1 again is a regression.
  const r = engine.processEvent(makeEvent({
    eventId: "e-1-dup", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));
  assert(!r.ordered, "Regressed sequence should not be ordered");
  assert(r.violations.some(v => v.type === "agent_clock_regression"), "Should report regression violation");
});

test("Cross-partition move succeeds for elements in different subtrees", () => {
  const sg = new MockSceneGraph(3, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Prime partitions
  engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));

  const result = engine.handleCrossPartitionMove("CP-00001", "PN-00002");
  assert(result.success, "Cross-partition move should succeed");
  assert(result.oldPartition === "PN-00001", "Old partition should be PN-00001");
  assert(result.newPartition === "PN-00002", "New partition should be PN-00002");
});

test("Cross-partition move within same subtree is no-op success", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  const result = engine.handleCrossPartitionMove("CP-00001", "CP-00002");
  assert(result.success, "Same-subtree move should succeed");
  assert(result.oldPartition === result.newPartition, "Partitions should be the same");
});

test("Element history is per-partition", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));
  engine.processEvent(makeEvent({
    eventId: "e-2", agentId: "agent-1", sequenceNumber: 2,
    targetElementId: "CP-00001",
  }));

  const history = engine.elementHistory("CP-00001");
  assert(history.length === 2, `History should have 2 entries, got ${history.length}`);
});

test("getPartitionStats returns stats for all active partitions", () => {
  const sg = new MockSceneGraph(3, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Create events in 2 of 3 subtrees
  engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));
  engine.processEvent(makeEvent({
    eventId: "e-2", agentId: "agent-2", sequenceNumber: 1,
    targetElementId: "CP-01001",
  }));

  const stats = engine.getPartitionStats();
  assert(stats.size === 2, `Should have 2 active partitions, got ${stats.size}`);
});

test("Conflict detection uses sparse vector clocks", () => {
  const sg = new MockSceneGraph(1, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  const eventA = makeEvent({
    eventId: "e-a", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
    vectorClock: { "agent-1": 2, "agent-2": 1 },
  });
  const eventB = makeEvent({
    eventId: "e-b", agentId: "agent-2", sequenceNumber: 1,
    targetElementId: "CP-00001",
    vectorClock: { "agent-1": 1, "agent-2": 2 },
  });

  const concurrent = engine.detectConflicts(eventA, eventB);
  assert(concurrent, "Events with concurrent vector clocks should conflict");
});

test("Conflict detection returns false for different elements", () => {
  const sg = new MockSceneGraph(1, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  const eventA = makeEvent({
    eventId: "e-a", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  });
  const eventB = makeEvent({
    eventId: "e-b", agentId: "agent-2", sequenceNumber: 1,
    targetElementId: "CP-00002",
  });

  const concurrent = engine.detectConflicts(eventA, eventB);
  assert(!concurrent, "Events on different elements should not conflict");
});

test("Reset clears all partitions", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  engine.processEvent(makeEvent({
    eventId: "e-1", agentId: "agent-1", sequenceNumber: 1,
    targetElementId: "CP-00001",
  }));

  engine.reset();
  const stats = engine.getPartitionStats();
  assert(stats.size === 0, "After reset, no partitions should exist");
});

test("Flush returns all buffered events", () => {
  const sg = new MockSceneGraph(2, 5);
  const engine = new PartitionedCausalEngine(makeConfig(), sg);

  // Buffer events in both subtrees
  engine.processEvent(makeEvent({
    eventId: "e-2a", agentId: "agent-1", sequenceNumber: 2,
    targetElementId: "CP-00001",
  }));
  engine.processEvent(makeEvent({
    eventId: "e-2b", agentId: "agent-2", sequenceNumber: 2,
    targetElementId: "CP-01001",
  }));

  const flushed = engine.flush();
  assert(flushed.length === 2, `Flush should return 2 events, got ${flushed.length}`);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

setTimeout(() => {
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}, 100);
