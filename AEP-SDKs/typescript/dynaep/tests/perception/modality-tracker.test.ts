// @PAD: /root/dynAEP/sdk/typescript/tests/perception/modality-tracker.test.ts
// ===========================================================================
// Tests for ModalityTracker - OPT-010 Cross-Modality State Atomicity
// ===========================================================================

import { ModalityTracker, type PerceptionConfig, type ModalityState } from "../../src/perception/ModalityTracker";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(`ASSERTION FAILED: ${message}`);
  }
}

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void): void {
  try {
    fn();
    passed++;
    console.log(`  PASS: ${name}`);
  } catch (e: any) {
    failed++;
    console.log(`  FAIL: ${name}: ${e.message}`);
  }
}

// ---------------------------------------------------------------------------
// Mock BridgeClock
// ---------------------------------------------------------------------------

class MockBridgeClock {
  private _time: number = 1000;

  now(): number {
    return this._time;
  }

  advance(ms: number): void {
    this._time += ms;
  }

  stamp(): { bridgeTimeMs: number } {
    return { bridgeTimeMs: this._time };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(max: number = 3): PerceptionConfig {
  return { maxSimultaneousModalities: max };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("=== OPT-010: Modality Tracker Tests ===\n");

test("Initial state has no active modalities", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);
  const state = tracker.getActiveState();
  assert(state.activeCount === 0, "Should start with 0 active modalities");
  assert(state.activeModalities.length === 0, "Should have empty modality list");
});

test("recordActivation adds a modality", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 5000);

  const state = tracker.getActiveState();
  assert(state.activeCount === 1, "Should have 1 active modality");
  assert(state.activeModalities.includes("speech"), "Should include speech");
});

test("Multiple modalities tracked independently", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 5000);
  tracker.recordActivation("haptic", "evt-2", 3000);
  tracker.recordActivation("visual", "evt-3", 2000);

  const state = tracker.getActiveState();
  assert(state.activeCount === 3, "Should have 3 active modalities");
  assert(state.activeModalities.includes("speech"), "Should include speech");
  assert(state.activeModalities.includes("haptic"), "Should include haptic");
  assert(state.activeModalities.includes("visual"), "Should include visual");
});

test("Expired modalities are automatically removed", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 1000); // Duration 1000ms

  // Advance past expiry
  clock.advance(1500);

  const state = tracker.getActiveState();
  assert(state.activeCount === 0, "Expired modality should be removed");
  assert(state.activeModalities.length === 0, "No modalities should remain");
});

test("Only expired modalities are removed, active ones persist", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 1000);  // Expires at t=2000
  tracker.recordActivation("haptic", "evt-2", 5000);  // Expires at t=6000

  // Advance past speech expiry but not haptic
  clock.advance(1500); // t=2500

  const state = tracker.getActiveState();
  assert(state.activeCount === 1, "Only haptic should remain");
  assert(state.activeModalities.includes("haptic"), "haptic should be active");
  assert(!state.activeModalities.includes("speech"), "speech should be expired");
});

test("recordCompletion removes modality immediately", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 10000);
  tracker.recordCompletion("speech");

  const state = tracker.getActiveState();
  assert(state.activeCount === 0, "Completed modality should be removed");
});

test("Same modality re-activated updates the entry", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 1000);
  clock.advance(500);
  tracker.recordActivation("speech", "evt-2", 2000); // Re-activate with new duration

  const state = tracker.getActiveState();
  assert(state.activeCount === 1, "Should still have 1 (replaced)");

  // Advance past original expiry (t=2000) but within new one
  clock.advance(1000); // t=2500, new speech started at t=1500, expires at t=3500

  const state2 = tracker.getActiveState();
  assert(state2.activeCount === 1, "Re-activated speech should still be active");
});

test("getActiveModalities returns full ModalityInfo", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 5000);

  const modalities = tracker.getActiveModalities();
  assert(modalities.size === 1, "Should have 1 modality");

  const info = modalities.get("speech")!;
  assert(info.modality === "speech", "Modality name should match");
  assert(info.eventId === "evt-1", "Event ID should match");
  assert(info.startedAt === 1000, "Start time should match clock time");
  assert(info.estimatedDurationMs === 5000, "Duration should match");
});

test("getActiveModalities returns snapshot (not live reference)", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 5000);
  const snapshot = tracker.getActiveModalities();

  tracker.recordActivation("haptic", "evt-2", 3000);

  // Original snapshot should not be affected
  assert(snapshot.size === 1, "Snapshot should not change");
  assert(!snapshot.has("haptic"), "Snapshot should not include later additions");
});

test("getMaxSimultaneous returns configured limit", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(5), clock as any);
  assert(tracker.getMaxSimultaneous() === 5, "Should return configured max");
});

test("Atomic sequence: getActiveState -> evaluate -> record", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(3), clock as any);

  // Simulate the full atomic sequence:
  // 1. Get active state
  const state1 = tracker.getActiveState();
  assert(state1.activeCount === 0, "Should start empty");

  // 2. Check if activation is allowed (mock Rego eval)
  const isAllowed = state1.activeCount < tracker.getMaxSimultaneous();
  assert(isAllowed, "Should be allowed (0 < 3)");

  // 3. Record activation
  tracker.recordActivation("speech", "evt-1", 5000);

  // Repeat for second modality
  const state2 = tracker.getActiveState();
  assert(state2.activeCount === 1, "Should have 1 after first activation");
  tracker.recordActivation("haptic", "evt-2", 3000);

  // And third
  const state3 = tracker.getActiveState();
  assert(state3.activeCount === 2, "Should have 2 after second activation");
  tracker.recordActivation("visual", "evt-3", 2000);

  // Now at capacity
  const state4 = tracker.getActiveState();
  assert(state4.activeCount === 3, "Should have 3 at capacity");

  // Fourth should be denied by Rego (we simulate the check)
  const isAllowed4 = state4.activeCount < tracker.getMaxSimultaneous();
  assert(!isAllowed4, "Should not allow 4th modality");
});

test("Boundary: expiry at exact duration edge", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "evt-1", 1000); // startedAt=1000, expires when now > 2000

  // At exact boundary (now = 2000, not > 2000)
  clock.advance(1000); // t=2000
  const state1 = tracker.getActiveState();
  assert(state1.activeCount === 1, "At exact boundary should still be active (not strictly >)");

  // One ms past boundary
  clock.advance(1);
  const state2 = tracker.getActiveState();
  assert(state2.activeCount === 0, "Past boundary should be expired");
});

test("recordCompletion for non-existent modality is a no-op", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  // Should not throw
  tracker.recordCompletion("nonexistent");
  const state = tracker.getActiveState();
  assert(state.activeCount === 0, "Should still be 0");
});

test("Multiple activations and completions interleaved", () => {
  const clock = new MockBridgeClock();
  const tracker = new ModalityTracker(makeConfig(), clock as any);

  tracker.recordActivation("speech", "e-1", 5000);
  tracker.recordActivation("haptic", "e-2", 3000);
  assert(tracker.getActiveState().activeCount === 2, "Should have 2");

  tracker.recordCompletion("speech");
  assert(tracker.getActiveState().activeCount === 1, "Should have 1 after speech completion");

  tracker.recordActivation("visual", "e-3", 2000);
  assert(tracker.getActiveState().activeCount === 2, "Should have 2 again");

  tracker.recordCompletion("haptic");
  tracker.recordCompletion("visual");
  assert(tracker.getActiveState().activeCount === 0, "Should have 0 after all completions");
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
if (failed > 0) process.exit(1);
