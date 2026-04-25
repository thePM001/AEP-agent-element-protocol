import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { AgentGateway } from "../src/gateway.js";
import type { Policy, AgentAction } from "../src/policy/types.js";

const TEST_DIR = join(
  import.meta.dirname ?? __dirname,
  "../.test-gateway-ledgers"
);

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    version: "2.1",
    name: "gateway-test",
    capabilities: [
      { tool: "file:read", scope: { paths: ["src/**"] } },
      { tool: "file:write", scope: { paths: ["src/**"] } },
      {
        tool: "aep:create_element",
        scope: {
          element_prefixes: ["CP", "PN"],
          z_bands: ["20-29", "10-19"],
        },
      },
      {
        tool: "aep:update_element",
        scope: { element_prefixes: ["CP"], exclude_ids: ["SH-00001"] },
      },
    ],
    limits: { max_aep_mutations: 50 },
    gates: [
      { action: "file:delete", approval: "human", risk_level: "high" },
    ],
    forbidden: [{ pattern: "\\.env", reason: "secrets" }],
    session: {
      max_actions: 100,
      rate_limit: { max_per_minute: 60 },
      escalation: [],
    },
    evidence: { enabled: true, dir: TEST_DIR },
    ...overrides,
  };
}

function action(tool: string, input?: Record<string, unknown>): AgentAction {
  return { tool, input: input ?? {}, timestamp: new Date() };
}

describe("AgentGateway", () => {
  let gateway: AgentGateway;
  let sessionId: string;

  beforeEach(() => {
    if (!existsSync(TEST_DIR)) {
      mkdirSync(TEST_DIR, { recursive: true });
    }
    gateway = new AgentGateway({ ledgerDir: TEST_DIR });
    const session = gateway.createSessionFromPolicy(makePolicy());
    sessionId = session.id;
  });

  afterEach(() => {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  describe("full flow", () => {
    it("create session -> evaluate -> validateAEP -> recordResult -> terminate", () => {
      // Evaluate allowed action
      const verdict = gateway.evaluate(
        sessionId,
        action("aep:create_element", {
          id: "CP-00010",
          z: 25,
          parent: "PN-00001",
        })
      );
      expect(verdict.decision).toBe("allow");

      // AEP structural validation
      const validation = gateway.validateAEP(sessionId, verdict.actionId, {
        id: "CP-00010",
        type: "component",
        z: 25,
        parent: "PN-00001",
      });
      expect(validation.valid).toBe(true);

      // Record result
      gateway.recordResult(sessionId, verdict.actionId, {
        success: true,
        output: { created: "CP-00010" },
      });

      // Terminate
      const report = gateway.terminateSession(sessionId, "test complete");
      expect(report.totalActions).toBe(1);
      expect(report.allowed).toBe(1);

      // Verify ledger
      const ledger = gateway.getLedger(sessionId)!;
      const entries = ledger.entries();
      expect(entries.length).toBeGreaterThanOrEqual(4);
      expect(entries[0].type).toBe("session:start");
      expect(entries[entries.length - 1].type).toBe("session:terminate");
      expect(ledger.verify().valid).toBe(true);
    });
  });

  describe("denied actions never reach AEP validation", () => {
    it("forbidden pattern blocks before AEP", () => {
      const verdict = gateway.evaluate(
        sessionId,
        action("file:read", { path: ".env" })
      );
      expect(verdict.decision).toBe("deny");

      // No AEP validation should be needed
      const ledger = gateway.getLedger(sessionId)!;
      const entries = ledger.entries();
      const aepEntries = entries.filter(
        (e) => e.type === "aep:validate" || e.type === "aep:reject"
      );
      expect(aepEntries).toHaveLength(0);
    });
  });

  describe("gated actions pause session", () => {
    it("gates file:delete and pauses session", () => {
      // Need to add file:delete capability for it to reach the gate check
      const gw = new AgentGateway({ ledgerDir: TEST_DIR });
      const s = gw.createSessionFromPolicy({
        ...makePolicy(),
        capabilities: [
          ...makePolicy().capabilities,
          { tool: "file:delete" },
        ],
      });

      const verdict = gw.evaluate(
        s.id,
        action("file:delete", { path: "src/old.ts" })
      );
      expect(verdict.decision).toBe("gate");
      expect(s.state).toBe("paused");

      // Resume session
      gw.resumeSession(s.id);
      expect(s.state).toBe("active");
    });
  });

  describe("AEP validation", () => {
    it("rejects invalid z-band", () => {
      const verdict = gateway.evaluate(
        sessionId,
        action("aep:create_element", { id: "CP-00010", z: 25 })
      );
      expect(verdict.decision).toBe("allow");

      const validation = gateway.validateAEP(sessionId, verdict.actionId, {
        id: "CP-00010",
        type: "component",
        z: 50, // Wrong z-band for CP prefix
        parent: "PN-00001",
      });
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("Z-index");

      // Should be logged as aep:reject
      const ledger = gateway.getLedger(sessionId)!;
      const rejects = ledger.entries().filter((e) => e.type === "aep:reject");
      expect(rejects).toHaveLength(1);
    });

    it("rejects invalid element ID format", () => {
      const verdict = gateway.evaluate(
        sessionId,
        action("aep:create_element", { id: "CP-00010", z: 25 })
      );

      const validation = gateway.validateAEP(sessionId, verdict.actionId, {
        id: "BADID",
        type: "component",
        z: 25,
        parent: "PN-00001",
      });
      expect(validation.valid).toBe(false);
      expect(validation.errors[0]).toContain("format");
    });
  });

  describe("rollback", () => {
    it("rolls back a created element", () => {
      const verdict = gateway.evaluate(
        sessionId,
        action("aep:create_element", { id: "CP-00050", z: 25 })
      );

      gateway.validateAEP(sessionId, verdict.actionId, {
        id: "CP-00050",
        type: "component",
        z: 25,
        parent: "PN-00001",
      });

      gateway.storeCompensation(
        sessionId,
        verdict.actionId,
        "aep:create_element",
        { id: "CP-00050", z: 25, parent: "PN-00001" }
      );

      gateway.recordResult(sessionId, verdict.actionId, { success: true });

      // Rollback
      const result = gateway.rollback(sessionId, verdict.actionId);
      expect(result.success).toBe(true);
      expect(result.compensationApplied).toEqual({
        tool: "aep:delete_element",
        input: { id: "CP-00050" },
      });
    });

    it("rolls back entire session", () => {
      // Create two elements
      for (const id of ["CP-00060", "CP-00061"]) {
        const v = gateway.evaluate(
          sessionId,
          action("aep:create_element", { id, z: 25 })
        );
        gateway.storeCompensation(sessionId, v.actionId, "aep:create_element", {
          id,
          z: 25,
        });
      }

      const results = gateway.rollbackSession(sessionId);
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.success)).toBe(true);
    });
  });

  describe("evidence ledger captures both layers", () => {
    it("records policy decision and AEP validation", () => {
      const verdict = gateway.evaluate(
        sessionId,
        action("aep:create_element", { id: "CP-00010", z: 25 })
      );

      gateway.validateAEP(sessionId, verdict.actionId, {
        id: "CP-00010",
        type: "component",
        z: 25,
        parent: "PN-00001",
      });

      const ledger = gateway.getLedger(sessionId)!;
      const entries = ledger.entries();
      const types = entries.map((e) => e.type);

      expect(types).toContain("session:start");
      expect(types).toContain("action:evaluate");
      expect(types).toContain("aep:validate");
    });
  });

  describe("session management", () => {
    it("lists active sessions", () => {
      const active = gateway.listActiveSessions();
      expect(active.length).toBeGreaterThanOrEqual(1);
    });

    it("gets session by ID", () => {
      const session = gateway.getSession(sessionId);
      expect(session).not.toBeNull();
      expect(session?.id).toBe(sessionId);
    });
  });

  describe("policy integrity in ledger entries", () => {
    it("session:start includes policyHash", () => {
      const ledger = gateway.getLedger(sessionId)!;
      const start = ledger.entries().find((e) => e.type === "session:start")!;
      expect(start.data.policyHash).toBeDefined();
      expect(start.data.policyHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("action:evaluate includes policyHash", () => {
      gateway.evaluate(sessionId, action("file:read", { path: "src/a.ts" }));
      const ledger = gateway.getLedger(sessionId)!;
      const evalEntry = ledger.entries().find((e) => e.type === "action:evaluate")!;
      expect(evalEntry.data.policyHash).toBeDefined();
      expect(evalEntry.data.policyHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it("session:start includes policyDeclaration", () => {
      const ledger = gateway.getLedger(sessionId)!;
      const start = ledger.entries().find((e) => e.type === "session:start")!;
      const decl = start.data.policyDeclaration as Record<string, unknown>;
      expect(decl).toBeDefined();
      expect(decl.capabilities).toBeDefined();
      expect(decl.forbidden).toBeDefined();
      expect(decl.gates).toBeDefined();
      expect(decl.limits).toBeDefined();
      expect(decl.session).toBeDefined();
    });

    it("policyDeclaration.capabilities matches input policy", () => {
      const ledger = gateway.getLedger(sessionId)!;
      const start = ledger.entries().find((e) => e.type === "session:start")!;
      const decl = start.data.policyDeclaration as Record<string, unknown>;
      const caps = decl.capabilities as unknown[];
      // Our makePolicy has 4 capabilities
      expect(caps).toHaveLength(4);
    });
  });

  describe("stateRef in ledger entries", () => {
    it("ledger entries include stateRef from session state", () => {
      gateway.evaluate(sessionId, action("file:read", { path: "src/a.ts" }));
      const ledger = gateway.getLedger(sessionId)!;
      const entries = ledger.entries();
      // All entries should have stateRef since gateway wires a stateProvider
      for (const entry of entries) {
        expect(entry.stateRef).toBeDefined();
        expect(entry.stateRef).toMatch(/^sha256:[0-9a-f]{64}$/);
      }
    });
  });
});
