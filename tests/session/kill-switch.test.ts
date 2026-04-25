import { KillSwitch } from "../../src/session/kill-switch.js";
import { SessionManager } from "../../src/session/session-manager.js";
import { TrustManager } from "../../src/trust/manager.js";
import { RollbackManager } from "../../src/rollback/manager.js";
import type { Policy } from "../../src/policy/types.js";

function makePolicy(): Policy {
  return {
    version: "2.2",
    name: "test",
    capabilities: [{ tool: "file:read", scope: {} }],
    limits: {},
    gates: [],
    forbidden: [],
    session: { max_actions: 100, escalation: [] },
    evidence: { enabled: true, dir: "/tmp" },
  } as Policy;
}

describe("KillSwitch", () => {
  let sessionManager: SessionManager;
  let rollbackManager: RollbackManager;
  let trustManagers: Map<string, TrustManager>;

  beforeEach(() => {
    sessionManager = new SessionManager();
    rollbackManager = new RollbackManager();
    trustManagers = new Map();
  });

  it("killAll terminates all active sessions", () => {
    const s1 = sessionManager.createSessionFromPolicy(makePolicy());
    const s2 = sessionManager.createSessionFromPolicy(makePolicy());

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killAll("emergency");

    expect(result.sessionsTerminated).toBe(2);
    expect(result.reports).toHaveLength(2);
    expect(result.trustReset).toBe(true);
  });

  it("killSession terminates specific session", () => {
    const s1 = sessionManager.createSessionFromPolicy(makePolicy());
    const s2 = sessionManager.createSessionFromPolicy(makePolicy());

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killSession(s1.id, "targeted kill");

    expect(result.sessionsTerminated).toBe(1);
    expect(result.reports[0].duration).toBeDefined();
    expect(result.reports[0].sessionId).toBe(s1.id);
  });

  it("killAll with rollback flag attempts rollback", () => {
    sessionManager.createSessionFromPolicy(makePolicy());

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killAll("emergency", { rollback: true });

    expect(result.rollbacksAttempted).toBe(true);
  });

  it("killAll without rollback flag does not attempt rollback", () => {
    sessionManager.createSessionFromPolicy(makePolicy());

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killAll("emergency");

    expect(result.rollbacksAttempted).toBe(false);
  });

  it("killAll resets trust to zero", () => {
    const s1 = sessionManager.createSessionFromPolicy(makePolicy());
    const tm = new TrustManager({ initial_score: 800 });
    trustManagers.set(s1.id, tm);

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    ks.killAll("emergency");

    expect(tm.getScore()).toBe(0);
  });

  it("killSession resets trust for that session", () => {
    const s1 = sessionManager.createSessionFromPolicy(makePolicy());
    const tm = new TrustManager({ initial_score: 600 });
    trustManagers.set(s1.id, tm);

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    ks.killSession(s1.id, "targeted");

    expect(tm.getScore()).toBe(0);
  });

  it("killAll with no active sessions returns empty result", () => {
    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killAll("nothing to kill");

    expect(result.sessionsTerminated).toBe(0);
    expect(result.reports).toHaveLength(0);
  });

  it("killAll report contains termination reason", () => {
    sessionManager.createSessionFromPolicy(makePolicy());

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killAll("critical failure");

    expect(result.reports[0].terminationReason).toContain("KILL");
    expect(result.reports[0].terminationReason).toContain("critical failure");
  });

  it("killSession on nonexistent session returns zero terminated", () => {
    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killSession("nonexistent-id", "gone");

    // Session not found throws, caught internally, no reports
    expect(result.sessionsTerminated).toBe(0);
  });

  it("does not terminate already terminated sessions", () => {
    const s1 = sessionManager.createSessionFromPolicy(makePolicy());
    sessionManager.terminateSession(s1.id, "pre-terminated");

    const ks = new KillSwitch(sessionManager, rollbackManager, trustManagers);
    const result = ks.killAll("cleanup");

    // s1 is already terminated, so listActiveSessions should not include it
    expect(result.sessionsTerminated).toBe(0);
  });

  it("works without optional rollbackManager", () => {
    const s1 = sessionManager.createSessionFromPolicy(makePolicy());

    const ks = new KillSwitch(sessionManager);
    const result = ks.killAll("no rollback manager", { rollback: true });

    expect(result.sessionsTerminated).toBe(1);
    // rollback was requested but no manager; should still complete
    expect(result.rollbacksAttempted).toBe(true);
  });
});
