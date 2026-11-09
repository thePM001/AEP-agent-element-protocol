// AEP 2.9 - Evaluation chain step activation types.
// The live chain runs in the Rust crate (crate/src/lib.rs). These types describe
// the TypeScript step activation profile in defaults.ts that presets read.

export enum StepActivationMode {
  /** The step runs on every action. */
  ALWAYS = "always",
  /** The step runs only when its precondition holds (or force_all_preconditions is set). */
  ACTIVE = "active",
}

export interface StepActivationEntry {
  step: number;
  name: string;
  mode: StepActivationMode;
  precondition?: string;
}

export interface StepActivationProfile {
  steps: StepActivationEntry[];
  force_all_preconditions: boolean;
}
