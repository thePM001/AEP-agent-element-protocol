import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { AgentGateway } from "../../src/gateway.js";
import type { Policy, AgentAction } from "../../src/policy/types.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../.test-concurrency-ledgers-" + randomUUID().slice(0, 8)
);

function makePolicy(): Policy {
  return {
    version: "2.2",
    name: "concurrency-test",
    capabilities: [
      {
        tool: "aep:create_element",
        scope: { element_prefixes: ["CP", "PN"], z_bands: ["20-29", "10-19"] },
      },
      {
        tool: "aep:update_element",
        scope: { element_prefixes: ["CP", "PN"] },
      },
    ],
    limits: { max_aep_mutations: 50 },
    gates: [],
    forbidden: [],
    session: { max_actions: 100, escalation: [] },
    evidence: { enabled: true, dir: TEST_DIR },
  };
}

function action(tool: string, input?: Record<string, unknown>): AgentAction {
  return { tool, input: input ?? {}, timestamp: new Date() };
}

describe("Optimistic concurrency control", () => {
  let gateway: AgentGateway;
  let sessionId: string;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) mkdirSync(TEST_DIR, { recursive: true });
    gateway = new AgentGateway({ ledgerDir: TEST_DIR });
    const session = gateway.createSessionFromPolicy(makePolicy());
    sessionId = session.id;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) rmSync(TEST_DIR, { recursive: true, force: true });
  });

  it("accepts first mutation with version 0", () => {
    const verdict = gateway.evaluate(
      sessionId,
      action("aep:create_element", { id: "CP-00010", z: 25 })
    );
    expect(verdict.decision).toBe("allow");

    const result = gateway.validateAEPWithVersion(sessionId, verdict.actionId, {
      id: "CP-00010",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });
    expect(result.valid).toBe(true);
  });

  it("increments tracked version after successful mutation", () => {
    const v1 = gateway.evaluate(
      sessionId,
      action("aep:create_element", { id: "CP-00020", z: 25 })
    );
    gateway.validateAEPWithVersion(sessionId, v1.actionId, {
      id: "CP-00020",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });

    expect(gateway.getElementVersion("CP-00020")).toBe(1);
  });

  it("rejects mutation with stale version", () => {
    // First mutation creates version 1
    const v1 = gateway.evaluate(
      sessionId,
      action("aep:create_element", { id: "CP-00030", z: 25 })
    );
    gateway.validateAEPWithVersion(sessionId, v1.actionId, {
      id: "CP-00030",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });

    // Second mutation succeeds with current version
    const v2 = gateway.evaluate(
      sessionId,
      action("aep:update_element", { id: "CP-00030" })
    );
    gateway.validateAEPWithVersion(sessionId, v2.actionId, {
      id: "CP-00030",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 1,
    });

    // Third mutation with stale version 1 (current is 2)
    const v3 = gateway.evaluate(
      sessionId,
      action("aep:update_element", { id: "CP-00030" })
    );
    const result = gateway.validateAEPWithVersion(sessionId, v3.actionId, {
      id: "CP-00030",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 1,
    });

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("concurrency conflict");
  });

  it("logs concurrency conflict to ledger", () => {
    const v1 = gateway.evaluate(
      sessionId,
      action("aep:create_element", { id: "CP-00040", z: 25 })
    );
    gateway.validateAEPWithVersion(sessionId, v1.actionId, {
      id: "CP-00040",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });

    // Conflict: provide version 0 when current is 1
    const v2 = gateway.evaluate(
      sessionId,
      action("aep:update_element", { id: "CP-00040" })
    );
    gateway.validateAEPWithVersion(sessionId, v2.actionId, {
      id: "CP-00040",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });

    const ledger = gateway.getLedger(sessionId)!;
    const rejects = ledger.entries().filter((e) => e.type === "aep:reject");
    expect(rejects.length).toBeGreaterThanOrEqual(1);
  });

  it("returns 0 for untracked element version", () => {
    expect(gateway.getElementVersion("UNKNOWN-99999")).toBe(0);
  });

  it("accepts retry with correct version after conflict", () => {
    // Create
    const v1 = gateway.evaluate(
      sessionId,
      action("aep:create_element", { id: "CP-00050", z: 25 })
    );
    gateway.validateAEPWithVersion(sessionId, v1.actionId, {
      id: "CP-00050",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });

    // Conflict
    const v2 = gateway.evaluate(
      sessionId,
      action("aep:update_element", { id: "CP-00050" })
    );
    const conflict = gateway.validateAEPWithVersion(sessionId, v2.actionId, {
      id: "CP-00050",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: 0,
    });
    expect(conflict.valid).toBe(false);

    // Re-read version and retry
    const current = gateway.getElementVersion("CP-00050");
    const v3 = gateway.evaluate(
      sessionId,
      action("aep:update_element", { id: "CP-00050" })
    );
    const retry = gateway.validateAEPWithVersion(sessionId, v3.actionId, {
      id: "CP-00050",
      type: "component",
      z: 25,
      parent: "PN-00001",
      _version: current,
    });
    expect(retry.valid).toBe(true);
  });
});
