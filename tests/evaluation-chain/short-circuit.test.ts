// AEP 2.5 -- Short-Circuit Evaluation Chain Tests
// Covers the 15-step evaluation chain with short-circuit pattern.
// 12 unit tests + 4 integration tests.

import { describe, it, expect, beforeEach } from "vitest";
import {
  StepActivationMode,
  type StepActivationProfile,
  type StepVerdict,
  type EvalContext,
  type EvalStep,
} from "../../src/evaluation-chain/types.js";
import {
  DEFAULT_STEP_ACTIVATION_PROFILE,
  ALWAYS_MODE_STEPS,
  ACTIVE_MODE_STEPS,
} from "../../src/evaluation-chain/defaults.js";
import {
  PRECONDITION_EVALUATORS,
  evaluatePrecondition,
} from "../../src/evaluation-chain/preconditions.js";
import {
  runEvaluationChain,
  isHardViolation,
  countEvaluated,
  countShortCircuited,
  countAborted,
} from "../../src/evaluation-chain/runner.js";
import {
  PRESET_STEP_ACTIVATION,
  getStepActivation,
} from "../../src/assist/presets.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeContext(overrides?: Partial<EvalContext>): EvalContext {
  return {
    session: {
      id: "test-session-001",
      state: "active",
      actionCount: 0,
      actionsInLastMinute: 0,
      elapsedMs: 1000,
      actionsDenied: 0,
      actionsAllowed: 0,
      actionsGated: 0,
      actionsEvaluated: 0,
      ...overrides?.session,
    },
    config: {
      drift: { warmupThreshold: 10 },
      gates: {},
      ...overrides?.config,
    },
    policy: {
      escalation: [],
      ...overrides?.policy,
    },
    currentAction: {
      tool: "file:read",
      type: "read",
      input: {},
      involvesRetrieval: false,
      ...overrides?.currentAction,
    },
    fleet: {
      activeAgentCount: 1,
      ...overrides?.fleet,
    },
    knowledgeBase: overrides?.knowledgeBase,
    decomposition: overrides?.decomposition,
  };
}

function makePassVerdict(step: number, name: string, mode: StepActivationMode): StepVerdict {
  return {
    step,
    name,
    mode,
    verdict: "pass",
    verdict_reason: "ok",
    duration_us: 10,
    timestamp: new Date().toISOString(),
  };
}

function makeFailVerdict(step: number, name: string, mode: StepActivationMode): StepVerdict {
  return {
    step,
    name,
    mode,
    verdict: "fail",
    verdict_reason: "policy_violation",
    duration_us: 10,
    timestamp: new Date().toISOString(),
  };
}

function make15Steps(overrideExecutors?: Partial<Record<number, (ctx: EvalContext) => StepVerdict>>): EvalStep[] {
  return DEFAULT_STEP_ACTIVATION_PROFILE.steps.map((s) => ({
    step: s.step,
    name: s.name,
    execute: overrideExecutors?.[s.step] ?? (() => makePassVerdict(s.step, s.name, s.mode)),
  }));
}

// ---------------------------------------------------------------------------
// Unit Tests
// ---------------------------------------------------------------------------

describe("Evaluation Chain - Unit Tests", () => {
  describe("defaults", () => {
    it("has exactly 15 steps", () => {
      expect(DEFAULT_STEP_ACTIVATION_PROFILE.steps).toHaveLength(15);
    });

    it("step numbers are 0 through 14", () => {
      const stepNumbers = DEFAULT_STEP_ACTIVATION_PROFILE.steps.map((s) => s.step);
      expect(stepNumbers).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
    });

    it("always-mode steps match specification", () => {
      const alwaysSteps = DEFAULT_STEP_ACTIVATION_PROFILE.steps
        .filter((s) => s.mode === StepActivationMode.ALWAYS)
        .map((s) => s.step);
      expect(alwaysSteps).toEqual(ALWAYS_MODE_STEPS);
      expect(alwaysSteps).toEqual([1, 2, 3, 4, 7, 8, 9, 14]);
    });

    it("active-mode steps match specification", () => {
      const activeSteps = DEFAULT_STEP_ACTIVATION_PROFILE.steps
        .filter((s) => s.mode === StepActivationMode.ACTIVE)
        .map((s) => s.step);
      expect(activeSteps).toEqual(ACTIVE_MODE_STEPS);
      expect(activeSteps).toEqual([0, 5, 6, 10, 11, 12, 13]);
    });

    it("all active-mode steps have preconditions", () => {
      const activeSteps = DEFAULT_STEP_ACTIVATION_PROFILE.steps.filter(
        (s) => s.mode === StepActivationMode.ACTIVE,
      );
      for (const s of activeSteps) {
        expect(s.precondition).toBeDefined();
        expect(s.precondition).not.toBe("");
      }
    });

    it("default force_all_preconditions is false", () => {
      expect(DEFAULT_STEP_ACTIVATION_PROFILE.force_all_preconditions).toBe(false);
    });
  });

  describe("always_mode_never_short_circuits", () => {
    it("always-mode steps execute fully regardless of context", () => {
      const ctx = makeContext(); // minimal context, no features enabled
      const steps = make15Steps();
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: false,
      };

      const result = runEvaluationChain(ctx, steps, profile);

      // Always-mode steps should have verdict_reason !== "not_applicable"
      for (const stepNum of ALWAYS_MODE_STEPS) {
        const v = result.verdicts.find((v) => v.step === stepNum);
        expect(v).toBeDefined();
        expect(v!.verdict_reason).not.toBe("not_applicable");
        expect(v!.verdict_reason).not.toBe("chain_aborted_hard_violation");
      }
    });
  });

  describe("active_mode_short_circuits_on_false_precondition", () => {
    it("short-circuits when precondition is false", () => {
      // With no features enabled, most active-mode preconditions are false
      const ctx = makeContext({
        session: {
          id: "test", state: "active", actionCount: 0,
          actionsInLastMinute: 0, elapsedMs: 1000,
          actionsDenied: 0, actionsAllowed: 0, actionsGated: 0, actionsEvaluated: 0,
        },
        fleet: { activeAgentCount: 1 },
      });
      const steps = make15Steps();
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: false,
      };

      const result = runEvaluationChain(ctx, steps, profile);

      // Step 0 (decomposition_enabled): decomposition not defined → short-circuit
      const v0 = result.verdicts.find((v) => v.step === 0)!;
      expect(v0.verdict_reason).toBe("not_applicable");
      expect(v0.precondition_result).toBe(false);

      // Step 5 (warmup_complete): actionCount=0, warmupThreshold=10 → false
      const v5 = result.verdicts.find((v) => v.step === 5)!;
      expect(v5.verdict_reason).toBe("not_applicable");

      // Step 12 (fleet_multi_agent): activeAgentCount=1 → false
      const v12 = result.verdicts.find((v) => v.step === 12)!;
      expect(v12.verdict_reason).toBe("not_applicable");

      // Step 13 (knowledge_active_and_retrieval): no KB → false
      const v13 = result.verdicts.find((v) => v.step === 13)!;
      expect(v13.verdict_reason).toBe("not_applicable");

      // Short-circuit count should be > 0
      expect(result.steps_short_circuited).toBeGreaterThan(0);
    });

    it("does not short-circuit when precondition is true", () => {
      const ctx = makeContext({
        session: {
          id: "test", state: "active", actionCount: 50,
          actionsInLastMinute: 5, elapsedMs: 300000,
          actionsDenied: 0, actionsAllowed: 50, actionsGated: 0, actionsEvaluated: 50,
        },
        decomposition: { enabled: true },
        fleet: { activeAgentCount: 3 },
        knowledgeBase: { active: true },
        currentAction: { tool: "file:read", type: "read", input: {}, involvesRetrieval: true },
        policy: { escalation: [{ after_actions: 20, require: "human_checkin" }] },
        config: {
          drift: { warmupThreshold: 10 },
          budgets: { maxRuntimeMs: 60000 },
          gates: { "file:delete": { approval: "human" } },
        },
      });
      const steps = make15Steps();
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: false,
      };

      const result = runEvaluationChain(ctx, steps, profile);

      // All active-mode steps should now NOT be short-circuited
      for (const stepNum of ACTIVE_MODE_STEPS) {
        const v = result.verdicts.find((v) => v.step === stepNum)!;
        expect(v.verdict_reason).not.toBe("not_applicable");
      }

      expect(result.steps_short_circuited).toBe(0);
    });
  });

  describe("force_all_preconditions_overrides", () => {
    it("prevents short-circuiting when force_all_preconditions is true", () => {
      const ctx = makeContext(); // minimal context
      const steps = make15Steps();
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: true,
      };

      const result = runEvaluationChain(ctx, steps, profile);

      // No step should be short-circuited
      expect(result.steps_short_circuited).toBe(0);

      // All 15 steps should have a non-short-circuit verdict
      for (const v of result.verdicts) {
        expect(v.verdict_reason).not.toBe("not_applicable");
      }
    });
  });

  describe("ledger_always_has_15_entries", () => {
    it("always produces exactly 15 verdicts", () => {
      const ctx = makeContext();
      const steps = make15Steps();

      const result = runEvaluationChain(ctx, steps);

      expect(result.verdicts).toHaveLength(15);
      expect(result.steps_total).toBe(15);
    });

    it("15 verdicts even when all steps pass", () => {
      const ctx = makeContext();
      const steps = make15Steps();
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: true,
      };

      const result = runEvaluationChain(ctx, steps, profile);
      expect(result.verdicts).toHaveLength(15);
    });
  });

  describe("hard_violation_early_exit_fills_remaining", () => {
    it("fills remaining steps with chain_aborted_hard_violation", () => {
      const ctx = makeContext();
      // Step 3 (system_rate_limit) fails hard
      const steps = make15Steps({
        3: () => makeFailVerdict(3, "system_rate_limit", StepActivationMode.ALWAYS),
      });
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: true,
      };

      const result = runEvaluationChain(ctx, steps, profile);

      expect(result.verdicts).toHaveLength(15);
      expect(result.decision).toBe("deny");

      // Steps 0-3 should have been evaluated
      for (let i = 0; i <= 3; i++) {
        expect(result.verdicts[i].verdict_reason).not.toBe("chain_aborted_hard_violation");
      }

      // Steps 4-14 should be aborted
      for (let i = 4; i <= 14; i++) {
        const v = result.verdicts[i];
        expect(v.verdict_reason).toBe("chain_aborted_hard_violation");
        expect(v.duration_us).toBe(0);
      }

      expect(result.steps_aborted).toBe(11);
    });
  });

  describe("short_circuit_performance", () => {
    it("short-circuited steps have minimal duration", () => {
      const ctx = makeContext();
      const steps = make15Steps();
      const profile: StepActivationProfile = {
        ...DEFAULT_STEP_ACTIVATION_PROFILE,
        force_all_preconditions: false,
      };

      const result = runEvaluationChain(ctx, steps, profile);

      const shortCircuited = result.verdicts.filter(
        (v) => v.verdict_reason === "not_applicable",
      );
      expect(shortCircuited.length).toBeGreaterThan(0);

      // Short-circuited steps should take less than 1000 microseconds each
      for (const v of shortCircuited) {
        expect(v.duration_us).toBeLessThan(1000);
      }
    });
  });

  describe("counter functions", () => {
    it("countEvaluated excludes not_applicable and aborted", () => {
      const verdicts: StepVerdict[] = [
        { step: 0, name: "a", mode: StepActivationMode.ACTIVE, verdict: "pass", verdict_reason: "not_applicable", duration_us: 0, timestamp: "" },
        { step: 1, name: "b", mode: StepActivationMode.ALWAYS, verdict: "pass", verdict_reason: "ok", duration_us: 10, timestamp: "" },
        { step: 2, name: "c", mode: StepActivationMode.ALWAYS, verdict: "fail", verdict_reason: "denied", duration_us: 10, timestamp: "" },
        { step: 3, name: "d", mode: StepActivationMode.ALWAYS, verdict: "pass", verdict_reason: "chain_aborted_hard_violation", duration_us: 0, timestamp: "" },
      ];

      expect(countEvaluated(verdicts)).toBe(2);
      expect(countShortCircuited(verdicts)).toBe(1);
      expect(countAborted(verdicts)).toBe(1);
    });

    it("isHardViolation detects fail verdict", () => {
      expect(isHardViolation(makeFailVerdict(0, "test", StepActivationMode.ALWAYS))).toBe(true);
      expect(isHardViolation(makePassVerdict(0, "test", StepActivationMode.ALWAYS))).toBe(false);
    });
  });

  describe("precondition evaluators", () => {
    it("decomposition_enabled checks decomposition config", () => {
      expect(evaluatePrecondition("decomposition_enabled", makeContext())).toBe(false);
      expect(evaluatePrecondition("decomposition_enabled", makeContext({
        decomposition: { enabled: true },
      }))).toBe(true);
    });

    it("warmup_complete checks action count against threshold", () => {
      expect(evaluatePrecondition("warmup_complete", makeContext({
        session: {
          id: "t", state: "active", actionCount: 5,
          actionsInLastMinute: 0, elapsedMs: 0,
          actionsDenied: 0, actionsAllowed: 0, actionsGated: 0, actionsEvaluated: 0,
        },
        config: { drift: { warmupThreshold: 10 }, gates: {} },
      }))).toBe(false);

      expect(evaluatePrecondition("warmup_complete", makeContext({
        session: {
          id: "t", state: "active", actionCount: 15,
          actionsInLastMinute: 0, elapsedMs: 0,
          actionsDenied: 0, actionsAllowed: 0, actionsGated: 0, actionsEvaluated: 0,
        },
        config: { drift: { warmupThreshold: 10 }, gates: {} },
      }))).toBe(true);
    });

    it("fleet_multi_agent checks agent count > 1", () => {
      expect(evaluatePrecondition("fleet_multi_agent", makeContext({
        fleet: { activeAgentCount: 1 },
      }))).toBe(false);
      expect(evaluatePrecondition("fleet_multi_agent", makeContext({
        fleet: { activeAgentCount: 3 },
      }))).toBe(true);
    });

    it("knowledge_active_and_retrieval checks both conditions", () => {
      // Neither active nor retrieval
      expect(evaluatePrecondition("knowledge_active_and_retrieval", makeContext())).toBe(false);

      // Active but not retrieval
      expect(evaluatePrecondition("knowledge_active_and_retrieval", makeContext({
        knowledgeBase: { active: true },
        currentAction: { tool: "file:write", type: "write", input: {}, involvesRetrieval: false },
      }))).toBe(false);

      // Both true
      expect(evaluatePrecondition("knowledge_active_and_retrieval", makeContext({
        knowledgeBase: { active: true },
        currentAction: { tool: "file:read", type: "read", input: {}, involvesRetrieval: true },
      }))).toBe(true);
    });

    it("unknown precondition returns false", () => {
      expect(evaluatePrecondition("nonexistent_precondition", makeContext())).toBe(false);
    });

    it("all active-mode step preconditions have evaluators", () => {
      const activeSteps = DEFAULT_STEP_ACTIVATION_PROFILE.steps.filter(
        (s) => s.mode === StepActivationMode.ACTIVE,
      );
      for (const s of activeSteps) {
        expect(PRECONDITION_EVALUATORS[s.precondition!]).toBeDefined();
      }
    });
  });

  describe("preset step activation", () => {
    it("strict preset has force_all_preconditions = true", () => {
      const profile = getStepActivation("strict");
      expect(profile.force_all_preconditions).toBe(true);
    });

    it("standard preset has force_all_preconditions = false", () => {
      const profile = getStepActivation("standard");
      expect(profile.force_all_preconditions).toBe(false);
    });

    it("relaxed preset has force_all_preconditions = false", () => {
      const profile = getStepActivation("relaxed");
      expect(profile.force_all_preconditions).toBe(false);
    });

    it("audit preset has force_all_preconditions = true", () => {
      const profile = getStepActivation("audit");
      expect(profile.force_all_preconditions).toBe(true);
    });

    it("all presets have matching step count", () => {
      for (const preset of ["strict", "standard", "relaxed", "audit"] as const) {
        const profile = getStepActivation(preset);
        expect(profile.steps).toHaveLength(15);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe("Evaluation Chain - Integration Tests", () => {
  describe("single agent standard preset", () => {
    it("short-circuits inactive features, evaluates core governance", () => {
      const ctx = makeContext({
        session: {
          id: "sess-001", state: "active", actionCount: 3,
          actionsInLastMinute: 3, elapsedMs: 5000,
          actionsDenied: 0, actionsAllowed: 3, actionsGated: 0, actionsEvaluated: 3,
        },
        config: {
          drift: { warmupThreshold: 10 },
          gates: { "file:delete": { approval: "human" } },
          budgets: { maxRuntimeMs: 60000, maxActions: 100 },
        },
        policy: { escalation: [] },
        fleet: { activeAgentCount: 1 },
      });
      const steps = make15Steps();
      const profile = getStepActivation("standard");

      const result = runEvaluationChain(ctx, steps, profile);

      expect(result.verdicts).toHaveLength(15);
      expect(result.decision).toBe("allow");

      // Step 0 (task_scope): decomposition not enabled → short-circuit
      expect(result.verdicts[0].verdict_reason).toBe("not_applicable");

      // Step 5 (intent_drift): actionCount=3, warmup=10 → short-circuit
      expect(result.verdicts[5].verdict_reason).toBe("not_applicable");

      // Step 6 (escalation): no escalation rules → short-circuit
      expect(result.verdicts[6].verdict_reason).toBe("not_applicable");

      // Step 12 (cross_agent): single agent → short-circuit
      expect(result.verdicts[12].verdict_reason).toBe("not_applicable");

      // Step 13 (knowledge): no KB → short-circuit
      expect(result.verdicts[13].verdict_reason).toBe("not_applicable");

      // Core governance steps should have executed
      for (const stepNum of [1, 2, 3, 4, 7, 8, 9, 14]) {
        expect(result.verdicts[stepNum].verdict_reason).not.toBe("not_applicable");
      }

      // Steps 10 and 11 have preconditions that ARE met (budgets + gates configured)
      expect(result.verdicts[10].verdict_reason).not.toBe("not_applicable");
      expect(result.verdicts[11].verdict_reason).not.toBe("not_applicable");

      expect(result.steps_short_circuited).toBe(5);
      expect(result.steps_evaluated).toBe(10);
    });
  });

  describe("multi-agent strict preset", () => {
    it("evaluates all steps with force_all_preconditions", () => {
      const ctx = makeContext({
        fleet: { activeAgentCount: 4 },
        decomposition: { enabled: true },
      });
      const steps = make15Steps();
      const profile = getStepActivation("strict");

      const result = runEvaluationChain(ctx, steps, profile);

      expect(result.verdicts).toHaveLength(15);

      // With force_all_preconditions=true, no short-circuits
      expect(result.steps_short_circuited).toBe(0);
      expect(result.steps_evaluated).toBe(15);

      // Every step should have been evaluated
      for (const v of result.verdicts) {
        expect(v.verdict_reason).not.toBe("not_applicable");
        expect(v.verdict_reason).not.toBe("chain_aborted_hard_violation");
      }
    });
  });

  describe("preset switch mid-evaluation", () => {
    it("switching from strict to relaxed changes short-circuit behavior", () => {
      const ctx = makeContext(); // minimal context
      const steps = make15Steps();

      // Run with strict: no short-circuits
      const strictProfile = getStepActivation("strict");
      const strictResult = runEvaluationChain(ctx, steps, strictProfile);
      expect(strictResult.steps_short_circuited).toBe(0);
      expect(strictResult.steps_evaluated).toBe(15);

      // Run with relaxed (same as standard for force_all): short-circuits happen
      const relaxedProfile = getStepActivation("relaxed");
      const relaxedResult = runEvaluationChain(ctx, steps, relaxedProfile);
      expect(relaxedResult.steps_short_circuited).toBeGreaterThan(0);
      expect(relaxedResult.steps_evaluated).toBeLessThan(15);

      // Both should still have 15 verdicts
      expect(strictResult.verdicts).toHaveLength(15);
      expect(relaxedResult.verdicts).toHaveLength(15);
    });
  });

  describe("chain result report shape", () => {
    it("returns complete ChainResult with all required fields", () => {
      const ctx = makeContext();
      const steps = make15Steps();

      const result = runEvaluationChain(ctx, steps);

      // Required fields
      expect(result).toHaveProperty("decision");
      expect(result).toHaveProperty("actionId");
      expect(result).toHaveProperty("reasons");
      expect(result).toHaveProperty("verdicts");
      expect(result).toHaveProperty("steps_total");
      expect(result).toHaveProperty("steps_evaluated");
      expect(result).toHaveProperty("steps_short_circuited");
      expect(result).toHaveProperty("steps_aborted");

      // steps_total is always 15
      expect(result.steps_total).toBe(15);

      // Sum of evaluated + short-circuited + aborted = 15
      expect(
        result.steps_evaluated + result.steps_short_circuited + result.steps_aborted,
      ).toBe(15);

      // Verdict fields
      for (const v of result.verdicts) {
        expect(v).toHaveProperty("step");
        expect(v).toHaveProperty("name");
        expect(v).toHaveProperty("mode");
        expect(v).toHaveProperty("verdict");
        expect(v).toHaveProperty("verdict_reason");
        expect(v).toHaveProperty("duration_us");
        expect(v).toHaveProperty("timestamp");
        expect(typeof v.step).toBe("number");
        expect(typeof v.duration_us).toBe("number");
      }
    });

    it("evaluated + short_circuited + aborted always equals 15", () => {
      // Test with hard violation at step 2
      const ctx = makeContext();
      const steps = make15Steps({
        2: () => makeFailVerdict(2, "ring_capability", StepActivationMode.ALWAYS),
      });
      const profile = getStepActivation("strict");

      const result = runEvaluationChain(ctx, steps, profile);

      expect(
        result.steps_evaluated + result.steps_short_circuited + result.steps_aborted,
      ).toBe(15);
      expect(result.steps_aborted).toBeGreaterThan(0);
    });
  });
});
