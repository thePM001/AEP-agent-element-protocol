import { AgentGateway } from "../../src/gateway.js";
import { WorkflowExecutor } from "../../src/workflow/executor.js";
import type { WorkflowDefinition } from "../../src/workflow/types.js";
import type { Policy } from "../../src/policy/types.js";
import { tmpdir } from "node:os";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "aep-wf-test-"));
}

function makePolicy(): Policy {
  return {
    version: "2.2",
    name: "wf-test",
    capabilities: [{ tool: "file:read", scope: {} }],
    limits: {},
    gates: [],
    evidence: { enabled: true, dir: "./ledgers" },
    forbidden: [],
    session: { max_actions: 100, escalation: [] },
    trust: {
      initial_score: 500,
      decay_rate: 5,
      penalties: {
        policy_violation: 50,
        structural_violation: 30,
        rate_limit: 10,
        forbidden_match: 100,
        intent_drift: 75,
      },
      rewards: {
        successful_action: 5,
        successful_rollback: 10,
      },
    },
    ring: { default: 2, promotion: {} },
    recovery: { enabled: false, max_attempts: 2 },
    scanners: { enabled: false },
  } as unknown as Policy;
}

function makeWorkflow(): WorkflowDefinition {
  return {
    name: "dev-pipeline",
    phases: [
      {
        name: "plan",
        description: "Planning phase",
        entryConditions: [],
        role: "architect",
        ring: 2,
        exitCriteria: [],
        maxRework: 2,
      },
      {
        name: "implement",
        description: "Implementation phase",
        entryConditions: [],
        role: "coder",
        ring: 2,
        exitCriteria: [],
        maxRework: 3,
      },
      {
        name: "review",
        description: "Review phase",
        entryConditions: [],
        role: "reviewer",
        ring: 3,
        exitCriteria: [],
        maxRework: 1,
      },
      {
        name: "approve",
        description: "Approval phase",
        entryConditions: [],
        role: "approver",
        ring: 1,
        exitCriteria: [],
        maxRework: 0,
      },
    ],
    onFail: "terminate",
  };
}

describe("WorkflowExecutor", () => {
  describe("Phase creation with entry conditions", () => {
    it("creates phases from a workflow definition", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const wf = makeWorkflow();
      const executor = new WorkflowExecutor(wf, gw);

      expect(executor.getDefinition().phases).toHaveLength(4);
      expect(executor.getDefinition().phases[0].name).toBe("plan");
    });

    it("rejects starting a phase with unmet entry conditions", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const wf = makeWorkflow();
      wf.phases[0].entryConditions = [
        { field: "always_false", operator: "eq", value: true },
      ];
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(wf, gw);
      executor.setSession(session.id);

      expect(() => executor.startPhase("plan")).toThrow("Entry conditions not met");
    });
  });

  describe("Verdict routing: advance moves forward", () => {
    it("advances to next phase on advance verdict", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      executor.startPhase("plan");
      executor.submitVerdict("plan", "advance");

      const status = executor.getStatus();
      expect(status.phaseIndex).toBe(1);
      expect(status.phase).toBe("implement");
    });
  });

  describe("Verdict routing: rework loops back with feedback", () => {
    it("stays on same phase after rework", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      executor.startPhase("plan");
      executor.submitVerdict("plan", "rework", "Needs more detail");

      const status = executor.getStatus();
      expect(status.reworkCount).toBe(1);
      expect(status.phase).toBe("plan");
      expect(status.verdictHistory[0].feedback).toBe("Needs more detail");
    });
  });

  describe("Verdict routing: skip bypasses with log", () => {
    it("skips to next phase", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      executor.startPhase("plan");
      executor.submitVerdict("plan", "skip");

      const status = executor.getStatus();
      expect(status.phaseIndex).toBe(1);
      expect(status.verdictHistory[0].verdict).toBe("skip");
    });
  });

  describe("Verdict routing: fail terminates", () => {
    it("sets workflow state to failed", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      executor.startPhase("plan");
      executor.submitVerdict("plan", "fail", "Critical issue");

      const status = executor.getStatus();
      expect(status.state).toBe("failed");
    });
  });

  describe("Max rework enforced", () => {
    it("fails when rework exceeds maxRework", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const wf = makeWorkflow();
      wf.phases[0].maxRework = 1; // Only 1 rework allowed
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(wf, gw);
      executor.setSession(session.id);

      executor.startPhase("plan");
      executor.submitVerdict("plan", "rework"); // rework count = 1
      executor.submitVerdict("plan", "rework"); // exceeds maxRework=1, becomes fail

      const status = executor.getStatus();
      expect(status.state).toBe("failed");
    });
  });

  describe("Trust changes per verdict correct", () => {
    it("advance gives +15 trust", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      const trust = gw.getTrustManager(session.id)!;
      const before = trust.getScore();
      executor.startPhase("plan");
      executor.submitVerdict("plan", "advance");
      const after = trust.getScore();

      expect(after - before).toBe(15);
    });

    it("rework gives -20 trust", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      const trust = gw.getTrustManager(session.id)!;
      const before = trust.getScore();
      executor.startPhase("plan");
      executor.submitVerdict("plan", "rework");
      const after = trust.getScore();

      expect(after - before).toBe(-20);
    });

    it("skip gives -5 trust", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      const trust = gw.getTrustManager(session.id)!;
      const before = trust.getScore();
      executor.startPhase("plan");
      executor.submitVerdict("plan", "skip");
      const after = trust.getScore();

      expect(after - before).toBe(-5);
    });

    it("fail gives -100 trust", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      const trust = gw.getTrustManager(session.id)!;
      const before = trust.getScore();
      executor.startPhase("plan");
      executor.submitVerdict("plan", "fail");
      const after = trust.getScore();

      expect(after - before).toBe(-100);
    });
  });

  describe("Workflow + task decomposition: phases contain subtask trees", () => {
    it("task decomposition works within a workflow phase", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const policy = makePolicy();
      (policy as Record<string, unknown>).decomposition = { enabled: true };
      const session = gw.createSessionFromPolicy(policy);
      session.activate();

      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);
      executor.startPhase("plan");

      const dm = gw.getDecompositionManager(session.id);
      expect(dm).not.toBeNull();

      // Can create tasks within a workflow phase
      const root = dm!.createRoot(session.id, "Plan subtasks", {
        allowedTools: ["file:read"],
        allowedPrefixes: [],
        allowedPaths: ["**"],
        maxActions: 10,
        inheritFromParent: true,
      });
      expect(root.status).toBe("active");
    });
  });

  describe("Ledger logs all workflow events", () => {
    it("records workflow:start, phase_enter, phase_verdict, complete", () => {
      const dir = makeTempDir();
      const gw = new AgentGateway({ ledgerDir: dir });
      const session = gw.createSessionFromPolicy(makePolicy());
      session.activate();
      const executor = new WorkflowExecutor(makeWorkflow(), gw);
      executor.setSession(session.id);

      executor.startPhase("plan");
      executor.submitVerdict("plan", "advance");
      executor.submitVerdict("implement", "advance");
      executor.submitVerdict("review", "advance");
      executor.submitVerdict("approve", "advance");

      const ledger = gw.getLedger(session.id)!;
      const entries = ledger.entries();
      const types = entries.map((e) => e.type);

      expect(types).toContain("workflow:start");
      expect(types).toContain("workflow:phase_enter");
      expect(types).toContain("workflow:phase_verdict");
      expect(types).toContain("workflow:complete");
    });
  });

  describe("Workflow definition from YAML template", () => {
    it("template names map to phase lists", () => {
      const templates: Record<string, string[]> = {
        "dev-pipeline": ["plan", "implement", "review", "approve"],
        "audit-pipeline": ["scan", "evaluate", "report"],
      };

      expect(templates["dev-pipeline"]).toHaveLength(4);
      expect(templates["audit-pipeline"]).toHaveLength(3);
    });
  });
});
