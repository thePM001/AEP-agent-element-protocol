// AEP 2.5 -- Evaluation Chain Module
// Exports the short-circuit pattern for the 15-step evaluation chain.

export {
  StepActivationMode,
  type StepActivationEntry,
  type StepActivationProfile,
  type StepVerdictDecision,
  type StepVerdict,
  type ChainResult,
  type EvalContext,
} from "./types.js";

export {
  DEFAULT_STEP_ACTIVATION_PROFILE,
  ALWAYS_MODE_STEPS,
  ACTIVE_MODE_STEPS,
} from "./defaults.js";

export {
  PRECONDITION_EVALUATORS,
  evaluatePrecondition,
} from "./preconditions.js";

export {
  runEvaluationChain,
  isHardViolation,
  countEvaluated,
  countShortCircuited,
  countAborted,
  type StepExecutor,
  type EvalStep,
} from "./runner.js";
