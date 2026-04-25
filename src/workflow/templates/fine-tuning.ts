// AEP 2.5 -- Governed Fine-Tuning Workflow Template
// Six-phase workflow wrapping any fine-tuning process with governance.
// Phases: DATA_PREPARATION, DATA_VALIDATION, TRAINING_CONFIG,
//         TRAINING_EXECUTION, EVALUATION, DEPLOYMENT.

import type { WorkflowDefinition, WorkflowPhase } from "../types.js";
import type { CompletionCriterion } from "../../decomposition/types.js";

const DATA_PREPARATION: WorkflowPhase = {
  name: "DATA_PREPARATION",
  description: "Collect, clean and format training data. Remove duplicates, handle missing values, verify licensing and provenance.",
  entryConditions: [],
  role: "data_engineer",
  ring: 2,
  exitCriteria: [
    { type: "no_violations", met: false } as CompletionCriterion,
    { type: "custom", value: "data_format_valid", met: false } as CompletionCriterion,
  ],
  maxRework: 3,
};

const DATA_VALIDATION: WorkflowPhase = {
  name: "DATA_VALIDATION",
  description: "Run data profiling scanner. Verify null rates, class balance, schema consistency and outlier bounds. Scan for PII and secrets.",
  entryConditions: [
    { field: "DATA_PREPARATION", operator: "eq", value: "completed" },
  ],
  role: "data_engineer",
  ring: 2,
  exitCriteria: [
    { type: "no_violations", met: false } as CompletionCriterion,
    { type: "custom", value: "profiler_pass", met: false } as CompletionCriterion,
    { type: "custom", value: "scanner_pass", met: false } as CompletionCriterion,
  ],
  maxRework: 2,
};

const TRAINING_CONFIG: WorkflowPhase = {
  name: "TRAINING_CONFIG",
  description: "Define hyperparameters, select base model, configure LoRA rank and learning rate. Verify cost budget before proceeding.",
  entryConditions: [
    { field: "DATA_VALIDATION", operator: "eq", value: "completed" },
  ],
  role: "ml_engineer",
  ring: 1,
  exitCriteria: [
    { type: "no_violations", met: false } as CompletionCriterion,
    { type: "custom", value: "config_reviewed", met: false } as CompletionCriterion,
  ],
  maxRework: 2,
};

const TRAINING_EXECUTION: WorkflowPhase = {
  name: "TRAINING_EXECUTION",
  description: "Execute fine-tuning run. Monitor loss curves, detect divergence. Enforce token and cost limits from session policy.",
  entryConditions: [
    { field: "TRAINING_CONFIG", operator: "eq", value: "completed" },
  ],
  role: "ml_engineer",
  ring: 1,
  exitCriteria: [
    { type: "no_violations", met: false } as CompletionCriterion,
    { type: "custom", value: "training_complete", met: false } as CompletionCriterion,
  ],
  maxRework: 1,
};

const EVALUATION: WorkflowPhase = {
  name: "EVALUATION",
  description: "Evaluate fine-tuned model using ML metrics. Compare against baseline. Verify accuracy, F1, perplexity meet thresholds.",
  entryConditions: [
    { field: "TRAINING_EXECUTION", operator: "eq", value: "completed" },
  ],
  role: "ml_engineer",
  ring: 1,
  exitCriteria: [
    { type: "no_violations", met: false } as CompletionCriterion,
    { type: "custom", value: "metrics_above_threshold", met: false } as CompletionCriterion,
    { type: "trust_above", value: 400, met: false } as CompletionCriterion,
  ],
  maxRework: 2,
};

const DEPLOYMENT: WorkflowPhase = {
  name: "DEPLOYMENT",
  description: "Deploy fine-tuned model to target environment. Verify inference endpoint, run smoke tests, enable monitoring.",
  entryConditions: [
    { field: "EVALUATION", operator: "eq", value: "completed" },
  ],
  role: "deployer",
  ring: 0,
  exitCriteria: [
    { type: "no_violations", met: false } as CompletionCriterion,
    { type: "custom", value: "deployment_verified", met: false } as CompletionCriterion,
    { type: "trust_above", value: 500, met: false } as CompletionCriterion,
  ],
  maxRework: 1,
};

export const FINE_TUNING_PHASES: WorkflowPhase[] = [
  DATA_PREPARATION,
  DATA_VALIDATION,
  TRAINING_CONFIG,
  TRAINING_EXECUTION,
  EVALUATION,
  DEPLOYMENT,
];

/**
 * Creates a governed fine-tuning workflow definition.
 * Wraps any fine-tuning process with AEP governance at every phase.
 */
export function createFineTuningWorkflow(
  onFail: "terminate" | "escalate" | "rollback" = "escalate"
): WorkflowDefinition {
  return {
    name: "fine-tuning",
    phases: FINE_TUNING_PHASES.map((p) => ({ ...p })),
    onFail,
  };
}
