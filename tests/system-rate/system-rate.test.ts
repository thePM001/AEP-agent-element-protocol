import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentGateway } from "../../src/gateway.js";
import type { Policy, AgentAction } from "../../src/policy/types.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../.test-sysrate-ledgers-" + randomUUID().slice(0, 8)
);

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    version: "2.2",
    name: "system-rate-test",
    capabilities: [
      { tool: "file:read", scope: { paths: ["src/**"] } },
    ],
    limits: {},
    gates: [],
    forbidden: [],
    session: { max_actions: 100, escalation: [] },
    evidence: { enabled: true, dir: TEST_DIR },
    system: { max_actions_per_minute: 3, max_concurrent_sessions: 5 },
    ...overrides,
  };
}

function action(path: string): AgentAction {
  return { tool: "file:read", input: { path }, timestamp: new Date() };
}

describe("System-wide rate limiting", () => {
  let gateway: AgentGateway;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    gateway = new AgentGateway({ ledgerDir: TEST_DIR });
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("blocks actions across sessions when system rate exceeded", () => {
    const policy = makePolicy();

    // Create two sessions sharing the same gateway (same system counter)
    const s1 = gateway.createSessionFromPolicy(policy);
    const s2 = gateway.createSessionFromPolicy(policy);

    // Two actions on session 1
    gateway.evaluate(s1.id, action("src/a.ts"));
    gateway.evaluate(s1.id, action("src/b.ts"));

    // One action on session 2
    gateway.evaluate(s2.id, action("src/c.ts"));

    // Fourth action across all sessions should be denied (limit is 3/min)
    const v = gateway.evaluate(s1.id, action("src/d.ts"));
    expect(v.decision).toBe("deny");
    expect(v.reasons[0]).toContain("System-wide rate limit");
  });

  it("enforces max concurrent sessions", () => {
    const policy = makePolicy({
      system: { max_actions_per_minute: 100, max_concurrent_sessions: 2 },
    });

    gateway.createSessionFromPolicy(policy);
    gateway.createSessionFromPolicy(policy);

    expect(() => gateway.createSessionFromPolicy(policy)).toThrow(
      /Maximum concurrent sessions/
    );
  });

  it("allows new sessions after previous ones terminate", () => {
    const policy = makePolicy({
      system: { max_actions_per_minute: 100, max_concurrent_sessions: 1 },
    });

    const s1 = gateway.createSessionFromPolicy(policy);
    gateway.terminateSession(s1.id, "done");

    // Should work: only 0 active sessions now
    const s2 = gateway.createSessionFromPolicy(policy);
    expect(s2.id).toBeDefined();
  });
});
