import { describe, it, expect, beforeEach } from "vitest";
import { Session } from "../../src/session/session.js";
import type { Policy } from "../../src/policy/types.js";

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    version: "2.1",
    name: "test-policy",
    capabilities: [],
    limits: {},
    gates: [],
    evidence: { enabled: true, dir: "./test-ledgers" },
    forbidden: [],
    session: {
      max_actions: 100,
      rate_limit: { max_per_minute: 30 },
      escalation: [],
    },
    ...overrides,
  };
}

describe("Session", () => {
  let session: Session;

  beforeEach(() => {
    session = new Session(makePolicy());
  });

  it("creates with correct initial state", () => {
    expect(session.id).toBeTruthy();
    expect(session.state).toBe("created");
    expect(session.createdAt).toBeInstanceOf(Date);
    expect(session.stats.actionsEvaluated).toBe(0);
    expect(session.stats.actionsAllowed).toBe(0);
    expect(session.stats.actionsDenied).toBe(0);
    expect(session.stats.actionsGated).toBe(0);
    expect(session.stats.lastActionAt).toBeNull();
  });

  it("transitions created -> active", () => {
    session.activate();
    expect(session.state).toBe("active");
  });

  it("transitions active -> paused", () => {
    session.activate();
    session.pause();
    expect(session.state).toBe("paused");
  });

  it("transitions paused -> active", () => {
    session.activate();
    session.pause();
    session.activate();
    expect(session.state).toBe("active");
  });

  it("transitions active -> terminated", () => {
    session.activate();
    const report = session.terminate("test complete");
    expect(session.state).toBe("terminated");
    expect(report.sessionId).toBe(session.id);
    expect(report.terminationReason).toBe("test complete");
  });

  it("rejects invalid state transitions", () => {
    expect(() => session.pause()).toThrow("Cannot pause");
    session.activate();
    session.terminate("done");
    expect(() => session.activate()).toThrow("Cannot activate");
  });

  it("tracks action statistics", () => {
    session.activate();
    session.recordAction("allow");
    session.recordAction("allow");
    session.recordAction("deny");
    session.recordAction("gate");

    expect(session.stats.actionsEvaluated).toBe(4);
    expect(session.stats.actionsAllowed).toBe(2);
    expect(session.stats.actionsDenied).toBe(1);
    expect(session.stats.actionsGated).toBe(1);
    expect(session.stats.lastActionAt).toBeInstanceOf(Date);
    expect(session.stats.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("counts actions in last minute for rate limiting", () => {
    session.activate();
    session.recordAction("allow");
    session.recordAction("allow");
    expect(session.getActionsInLastMinute()).toBe(2);
  });

  it("generates correct session report on termination", () => {
    session.activate();
    session.recordAction("allow");
    session.recordAction("deny");
    session.recordAction("gate");

    const report = session.terminate("testing report");
    expect(report.totalActions).toBe(3);
    expect(report.allowed).toBe(1);
    expect(report.denied).toBe(1);
    expect(report.gated).toBe(1);
    expect(report.duration).toBeGreaterThanOrEqual(0);
  });

  it("stores metadata", () => {
    const s = new Session(makePolicy(), { agent: "claude", env: "test" });
    expect(s.metadata.agent).toBe("claude");
    expect(s.metadata.env).toBe("test");
  });
});
