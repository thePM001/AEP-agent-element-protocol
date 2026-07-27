// @PAD: /root/dynAEP/sdk/typescript/tests/chain/parallel-executor.test.ts
// ===========================================================================
// Tests: OPT-004 Parallel Chain Executor
//
// Verifies:
//   1. Parallel produces identical verdicts to sequential (all-pass)
//   2. Early abort populates remaining steps with not_executed_early_abort
//   3. Ledger always contains exactly 15 entries
//   4. Stage B correctly receives Stage A context (session, ring)
//   5. Stage D correctly receives Stage B covenant result
//   6. Rejection at Step 3 (Stage A) skips Steps 5-14
//   7. Rejection at Step 8 (Stage B) skips Steps 10-14
//   8. All steps within a stage execute even if one fails
//   9. "sequential" mode produces identical results
//  10. Exception handling: thrown errors become hard rejections
//  11. Constructor validates exactly 15 steps
// ===========================================================================

import { describe, it, expect } from "vitest";
import type {
  StepExecutor,
  StepResult,
  ChainInput,
  StepContext,
  StepMode,
} from "../../src/chain/types";
import {
  CHAIN_STEP_COUNT,
  STEP_DEFINITIONS,
} from "../../src/chain/types";
import { ParallelChainExecutor } from "../../src/chain/ParallelChainExecutor";
import { SequentialChainExecutor } from "../../src/chain/SequentialChainExecutor";

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

/** Track which steps were executed and in what order */
const executionLog: number[] = [];

function resetLog(): void {
  executionLog.length = 0;
}

/** Create a step that passes, optionally reading from context */
function passStep(stepNum: number, delayMs: number = 0): StepExecutor {
  const def = STEP_DEFINITIONS[stepNum];
  return {
    step: stepNum,
    name: def.name,
    mode: def.mode as StepMode,
    async execute(
      _input: ChainInput,
      _context: StepContext,
    ): Promise<StepResult> {
      executionLog.push(stepNum);
      if (delayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs));
      }
      return {
        step: stepNum,
        name: def.name,
        mode: def.mode as StepMode,
        verdict: "pass",
        verdict_reason: "ok",
        duration_us: delayMs * 1000,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/** Create a step that rejects */
function rejectStep(stepNum: number, reason: string = "test_rejection"): StepExecutor {
  const def = STEP_DEFINITIONS[stepNum];
  return {
    step: stepNum,
    name: def.name,
    mode: def.mode as StepMode,
    async execute(
      _input: ChainInput,
      _context: StepContext,
    ): Promise<StepResult> {
      executionLog.push(stepNum);
      return {
        step: stepNum,
        name: def.name,
        mode: def.mode as StepMode,
        verdict: "reject",
        verdict_reason: reason,
        duration_us: 0,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/** Create a step that throws an exception */
function throwStep(stepNum: number, errorMsg: string = "test_error"): StepExecutor {
  const def = STEP_DEFINITIONS[stepNum];
  return {
    step: stepNum,
    name: def.name,
    mode: def.mode as StepMode,
    async execute(): Promise<StepResult> {
      executionLog.push(stepNum);
      throw new Error(errorMsg);
    },
  };
}

/** Create a step that reads from context and verifies a dependency */
function contextReadStep(
  stepNum: number,
  dependsOnStep: number,
  contextKeyToCheck: string,
): StepExecutor {
  const def = STEP_DEFINITIONS[stepNum];
  return {
    step: stepNum,
    name: def.name,
    mode: def.mode as StepMode,
    async execute(
      _input: ChainInput,
      context: StepContext,
    ): Promise<StepResult> {
      executionLog.push(stepNum);
      const depResult = context[`step_${dependsOnStep}_result`] as
        | StepResult
        | undefined;

      // Verify the dependency was resolved
      const hasContext = depResult !== undefined;

      return {
        step: stepNum,
        name: def.name,
        mode: def.mode as StepMode,
        verdict: hasContext ? "pass" : "reject",
        verdict_reason: hasContext
          ? `${contextKeyToCheck}_resolved`
          : `missing_${contextKeyToCheck}`,
        duration_us: 0,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

/** Create all 15 steps as pass steps */
function allPassSteps(delayMs: number = 0): StepExecutor[] {
  return Array.from({ length: CHAIN_STEP_COUNT }, (_, i) =>
    passStep(i, delayMs),
  );
}

const defaultInput: ChainInput = {
  event: { type: "CUSTOM", target_id: "CP-00001" },
  context: {},
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ParallelChainExecutor", () => {
  describe("constructor", () => {
    it("requires exactly 15 steps", () => {
      expect(() => new ParallelChainExecutor([])).toThrow(
        "Chain requires exactly 15 steps, got 0",
      );
      expect(
        () => new ParallelChainExecutor(allPassSteps().slice(0, 10)),
      ).toThrow("Chain requires exactly 15 steps, got 10");
    });

    it("accepts exactly 15 steps", () => {
      expect(() => new ParallelChainExecutor(allPassSteps())).not.toThrow();
    });
  });

  describe("all-pass execution", () => {
    it("returns pass verdict when all steps pass", async () => {
      resetLog();
      const executor = new ParallelChainExecutor(allPassSteps());
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("pass");
      expect(result.rejection_step).toBeNull();
      expect(result.rejection_reason).toBeNull();
    });

    it("ledger contains exactly 15 entries", async () => {
      const executor = new ParallelChainExecutor(allPassSteps());
      const result = await executor.execute(defaultInput);

      expect(result.ledger).toHaveLength(CHAIN_STEP_COUNT);
    });

    it("ledger entries are index-aligned (step N at index N)", async () => {
      const executor = new ParallelChainExecutor(allPassSteps());
      const result = await executor.execute(defaultInput);

      for (let i = 0; i < CHAIN_STEP_COUNT; i++) {
        expect(result.ledger[i].step).toBe(i);
        expect(result.ledger[i].name).toBe(STEP_DEFINITIONS[i].name);
      }
    });

    it("all steps execute exactly once", async () => {
      resetLog();
      const executor = new ParallelChainExecutor(allPassSteps());
      await executor.execute(defaultInput);

      const sorted = [...executionLog].sort((a, b) => a - b);
      expect(sorted).toEqual(
        Array.from({ length: CHAIN_STEP_COUNT }, (_, i) => i),
      );
    });
  });

  describe("identical verdicts: parallel vs sequential", () => {
    it("both produce pass for all-pass input", async () => {
      const par = new ParallelChainExecutor(allPassSteps());
      const seq = new SequentialChainExecutor(allPassSteps());

      const parResult = await par.execute(defaultInput);
      const seqResult = await seq.execute(defaultInput);

      expect(parResult.verdict).toBe(seqResult.verdict);
      expect(parResult.rejection_step).toBe(seqResult.rejection_step);
      expect(parResult.ledger.length).toBe(seqResult.ledger.length);
    });

    it("both produce same rejection for Step 3 reject", async () => {
      const steps = allPassSteps();
      steps[3] = rejectStep(3, "config_invalid");
      const par = new ParallelChainExecutor([...steps]);

      const seqSteps = allPassSteps();
      seqSteps[3] = rejectStep(3, "config_invalid");
      const seq = new SequentialChainExecutor(seqSteps);

      const parResult = await par.execute(defaultInput);
      const seqResult = await seq.execute(defaultInput);

      expect(parResult.verdict).toBe("reject");
      expect(seqResult.verdict).toBe("reject");
      expect(parResult.rejection_step).toBe(3);
      expect(seqResult.rejection_step).toBe(3);
      expect(parResult.rejection_reason).toBe(seqResult.rejection_reason);
    });

    it("both produce same rejection for Step 13 reject", async () => {
      const makeSteps = (): StepExecutor[] => {
        const s = allPassSteps();
        s[13] = rejectStep(13, "knowledge_missing");
        return s;
      };

      const par = new ParallelChainExecutor(makeSteps());
      const seq = new SequentialChainExecutor(makeSteps());

      const parResult = await par.execute(defaultInput);
      const seqResult = await seq.execute(defaultInput);

      expect(parResult.verdict).toBe(seqResult.verdict);
      expect(parResult.rejection_step).toBe(seqResult.rejection_step);
      expect(parResult.rejection_reason).toBe(seqResult.rejection_reason);
    });
  });

  describe("early abort and not-executed entries", () => {
    it("rejection at Step 3 (Stage A) skips Steps 5-14", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[3] = rejectStep(3);
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(3);
      expect(result.ledger).toHaveLength(CHAIN_STEP_COUNT);

      // Steps 0-4 should have been executed (Stage A runs all before checking)
      for (let i = 0; i <= 4; i++) {
        expect(result.ledger[i].verdict_reason).not.toBe(
          "not_executed_early_abort",
        );
      }

      // Steps 5-14 should be not-executed
      for (let i = 5; i < CHAIN_STEP_COUNT; i++) {
        expect(result.ledger[i].verdict).toBe("pass");
        expect(result.ledger[i].verdict_reason).toBe(
          "not_executed_early_abort",
        );
        expect(result.ledger[i].abort_reason).toBe("stage_A_rejection");
        expect(result.ledger[i].duration_us).toBe(0);
      }
    });

    it("rejection at Step 8 (Stage B) skips Steps 10-14", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[8] = rejectStep(8, "rego_deny");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(8);

      // Steps 0-9 should have been executed (Stages A + B)
      for (let i = 0; i <= 9; i++) {
        expect(result.ledger[i].verdict_reason).not.toBe(
          "not_executed_early_abort",
        );
      }

      // Steps 10-14 should be not-executed
      for (let i = 10; i < CHAIN_STEP_COUNT; i++) {
        expect(result.ledger[i].verdict).toBe("pass");
        expect(result.ledger[i].verdict_reason).toBe(
          "not_executed_early_abort",
        );
        expect(result.ledger[i].abort_reason).toBe("stage_B_rejection");
      }
    });

    it("rejection at Step 11 (Stage C) skips Steps 13-14", async () => {
      const steps = allPassSteps();
      steps[11] = rejectStep(11, "mutation_blocked");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(11);

      // Steps 13-14 should be not-executed
      for (const i of [13, 14]) {
        expect(result.ledger[i].verdict_reason).toBe(
          "not_executed_early_abort",
        );
        expect(result.ledger[i].abort_reason).toBe("stage_C_rejection");
      }
    });

    it("rejection at Step 13 (Stage D) skips Step 14", async () => {
      const steps = allPassSteps();
      steps[13] = rejectStep(13, "knowledge_missing");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(13);
      expect(result.ledger[14].verdict_reason).toBe(
        "not_executed_early_abort",
      );
      expect(result.ledger[14].abort_reason).toBe("stage_D_rejection");
    });

    it("rejection at Step 14 (Stage E) has no not-executed entries", async () => {
      const steps = allPassSteps();
      steps[14] = rejectStep(14, "content_violation");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(14);

      // All entries should be from actual execution
      for (let i = 0; i < CHAIN_STEP_COUNT; i++) {
        expect(result.ledger[i].verdict_reason).not.toBe(
          "not_executed_early_abort",
        );
      }
    });
  });

  describe("intra-stage concurrency: all steps in stage execute even if one fails", () => {
    it("Stage A: all 5 steps execute even when Step 2 rejects", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[2] = rejectStep(2, "ring_invalid");
      const executor = new ParallelChainExecutor(steps);
      await executor.execute(defaultInput);

      // All of steps 0-4 should have executed
      const stageAExecuted = executionLog.filter((s) => s >= 0 && s <= 4);
      expect(stageAExecuted.sort()).toEqual([0, 1, 2, 3, 4]);
    });

    it("Stage B: all 5 steps execute even when Step 6 rejects", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[6] = rejectStep(6, "escalation_denied");
      const executor = new ParallelChainExecutor(steps);
      await executor.execute(defaultInput);

      // All of steps 5-9 should have executed (Stage A + B)
      const stageBExecuted = executionLog.filter((s) => s >= 5 && s <= 9);
      expect(stageBExecuted.sort()).toEqual([5, 6, 7, 8, 9]);
    });

    it("Stage C: all 3 steps execute even when Step 10 rejects", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[10] = rejectStep(10, "scope_violation");
      const executor = new ParallelChainExecutor(steps);
      await executor.execute(defaultInput);

      const stageCExecuted = executionLog.filter((s) => s >= 10 && s <= 12);
      expect(stageCExecuted.sort()).toEqual([10, 11, 12]);
    });

    it("multiple rejections in same stage: reports lowest step number", async () => {
      const steps = allPassSteps();
      steps[1] = rejectStep(1, "session_expired");
      steps[3] = rejectStep(3, "counter_exceeded");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(1); // lowest step number
      expect(result.rejection_reason).toBe("session_expired");
    });
  });

  describe("inter-stage data dependencies", () => {
    it("Step 5 receives session state from Step 1 (Stage A → B)", async () => {
      const steps = allPassSteps();
      // Step 5 reads Step 1's result from context
      steps[5] = contextReadStep(5, 1, "session_state");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("pass");
      expect(result.ledger[5].verdict_reason).toBe("session_state_resolved");
    });

    it("Step 6 receives ring from Step 2 (Stage A → B)", async () => {
      const steps = allPassSteps();
      steps[6] = contextReadStep(6, 2, "ring");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("pass");
      expect(result.ledger[6].verdict_reason).toBe("ring_resolved");
    });

    it("Step 13 receives covenant from Step 7 (Stage B → D)", async () => {
      const steps = allPassSteps();
      steps[13] = contextReadStep(13, 7, "covenant");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("pass");
      expect(result.ledger[13].verdict_reason).toBe("covenant_resolved");
    });

    it("Step 5 does NOT see Step 6 result (same stage isolation)", async () => {
      const steps = allPassSteps();
      // Step 5 tries to read Step 6's result (should NOT be available)
      steps[5] = contextReadStep(5, 6, "escalation");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      // Step 5 should reject because Step 6 hasn't run yet (same stage)
      expect(result.ledger[5].verdict).toBe("reject");
      expect(result.ledger[5].verdict_reason).toBe("missing_escalation");
    });
  });

  describe("exception handling", () => {
    it("thrown error becomes hard rejection", async () => {
      const steps = allPassSteps();
      steps[4] = throwStep(4, "unexpected_failure");
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(4);
      expect(result.rejection_reason).toContain("exception:");
      expect(result.rejection_reason).toContain("unexpected_failure");
    });

    it("exception in one step does not prevent other stage steps from running", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[2] = throwStep(2, "ring_crash");
      const executor = new ParallelChainExecutor(steps);
      await executor.execute(defaultInput);

      // Steps 0, 1, 3, 4 should still have executed
      expect(executionLog).toContain(0);
      expect(executionLog).toContain(1);
      expect(executionLog).toContain(3);
      expect(executionLog).toContain(4);
    });
  });

  describe("ledger completeness invariant", () => {
    it("ledger has 15 entries on all-pass", async () => {
      const executor = new ParallelChainExecutor(allPassSteps());
      const result = await executor.execute(defaultInput);
      expect(result.ledger).toHaveLength(15);
    });

    it("ledger has 15 entries on Stage A rejection", async () => {
      const steps = allPassSteps();
      steps[0] = rejectStep(0);
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);
      expect(result.ledger).toHaveLength(15);
    });

    it("ledger has 15 entries on Stage E rejection", async () => {
      const steps = allPassSteps();
      steps[14] = rejectStep(14);
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);
      expect(result.ledger).toHaveLength(15);
    });

    it("ledger has 15 entries on exception", async () => {
      const steps = allPassSteps();
      steps[7] = throwStep(7);
      const executor = new ParallelChainExecutor(steps);
      const result = await executor.execute(defaultInput);
      expect(result.ledger).toHaveLength(15);
    });

    it("every ledger entry has correct step name from STEP_DEFINITIONS", async () => {
      const executor = new ParallelChainExecutor(allPassSteps());
      const result = await executor.execute(defaultInput);

      for (let i = 0; i < CHAIN_STEP_COUNT; i++) {
        expect(result.ledger[i].name).toBe(STEP_DEFINITIONS[i].name);
      }
    });
  });

  describe("timing", () => {
    it("total_duration_us is positive", async () => {
      const executor = new ParallelChainExecutor(allPassSteps());
      const result = await executor.execute(defaultInput);
      expect(result.total_duration_us).toBeGreaterThan(0);
    });
  });
});

describe("SequentialChainExecutor", () => {
  describe("constructor", () => {
    it("requires exactly 15 steps", () => {
      expect(() => new SequentialChainExecutor([])).toThrow(
        "Chain requires exactly 15 steps, got 0",
      );
    });
  });

  describe("execution order", () => {
    it("executes steps in order 0-14", async () => {
      resetLog();
      const executor = new SequentialChainExecutor(allPassSteps());
      await executor.execute(defaultInput);

      expect(executionLog).toEqual(
        Array.from({ length: CHAIN_STEP_COUNT }, (_, i) => i),
      );
    });

    it("stops at first rejection", async () => {
      resetLog();
      const steps = allPassSteps();
      steps[5] = rejectStep(5);
      const executor = new SequentialChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(executionLog).toEqual([0, 1, 2, 3, 4, 5]);
    });
  });

  describe("ledger completeness", () => {
    it("ledger always has 15 entries", async () => {
      const steps = allPassSteps();
      steps[3] = rejectStep(3);
      const executor = new SequentialChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.ledger).toHaveLength(15);
    });
  });

  describe("exception handling", () => {
    it("thrown error becomes hard rejection", async () => {
      const steps = allPassSteps();
      steps[7] = throwStep(7, "boom");
      const executor = new SequentialChainExecutor(steps);
      const result = await executor.execute(defaultInput);

      expect(result.verdict).toBe("reject");
      expect(result.rejection_step).toBe(7);
      expect(result.rejection_reason).toContain("exception: boom");
    });
  });
});

describe("Sequential vs Parallel equivalence", () => {
  const scenarios: Array<{
    label: string;
    rejectStep?: number;
  }> = [
    { label: "all pass" },
    { label: "reject at step 0", rejectStep: 0 },
    { label: "reject at step 1", rejectStep: 1 },
    { label: "reject at step 3", rejectStep: 3 },
    { label: "reject at step 5", rejectStep: 5 },
    { label: "reject at step 8", rejectStep: 8 },
    { label: "reject at step 10", rejectStep: 10 },
    { label: "reject at step 13", rejectStep: 13 },
    { label: "reject at step 14", rejectStep: 14 },
  ];

  for (const scenario of scenarios) {
    it(`produces identical verdict: ${scenario.label}`, async () => {
      const makeSteps = (): StepExecutor[] => {
        const s = allPassSteps();
        if (scenario.rejectStep !== undefined) {
          s[scenario.rejectStep] = rejectStep(
            scenario.rejectStep,
            `reject_${scenario.rejectStep}`,
          );
        }
        return s;
      };

      const par = new ParallelChainExecutor(makeSteps());
      const seq = new SequentialChainExecutor(makeSteps());

      const parResult = await par.execute(defaultInput);
      const seqResult = await seq.execute(defaultInput);

      expect(parResult.verdict).toBe(seqResult.verdict);
      expect(parResult.rejection_step).toBe(seqResult.rejection_step);
      expect(parResult.rejection_reason).toBe(seqResult.rejection_reason);
      expect(parResult.ledger.length).toBe(seqResult.ledger.length);

      // Verify identical verdict per step
      for (let i = 0; i < CHAIN_STEP_COUNT; i++) {
        expect(parResult.ledger[i].step).toBe(seqResult.ledger[i].step);
        expect(parResult.ledger[i].verdict).toBe(seqResult.ledger[i].verdict);
        expect(parResult.ledger[i].name).toBe(seqResult.ledger[i].name);
      }
    });
  }
});
