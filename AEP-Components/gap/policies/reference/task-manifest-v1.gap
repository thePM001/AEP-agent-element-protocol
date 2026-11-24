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
  agent_permission:
    - agent_id: coding-agent
      action: write
    - agent_id: coding-agent
      action: manifest
  wrap: ucb
  action_path_prefix: ucb
  aspect: procedural

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

extensions:
  aep:
    subprotocols:
      ucb:
        validator: ucb
        actions: [manifest_synthesize, ingress_validate]

---
kind: aep.task_manifest.template
schema: task-manifest-v1
defaults:
  trust_tier: standard
  caw_profile: agent-sandbox
  gap_address: dev.aep.caw/agent-sandbox.v1
  allowed_operations:
    - lattice:cross
    - coding:propose
