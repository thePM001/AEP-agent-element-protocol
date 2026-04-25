import { AgentGateway } from "../../src/gateway.js";
import type { Policy } from "../../src/policy/types.js";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "aep-track-test-"));
}

function makePolicy(): Policy {
  return {
    version: "2.2",
    name: "tracking-test",
    capabilities: [{ tool: "file:read", scope: {} }],
    limits: {},
    gates: [],
    evidence: { enabled: true, dir: "./ledgers" },
    forbidden: [],
    session: { max_actions: 100, escalation: [] },
    trust: {
      initial_score: 500,
      decay_rate: 5,
      penalties: {},
      rewards: {},
    },
    ring: { default: 2, promotion: {} },
    recovery: { enabled: false, max_attempts: 2 },
    scanners: { enabled: false },
    tracking: {
      tokens: true,
      cost_per_million_input: 3.0,
      cost_per_million_output: 15.0,
      currency: "USD",
    },
  } as unknown as Policy;
}

describe("Token and Cost Tracking", () => {
  describe("Tokens recorded in ledger entry", () => {
    it("stores token usage on action:result entries", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();

      gw.recordResult(session.id, "act-001", {
        success: true,
        tokens: { input: 1000, output: 500, total: 1500 },
        cost: { input_cost: 0.003, output_cost: 0.0075, total_cost: 0.0105, currency: "USD" },
      });

      const ledger = gw.getLedger(session.id)!;
      const entries = ledger.entries();
      const resultEntry = entries.find((e) => e.type === "action:result");
      expect(resultEntry).toBeDefined();
      expect(resultEntry!.tokens).toEqual({ input: 1000, output: 500, total: 1500 });
      expect(resultEntry!.cost).toEqual({
        input_cost: 0.003,
        output_cost: 0.0075,
        total_cost: 0.0105,
        currency: "USD",
      });
    });
  });

  describe("Cost calculated from tokens and rates", () => {
    it("accumulates cost totals across multiple actions", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();

      gw.recordResult(session.id, "act-001", {
        success: true,
        tokens: { input: 1000, output: 500, total: 1500 },
        cost: { input_cost: 0.003, output_cost: 0.0075, total_cost: 0.0105, currency: "USD" },
      });

      gw.recordResult(session.id, "act-002", {
        success: true,
        tokens: { input: 2000, output: 1000, total: 3000 },
        cost: { input_cost: 0.006, output_cost: 0.015, total_cost: 0.021, currency: "USD" },
      });

      const costTotals = gw.getSessionCostTotals(session.id);
      expect(costTotals).not.toBeNull();
      expect(costTotals!.input).toBeCloseTo(0.009);
      expect(costTotals!.output).toBeCloseTo(0.0225);
      expect(costTotals!.currency).toBe("USD");
    });
  });

  describe("Session report totals correct", () => {
    it("terminateSession report includes totalTokens and totalCost", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();

      gw.recordResult(session.id, "act-001", {
        success: true,
        tokens: { input: 1000, output: 500, total: 1500 },
        cost: { input_cost: 0.003, output_cost: 0.0075, total_cost: 0.0105, currency: "USD" },
      });

      gw.recordResult(session.id, "act-002", {
        success: true,
        tokens: { input: 2000, output: 1000, total: 3000 },
        cost: { input_cost: 0.006, output_cost: 0.015, total_cost: 0.021, currency: "USD" },
      });

      const report = gw.terminateSession(session.id, "done");
      expect(report.totalTokens).toBe(4500); // 1000+500 + 2000+1000
      expect(report.totalCost).toBeCloseTo(0.0315); // 0.0105 + 0.021
    });
  });

  describe("Cost saved estimated from rejected or aborted actions", () => {
    it("estimates cost saved based on rejected actions and average output tokens", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();

      // Two completed actions with known output tokens
      gw.recordResult(session.id, "act-001", {
        success: true,
        tokens: { input: 1000, output: 400, total: 1400 },
        cost: { input_cost: 0.003, output_cost: 0.006, total_cost: 0.009, currency: "USD" },
      });

      gw.recordResult(session.id, "act-002", {
        success: true,
        tokens: { input: 1000, output: 600, total: 1600 },
        cost: { input_cost: 0.003, output_cost: 0.009, total_cost: 0.012, currency: "USD" },
      });

      // Record 3 rejections
      gw.recordRejection(session.id);
      gw.recordRejection(session.id);
      gw.recordRejection(session.id);

      const report = gw.terminateSession(session.id, "done");

      // avgOutputTokens = (400 + 600) / 2 = 500
      // totalTokens = (1000+400) + (1000+600) = 3000
      // totalCost = 0.009 + 0.012 = 0.021
      // costPerToken = 0.021 / 3000 = 0.000007
      // costSaved = 3 * 500 * 0.000007 = 0.0105
      expect(report.costSaved).toBeDefined();
      expect(report.costSaved!).toBeGreaterThan(0);
      expect(report.costSaved!).toBeCloseTo(0.0105);
    });
  });

  describe("Zero tokens when tracking disabled or unused", () => {
    it("produces no token or cost totals when no tokens are recorded", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();

      // Record result without token data
      gw.recordResult(session.id, "act-001", {
        success: true,
      });

      expect(gw.getSessionTokenTotals(session.id)).toBeNull();
      expect(gw.getSessionCostTotals(session.id)).toBeNull();

      const report = gw.terminateSession(session.id, "done");
      expect(report.totalTokens).toBeUndefined();
      expect(report.totalCost).toBeUndefined();
      expect(report.costSaved).toBeUndefined();
    });
  });
});
