address:
  domain: dev.aep.ucb
  id: task-manifest.v1

pattern: |
  Governed per-agent task contract for UCB ingress and Base Node dock enforcement.

action:
  type: structured
  schema: TaskManifestV1
  structured_generation: true
  content: |
    Synthesize task-manifest-v1 with GAP-typed intent, trust tier and CAW profile binding.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  agent_may:
    - agent_id: grok-build
      action: write
    - agent_id: grok-build
      action: manifest
  wrap: ucb
  action_path_prefix: ucb
  fscale:
    required.0.alias: nla-policy-scan
    required.0.id: FS.0.128.172
    required.1.alias: nla-lattice-api-route
    required.1.id: FS.0.128.22
  aspect: procedural

subprotocols:
  ucb:
    validator: ucb
    actions: [manifest_synthesize, ingress_validate]

types:
  TaskManifestV1:
    format: json
    fields:
      manifest_version: string
      agent_id: string
      intent:
        type: object
        fields:
          summary: string
          allowed_operations: array
          caw_profile: string
          gap_address: string
      trust:
        type: object
        fields:
          tier: string
          max_trust_score: integer
---
kind: aep.task_manifest.template
schema: task-manifest-v1
defaults:
  trust_tier: standard
  max_trust_score: 700
  caw_profile: agent-sandbox
  gap_address: dev.aep.caw/agent-sandbox.v1
  allowed_operations:
    - lattice:cross
    - coding:propose