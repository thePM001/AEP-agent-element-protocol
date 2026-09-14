// ===========================================================================
// Benchmark: OPT-005 Causal Ordering Subtree Partitioning
//
// Compares global CausalOrderingEngine vs PartitionedCausalEngine at
// 2, 5, 10, and 20 agents. Measures per-event ordering latency, buffer
// utilization, and partition balance.
//
// Target: partitioned engine < 50% latency of global at 10+ agents
// ===========================================================================

import { CausalOrderingEngine, type CausalConfig, type CausalEvent } from "../sdk/typescript/src/temporal/causal";
import { PartitionedCausalEngine, type SceneGraph } from "../sdk/typescript/src/causal/PartitionedCausalEngine";

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

const config: CausalConfig = {
  maxReorderBufferSize: 64,
  maxReorderWaitMs: 5000,
  conflictResolution: "last_write_wins",
  enableVectorClocks: true,
  enableElementHistory: true,
  historyDepth: 50,
};

function makeEvent(agentId: string, seq: number, targetId: string): CausalEvent {
  return {
    eventId: `evt-${agentId}-${seq}`,
    agentId,
    bridgeTimeMs: Date.now(),
    targetElementId: targetId,
    sequenceNumber: seq,
    vectorClock: {},
    causalDependencies: [],
  };
}

// ---------------------------------------------------------------------------
// Benchmarks
// ---------------------------------------------------------------------------

function benchGlobal(agentCount: number, eventsPerAgent: number, subtreeCount: number): void {
  const engine = new CausalOrderingEngine(config);
  const elements: string[] = [];
  for (let s = 0; s < subtreeCount; s++) {
    for (let e = 0; e < 10; e++) {
      elements.push(`CP-${String(s * 1000 + e + 1).padStart(5, "0")}`);
    }
  }

  const start = performance.now();
  for (let a = 0; a < agentCount; a++) {
    const agentId = `agent-${a}`;
    for (let seq = 1; seq <= eventsPerAgent; seq++) {
      const target = elements[(a * eventsPerAgent + seq) % elements.length];
      engine.process(makeEvent(agentId, seq, target));
    }
  }
  const elapsed = performance.now() - start;
  const totalEvents = agentCount * eventsPerAgent;
  const avgUs = (elapsed * 1000) / totalEvents;
  console.log(`  Global (${agentCount} agents, ${totalEvents} events): ${avgUs.toFixed(1)}µs/event, ${Math.round(totalEvents / (elapsed / 1000))} events/sec`);
}

function benchPartitioned(agentCount: number, eventsPerAgent: number, subtreeCount: number): void {
  const sceneGraph = new MockSceneGraph(subtreeCount, 10);
  const engine = new PartitionedCausalEngine(config, sceneGraph);
  const elements: string[] = [];
  for (let s = 0; s < subtreeCount; s++) {
    for (let e = 0; e < 10; e++) {
      elements.push(`CP-${String(s * 1000 + e + 1).padStart(5, "0")}`);
    }
  }

  const start = performance.now();
  for (let a = 0; a < agentCount; a++) {
    const agentId = `agent-${a}`;
    for (let seq = 1; seq <= eventsPerAgent; seq++) {
      const target = elements[(a * eventsPerAgent + seq) % elements.length];
      engine.processEvent(makeEvent(agentId, seq, target));
    }
  }
  const elapsed = performance.now() - start;
  const totalEvents = agentCount * eventsPerAgent;
  const avgUs = (elapsed * 1000) / totalEvents;
  const stats = engine.getPartitionStats();
  console.log(`  Partitioned (${agentCount} agents, ${totalEvents} events, ${stats.size} partitions): ${avgUs.toFixed(1)}µs/event, ${Math.round(totalEvents / (elapsed / 1000))} events/sec`);
}

function benchCrossPartitionMoves(moveCount: number): void {
  const sceneGraph = new MockSceneGraph(4, 10);
  const engine = new PartitionedCausalEngine(config, sceneGraph);

  // Prime with some events
  for (let s = 0; s < 4; s++) {
    const target = `CP-${String(s * 1000 + 1).padStart(5, "0")}`;
    engine.processEvent(makeEvent("agent-0", s + 1, target));
  }

  const start = performance.now();
  for (let i = 0; i < moveCount; i++) {
    const elemId = `CP-${String((i % 4) * 1000 + 1).padStart(5, "0")}`;
    const newParent = `PN-${String(((i + 1) % 4) + 1).padStart(5, "0")}`;
    engine.handleCrossPartitionMove(elemId, newParent);
  }
  const elapsed = performance.now() - start;
  const avgUs = (elapsed * 1000) / moveCount;
  console.log(`  Cross-partition moves (${moveCount}): ${avgUs.toFixed(1)}µs/move`);
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

console.log("=== OPT-005: Causal Ordering - Global vs Partitioned ===\n");

for (const agentCount of [2, 5, 10, 20]) {
  console.log(`--- ${agentCount} agents ---`);
  benchGlobal(agentCount, 100, 4);
  benchPartitioned(agentCount, 100, 4);
  console.log();
}

console.log("--- Cross-partition moves ---");
benchCrossPartitionMoves(100);
benchCrossPartitionMoves(1000);

console.log("\n--- Buffer fill under sustained out-of-order ---");
const sceneGraph = new MockSceneGraph(4, 10);
const engine = new PartitionedCausalEngine(config, sceneGraph);
// Send events out of order
for (let a = 0; a < 5; a++) {
  const agentId = `agent-${a}`;
  for (let seq = 10; seq >= 1; seq--) {
    const target = `CP-${String(a * 1000 + 1).padStart(5, "0")}`;
    engine.processEvent(makeEvent(agentId, seq, target));
  }
}
const stats = engine.getPartitionStats();
for (const [key, stat] of stats) {
  console.log(`  Partition ${key}: buffer=${stat.bufferSize}/${stat.bufferCapacity}, delivered=${stat.deliveredCount}, agents=${stat.agentCount}`);
}

console.log("\nDone.");
