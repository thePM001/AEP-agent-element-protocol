address:
  domain: aep.multibasenode
  id: federation-smoke.v1

pattern: |
  AEP 2.9 multi-base-node federation smoke policy.
  Policy bundle Merkle sync and lattice-channel federation MUST use lattice-channel.v1.

action:
  type: pipeline
  steps:
    - "nodes.json schema v2 validate >> policy bundle merkle checkpoint >> lattice-channel federation smoke"

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: aep-agent-element-protocol
  version: 1.0.0
  stability: experimental
  agent_permission:
    - agent_id: coding-agent
      action: write
    - agent_id: coding-agent
      action: federate
  wrap: federation
  action_path_prefix: federation
  covenants:
    - "Cross-node federation MUST use lattice-channel.v1 not raw localhost bypass [hard]"
  scanners: [injection]
  budget:
    max_tokens: 5000
    max_cost: 0.0
  proof:
    sign: false

execution:
  retry:
    max_attempts: 1
    backoff: linear
