address:
  domain: dev.aep.cca
  id: implementation-plan.v1

pattern: |
  CCA deployment plan as a GAP-typed structured action.
  Materializes to implementation-plan-v1.json after lattice validation.

action:
  type: structured
  schema: ImplementationPlanV1
  structured_generation: true
  content: |
    Emit governed ImplementationPlan with GAP policy_overrides and CAW profile selection.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: system
  aspect: procedural

subprotocols:
  cca:
    validator: cca
    actions: [plan_generate, plan_execute]

types:
  ImplementationPlanV1:
    format: json
    fields:
      plan_version: string
      user_intent: string
      policy_overrides:
        type: object
        fields:
          gap:
            type: object
          caw_framework:
            type: object
      agent_runtime:
        type: object
---
kind: aep.implementation_plan.template
schema: implementation-plan-v1
require_gap: true
defaults:
  policy_overrides:
    gap:
      enabled: true
      meta_schema: AEP-Components/gap/schemas/gap-meta-schema-v1.2.json
    caw_framework:
      mount_profile: agent-sandbox
      gap_address: dev.aep.caw/agent-sandbox.v1