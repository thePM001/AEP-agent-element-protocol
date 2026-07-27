// @PAD: /root/dynAEP/sdk/typescript/src/chain/SequentialChainExecutor.ts
// ===========================================================================
// @dynaep/core - Sequential Chain Executor
// Executes all 15 steps in fixed order (Step 0 → Step 14).
// Preserves original AEP v2.5 behaviour for debugging and regression
// comparison against the parallel executor.
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

export class SequentialChainExecutor implements ChainExecutor {
  private readonly steps: ReadonlyArray<StepExecutor>;

  constructor(steps: StepExecutor[]) {
    if (steps.length !== CHAIN_STEP_COUNT) {
      throw new Error(
        `Chain requires exactly ${CHAIN_STEP_COUNT} steps, got ${steps.length}`,
      );
    }
    // Sort by step number to ensure correct execution order
    this.steps = [...steps].sort((a, b) => a.step - b.step);
  }

  async execute(input: ChainInput): Promise<ChainResult> {
    const ledger: StepResult[] = [];
    const context: StepContext = {};
    const chainStart = performance.now();

    for (const step of this.steps) {
      let result: StepResult;

      try {
        result = await step.execute(input, context);
      } catch (error: unknown) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        result = {
          step: step.step,
          name: step.name,
          mode: step.mode,
          verdict: "reject",
          verdict_reason: `exception: ${errorMessage}`,
          duration_us: 0,
          timestamp: new Date().toISOString(),
        };
      }

      ledger.push(result);
      context[`step_${step.step}_result`] = result;

      if (result.verdict === "reject") {
        // Fill remaining unexecuted steps with short-circuit entries
        for (let i = step.step + 1; i < CHAIN_STEP_COUNT; i++) {
          const remaining = this.steps.find((s) => s.step === i);
          ledger.push(
            createNotExecutedEntry(
              i,
              remaining?.name ?? `step_${i}`,
              remaining?.mode ?? "always",
              `step_${step.step}_rejection`,
            ),
          );
        }

        return {
          verdict: "reject",
          rejection_step: step.step,
          rejection_reason: result.verdict_reason,
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
}
