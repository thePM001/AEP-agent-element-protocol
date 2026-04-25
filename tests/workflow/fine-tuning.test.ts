import { describe, it, expect, beforeEach } from "vitest";
import { createFineTuningWorkflow, FINE_TUNING_PHASES } from "../../src/workflow/templates/fine-tuning.js";
import { WorkflowExecutor } from "../../src/workflow/executor.js";
import { AgentGateway } from "../../src/gateway.js";
import type { WorkflowDefinition } from "../../src/workflow/types.js";

describe("Fine-Tuning Workflow Template", () => {
  let definition: WorkflowDefinition;

  beforeEach(() => {
    definition = createFineTuningWorkflow();
  });

  it("creates a workflow with 6 phases", () => {
    expect(definition.phases.length).toBe(6);
    expect(definition.name).toBe("fine-tuning");
  });

  it("has correct phase names in order", () => {
    const names = definition.phases.map((p) => p.name);
    expect(names).toEqual([
      "DATA_PREPARATION",
      "DATA_VALIDATION",
      "TRAINING_CONFIG",
      "TRAINING_EXECUTION",
      "EVALUATION",
      "DEPLOYMENT",
    ]);
  });

  it("defaults to escalate on fail", () => {
    expect(definition.onFail).toBe("escalate");
  });

  it("accepts custom onFail strategy", () => {
    const d = createFineTuningWorkflow("terminate");
    expect(d.onFail).toBe("terminate");
  });

  it("assigns appropriate roles to phases", () => {
    const roles = definition.phases.map((p) => p.role);
    expect(roles[0]).toBe("data_engineer");
    expect(roles[1]).toBe("data_engineer");
    expect(roles[2]).toBe("ml_engineer");
    expect(roles[3]).toBe("ml_engineer");
    expect(roles[4]).toBe("ml_engineer");
    expect(roles[5]).toBe("deployer");
  });

  it("assigns rings with increasing privilege for deployment", () => {
    const rings = definition.phases.map((p) => p.ring);
    // Data phases at ring 2, training at ring 1, deployment at ring 0
    expect(rings[0]).toBe(2);
    expect(rings[1]).toBe(2);
    expect(rings[5]).toBe(0);
  });

  it("every phase has exit criteria", () => {
    for (const phase of definition.phases) {
      expect(phase.exitCriteria.length).toBeGreaterThan(0);
      // All criteria start as not met
      for (const criterion of phase.exitCriteria) {
        expect(criterion.met).toBe(false);
      }
    }
  });

  it("every phase has maxRework >= 1", () => {
    for (const phase of definition.phases) {
      expect(phase.maxRework).toBeGreaterThanOrEqual(1);
    }
  });

  it("FINE_TUNING_PHASES constant matches factory output", () => {
    expect(FINE_TUNING_PHASES.length).toBe(6);
    expect(FINE_TUNING_PHASES[0].name).toBe("DATA_PREPARATION");
    expect(FINE_TUNING_PHASES[5].name).toBe("DEPLOYMENT");
  });

  it("creates independent copies (no shared state)", () => {
    const d1 = createFineTuningWorkflow();
    const d2 = createFineTuningWorkflow();
    d1.phases[0].maxRework = 99;
    expect(d2.phases[0].maxRework).not.toBe(99);
  });

  it("works with WorkflowExecutor", () => {
    const gateway = new AgentGateway({ ledgerDir: "/tmp/aep-test-ft" });
    const executor = new WorkflowExecutor(definition, gateway);

    expect(executor.getDefinition().name).toBe("fine-tuning");
    expect(executor.getDefinition().phases.length).toBe(6);
    expect(executor.getCurrentPhase()).toBeNull();

    // Start first phase
    executor.startPhase("DATA_PREPARATION");
    expect(executor.getCurrentPhase()?.name).toBe("DATA_PREPARATION");
    expect(executor.getStatus().state).toBe("running");
  });
});
