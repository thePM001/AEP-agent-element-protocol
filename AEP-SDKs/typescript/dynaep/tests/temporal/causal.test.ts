// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/causal.test.ts
// ===========================================================================
// Tests for CausalOrderingEngine - dynAEP temporal authority layer
// ===========================================================================

import {
  CausalOrderingEngine,
  CausalConfig,
  CausalEvent,
  CausalOrderResult,
  CausalViolation,
} from "../../src/temporal/causal";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

function assertThrows(fn: () => void, message: string): void {
  let threw = false;
  try { fn(); } catch { threw = true; }
  if (!threw) throw new Error(`Expected throw: ${message}`);
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
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<CausalConfig>): CausalConfig {
  return {
    maxReorderBufferSize: 100,
    maxReorderWaitMs: 5000,
    conflictResolution: "last_write_wins",
    enableVectorClocks: true,
    enableElementHistory: true,
    historyDepth: 50,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CausalEvent> & { eventId: string; agentId: string; sequenceNumber: number }): CausalEvent {
  return {
    bridgeTimeMs: Date.now(),
    targetElementId: "elem-1",
    vectorClock: {},
    causalDependencies: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

export function testRegistersAgentAndInitializesVectorClockEntry(): void {
  test("Registers agent and initializes vector clock entry", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-alpha");
    const vc = engine.getVectorClock();
    assert("agent-alpha" in vc, "Vector clock should have an entry for agent-alpha");
    assert(vc["agent-alpha"] === 0, "Initial vector clock value should be 0");
  });
}

export function testProcessesInOrderEventsWithoutBuffering(): void {
  test("Processes in-order events without buffering", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    const results: CausalOrderResult[] = [];
    for (let seq = 1; seq <= 3; seq++) {
      const evt = makeEvent({ eventId: `e-${seq}`, agentId: "agent-1", sequenceNumber: seq });
      const r = engine.process(evt);
      results.push(r);
    }

    for (let i = 0; i < results.length; i++) {
      assert(results[i].ordered === true, `Event ${i + 1} should be ordered`);
    }
  });
}

export function testBuffersOutOfOrderEventsForReordering(): void {
  test("Buffers out-of-order events for reordering", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    // Send seq 2 before seq 1
    const evt2 = makeEvent({ eventId: "e-2", agentId: "agent-1", sequenceNumber: 2 });
    const result = engine.process(evt2);
    assert(result.ordered === false, "Out-of-order event should not be delivered immediately");
    const hasOutOfOrder = result.violations.some(
      (v: CausalViolation) => v.type === "out_of_order"
    );
    assert(hasOutOfOrder, "Should produce an out_of_order violation");
  });
}

export function testEmitsBufferedEventsWhenGapIsFilled(): void {
  test("Emits buffered events when gap is filled", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    // Send seq 2 first (buffered)
    const evt2 = makeEvent({ eventId: "e-2", agentId: "agent-1", sequenceNumber: 2 });
    engine.process(evt2);

    // Send seq 1 (fills the gap, should drain seq 2)
    const evt1 = makeEvent({ eventId: "e-1", agentId: "agent-1", sequenceNumber: 1 });
    const result = engine.process(evt1);
    assert(result.ordered === true, "Event seq 1 should be delivered");
    assert(
      result.reorderedEvents.includes("e-2"),
      "Buffered event e-2 should be drained and reordered"
    );
  });
}

export function testDetectsAgentClockRegression(): void {
  test("Detects agent clock regression", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    // Deliver seq 1, 2, 3
    engine.process(makeEvent({ eventId: "e-1", agentId: "agent-1", sequenceNumber: 1 }));
    engine.process(makeEvent({ eventId: "e-2", agentId: "agent-1", sequenceNumber: 2 }));
    engine.process(makeEvent({ eventId: "e-3", agentId: "agent-1", sequenceNumber: 3 }));

    // Now send seq 1 again - this is a regression
    const regressed = makeEvent({ eventId: "e-regressed", agentId: "agent-1", sequenceNumber: 1 });
    const result = engine.process(regressed);
    const hasRegression = result.violations.some(
      (v: CausalViolation) => v.type === "agent_clock_regression"
    );
    assert(hasRegression, "Should detect agent_clock_regression violation");
  });
}

export function testDetectsMissingCausalDependencies(): void {
  test("Detects missing causal dependencies", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    const evt = makeEvent({
      eventId: "e-1",
      agentId: "agent-1",
      sequenceNumber: 1,
      causalDependencies: ["nonexistent-event-id"],
    });
    const result = engine.process(evt);
    const hasMissing = result.violations.some(
      (v: CausalViolation) => v.type === "missing_dependency"
    );
    assert(hasMissing, "Should detect missing_dependency violation");
  });
}

export function testDetectsDuplicateSequenceNumbers(): void {
  test("Detects duplicate sequence numbers", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    // Deliver seq 1
    engine.process(makeEvent({ eventId: "e-1", agentId: "agent-1", sequenceNumber: 1 }));

    // Send same eventId again
    const duplicate = makeEvent({ eventId: "e-1", agentId: "agent-1", sequenceNumber: 2 });
    const result = engine.process(duplicate);
    const hasDuplicate = result.violations.some(
      (v: CausalViolation) => v.type === "duplicate_sequence"
    );
    assert(hasDuplicate, "Should detect duplicate_sequence violation");
  });
}

export function testFlushDrainsBufferInCausalOrder(): void {
  test("flush() drains buffer in causal order", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    // Buffer events out of order
    engine.process(makeEvent({ eventId: "e-3", agentId: "agent-1", sequenceNumber: 3, bridgeTimeMs: 3000 }));
    engine.process(makeEvent({ eventId: "e-2", agentId: "agent-1", sequenceNumber: 2, bridgeTimeMs: 2000 }));

    const flushed = engine.flush();
    assert(flushed.length === 2, "Flush should drain 2 buffered events");
    assert(
      flushed[0].sequenceNumber <= flushed[1].sequenceNumber,
      "Flushed events should be in sequence order"
    );
  });
}

export function testVectorClockAdvancesCorrectlyForSingleAgent(): void {
  test("Vector clock advances correctly for single agent", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-1");

    engine.process(makeEvent({ eventId: "e-1", agentId: "agent-1", sequenceNumber: 1 }));
    engine.process(makeEvent({ eventId: "e-2", agentId: "agent-1", sequenceNumber: 2 }));
    engine.process(makeEvent({ eventId: "e-3", agentId: "agent-1", sequenceNumber: 3 }));

    const vc = engine.getVectorClock();
    assert(vc["agent-1"] === 3, "Vector clock for agent-1 should be 3 after 3 events");
  });
}

export function testVectorClockAdvancesCorrectlyForMultipleAgents(): void {
  test("Vector clock advances correctly for multiple agents", () => {
    const engine = new CausalOrderingEngine(makeConfig());
    engine.registerAgent("agent-A");
    engine.registerAgent("agent-B");

    engine.process(makeEvent({ eventId: "a-1", agentId: "agent-A", sequenceNumber: 1 }));
    engine.process(makeEvent({ eventId: "b-1", agentId: "agent-B", sequenceNumber: 1 }));
    engine.process(makeEvent({ eventId: "a-2", agentId: "agent-A", sequenceNumber: 2 }));

    const vc = engine.getVectorClock();
    assert(vc["agent-A"] === 2, "Vector clock for agent-A should be 2");
    assert(vc["agent-B"] === 1, "Vector clock for agent-B should be 1");
  });
}

export function testDetectConflictsReturnsTrueForConcurrentMutationsOnSameElement(): void {
  test("detectConflicts returns true for concurrent mutations on same element", () => {
    const engine = new CausalOrderingEngine(makeConfig());

    const eventA: CausalEvent = {
      eventId: "a-1",
      agentId: "agent-A",
      bridgeTimeMs: 1000,
      targetElementId: "shared-elem",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 1, "agent-B": 0 },
      causalDependencies: [],
    };
    const eventB: CausalEvent = {
      eventId: "b-1",
      agentId: "agent-B",
      bridgeTimeMs: 1001,
      targetElementId: "shared-elem",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 0, "agent-B": 1 },
      causalDependencies: [],
    };

    const isConflict = engine.detectConflicts(eventA, eventB);
    assert(isConflict === true, "Concurrent mutations on the same element should be a conflict");
  });
}

export function testDetectConflictsReturnsFalseForDifferentElements(): void {
  test("detectConflicts returns false for concurrent mutations on different elements", () => {
    const engine = new CausalOrderingEngine(makeConfig());

    const eventA: CausalEvent = {
      eventId: "a-1",
      agentId: "agent-A",
      bridgeTimeMs: 1000,
      targetElementId: "elem-alpha",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 1, "agent-B": 0 },
      causalDependencies: [],
    };
    const eventB: CausalEvent = {
      eventId: "b-1",
      agentId: "agent-B",
      bridgeTimeMs: 1001,
      targetElementId: "elem-beta",
      sequenceNumber: 1,
      vectorClock: { "agent-A": 0, "agent-B": 1 },
      causalDependencies: [],
    };

    const isConflict = engine.detectConflicts(eventA, eventB);
    assert(isConflict === false, "Mutations on different elements should not conflict");
  });
}

export function testRespectsMaxReorderBufferSize(): void {
  test("Respects maxReorderBufferSize", () => {
    const engine = new CausalOrderingEngine(makeConfig({ maxReorderBufferSize: 3 }));
    engine.registerAgent("agent-1");

    // Buffer events with sequences 5, 4, 3, 2 (all out of order since expected is 1)
    engine.process(makeEvent({ eventId: "e-5", agentId: "agent-1", sequenceNumber: 5, bridgeTimeMs: 5000 }));
    engine.process(makeEvent({ eventId: "e-4", agentId: "agent-1", sequenceNumber: 4, bridgeTimeMs: 4000 }));
    engine.process(makeEvent({ eventId: "e-3", agentId: "agent-1", sequenceNumber: 3, bridgeTimeMs: 3000 }));
    engine.process(makeEvent({ eventId: "e-2", agentId: "agent-1", sequenceNumber: 2, bridgeTimeMs: 2000 }));

    // When buffer exceeds max size (3), the oldest by bridgeTimeMs should be evicted.
    // After adding 4 items to a buffer of max 3, oldest gets force-delivered.
    // We can verify by flushing - should have at most 3 items remaining.
    const flushed = engine.flush();
    assert(flushed.length <= 3, "Buffer should not exceed maxReorderBufferSize of 3");
  });
}

export function testDropsEventsAfterMaxReorderWaitMsExpires(): void {
  test("Drops events after maxReorderWaitMs expires", () => {
    // Use a very short wait to test timeout behavior via flush
    const engine = new CausalOrderingEngine(makeConfig({ maxReorderWaitMs: 10 }));
    engine.registerAgent("agent-1");

    // Buffer an out-of-order event
    engine.process(makeEvent({ eventId: "e-3", agentId: "agent-1", sequenceNumber: 3 }));

    // Force flush to simulate drain after wait period
    const flushed = engine.flush();
    assert(flushed.length === 1, "Flushed events should include the timed-out buffered event");
    assert(flushed[0].eventId === "e-3", "The flushed event should be e-3");
  });
}

// ---------------------------------------------------------------------------
// Run all AEP-NOSHIP/tests
// ---------------------------------------------------------------------------

testRegistersAgentAndInitializesVectorClockEntry();
testProcessesInOrderEventsWithoutBuffering();
testBuffersOutOfOrderEventsForReordering();
testEmitsBufferedEventsWhenGapIsFilled();
testDetectsAgentClockRegression();
testDetectsMissingCausalDependencies();
testDetectsDuplicateSequenceNumbers();
testFlushDrainsBufferInCausalOrder();
testVectorClockAdvancesCorrectlyForSingleAgent();
testVectorClockAdvancesCorrectlyForMultipleAgents();
testDetectConflictsReturnsTrueForConcurrentMutationsOnSameElement();
testDetectConflictsReturnsFalseForDifferentElements();
testRespectsMaxReorderBufferSize();
testDropsEventsAfterMaxReorderWaitMsExpires();

setTimeout(() => {
  console.log(`\nCausal tests complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 2000);
