// AEP 2.5 -- Evaluation Chain Runner
// Orchestrates the 15-step evaluation chain with short-circuit support.

import {
  StepActivationMode,
  type StepActivationProfile,
  type StepVerdict,
  type ChainResult,
  type EvalContext,
} from "./types.js";
import { evaluatePrecondition } from "./preconditions.js";
import { DEFAULT_STEP_ACTIVATION_PROFILE } from "./defaults.js";

/**
 * Returns the microsecond duration since a given start time (from performance.now()).
 */
function durationUs(startMs: number): number {
  return Math.round((performance.now() - startMs) * 1000);
}

/**
 * Creates a not_applicable verdict for a short-circuited active-mode step.
 */
function createShortCircuitVerdict(
  step: number,
  name: string,
  precondition: string | undefined,
  startMs: number,
): StepVerdict {
  return {
    step,
    name,
    mode: StepActivationMode.ACTIVE,
    precondition,
    precondition_result: false,
    verdict: "pass",
    verdict_reason: "not_applicable",
    duration_us: durationUs(startMs),
    timestamp: new Date().toISOString(),
  };
}

/**
 * Creates a verdict for a step that was not evaluated due to early chain abort.
 */
function createAbortedVerdict(
  step: number,
  name: string,
  mode: StepActivationMode,
  precondition: string | undefined,
): StepVerdict {
  return {
    step,
    name,
    mode,
    precondition,
    verdict: "pass",
    verdict_reason: "chain_aborted_hard_violation",
    duration_us: 0,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Checks whether a verdict represents a hard violation that should abort the chain.
 */
export function isHardViolation(verdict: StepVerdict): boolean {
  return verdict.verdict === "fail";
}

/**
 * Counts verdicts by category.
 */
export function countEvaluated(verdicts: StepVerdict[]): number {
  return verdicts.filter(
    (v) =>
      v.verdict_reason !== "not_applicable" &&
      v.verdict_reason !== "chain_aborted_hard_violation",
  ).length;
}

export function countShortCircuited(verdicts: StepVerdict[]): number {
  return verdicts.filter((v) => v.verdict_reason === "not_applicable").length;
}

export function countAborted(verdicts: StepVerdict[]): number {
  return verdicts.filter(
    (v) => v.verdict_reason === "chain_aborted_hard_violation",
  ).length;
}

/**
 * A step executor function. Each step implements this interface.
 * Returns a StepVerdict with the step's outcome.
 */
export type StepExecutor = (ctx: EvalContext) => StepVerdict;

/**
 * An evaluation step definition.
 */
export interface EvalStep {
  step: number;
  name: string;
  execute: StepExecutor;
}

/**
 * Run the full 15-step evaluation chain.
 *
 * The chain always produces exactly 15 StepVerdict entries:
 * - "always" mode steps run their full logic on every evaluation.
 * - "active" mode steps check their precondition:
 *   - If force_all_preconditions is true (strict/audit): treat precondition as true.
 *   - If precondition is true: run full logic.
 *   - If precondition is false: short-circuit to PASS with verdict_reason "not_applicable".
 * - On hard violation early exit: remaining steps get "chain_aborted_hard_violation".
 */
export function runEvaluationChain(
  ctx: EvalContext,
  steps: EvalStep[],
  profile?: StepActivationProfile,
): ChainResult {
  const activationProfile = profile ?? DEFAULT_STEP_ACTIVATION_PROFILE;
  const verdicts: StepVerdict[] = [];
  let chainDecision: "allow" | "deny" | "gate" = "allow";
  let chainReasons: string[] = [];
  let chainActionId = "";
  let matchedCapability: unknown = undefined;
  let matchedGate: unknown = undefined;
  let matchedForbidden: unknown = undefined;
  let aborted = false;

  for (const step of steps) {
    if (aborted) {
      const activation = activationProfile.steps[step.step];
      verdicts.push(
        createAbortedVerdict(
          step.step,
          step.name,
          activation?.mode ?? StepActivationMode.ALWAYS,
          activation?.precondition,
        ),
      );
      continue;
    }

    const activation = activationProfile.steps[step.step];

    if (!activation || activation.mode === StepActivationMode.ALWAYS) {
      // Always-mode step: run full logic
      const verdict = step.execute(ctx);
      verdicts.push(verdict);

      if (isHardViolation(verdict)) {
        chainDecision = "deny";
        chainReasons = [verdict.verdict_reason];
        chainActionId = (verdict.details?.actionId as string) ?? chainActionId;
        matchedForbidden = verdict.details?.matchedForbidden ?? matchedForbidden;
        aborted = true;
      } else if (verdict.verdict === "gate_pending") {
        chainDecision = "gate";
        chainReasons = [verdict.verdict_reason];
        chainActionId = (verdict.details?.actionId as string) ?? chainActionId;
        matchedGate = verdict.details?.matchedGate ?? matchedGate;
        matchedCapability = verdict.details?.matchedCapability ?? matchedCapability;
        aborted = true;
      } else if (verdict.verdict === "pass") {
        matchedCapability = verdict.details?.matchedCapability ?? matchedCapability;
        chainActionId = (verdict.details?.actionId as string) ?? chainActionId;
      }
    } else {
      // Active-mode step: check precondition
      const startMs = performance.now();
      const preconditionMet =
        activationProfile.force_all_preconditions ||
        (activation.precondition
          ? evaluatePrecondition(activation.precondition, ctx)
          : true);

      if (preconditionMet) {
        const verdict = step.execute(ctx);
        verdict.precondition_result = true;
        verdicts.push(verdict);

        if (isHardViolation(verdict)) {
          chainDecision = "deny";
          chainReasons = [verdict.verdict_reason];
          chainActionId = (verdict.details?.actionId as string) ?? chainActionId;
          aborted = true;
        } else if (verdict.verdict === "gate_pending") {
          chainDecision = "gate";
          chainReasons = [verdict.verdict_reason];
          chainActionId = (verdict.details?.actionId as string) ?? chainActionId;
          matchedGate = verdict.details?.matchedGate ?? matchedGate;
          aborted = true;
        }
      } else {
        verdicts.push(
          createShortCircuitVerdict(
            step.step,
            step.name,
            activation.precondition,
            startMs,
          ),
        );
      }
    }
  }

  if (chainDecision === "allow") {
    chainReasons = ["Action permitted by policy."];
  }

  return {
    decision: chainDecision,
    actionId: chainActionId,
    reasons: chainReasons,
    verdicts,
    steps_total: 15,
    steps_evaluated: countEvaluated(verdicts),
    steps_short_circuited: countShortCircuited(verdicts),
    steps_aborted: countAborted(verdicts),
    matchedCapability,
    matchedGate,
    matchedForbidden,
  };
}
