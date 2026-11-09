import { afterEach, describe, it, expect, vi } from "vitest";
import { Session } from "../lib/session.js";
import { validatePolicy } from "../../policy-engine/lib/policy/loader.js";
import type { Policy } from "../../policy-engine/lib/policy/types.js";

function policy(): Policy {
  return validatePolicy({
    version: "1",
    name: "session-test",
    capabilities: [{ tool: "*" }],
    limits: {},
    session: { max_actions: 10 },
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Session lifecycle", () => {
  it("starts created with empty stats and the given metadata", () => {
    const p = policy();
    const s = new Session(p, { owner: "ci" });
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(s.state).toBe("created");
    expect(s.policy).toBe(p);
    expect(s.metadata).toEqual({ owner: "ci" });
    expect(s.stats).toEqual({
      actionsEvaluated: 0,
      actionsAllowed: 0,
      actionsDenied: 0,
      actionsGated: 0,
      elapsedMs: 0,
      lastActionAt: null,
    });
    expect(new Session(p).metadata).toEqual({});
    expect(new Session(p).id).not.toBe(s.id);
  });

  it("moves created to active to paused and back to active", () => {
    const s = new Session(policy());
    s.activate();
    expect(s.state).toBe("active");
    s.pause();
    expect(s.state).toBe("paused");
    s.activate();
    expect(s.state).toBe("active");
  });

  it("rejects invalid transitions", () => {
    const s = new Session(policy());
    expect(() => s.pause()).toThrow('Cannot pause session in state "created". Must be "active".');
    s.activate();
    expect(() => s.activate()).toThrow('Cannot activate session in state "active". Must be "created" or "paused".');
    s.terminate("stop");
    expect(() => s.activate()).toThrow(/state "terminated"/);
    expect(() => s.pause()).toThrow(/state "terminated"/);
  });

  it("terminates with a report of the counts and remains terminated on repeat calls", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    const s = new Session(policy());
    s.activate();
    s.recordAction("allow");
    s.recordAction("deny");
    s.recordAction("gate");
    s.recordAction("allow");
    vi.setSystemTime(new Date("2026-03-01T10:00:05Z"));
    const report = s.terminate("operator stop");
    expect(report).toEqual({
      sessionId: s.id,
      duration: 5000,
      totalActions: 4,
      allowed: 2,
      denied: 1,
      gated: 1,
      terminationReason: "operator stop",
    });
    expect(s.state).toBe("terminated");
    vi.setSystemTime(new Date("2026-03-01T10:00:09Z"));
    const again = s.terminate("second");
    expect(again.terminationReason).toBe("second");
    expect(again.duration).toBe(9000);
    expect(again.totalActions).toBe(4);
    expect(s.state).toBe("terminated");
  });
});

describe("Session action accounting", () => {
  it("records decisions, timestamps and elapsed time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    const s = new Session(policy());
    vi.setSystemTime(new Date("2026-03-01T10:00:02Z"));
    s.recordAction("deny");
    expect(s.stats.actionsEvaluated).toBe(1);
    expect(s.stats.actionsDenied).toBe(1);
    expect(s.stats.elapsedMs).toBe(2000);
    expect(s.stats.lastActionAt?.toISOString()).toBe("2026-03-01T10:00:02.000Z");
  });

  it("counts only actions within the last minute", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T10:00:00Z"));
    const s = new Session(policy());
    s.recordAction("allow");
    s.recordAction("allow");
    vi.setSystemTime(new Date("2026-03-01T10:00:30Z"));
    s.recordAction("allow");
    expect(s.getActionsInLastMinute()).toBe(3);
    vi.setSystemTime(new Date("2026-03-01T10:01:10Z"));
    expect(s.getActionsInLastMinute()).toBe(1);
    vi.setSystemTime(new Date("2026-03-01T10:02:00Z"));
    expect(s.getActionsInLastMinute()).toBe(0);
    expect(s.stats.actionsEvaluated).toBe(3);
  });
});
