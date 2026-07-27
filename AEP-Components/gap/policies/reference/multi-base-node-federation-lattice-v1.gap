address:
  domain: aep.multibasenode
  id: federation-lattice.v1

pattern: |
  Multi-base-node federation transport MUST use lattice-channel.v1 frames.
  Cross-node registry, policy bundle sync, and optional ASIP handshakes MUST NOT bypass the lattice dock.

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
  trust_ring: user
  covenants:
    - "Cross-node IO MUST use lattice-channel.v1 not raw HTTP localhost bypass [hard]"
    - "Agentstream is optional; agentstream_topology applies only when deployed [hard]"
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