import { describe, it, expect } from "vitest";
import { KillSwitch } from "../lib/kill-switch.js";
import { SessionManager } from "../lib/session-manager.js";
import { RollbackManager } from "../../evidence-ledger/lib/rollback/manager.js";
import type { RollbackResult } from "../../evidence-ledger/lib/rollback/types.js";
import { validatePolicy } from "../../policy-engine/lib/policy/loader.js";

function managerWith(n: number): { m: SessionManager; ids: string[] } {
  const m = new SessionManager();
  const p = validatePolicy({
    version: "1",
    name: "kill-test",
    capabilities: [],
    limits: {},
    session: { max_actions: 10 },
  });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const s = m.createSessionFromPolicy(p);
    s.activate();
    ids.push(s.id);
  }
  return { m, ids };
}

class RecordingRollback extends RollbackManager {
  readonly rolledBack: string[] = [];
  constructor(private readonly fail = false) {
    super();
  }
  override rollbackSession(sessionId: string): RollbackResult[] {
    this.rolledBack.push(sessionId);
    if (this.fail) throw new Error("rollback store offline");
    return [];
  }
}

class FakeTrust {
  penalties = 0;
  constructor(private score: number, private readonly step: number) {}
  getScore = (): number => this.score;
  penalize = (_reason: string, _amount?: number): void => {
    this.penalties++;
    this.score = Math.max(0, this.score - this.step);
  };
}

describe("KillSwitch.killAll", () => {
  it("terminates every active session with a KILL reason", () => {
    const { m, ids } = managerWith(3);
    const result = new KillSwitch(m).killAll("runaway");
    expect(result.sessionsTerminated).toBe(3);
    expect(result.reports.map((r) => r.sessionId).sort()).toEqual([...ids].sort());
    expect(result.reports.every((r) => r.terminationReason === "KILL: runaway")).toBe(true);
    expect(result.rollbacksAttempted).toBe(false);
    expect(result.trustReset).toBe(false);
    expect(m.getActiveCount()).toBe(0);
  });

  it("skips sessions that are already terminated", () => {
    const { m, ids } = managerWith(2);
    m.terminateSession(ids[0] ?? "", "earlier");
    const result = new KillSwitch(m).killAll("sweep");
    expect(result.sessionsTerminated).toBe(1);
    expect(result.reports[0]?.sessionId).toBe(ids[1]);
  });

  it("rolls back each session only when asked", () => {
    const { m, ids } = managerWith(2);
    const rb = new RecordingRollback();
    const ks = new KillSwitch(m, rb);
    const result = ks.killAll("incident", { rollback: true });
    expect(rb.rolledBack.sort()).toEqual([...ids].sort());
    expect(result.rollbacksAttempted).toBe(true);

    const other = managerWith(1);
    const rb2 = new RecordingRollback();
    new KillSwitch(other.m, rb2).killAll("quiet");
    expect(rb2.rolledBack).toEqual([]);
  });

  it("still terminates when rollback throws", () => {
    const { m } = managerWith(2);
    const result = new KillSwitch(m, new RecordingRollback(true)).killAll("x", { rollback: true });
    expect(result.reports).toHaveLength(2);
    expect(m.getActiveCount()).toBe(0);
  });

  it("drives trust to zero for sessions with a trust manager", () => {
    const { m, ids } = managerWith(2);
    const trust = new FakeTrust(100, 30);
    const managers = new Map([[ids[0] ?? "", trust]]);
    const result = new KillSwitch(m, undefined, managers).killAll("trust");
    expect(trust.getScore()).toBe(0);
    expect(trust.penalties).toBe(4);
    expect(result.trustReset).toBe(true);
  });
});

describe("KillSwitch.killSession", () => {
  it("terminates one session and leaves the others running", () => {
    const { m, ids } = managerWith(2);
    const result = new KillSwitch(m).killSession(ids[1] ?? "", "one bad agent");
    expect(result.sessionsTerminated).toBe(1);
    expect(result.reports[0]?.terminationReason).toBe("KILL: one bad agent");
    expect(m.getSession(ids[0] ?? "")?.state).toBe("active");
    expect(m.getSession(ids[1] ?? "")?.state).toBe("terminated");
  });

  it("reports nothing for an unknown session", () => {
    const { m } = managerWith(1);
    const result = new KillSwitch(m).killSession("ghost", "x");
    expect(result).toEqual({ sessionsTerminated: 0, reports: [], rollbacksAttempted: false, trustReset: false });
  });

  it("rolls back and resets trust for the target session", () => {
    const { m, ids } = managerWith(1);
    const id = ids[0] ?? "";
    const rb = new RecordingRollback();
    const trust = new FakeTrust(10, 10);
    const result = new KillSwitch(m, rb, new Map([[id, trust]])).killSession(id, "y", { rollback: true });
    expect(rb.rolledBack).toEqual([id]);
    expect(result.rollbacksAttempted).toBe(true);
    expect(result.trustReset).toBe(true);
  });

  it("gives up after a bounded number of penalties when trust will not drop", () => {
    const { m, ids } = managerWith(1);
    const id = ids[0] ?? "";
    const stuck = new FakeTrust(50, 0);
    const result = new KillSwitch(m, undefined, new Map([[id, stuck]])).killSession(id, "z");
    expect(stuck.penalties).toBe(64);
    expect(result.trustReset).toBe(false);
    expect(result.sessionsTerminated).toBe(1);
  });
});
