import { afterEach, beforeEach, describe, it, expect } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionManager } from "../lib/session-manager.js";
import { validatePolicy } from "../../policy-engine/lib/policy/loader.js";
import type { Policy } from "../../policy-engine/lib/policy/types.js";

function policy(): Policy {
  return validatePolicy({
    version: "1",
    name: "mgr-test",
    capabilities: [{ tool: "*" }],
    limits: {},
    session: { max_actions: 10 },
  });
}

let dir = "";
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aep-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("SessionManager", () => {
  it("creates sessions from a policy object and finds them by id", () => {
    const m = new SessionManager();
    const s = m.createSessionFromPolicy(policy(), { team: "a" });
    expect(s.state).toBe("created");
    expect(s.metadata).toEqual({ team: "a" });
    expect(m.getSession(s.id)).toBe(s);
    expect(m.getSession("missing")).toBeNull();
  });

  it("loads the policy file when creating from a path", () => {
    const path = join(dir, "p.yaml");
    writeFileSync(path, 'version: "1"\nname: from-file\ncapabilities: []\nlimits: {}\nsession:\n  max_actions: 3\n');
    const m = new SessionManager();
    const s = m.createSession(path);
    expect(s.policy.name).toBe("from-file");
    expect(s.policy.session.max_actions).toBe(3);
    expect(() => m.createSession(join(dir, "nope.yaml"))).toThrow(/ENOENT/);
  });

  it("counts created, active and paused sessions toward capacity but not terminated ones", () => {
    const m = new SessionManager();
    const a = m.createSessionFromPolicy(policy());
    const b = m.createSessionFromPolicy(policy());
    const c = m.createSessionFromPolicy(policy());
    a.activate();
    b.activate();
    b.pause();
    expect(m.getActiveCount()).toBe(2);
    expect(m.listActiveSessions().map((s) => s.id).sort()).toEqual([a.id, c.id].sort());
    m.terminateSession(a.id, "done");
    expect(m.getActiveCount()).toBe(1);
  });

  it("refuses new sessions at the concurrency cap until one ends", () => {
    const m = new SessionManager();
    m.setMaxConcurrentSessions(2);
    const first = m.createSessionFromPolicy(policy());
    m.createSessionFromPolicy(policy());
    expect(() => m.createSessionFromPolicy(policy())).toThrow(
      "Cannot create session: maximum concurrent sessions (2) reached.",
    );
    m.terminateSession(first.id, "free a slot");
    expect(m.createSessionFromPolicy(policy()).state).toBe("created");
  });

  it("defaults to a cap of twenty", () => {
    const m = new SessionManager();
    for (let i = 0; i < 20; i++) m.createSessionFromPolicy(policy());
    expect(() => m.createSessionFromPolicy(policy())).toThrow(/\(20\)/);
  });

  it("terminates by id with a report and rejects unknown ids", () => {
    const m = new SessionManager();
    const s = m.createSessionFromPolicy(policy());
    s.activate();
    s.recordAction("allow");
    const report = m.terminateSession(s.id, "bye");
    expect(report.sessionId).toBe(s.id);
    expect(report.totalActions).toBe(1);
    expect(report.terminationReason).toBe("bye");
    expect(s.state).toBe("terminated");
    expect(() => m.terminateSession("ghost", "x")).toThrow('Session "ghost" not found.');
  });

  it("forgets removed sessions", () => {
    const m = new SessionManager();
    const s = m.createSessionFromPolicy(policy());
    m.removeSession(s.id);
    expect(m.getSession(s.id)).toBeNull();
    expect(m.getActiveCount()).toBe(0);
  });
});
