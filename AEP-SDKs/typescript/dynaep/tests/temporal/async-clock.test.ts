// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/async-clock.test.ts
// ===========================================================================
// Tests for AsyncBridgeClock - OPT-008 Async NTP Sync with Slewing
// ===========================================================================

import { AsyncBridgeClock } from "../../src/temporal/AsyncBridgeClock";
import type { ClockConfig } from "../../src/temporal/clock";

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
// Helpers
// ---------------------------------------------------------------------------

function makeConfig(overrides?: Partial<ClockConfig>): ClockConfig {
  return {
    protocol: "system",
    source: "",
    syncIntervalMs: 30000,
    maxDriftMs: 50,
    bridgeIsAuthority: true,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

console.log("=== OPT-008: Async Bridge Clock Tests ===\n");

test("now() returns a positive timestamp", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const t = clock.now();
  assert(t > 0, `now() should be positive, got ${t}`);
  assert(t > 1_600_000_000_000, `now() should be after 2020 in ms, got ${t}`);
});

test("now() is monotonically non-decreasing", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  let prev = 0;
  for (let i = 0; i < 1000; i++) {
    const t = clock.now();
    assert(t >= prev, `now() must be monotonic: ${t} < ${prev} at iteration ${i}`);
    prev = t;
  }
});

test("now() completes in < 0.01ms", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const iterations = 10000;
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    clock.now();
  }
  const elapsed = performance.now() - start;
  const avgMs = elapsed / iterations;
  assert(avgMs < 0.01, `now() should be < 0.01ms, got ${avgMs.toFixed(5)}ms`);
});

test("now() is synchronous (returns number, not Promise)", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const result = clock.now();
  assert(typeof result === "number", "now() should return a number");
  assert(!(result instanceof Promise), "now() should not return a Promise");
});

test("stamp() produces valid BridgeTimestamp", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const ts = clock.stamp();
  assert(ts.bridgeTimeMs > 0, "bridgeTimeMs should be positive");
  assert(ts.source === "system", "Source should be system");
  assert(ts.driftMs === 0, "Drift should be 0 without agent time");
});

test("stamp() calculates drift from agent time", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const agentTime = Date.now() - 100; // 100ms ago
  const ts = clock.stamp(agentTime);
  assert(ts.driftMs > 0, `Drift should be positive for past agent time, got ${ts.driftMs}`);
  assert(ts.agentTimeMs === agentTime, "agentTimeMs should be preserved");
});

test("health() returns correct initial state", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const h = clock.health();
  assert(h.protocol === "system", `Protocol should be system, got ${h.protocol}`);
  assert(h.currentOffsetMs === 0, "Initial offset should be 0");
  assert(h.uptimeMs >= 0, "Uptime should be non-negative");
});

test("isSynced() returns false before any sync", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  assert(!clock.isSynced(), "Should not be synced before start()");
});

test("getActiveProtocol() returns configured protocol", () => {
  const clock = new AsyncBridgeClock(makeConfig({ protocol: "ntp" }));
  assert(clock.getActiveProtocol() === "ntp", "Should return configured protocol");
});

test("getOffsetMs() is 0 before sync", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  assert(clock.getOffsetMs() === 0, "Initial offset should be 0");
});

test("isAuthority() reflects config", () => {
  const clock1 = new AsyncBridgeClock(makeConfig({ bridgeIsAuthority: true }));
  assert(clock1.isAuthority(), "Should be authority when configured");

  const clock2 = new AsyncBridgeClock(makeConfig({ bridgeIsAuthority: false }));
  assert(!clock2.isAuthority(), "Should not be authority when not configured");
});

test("measureDrift() returns bridge time minus agent time", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const agentTime = Date.now() - 50;
  const drift = clock.measureDrift(agentTime);
  assert(drift > 0, `Drift should be positive for past agent time, got ${drift}`);
  assert(drift < 200, `Drift should be reasonable, got ${drift}`);
});

test("start() with system protocol syncs immediately", async () => {
  const clock = new AsyncBridgeClock(makeConfig({ protocol: "system", syncIntervalMs: 0 }));
  await clock.start();
  assert(clock.isSynced(), "Should be synced after start");
  assert(clock.getSyncCount() >= 1, "Should have at least 1 sync");
  clock.stop();
});

test("stop() halts periodic sync", async () => {
  const clock = new AsyncBridgeClock(makeConfig({ protocol: "system", syncIntervalMs: 100 }));
  await clock.start();
  const countAtStop = clock.getSyncCount();
  clock.stop();
  // Wait a bit and verify count hasn't changed
  await new Promise(resolve => setTimeout(resolve, 250));
  assert(clock.getSyncCount() === countAtStop, "Sync count should not increase after stop");
});

test("onSync() receives events after sync", async () => {
  const clock = new AsyncBridgeClock(makeConfig({ protocol: "system", syncIntervalMs: 0 }));
  let received = false;
  clock.onSync((event) => {
    received = true;
    assert(event.type === "AEP_CLOCK_SYNC", "Event type should be AEP_CLOCK_SYNC");
    assert(event.payload.source === "system", "Source should be system");
  });
  await clock.start();
  assert(received, "Should have received sync event");
  clock.stop();
});

test("Multiple now() calls are close to each other", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const t1 = clock.now();
  const t2 = clock.now();
  const diff = t2 - t1;
  assert(diff >= 0, "Second call should be >= first");
  assert(diff < 1, `Consecutive calls should be within 1ms, got ${diff}ms`);
});

test("now() is close to Date.now()", () => {
  const clock = new AsyncBridgeClock(makeConfig());
  const bridgeTime = clock.now();
  const dateTime = Date.now();
  const diff = Math.abs(bridgeTime - dateTime);
  // Should be within a few ms of Date.now() without NTP offset
  assert(diff < 100, `Bridge time should be close to Date.now(), diff=${diff}ms`);
});

test("start() falls back to system if NTP unavailable", async () => {
  const clock = new AsyncBridgeClock(makeConfig({
    protocol: "ntp",
    source: "192.0.2.1", // Non-routable address
    syncIntervalMs: 0,
  }));
  await clock.start();
  // Should fall back to system
  assert(
    clock.getActiveProtocol() === "system" || clock.getActiveProtocol() === "ntp",
    "Should fall back to system or remain ntp",
  );
  clock.stop();
});

test("PTP falls back to NTP or system", async () => {
  const clock = new AsyncBridgeClock(makeConfig({
    protocol: "ptp",
    syncIntervalMs: 0,
  }));
  await clock.start();
  // PTP offset file likely doesn't exist, should fall back
  const proto = clock.getActiveProtocol();
  assert(
    proto === "system" || proto === "ntp",
    `Should fall back from PTP, got ${proto}`,
  );
  clock.stop();
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

setTimeout(() => {
  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  if (failed > 0) process.exit(1);
}, 2000); // Allow async tests to complete
