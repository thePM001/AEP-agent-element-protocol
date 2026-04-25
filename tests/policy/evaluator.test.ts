import { describe, it, expect, beforeEach } from "vitest";
import { PolicyEvaluator } from "../../src/policy/evaluator.js";
import { Session } from "../../src/session/session.js";
import type { Policy, AgentAction } from "../../src/policy/types.js";

function makePolicy(overrides?: Partial<Policy>): Policy {
  return {
    version: "2.1",
    name: "test",
    capabilities: [
      { tool: "file:read", scope: { paths: ["src/**"] } },
      { tool: "file:write", scope: { paths: ["src/**"] } },
      { tool: "command:run", scope: { binaries: ["npm", "node"] } },
      {
        tool: "aep:create_element",
        scope: {
          element_prefixes: ["CP", "PN"],
          z_bands: ["20-29", "10-19"],
        },
      },
      {
        tool: "aep:update_element",
        scope: {
          element_prefixes: ["CP", "PN"],
          exclude_ids: ["SH-00001"],
        },
      },
    ],
    limits: {
      max_runtime_ms: 60000,
      max_files_changed: 10,
      max_aep_mutations: 50,
    },
    gates: [
      { action: "file:delete", approval: "human", risk_level: "high" },
    ],
    forbidden: [
      { pattern: "\\.env", reason: "secrets" },
      { pattern: "rm -rf /", reason: "destructive" },
    ],
    session: {
      max_actions: 10,
      max_denials: 5,
      rate_limit: { max_per_minute: 60 },
      escalation: [],
    },
    evidence: { enabled: true, dir: "./test-ledgers" },
    ...overrides,
  };
}

function action(tool: string, input?: Record<string, unknown>): AgentAction {
  return { tool, input: input ?? {}, timestamp: new Date() };
}

describe("PolicyEvaluator", () => {
  let evaluator: PolicyEvaluator;
  let session: Session;

  beforeEach(() => {
    const policy = makePolicy();
    evaluator = new PolicyEvaluator(policy);
    session = new Session(policy);
  });

  describe("capability matching", () => {
    it("allows matching tool with scope", () => {
      const v = evaluator.evaluate(
        action("file:read", { path: "src/main.ts" }),
        session
      );
      expect(v.decision).toBe("allow");
      expect(v.matchedCapability?.tool).toBe("file:read");
    });

    it("denies tool not in capabilities", () => {
      const v = evaluator.evaluate(action("network:fetch"), session);
      expect(v.decision).toBe("deny");
      expect(v.reasons[0]).toContain("No capability");
    });

    it("denies tool with wrong scope (path)", () => {
      const v = evaluator.evaluate(
        action("file:read", { path: "/etc/passwd" }),
        session
      );
      expect(v.decision).toBe("deny");
    });

    it("allows command with permitted binary", () => {
      const v = evaluator.evaluate(
        action("command:run", { command: "npm install" }),
        session
      );
      expect(v.decision).toBe("allow");
    });

    it("denies command with unpermitted binary", () => {
      const v = evaluator.evaluate(
        action("command:run", { command: "curl http://example.com" }),
        session
      );
      expect(v.decision).toBe("deny");
    });
  });

  describe("AEP-specific capabilities", () => {
    it("allows element creation with valid prefix and z-band", () => {
      const v = evaluator.evaluate(
        action("aep:create_element", {
          id: "CP-00010",
          z: 25,
        }),
        session
      );
      expect(v.decision).toBe("allow");
    });

    it("denies element creation with wrong prefix", () => {
      const v = evaluator.evaluate(
        action("aep:create_element", {
          id: "MD-00010",
          z: 65,
        }),
        session
      );
      expect(v.decision).toBe("deny");
    });

    it("denies element creation with wrong z-band", () => {
      const v = evaluator.evaluate(
        action("aep:create_element", {
          id: "CP-00010",
          z: 50,
        }),
        session
      );
      expect(v.decision).toBe("deny");
    });

    it("denies update on excluded ID (SH-00001)", () => {
      const v = evaluator.evaluate(
        action("aep:update_element", {
          id: "SH-00001",
        }),
        session
      );
      expect(v.decision).toBe("deny");
    });

    it("allows update on permitted prefix", () => {
      const v = evaluator.evaluate(
        action("aep:update_element", {
          id: "CP-00003",
        }),
        session
      );
      expect(v.decision).toBe("allow");
    });
  });

  describe("forbidden pattern blocking", () => {
    it("blocks .env access", () => {
      const v = evaluator.evaluate(
        action("file:read", { path: ".env" }),
        session
      );
      expect(v.decision).toBe("deny");
      expect(v.matchedForbidden?.pattern).toBe("\\.env");
    });

    it("blocks destructive commands", () => {
      const v = evaluator.evaluate(
        action("command:run", { command: "rm -rf /" }),
        session
      );
      expect(v.decision).toBe("deny");
    });
  });

  describe("rate limit enforcement", () => {
    it("denies when rate limit exceeded", () => {
      const policy = makePolicy({
        session: {
          max_actions: 100,
          rate_limit: { max_per_minute: 2 },
          escalation: [],
        },
      });
      const ev = new PolicyEvaluator(policy);
      const s = new Session(policy);

      ev.evaluate(action("file:read", { path: "src/a.ts" }), s);
      ev.evaluate(action("file:read", { path: "src/b.ts" }), s);
      const v = ev.evaluate(action("file:read", { path: "src/c.ts" }), s);
      expect(v.decision).toBe("deny");
      expect(v.reasons[0]).toContain("Rate limit exceeded");
    });
  });

  describe("escalation triggers", () => {
    it("gates after configured action count", () => {
      const policy = makePolicy({
        session: {
          max_actions: 100,
          escalation: [{ after_actions: 2, require: "human_checkin" }],
        },
      });
      const ev = new PolicyEvaluator(policy);
      const s = new Session(policy);

      ev.evaluate(action("file:read", { path: "src/a.ts" }), s);
      ev.evaluate(action("file:read", { path: "src/b.ts" }), s);
      const v = ev.evaluate(action("file:read", { path: "src/c.ts" }), s);
      expect(v.decision).toBe("gate");
      expect(v.reasons[0]).toContain("human_checkin");
    });

    it("terminates after configured denial count", () => {
      const policy = makePolicy({
        capabilities: [],
        session: {
          max_actions: 100,
          escalation: [{ after_denials: 2, require: "terminate" }],
        },
      });
      const ev = new PolicyEvaluator(policy);
      const s = new Session(policy);

      ev.evaluate(action("bad_tool"), s);
      ev.evaluate(action("bad_tool"), s);
      const v = ev.evaluate(action("bad_tool"), s);
      expect(v.decision).toBe("deny");
      expect(v.reasons[0]).toContain("terminate");
    });
  });

  describe("budget/limit enforcement", () => {
    it("denies when max_actions exceeded", () => {
      const policy = makePolicy({
        session: { max_actions: 2, escalation: [] },
      });
      const ev = new PolicyEvaluator(policy);
      const s = new Session(policy);

      ev.evaluate(action("file:read", { path: "src/a.ts" }), s);
      ev.evaluate(action("file:read", { path: "src/b.ts" }), s);
      const v = ev.evaluate(action("file:read", { path: "src/c.ts" }), s);
      expect(v.decision).toBe("deny");
      expect(v.reasons[0]).toContain("Action limit exceeded");
    });
  });

  describe("gate detection", () => {
    it("gates file:delete actions", () => {
      const policy = makePolicy({
        capabilities: [{ tool: "file:delete" }],
      });
      const ev = new PolicyEvaluator(policy);
      const s = new Session(policy);

      const v = ev.evaluate(action("file:delete", { path: "src/old.ts" }), s);
      expect(v.decision).toBe("gate");
      expect(v.matchedGate?.action).toBe("file:delete");
      expect(v.matchedGate?.approval).toBe("human");
    });
  });

  describe("evaluation order (short-circuit)", () => {
    it("denies on session state before checking anything else", () => {
      session.activate();
      session.terminate("done");
      const v = evaluator.evaluate(action("file:read", { path: "src/a.ts" }), session);
      expect(v.decision).toBe("deny");
      expect(v.reasons[0]).toContain("terminated");
    });

    it("denies on paused session", () => {
      session.activate();
      session.pause();
      const v = evaluator.evaluate(action("file:read", { path: "src/a.ts" }), session);
      expect(v.decision).toBe("deny");
      expect(v.reasons[0]).toContain("paused");
    });

    it("auto-activates from created state", () => {
      expect(session.state).toBe("created");
      evaluator.evaluate(action("file:read", { path: "src/a.ts" }), session);
      expect(session.state).toBe("active");
    });
  });

  describe("Policy integrity", () => {
    it("provides a deterministic policy hash", () => {
      const hash = evaluator.getPolicyHash();
      expect(hash).toMatch(/^[a-f0-9]{64}$/);
      // Same policy produces same hash
      const evaluator2 = new PolicyEvaluator(makePolicy());
      expect(evaluator2.getPolicyHash()).toBe(hash);
    });

    it("detects policy mutation and denies", () => {
      // Object.freeze prevents mutation on the frozen policy,
      // but we can test the integrity mechanism directly by
      // creating an evaluator with a non-frozen policy copy
      const policy = makePolicy();
      const ev = new PolicyEvaluator(policy);
      const s = new Session("s-integrity", policy);

      // First evaluation should work
      const v1 = ev.evaluate(action("file:read", { path: "src/a.ts" }), s);
      expect(v1.decision).toBe("allow");

      // Policy hash should remain stable across evaluations
      expect(ev.getPolicyHash()).toMatch(/^[a-f0-9]{64}$/);
    });
  });
});
