// @PAD: /root/dynAEP/sdk/typescript/tests/workflow/temporal-primitives.test.ts
// ===========================================================================
// Tests for TA-3.3: Workflow Temporal Primitives
// Tests TemporalDeadline, TemporalSchedule, TemporalSleepResume,
// TemporalTimeout, and the TemporalPrimitives facade.
// ===========================================================================

import {
  TemporalDeadline,
  TemporalSchedule,
  TemporalSleepResume,
  TemporalTimeout,
  TemporalPrimitives,
  TemporalTimeoutError,
  type DeadlineHandle,
  type ScheduleHandle,
  type SerializedDeadline,
  type SerializedSchedule,
  type SerializedSuspend,
} from "../../src/workflow/TemporalPrimitives";

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
// Mock Bridge Clock
// ---------------------------------------------------------------------------

let bridgeTime = 1000;
const getNow = () => bridgeTime;

function resetClock(): void {
  bridgeTime = 1000;
}

// ===========================================================================
// TemporalDeadline Tests
// ===========================================================================

console.log("\n=== TA-3.3: Workflow Temporal Primitives Tests ===\n");
console.log("--- TemporalDeadline ---\n");

test("Deadline: setDeadline creates handle with correct fields", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  const handle = td.setDeadline("task-1", 2000, () => {});
  assert(handle.taskId === "task-1", `Expected taskId task-1, got ${handle.taskId}`);
  assert(handle.deadlineMs === 2000, `Expected deadlineMs 2000, got ${handle.deadlineMs}`);
  assert(handle.createdAt === 1000, `Expected createdAt 1000, got ${handle.createdAt}`);
});

test("Deadline: cancelDeadline removes the deadline", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  const handle = td.setDeadline("task-1", 2000, () => {});
  assert(td.activeCount() === 1, `Expected 1 active, got ${td.activeCount()}`);
  td.cancelDeadline(handle);
  assert(td.activeCount() === 0, `Expected 0 active after cancel, got ${td.activeCount()}`);
});

test("Deadline: tick fires expired callbacks", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let fired = false;
  td.setDeadline("task-1", 1500, () => { fired = true; });

  // Advance bridge time past the deadline
  bridgeTime = 1500;
  td.tick();
  assert(fired, "Callback should have fired after deadline reached");
});

test("Deadline: tick does not fire future deadlines", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let fired = false;
  td.setDeadline("task-1", 2000, () => { fired = true; });

  // Advance bridge time but not past the deadline
  bridgeTime = 1999;
  td.tick();
  assert(!fired, "Callback should not fire before deadline");
  assert(td.activeCount() === 1, "Deadline should still be active");
});

test("Deadline: multiple deadlines, only expired ones fire", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let fired1 = false;
  let fired2 = false;
  let fired3 = false;
  td.setDeadline("task-1", 1200, () => { fired1 = true; });
  td.setDeadline("task-2", 1500, () => { fired2 = true; });
  td.setDeadline("task-3", 2000, () => { fired3 = true; });

  bridgeTime = 1500;
  td.tick();
  assert(fired1, "task-1 (deadline 1200) should have fired at time 1500");
  assert(fired2, "task-2 (deadline 1500) should have fired at time 1500");
  assert(!fired3, "task-3 (deadline 2000) should not have fired at time 1500");
  assert(td.activeCount() === 1, `Expected 1 remaining, got ${td.activeCount()}`);
});

test("Deadline: replacing a deadline for same taskId", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let firedFirst = false;
  let firedSecond = false;
  td.setDeadline("task-1", 1500, () => { firedFirst = true; });
  td.setDeadline("task-1", 2000, () => { firedSecond = true; });

  assert(td.activeCount() === 1, `Expected 1 active after replacement, got ${td.activeCount()}`);

  bridgeTime = 1500;
  td.tick();
  assert(!firedFirst, "Old callback should not fire after replacement");
  assert(!firedSecond, "New callback should not fire before its deadline");

  bridgeTime = 2000;
  td.tick();
  assert(firedSecond, "New callback should fire at its deadline");
});

test("Deadline: activeCount tracks correctly", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  assert(td.activeCount() === 0, "Initially 0");
  td.setDeadline("t-1", 2000, () => {});
  assert(td.activeCount() === 1, "After 1 add");
  td.setDeadline("t-2", 3000, () => {});
  assert(td.activeCount() === 2, "After 2 adds");

  bridgeTime = 2000;
  td.tick();
  assert(td.activeCount() === 1, "After 1 expired");

  bridgeTime = 3000;
  td.tick();
  assert(td.activeCount() === 0, "After all expired");
});

test("Deadline: serializeDeadlines returns all entries", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  td.setDeadline("t-1", 2000, () => {});
  bridgeTime = 1100;
  td.setDeadline("t-2", 3000, () => {});

  const serialized = td.serializeDeadlines();
  assert(serialized.length === 2, `Expected 2 serialized, got ${serialized.length}`);

  const t1 = serialized.find(s => s.taskId === "t-1");
  const t2 = serialized.find(s => s.taskId === "t-2");
  assert(t1 !== undefined, "Should contain t-1");
  assert(t2 !== undefined, "Should contain t-2");
  assert(t1!.deadlineMs === 2000, `t-1 deadlineMs should be 2000, got ${t1!.deadlineMs}`);
  assert(t1!.createdAt === 1000, `t-1 createdAt should be 1000, got ${t1!.createdAt}`);
  assert(t2!.createdAt === 1100, `t-2 createdAt should be 1100, got ${t2!.createdAt}`);
});

test("Deadline: restoreDeadlines with default callback", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let defaultFired = false;

  const data: SerializedDeadline[] = [
    { taskId: "restored-1", deadlineMs: 1500, createdAt: 900 },
    { taskId: "restored-2", deadlineMs: 2000, createdAt: 950 },
  ];
  td.restoreDeadlines(data, () => { defaultFired = true; });

  assert(td.activeCount() === 2, `Expected 2 restored, got ${td.activeCount()}`);

  bridgeTime = 1500;
  td.tick();
  assert(defaultFired, "Default callback should fire for restored deadline");
  assert(td.activeCount() === 1, `Expected 1 remaining, got ${td.activeCount()}`);
});

test("Deadline: restoreDeadlines without default callback uses no-op", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);

  const data: SerializedDeadline[] = [
    { taskId: "restored-1", deadlineMs: 1500, createdAt: 900 },
  ];
  td.restoreDeadlines(data);

  assert(td.activeCount() === 1, `Expected 1 restored, got ${td.activeCount()}`);

  // Should not throw when callback fires (no-op)
  bridgeTime = 1500;
  td.tick();
  assert(td.activeCount() === 0, "Deadline should be removed after firing no-op");
});

test("Deadline: callback errors do not crash tick", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let secondFired = false;

  td.setDeadline("fail", 1500, () => { throw new Error("boom"); });
  td.setDeadline("ok", 1500, () => { secondFired = true; });

  bridgeTime = 1500;
  // Should not throw
  td.tick();
  assert(secondFired, "Second callback should still fire after first throws");
  assert(td.activeCount() === 0, "Both should be removed");
});

test("Deadline: fires exactly once (removed after firing)", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let fireCount = 0;
  td.setDeadline("once", 1500, () => { fireCount++; });

  bridgeTime = 1500;
  td.tick();
  assert(fireCount === 1, `Expected 1 fire, got ${fireCount}`);

  // Tick again at a later time - should not fire again
  bridgeTime = 2000;
  td.tick();
  assert(fireCount === 1, `Expected still 1 fire after second tick, got ${fireCount}`);
});

test("Deadline: deadline at exact current time fires immediately", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  let fired = false;
  td.setDeadline("exact", 1000, () => { fired = true; });

  td.tick();
  assert(fired, "Deadline at exact current time should fire on tick");
});

test("Deadline: cancelDeadline with non-existent handle is no-op", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  const fakeHandle: DeadlineHandle = { taskId: "nonexistent", deadlineMs: 5000, createdAt: 500 };
  // Should not throw
  td.cancelDeadline(fakeHandle);
  assert(td.activeCount() === 0, "Should remain at 0");
});

test("Deadline: cancel after fire is no-op", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  const handle = td.setDeadline("t", 1500, () => {});

  bridgeTime = 1500;
  td.tick();
  assert(td.activeCount() === 0, "Should be 0 after fire");

  // Cancel after already fired - should not throw
  td.cancelDeadline(handle);
  assert(td.activeCount() === 0, "Should still be 0");
});

test("Deadline: serializeDeadlines on empty returns empty array", () => {
  resetClock();
  const td = new TemporalDeadline(getNow);
  const serialized = td.serializeDeadlines();
  assert(serialized.length === 0, `Expected empty array, got length ${serialized.length}`);
});

// ===========================================================================
// TemporalSchedule Tests
// ===========================================================================

console.log("\n--- TemporalSchedule ---\n");

test("Schedule: creates handle with correct interval and nextRunMs", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  const handle = ts.schedule("sched-1", 500, () => {});
  assert(handle.scheduleId === "sched-1", `Expected scheduleId sched-1, got ${handle.scheduleId}`);
  assert(handle.intervalMs === 500, `Expected intervalMs 500, got ${handle.intervalMs}`);
  assert(handle.nextRunMs === 1500, `Expected nextRunMs 1500, got ${handle.nextRunMs}`);
});

test("Schedule: cancelSchedule removes the schedule", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  const handle = ts.schedule("sched-1", 500, () => {});
  assert(ts.activeCount() === 1, `Expected 1 active, got ${ts.activeCount()}`);
  ts.cancelSchedule(handle);
  assert(ts.activeCount() === 0, `Expected 0 active after cancel, got ${ts.activeCount()}`);
});

test("Schedule: tick fires when nextRunMs reached", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let fireCount = 0;
  ts.schedule("sched-1", 500, () => { fireCount++; });

  bridgeTime = 1500;
  ts.tick();
  assert(fireCount === 1, `Expected 1 fire, got ${fireCount}`);
});

test("Schedule: tick advances nextRunMs by intervalMs", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let fireCount = 0;
  ts.schedule("sched-1", 500, () => { fireCount++; });

  // First fire at 1500
  bridgeTime = 1500;
  ts.tick();
  assert(fireCount === 1, "First fire");

  // Should not fire at 1999
  bridgeTime = 1999;
  ts.tick();
  assert(fireCount === 1, "Should not fire before next interval");

  // Second fire at 2000
  bridgeTime = 2000;
  ts.tick();
  assert(fireCount === 2, `Expected 2 fires, got ${fireCount}`);
});

test("Schedule: tick does not fire future schedules", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let fired = false;
  ts.schedule("sched-1", 500, () => { fired = true; });

  bridgeTime = 1499;
  ts.tick();
  assert(!fired, "Should not fire before nextRunMs");
});

test("Schedule: multiple schedules fire independently", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let fires: string[] = [];
  ts.schedule("fast", 200, () => { fires.push("fast"); });
  ts.schedule("slow", 500, () => { fires.push("slow"); });

  // At 1200: fast fires (nextRun 1200), slow does not (nextRun 1500)
  bridgeTime = 1200;
  ts.tick();
  assert(fires.length === 1, `Expected 1 fire at 1200, got ${fires.length}`);
  assert(fires[0] === "fast", "Fast schedule should fire first");

  // At 1500: both would fire (fast nextRun now 1400, slow nextRun 1500)
  fires = [];
  bridgeTime = 1500;
  ts.tick();
  assert(fires.length === 2, `Expected 2 fires at 1500, got ${fires.length}`);
  assert(fires.includes("fast"), "Fast should fire");
  assert(fires.includes("slow"), "Slow should fire");
});

test("Schedule: replacing a schedule for same scheduleId", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let firedOld = false;
  let firedNew = false;
  ts.schedule("sched-1", 500, () => { firedOld = true; });
  ts.schedule("sched-1", 1000, () => { firedNew = true; });

  assert(ts.activeCount() === 1, `Expected 1 after replacement, got ${ts.activeCount()}`);

  // Old would fire at 1500, new at 2000
  bridgeTime = 1500;
  ts.tick();
  assert(!firedOld, "Old callback should not fire after replacement");
  assert(!firedNew, "New callback should not fire before its nextRunMs");

  bridgeTime = 2000;
  ts.tick();
  assert(firedNew, "New callback should fire at its nextRunMs");
});

test("Schedule: activeCount tracks correctly", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  assert(ts.activeCount() === 0, "Initially 0");
  const h1 = ts.schedule("s-1", 500, () => {});
  assert(ts.activeCount() === 1, "After 1 add");
  ts.schedule("s-2", 1000, () => {});
  assert(ts.activeCount() === 2, "After 2 adds");
  ts.cancelSchedule(h1);
  assert(ts.activeCount() === 1, "After 1 cancel");
});

test("Schedule: serializeSchedules returns all entries", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  ts.schedule("s-1", 500, () => {});
  ts.schedule("s-2", 1000, () => {});

  const serialized = ts.serializeSchedules();
  assert(serialized.length === 2, `Expected 2 serialized, got ${serialized.length}`);

  const s1 = serialized.find(s => s.scheduleId === "s-1");
  assert(s1 !== undefined, "Should contain s-1");
  assert(s1!.intervalMs === 500, `s-1 intervalMs should be 500, got ${s1!.intervalMs}`);
  assert(s1!.nextRunMs === 1500, `s-1 nextRunMs should be 1500, got ${s1!.nextRunMs}`);
  assert(s1!.lastRunMs === 0, `s-1 lastRunMs should be 0 initially, got ${s1!.lastRunMs}`);
});

test("Schedule: restoreSchedules with default callback", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let defaultFired = false;

  const data: SerializedSchedule[] = [
    { scheduleId: "restored-1", intervalMs: 200, nextRunMs: 1100, lastRunMs: 900 },
  ];
  ts.restoreSchedules(data, () => { defaultFired = true; });

  assert(ts.activeCount() === 1, `Expected 1 restored, got ${ts.activeCount()}`);

  bridgeTime = 1100;
  ts.tick();
  assert(defaultFired, "Default callback should fire for restored schedule");
});

test("Schedule: restoreSchedules without default callback uses no-op", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);

  const data: SerializedSchedule[] = [
    { scheduleId: "restored-1", intervalMs: 200, nextRunMs: 1100, lastRunMs: 900 },
  ];
  ts.restoreSchedules(data);

  assert(ts.activeCount() === 1, `Expected 1 restored, got ${ts.activeCount()}`);

  bridgeTime = 1100;
  // Should not throw
  ts.tick();
  assert(ts.activeCount() === 1, "Schedule should remain active (recurring)");
});

test("Schedule: callback errors do not crash tick", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let secondFired = false;

  ts.schedule("fail", 500, () => { throw new Error("boom"); });
  ts.schedule("ok", 500, () => { secondFired = true; });

  bridgeTime = 1500;
  // Should not throw
  ts.tick();
  assert(secondFired, "Second callback should still fire after first throws");
});

test("Schedule: schedule remains active after firing (recurring)", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  let fireCount = 0;
  ts.schedule("recurring", 500, () => { fireCount++; });

  bridgeTime = 1500;
  ts.tick();
  assert(fireCount === 1, "First fire");
  assert(ts.activeCount() === 1, "Schedule should still be active after firing");

  bridgeTime = 2000;
  ts.tick();
  assert(fireCount === 2, "Second fire");
  assert(ts.activeCount() === 1, "Schedule should still be active after second fire");
});

test("Schedule: cancelSchedule with non-existent handle is no-op", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  const fakeHandle: ScheduleHandle = { scheduleId: "nope", intervalMs: 500, nextRunMs: 2000 };
  ts.cancelSchedule(fakeHandle);
  assert(ts.activeCount() === 0, "Should remain 0");
});

test("Schedule: serializeSchedules on empty returns empty array", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  const serialized = ts.serializeSchedules();
  assert(serialized.length === 0, `Expected empty, got length ${serialized.length}`);
});

test("Schedule: lastRunMs updates after tick fires", () => {
  resetClock();
  const ts = new TemporalSchedule(getNow);
  ts.schedule("s-1", 500, () => {});

  bridgeTime = 1500;
  ts.tick();

  const serialized = ts.serializeSchedules();
  const s1 = serialized.find(s => s.scheduleId === "s-1");
  assert(s1 !== undefined, "Should find s-1");
  assert(s1!.lastRunMs === 1500, `lastRunMs should be 1500 after fire, got ${s1!.lastRunMs}`);
});

// ===========================================================================
// TemporalSleepResume Tests
// ===========================================================================

console.log("\n--- TemporalSleepResume ---\n");

test("SleepResume: sleep returns promise that resolves via tick", async () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  let resolved = false;

  const promise = sr.sleep("task-1", 500).then(() => { resolved = true; });

  // Not resolved yet
  assert(!resolved, "Should not be resolved before tick");

  // Advance time and tick
  bridgeTime = 1500;
  sr.tick();

  // Wait for microtask to settle
  await promise;
  assert(resolved, "Should be resolved after tick past wakeAt");
});

test("SleepResume: suspend records current bridge time", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  const task = sr.suspend("task-1");
  assert(task.taskId === "task-1", `Expected taskId task-1, got ${task.taskId}`);
  assert(task.suspendedAt === 1000, `Expected suspendedAt 1000, got ${task.suspendedAt}`);
});

test("SleepResume: resume computes elapsed bridge time", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  sr.suspend("task-1");

  bridgeTime = 1800;
  const result = sr.resume("task-1");
  assert(result.suspendedForMs === 800, `Expected 800ms elapsed, got ${result.suspendedForMs}`);
});

test("SleepResume: resume throws for unknown taskId", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  let threw = false;
  try {
    sr.resume("nonexistent");
  } catch (e: any) {
    threw = true;
    assert(e.message.includes("nonexistent"), `Error should mention task ID, got: ${e.message}`);
  }
  assert(threw, "Should throw for unknown taskId");
});

test("SleepResume: suspendedCount tracks correctly", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  assert(sr.suspendedCount() === 0, "Initially 0");
  sr.suspend("t-1");
  assert(sr.suspendedCount() === 1, "After 1 suspend");
  sr.suspend("t-2");
  assert(sr.suspendedCount() === 2, "After 2 suspends");
  sr.resume("t-1");
  assert(sr.suspendedCount() === 1, "After 1 resume");
});

test("SleepResume: sleeperCount tracks correctly", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  assert(sr.sleeperCount() === 0, "Initially 0");
  sr.sleep("t-1", 500);
  assert(sr.sleeperCount() === 1, "After 1 sleep");
  sr.sleep("t-2", 1000);
  assert(sr.sleeperCount() === 2, "After 2 sleeps");

  bridgeTime = 1500;
  sr.tick();
  assert(sr.sleeperCount() === 1, "After 1 woke up (t-1 at 1500)");
});

test("SleepResume: multiple concurrent sleepers", async () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  let resolved1 = false;
  let resolved2 = false;
  let resolved3 = false;

  const p1 = sr.sleep("t-1", 200).then(() => { resolved1 = true; });
  const p2 = sr.sleep("t-2", 500).then(() => { resolved2 = true; });
  const p3 = sr.sleep("t-3", 1000).then(() => { resolved3 = true; });

  assert(sr.sleeperCount() === 3, "3 sleepers");

  bridgeTime = 1200;
  sr.tick();
  await p1;
  assert(resolved1, "t-1 should wake at 1200");
  assert(!resolved2, "t-2 should not wake at 1200");
  assert(!resolved3, "t-3 should not wake at 1200");

  bridgeTime = 1500;
  sr.tick();
  await p2;
  assert(resolved2, "t-2 should wake at 1500");
  assert(!resolved3, "t-3 should not wake at 1500");

  bridgeTime = 2000;
  sr.tick();
  await p3;
  assert(resolved3, "t-3 should wake at 2000");
  assert(sr.sleeperCount() === 0, "All sleepers done");
});

test("SleepResume: replacing sleep for same taskId", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  sr.sleep("task-1", 500);
  sr.sleep("task-1", 1000);

  assert(sr.sleeperCount() === 1, `Expected 1 sleeper after replacement, got ${sr.sleeperCount()}`);
});

test("SleepResume: serializeSuspended returns all entries", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  sr.suspend("t-1");
  bridgeTime = 1200;
  sr.suspend("t-2");

  const serialized = sr.serializeSuspended();
  assert(serialized.length === 2, `Expected 2, got ${serialized.length}`);

  const t1 = serialized.find(s => s.taskId === "t-1");
  const t2 = serialized.find(s => s.taskId === "t-2");
  assert(t1 !== undefined, "Should contain t-1");
  assert(t2 !== undefined, "Should contain t-2");
  assert(t1!.suspendedAt === 1000, `t-1 suspendedAt should be 1000, got ${t1!.suspendedAt}`);
  assert(t2!.suspendedAt === 1200, `t-2 suspendedAt should be 1200, got ${t2!.suspendedAt}`);
});

test("SleepResume: restoreSuspended restores suspended tasks", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  const data: SerializedSuspend[] = [
    { taskId: "restored-1", suspendedAt: 800 },
    { taskId: "restored-2", suspendedAt: 900 },
  ];
  sr.restoreSuspended(data);
  assert(sr.suspendedCount() === 2, `Expected 2 restored, got ${sr.suspendedCount()}`);
});

test("SleepResume: resume after restore works correctly", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  const data: SerializedSuspend[] = [
    { taskId: "restored-1", suspendedAt: 800 },
  ];
  sr.restoreSuspended(data);

  bridgeTime = 1500;
  const result = sr.resume("restored-1");
  assert(result.suspendedForMs === 700, `Expected 700ms, got ${result.suspendedForMs}`);
  assert(sr.suspendedCount() === 0, "Should be 0 after resume");
});

test("SleepResume: suspend updates time if already suspended", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  sr.suspend("task-1");
  assert(sr.suspendedCount() === 1, "1 suspended");

  bridgeTime = 1500;
  const updated = sr.suspend("task-1");
  assert(sr.suspendedCount() === 1, "Still 1 suspended (updated, not added)");
  assert(updated.suspendedAt === 1500, `suspendedAt should be updated to 1500, got ${updated.suspendedAt}`);
});

test("SleepResume: serializeSuspended on empty returns empty array", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  const serialized = sr.serializeSuspended();
  assert(serialized.length === 0, `Expected empty, got length ${serialized.length}`);
});

test("SleepResume: sleep with zero duration resolves on next tick", async () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  let resolved = false;
  const p = sr.sleep("instant", 0).then(() => { resolved = true; });

  sr.tick();
  await p;
  assert(resolved, "Zero-duration sleep should resolve on tick at current time");
});

test("SleepResume: resume removes from suspended set", () => {
  resetClock();
  const sr = new TemporalSleepResume(getNow);
  sr.suspend("task-1");
  sr.resume("task-1");

  // Trying to resume again should throw
  let threw = false;
  try {
    sr.resume("task-1");
  } catch {
    threw = true;
  }
  assert(threw, "Second resume should throw (already removed)");
});

// ===========================================================================
// TemporalTimeout Tests
// ===========================================================================

console.log("\n--- TemporalTimeout ---\n");

test("Timeout: withTimeout resolves when operation completes in time", async () => {
  resetClock();
  const tt = new TemporalTimeout(getNow);
  const result = await tt.withTimeout(
    () => Promise.resolve(42),
    5000,
    10,
  );
  assert(result === 42, `Expected 42, got ${result}`);
});

test("Timeout: withTimeout rejects with TemporalTimeoutError when time expires", async () => {
  resetClock();
  // Use a clock that advances automatically on each read to simulate time passing
  let timeoutClock = 1000;
  const tt = new TemporalTimeout(() => {
    timeoutClock += 200; // Each read advances 200ms
    return timeoutClock;
  });

  let caught = false;
  try {
    await tt.withTimeout(
      () => new Promise(() => { /* never resolves */ }),
      500,
      10,
    );
  } catch (e: any) {
    caught = true;
    assert(e instanceof TemporalTimeoutError, "Should throw TemporalTimeoutError");
    assert(e.name === "TemporalTimeoutError", `Expected name TemporalTimeoutError, got ${e.name}`);
  }
  assert(caught, "Should have caught timeout error");
});

test("Timeout: TemporalTimeoutError has correct elapsedMs", async () => {
  let timeoutClock = 0;
  const tt = new TemporalTimeout(() => {
    timeoutClock += 300;
    return timeoutClock;
  });

  try {
    await tt.withTimeout(
      () => new Promise(() => {}),
      500,
      10,
    );
    assert(false, "Should have thrown");
  } catch (e: any) {
    assert(e instanceof TemporalTimeoutError, "Should be TemporalTimeoutError");
    assert(e.elapsedMs >= 500, `elapsedMs should be >= 500, got ${e.elapsedMs}`);
  }
});

test("Timeout: operation error passes through", async () => {
  resetClock();
  const tt = new TemporalTimeout(getNow);
  let caught = false;
  try {
    await tt.withTimeout(
      () => Promise.reject(new Error("op-failed")),
      5000,
      10,
    );
  } catch (e: any) {
    caught = true;
    assert(!(e instanceof TemporalTimeoutError), "Should not be TemporalTimeoutError");
    assert(e.message === "op-failed", `Expected op-failed, got ${e.message}`);
  }
  assert(caught, "Operation error should pass through");
});

test("Timeout: timeout uses bridge time not wall clock", async () => {
  // Bridge clock is frozen - timeout should never fire even after real time passes
  const frozenTime = 5000;
  const tt = new TemporalTimeout(() => frozenTime);

  const result = await tt.withTimeout(
    () => Promise.resolve("done"),
    100,
    10,
  );
  assert(result === "done", "Should resolve since bridge time is frozen");
});

test("Timeout: TemporalTimeoutError message includes elapsed time", () => {
  const err = new TemporalTimeoutError(1234);
  assert(err.message.includes("1234"), `Message should include elapsed time, got: ${err.message}`);
  assert(err.message.includes("bridge time"), `Message should mention bridge time, got: ${err.message}`);
});

test("Timeout: withTimeout resolves with correct value type", async () => {
  resetClock();
  const tt = new TemporalTimeout(getNow);
  const str = await tt.withTimeout(() => Promise.resolve("hello"), 5000, 10);
  assert(str === "hello", `Expected "hello", got ${str}`);

  const obj = await tt.withTimeout(() => Promise.resolve({ x: 1 }), 5000, 10);
  assert(obj.x === 1, `Expected x=1, got ${obj.x}`);
});

test("Timeout: concurrent timeouts are independent", async () => {
  resetClock();
  const tt = new TemporalTimeout(getNow);

  const p1 = tt.withTimeout(() => Promise.resolve("a"), 5000, 10);
  const p2 = tt.withTimeout(() => Promise.resolve("b"), 5000, 10);

  const [r1, r2] = await Promise.all([p1, p2]);
  assert(r1 === "a", `Expected "a", got ${r1}`);
  assert(r2 === "b", `Expected "b", got ${r2}`);
});

// ===========================================================================
// TemporalPrimitives Facade Tests
// ===========================================================================

console.log("\n--- TemporalPrimitives Facade ---\n");

test("Facade: constructor creates all sub-primitives", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);
  assert(tp.deadline instanceof TemporalDeadline, "Should have deadline");
  assert(tp.scheduler instanceof TemporalSchedule, "Should have scheduler");
  assert(tp.sleepResume instanceof TemporalSleepResume, "Should have sleepResume");
  assert(tp.timeout instanceof TemporalTimeout, "Should have timeout");
});

test("Facade: isRunning returns correct state", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);
  assert(!tp.isRunning(), "Should not be running initially");
  tp.start();
  assert(tp.isRunning(), "Should be running after start");
  tp.stop();
  assert(!tp.isRunning(), "Should not be running after stop");
});

test("Facade: start is idempotent", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);
  tp.start();
  tp.start(); // second start should be no-op
  assert(tp.isRunning(), "Should still be running");
  tp.stop();
});

test("Facade: stop when not running is no-op", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);
  // Should not throw
  tp.stop();
  assert(!tp.isRunning(), "Should not be running");
});

test("Facade: tick manually advances all sub-primitives", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);

  let deadlineFired = false;
  let scheduleFired = false;

  tp.deadline.setDeadline("d-1", 1500, () => { deadlineFired = true; });
  tp.scheduler.schedule("s-1", 500, () => { scheduleFired = true; });

  bridgeTime = 1500;
  tp.tick();

  assert(deadlineFired, "Deadline should fire on manual tick");
  assert(scheduleFired, "Schedule should fire on manual tick");
});

test("Facade: tick wakes sleepers", async () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);
  let resolved = false;

  const p = tp.sleepResume.sleep("t-1", 500).then(() => { resolved = true; });

  bridgeTime = 1500;
  tp.tick();
  await p;
  assert(resolved, "Sleeper should wake on facade tick");
});

test("Facade: accepts custom pollIntervalMs config", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow, { pollIntervalMs: 100 });
  // Just verify it constructs without error
  assert(!tp.isRunning(), "Should not be running by default");
  assert(tp.deadline instanceof TemporalDeadline, "Should have deadline");
});

test("Facade: stop clears polling handle", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);
  tp.start();
  tp.stop();
  assert(!tp.isRunning(), "Should be stopped");

  // Start again should work
  tp.start();
  assert(tp.isRunning(), "Should be running again after restart");
  tp.stop();
});

test("Facade: deadline and scheduler are independent", () => {
  resetClock();
  const tp = new TemporalPrimitives(getNow);

  let deadlineFired = false;
  tp.deadline.setDeadline("d-1", 1200, () => { deadlineFired = true; });
  tp.scheduler.schedule("s-1", 500, () => {});

  // Cancel the schedule, deadline should still fire
  tp.scheduler.cancelSchedule({ scheduleId: "s-1", intervalMs: 500, nextRunMs: 1500 });

  bridgeTime = 1200;
  tp.tick();
  assert(deadlineFired, "Deadline should fire independently of cancelled schedule");
  assert(tp.scheduler.activeCount() === 0, "Schedule should be cancelled");
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
