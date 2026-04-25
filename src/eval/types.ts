// AEP 2.5 -- Eval-to-Guardrail Lifecycle Types
// Run evaluation datasets against the governance pipeline.
// Results identify failing patterns and suggest covenant rules or scanner patterns.

export interface EvalEntry {
  id: string;
  input: string;
  expectedOutcome: "pass" | "fail";
  category?: string;
  tags?: string[];
}

export interface EvalDataset {
  name: string;
  version: string;
  entries: EvalEntry[];
}

export interface ViolationSummary {
  rule: string;
  count: number;
  severity: string;
  category: string;
}

export interface SuggestedRule {
  type: "covenant" | "scanner";
  rule: string;
  confidence: number;
  basedOn: string;
}

export interface EvalReport {
  datasetName: string;
  total: number;
  passed: number;
  failed: number;
  falsePositives: number;
  falseNegatives: number;
  violations: ViolationSummary[];
  suggestedRules: SuggestedRule[];
  mlMetrics?: import("./metrics.js").MLMetricsReport;
}
