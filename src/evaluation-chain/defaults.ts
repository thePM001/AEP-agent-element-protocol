// AEP 2.5 -- Default Step Activation Profile
// Defines the 15-step evaluation chain with activation modes and preconditions.

import { StepActivationMode, type StepActivationProfile } from "./types.js";

export const DEFAULT_STEP_ACTIVATION_PROFILE: StepActivationProfile = {
  steps: [
    {
      step: 0,
      name: "task_scope",
      mode: StepActivationMode.ACTIVE,
      precondition: "decomposition_enabled",
    },
    {
      step: 1,
      name: "session_state",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 2,
      name: "ring_capability",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 3,
      name: "system_rate_limit",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 4,
      name: "session_rate_limit",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 5,
      name: "intent_drift",
      mode: StepActivationMode.ACTIVE,
      precondition: "warmup_complete",
    },
    {
      step: 6,
      name: "escalation",
      mode: StepActivationMode.ACTIVE,
      precondition: "escalation_rules_defined",
    },
    {
      step: 7,
      name: "covenant_evaluation",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 8,
      name: "rego_check",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 9,
      name: "capability_trust",
      mode: StepActivationMode.ALWAYS,
    },
    {
      step: 10,
      name: "budget_limit",
      mode: StepActivationMode.ACTIVE,
      precondition: "budgets_configured",
    },
    {
      step: 11,
      name: "gate_check",
      mode: StepActivationMode.ACTIVE,
      precondition: "gates_configured_for_action_type",
    },
    {
      step: 12,
      name: "cross_agent_verification",
      mode: StepActivationMode.ACTIVE,
      precondition: "fleet_multi_agent",
    },
    {
      step: 13,
      name: "knowledge_validation",
      mode: StepActivationMode.ACTIVE,
      precondition: "knowledge_active_and_retrieval",
    },
    {
      step: 14,
      name: "content_scanners",
      mode: StepActivationMode.ALWAYS,
    },
  ],
  force_all_preconditions: false,
};

export const ALWAYS_MODE_STEPS = [1, 2, 3, 4, 7, 8, 9, 14];
export const ACTIVE_MODE_STEPS = [0, 5, 6, 10, 11, 12, 13];
