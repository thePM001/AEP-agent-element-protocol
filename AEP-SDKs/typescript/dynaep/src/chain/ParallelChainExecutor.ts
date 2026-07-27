// @PAD: /root/dynAEP/sdk/typescript/src/chain/ParallelChainExecutor.ts
// ===========================================================================
// @dynaep/core - Parallel Chain Executor (OPT-004)
//
// Restructures the AEP v2.5 15-step evaluation chain into 5 parallel stages
// based on data dependency analysis (Section 3.3.5). Steps within a stage
// run concurrently via Promise.all(). Stages execute sequentially.
//
// Stage structure:
//   Stage A (concurrent): Steps 0, 1, 2, 3, 4
//     All independent reads (config lookups, counter checks). No writes.
//     → Abort if any rejects
//
//   Stage B (concurrent): Steps 5, 6, 7, 8, 9
//     Step 5 receives session state from Stage A Step 1
//     Step 6 receives ring from Stage A Step 2
//     → Abort if any rejects
//
//   Stage C (concurrent): Steps 10, 11, 12
//     All independent active-mode checks
//     → Abort if any rejects
//
//   Stage D (sequential): Step 13
//     Receives covenant result from Stage B Step 7
//     → Abort if rejects
//
//   Stage E (sequential): Step 14
//     Content scanners (uses OPT-003 UnifiedScanner if available)
//     → Final step
//
// Correctness invariant: The parallel executor MUST produce identical
// verdicts to the sequential executor for every possible input.
//
// Estimated improvement: 30-50% cold-path latency reduction.
// ===========================================================================

import type {
  ChainExecutor,
  ChainInput,
  ChainResult,
  StepExecutor,
  StepResult,
  StepContext,
} from "./types";
import { CHAIN_STEP_COUNT, createNotExecutedEntry } from "./types";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

/** Result of executing a single stage */
interface StageResult {
  rejected: boolean;
  rejectionStep: number | null;
  rejectionReason: string | null;
}

/** Immutable stage definition */
interface StageDefinition {
  readonly label: string;
  readonly stepNumbers: ReadonlyArray<number>;
}

// ---------------------------------------------------------------------------
// Stage topology (verified against AEP v2.5 Section 3.3.5)
// ---------------------------------------------------------------------------

const STAGES: ReadonlyArray<StageDefinition> = [
  { label: "A", stepNumbers: [0, 1, 2, 3, 4] },
  { label: "B", stepNumbers: [5, 6, 7, 8, 9] },
  { label: "C", stepNumbers: [10, 11, 12] },
  { label: "D", stepNumbers: [13] },
  { label: "E", stepNumbers: [14] },
];

// ---------------------------------------------------------------------------
// Executor
// ---------------------------------------------------------------------------

export class ParallelChainExecutor implements ChainExecutor {
  private readonly stepMap: ReadonlyMap<number, StepExecutor>;

  constructor(steps: StepExecutor[]) {
    if (steps.length !== CHAIN_STEP_COUNT) {
      throw new Error(
        `Chain requires exactly ${CHAIN_STEP_COUNT} steps, got ${steps.length}`,
      );
    }
    this.stepMap = new Map(steps.map((s) => [s.step, s]));
  }

  async execute(input: ChainInput): Promise<ChainResult> {
    const ledger: StepResult[] = new Array<StepResult>(CHAIN_STEP_COUNT);
    const context: StepContext = {};
    const chainStart = performance.now();

    for (let stageIdx = 0; stageIdx < STAGES.length; stageIdx++) {
      const stage = STAGES[stageIdx];

      const stageResult = await this.executeStage(
        stage,
        input,
        context,
        ledger,
      );

      if (stageResult.rejected) {
        // Fill all steps from subsequent stages with not-executed entries
        const abortReason = `stage_${stage.label}_rejection`;
        for (
          let futureIdx = stageIdx + 1;
          futureIdx < STAGES.length;
          futureIdx++
        ) {
          for (const stepNum of STAGES[futureIdx].stepNumbers) {
            const step = this.stepMap.get(stepNum);
            ledger[stepNum] = createNotExecutedEntry(
              stepNum,
              step?.name ?? `step_${stepNum}`,
              step?.mode ?? "always",
              abortReason,
            );
          }
        }

        return {
          verdict: "reject",
          rejection_step: stageResult.rejectionStep,
          rejection_reason: stageResult.rejectionReason,
          ledger,
          total_duration_us: (performance.now() - chainStart) * 1000,
        };
      }
    }

    return {
      verdict: "pass",
      rejection_step: null,
      rejection_reason: null,
      ledger,
      total_duration_us: (performance.now() - chainStart) * 1000,
    };
  }

  /**
   * Execute all steps in a stage concurrently via Promise.all().
   *
   * Key invariants:
   * 1. All steps within a stage MUST complete before any result is inspected.
   *    We wrap each step in try/catch so Promise.all() never short-circuits.
   * 2. Exceptions are caught per-step and treated as hard rejections.
   * 3. Context is snapshotted at stage entry (steps share read-only context).
   * 4. After all steps complete, results are written back to the shared context
   *    for use by subsequent stages.
   */
  private async executeStage(
    stage: StageDefinition,
    input: ChainInput,
    context: StepContext,
    ledger: StepResult[],
  ): Promise<StageResult> {
    // Snapshot context for this stage - steps within a stage get read-only
    // access to prior stage results but cannot see each other's results.
    const stageContext: StepContext = { ...context };

    const promises: Promise<StepResult>[] = stage.stepNumbers.map(
      async (stepNum) => {
        const step = this.stepMap.get(stepNum);
        if (!step) {
          throw new Error(
            `Missing step executor for step ${stepNum}`,
          );
        }

        try {
          return await step.execute(input, stageContext);
        } catch (error: unknown) {
          const errorMessage =
            error instanceof Error ? error.message : String(error);
          return {
            step: stepNum,
            name: step.name,
            mode: step.mode,
            verdict: "reject" as const,
            verdict_reason: `exception: ${errorMessage}`,
            duration_us: 0,
            timestamp: new Date().toISOString(),
          };
        }
      },
    );

    // Collect ALL results - do not short-circuit within a stage.
    // Each promise is individually try/caught so Promise.all() always resolves.
    const results = await Promise.all(promises);

    // Place results into ledger at correct indices and update shared context
    // for subsequent stages.
    for (const result of results) {
      ledger[result.step] = result;
      context[`step_${result.step}_result`] = result;
    }

    // Check for any rejection verdict. If multiple steps reject within the
    // same stage, report the lowest step number (deterministic ordering).
    const rejections = results
      .filter((r) => r.verdict === "reject")
      .sort((a, b) => a.step - b.step);

    if (rejections.length > 0) {
      return {
        rejected: true,
        rejectionStep: rejections[0].step,
        rejectionReason: rejections[0].verdict_reason,
      };
    }

    return {
      rejected: false,
      rejectionStep: null,
      rejectionReason: null,
    };
  }
}
