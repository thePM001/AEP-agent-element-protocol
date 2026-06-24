// @PAD: /root/dynAEP/sdk/typescript/tests/temporal/clock.test.ts
// ===========================================================================
// Tests for BridgeClock - dynAEP temporal authority layer
// ===========================================================================

import { BridgeClock, ClockConfig } from "../../src/temporal/clock";

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
// Tests
// ---------------------------------------------------------------------------

export function testBridgeClockInitializesWithNTPConfig(): void {
  test("BridgeClock initializes with NTP config", () => {
    const config: ClockConfig = {
      protocol: "ntp",
      source: "pool.ntp.org",
      syncIntervalMs: 30000,
      maxDriftMs: 100,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    assert(clock !== null && clock !== undefined, "Clock instance should exist");
    const h = clock.health();
    assert(h.protocol === "ntp", "health().protocol should be 'ntp'");
  });
}

export function testBridgeClockInitializesWithPTPConfig(): void {
  test("BridgeClock initializes with PTP config", () => {
    const config: ClockConfig = {
      protocol: "ptp",
      source: "/sys/class/ptp/ptp0/offset",
      syncIntervalMs: 10000,
      maxDriftMs: 50,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const h = clock.health();
    assert(h.protocol === "ptp", "health().protocol should be 'ptp'");
  });
}

export function testBridgeClockFallbackToSystemClock(): void {
  test("BridgeClock falls back to system clock when NTP unreachable", async () => {
    const config: ClockConfig = {
      protocol: "ntp",
      source: "192.0.2.1",
      syncIntervalMs: 0,
      maxDriftMs: 500,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const syncResult = await clock.sync();
    // Even if NTP fails, sync should succeed via system fallback
    assert(syncResult.success === true, "Sync should succeed via system fallback");
    const h = clock.health();
    assert(h !== null && h !== undefined, "health() should still work after fallback");
  });
}

export function testStampProducesBridgeTimestampWithCorrectStructure(): void {
  test("stamp() produces BridgeTimestamp with correct structure", () => {
    const config: ClockConfig = {
      protocol: "system",
      source: "local",
      syncIntervalMs: 0,
      maxDriftMs: 200,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const ts = clock.stamp(null);
    assert(ts.bridgeTimeMs > 0, "bridgeTimeMs should be greater than 0");
    assert(typeof ts.source === "string" && ts.source.length > 0, "source should exist");
    assert(ts.syncedAt >= 0, "syncedAt should be >= 0");
  });
}

export function testStampPreservesAgentTimestamp(): void {
  test("stamp() preserves agent timestamp in agentTimeMs field", () => {
    const config: ClockConfig = {
      protocol: "system",
      source: "local",
      syncIntervalMs: 0,
      maxDriftMs: 200,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const ts = clock.stamp(1000);
    assert(ts.agentTimeMs === 1000, "agentTimeMs should be exactly 1000");
  });
}

export function testStampMeasuresDriftCorrectly(): void {
  test("stamp() measures drift correctly", () => {
    const config: ClockConfig = {
      protocol: "system",
      source: "local",
      syncIntervalMs: 0,
      maxDriftMs: 200,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const knownAgentTime = Date.now() - 50;
    const ts = clock.stamp(knownAgentTime);
    // driftMs = bridgeTimeMs - agentTimeMs, should be roughly 50ms
    assert(typeof ts.driftMs === "number", "driftMs should be a number");
    assert(Math.abs(ts.driftMs - 50) < 100, "driftMs should be reasonably close to 50");
  });
}

export function testIsSyncedReturnsFalseBeforeFirstSync(): void {
  test("isSynced() returns false before first sync", () => {
    const config: ClockConfig = {
      protocol: "ntp",
      source: "pool.ntp.org",
      syncIntervalMs: 60000,
      maxDriftMs: 100,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    assert(clock.isSynced() === false, "isSynced() should be false before any sync");
  });
}

export function testIsSyncedReturnsTrueAfterSuccessfulSync(): void {
  test("isSynced() returns true after successful sync", async () => {
    const config: ClockConfig = {
      protocol: "system",
      source: "local",
      syncIntervalMs: 60000,
      maxDriftMs: 100,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const result = await clock.sync();
    assert(result.success === true, "System clock sync should succeed");
    assert(clock.isSynced() === true, "isSynced() should be true after successful sync");
  });
}

export function testHealthReturnsCompleteClockHealthObject(): void {
  test("health() returns complete ClockHealth object", () => {
    const config: ClockConfig = {
      protocol: "system",
      source: "local",
      syncIntervalMs: 30000,
      maxDriftMs: 200,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    const h = clock.health();
    assert(typeof h.synced === "boolean", "synced field should be a boolean");
    assert(typeof h.lastSyncAt === "number", "lastSyncAt field should be a number");
    assert(typeof h.currentOffsetMs === "number", "currentOffsetMs field should be a number");
    assert(
      h.protocol === "ntp" || h.protocol === "ptp" || h.protocol === "system",
      "protocol field should be ntp, ptp, or system"
    );
    assert(typeof h.source === "string", "source field should be a string");
    assert(typeof h.uptimeMs === "number", "uptimeMs field should be a number");
  });
}

export function testMultipleStampsProduceMonotonicallyIncreasingBridgeTimeMs(): void {
  test("Multiple stamp() calls produce monotonically increasing bridgeTimeMs", () => {
    const config: ClockConfig = {
      protocol: "system",
      source: "local",
      syncIntervalMs: 0,
      maxDriftMs: 200,
      bridgeIsAuthority: true,
    };
    const clock = new BridgeClock(config);
    let previousMs = 0;
    for (let i = 0; i < 10; i++) {
      const ts = clock.stamp(null);
      assert(
        ts.bridgeTimeMs >= previousMs,
        `bridgeTimeMs at iteration ${i} (${ts.bridgeTimeMs}) should be >= previous (${previousMs})`
      );
      previousMs = ts.bridgeTimeMs;
    }
  });
}

// ---------------------------------------------------------------------------
// Run all AEP-NOSHIP/tests
// ---------------------------------------------------------------------------

testBridgeClockInitializesWithNTPConfig();
testBridgeClockInitializesWithPTPConfig();
testBridgeClockFallbackToSystemClock();
testStampProducesBridgeTimestampWithCorrectStructure();
testStampPreservesAgentTimestamp();
testStampMeasuresDriftCorrectly();
testIsSyncedReturnsFalseBeforeFirstSync();
testIsSyncedReturnsTrueAfterSuccessfulSync();
testHealthReturnsCompleteClockHealthObject();
testMultipleStampsProduceMonotonicallyIncreasingBridgeTimeMs();

setTimeout(() => {
  console.log(`\nClock tests complete: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}, 2000);
