// @PAD: /root/dynAEP/sdk/typescript/src/chain/types.ts
// ===========================================================================
// @dynaep/core - Chain Executor Types
// AEP v2.5 Section 3.3: 15-Step Evaluation Chain
//
// Defines the type system for decomposing the monolithic validation pipeline
// into independently executable, composable steps with parallel staging.
// ===========================================================================

/** Step execution mode per AEP v2.5 Section 3.3 */
export type StepMode = "always" | "active";

/** Verdict for a single step */
export type StepVerdict = "pass" | "reject";

/** Result of executing a single chain step */
export interface StepResult {
  /** Step index (0-14) */
  step: number;
  /** Human-readable step name */
  name: string;
  /** Whether this step always runs or short-circuits on precondition */
  mode: StepMode;
  /** Pass or reject verdict */
  verdict: StepVerdict;
  /** Reason for the verdict */
  verdict_reason: string;
  /** Execution duration in microseconds */
  duration_us: number;
  /** Bridge-authoritative ISO 8601 timestamp */
  timestamp: string;
  /** Present only on not-executed entries when a prior stage aborted */
  abort_reason?: string;
}

/** Complete result of the 15-step chain evaluation */
export interface ChainResult {
  /** Overall verdict: pass if all 15 steps pass, reject otherwise */
  verdict: StepVerdict;
  /** Step number that caused rejection, or null if all passed */
  rejection_step: number | null;
  /** Reason for rejection, or null if all passed */
  rejection_reason: string | null;
  /** Always contains exactly 15 entries (one per step, index-aligned) */
  ledger: StepResult[];
  /** Total wall-clock execution time in microseconds */
  total_duration_us: number;
}

/** Input to the chain executor */
export interface ChainInput {
  /** The AG-UI event being validated */
  event: Record<string, unknown>;
  /** Additional context (bridge state, session info, etc.) */
  context: Record<string, unknown>;
}

/** Shared context passed between stages (read-only within a stage) */
export interface StepContext {
  [key: string]: unknown;
}

/** Interface for a single step executor */
export interface StepExecutor {
  /** Step index (0-14) */
  readonly step: number;
  /** Human-readable step name */
  readonly name: string;
  /** Execution mode: "always" or "active" */
  readonly mode: StepMode;
  /**
   * Execute this step against the given input and inter-stage context.
   * Must not mutate the context object (context is frozen per-stage).
   * Must not throw for expected rejections (return reject verdict instead).
   * Unexpected exceptions are caught by the chain executor and treated
   * as hard rejections.
   */
  execute(input: ChainInput, context: StepContext): Promise<StepResult>;
}

/** Interface for chain executors (parallel or sequential) */
export interface ChainExecutor {
  execute(input: ChainInput): Promise<ChainResult>;
}

/** Chain execution configuration */
export interface ChainExecutionConfig {
  /** "parallel" uses 5-stage concurrent execution, "sequential" preserves legacy order */
  mode: "parallel" | "sequential";
}

/** Total number of steps in the AEP v2.5 evaluation chain */
export const CHAIN_STEP_COUNT = 15;

/**
 * AEP v2.5 Section 3.3 step definitions.
 * 8 "always" steps never short-circuit; 7 "active" steps short-circuit
 * when their precondition is false.
 */
export const STEP_DEFINITIONS: ReadonlyArray<{
  readonly name: string;
  readonly mode: StepMode;
}> = [
  { name: "config_lookup", mode: "always" },     // 0
  { name: "session_check", mode: "always" },      // 1
  { name: "ring_check", mode: "always" },         // 2
  { name: "counter_check", mode: "always" },      // 3
  { name: "rate_limit", mode: "always" },         // 4
  { name: "intent_drift", mode: "active" },       // 5  - reads Step 1 session
  { name: "escalation_check", mode: "active" },   // 6  - reads Step 2 ring
  { name: "covenant_check", mode: "always" },     // 7
  { name: "rego_policy", mode: "always" },        // 8
  { name: "capability_trust", mode: "always" },   // 9
  { name: "scope_boundary", mode: "active" },     // 10
  { name: "mutation_guard", mode: "active" },     // 11
  { name: "temporal_fence", mode: "active" },     // 12
  { name: "knowledge_check", mode: "active" },    // 13 - reads Step 7 covenant
  { name: "content_scan", mode: "always" },       // 14
];

/**
 * Create a not-executed ledger entry for steps skipped due to early abort.
 * These entries count as PASS for ledger completeness (the ledger always has
 * 15 entries) but are clearly distinguishable from actual evaluations via
 * the verdict_reason and abort_reason fields.
 */
export function createNotExecutedEntry(
  step: number,
  name: string,
  mode: StepMode,
  abortReason: string,
): StepResult {
  return {
    step,
    name,
    mode,
    verdict: "pass",
    verdict_reason: "not_executed_early_abort",
    duration_us: 0,
    timestamp: new Date().toISOString(),
    abort_reason: abortReason,
  };
}
