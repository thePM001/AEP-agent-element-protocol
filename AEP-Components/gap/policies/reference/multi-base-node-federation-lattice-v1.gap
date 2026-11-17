address:
  domain: aep.multibasenode
  id: federation-lattice.v1

pattern: |
  Multi-base-node federation transport MUST use lattice-channel.v1 frames.
  Cross-node registry and policy bundle sync MUST NOT bypass the lattice dock.

action:
  type: pipeline
  steps:
    - "registry health probe >> lattice-channel frame >> peer verify >> federation allow"

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
    - "Cross-node IO MUST use lattice-channel.v1 not raw HTTP localhost bypass [hard]"
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
