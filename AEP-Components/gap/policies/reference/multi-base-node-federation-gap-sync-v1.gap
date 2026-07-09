address:
  domain: aep.multibasenode
  id: federation-gap-sync.v1

pattern: |
  Policy bundle sync between registered peers MUST use Merkle checkpoint verification.
  gap-sync from and to node_id MUST exist in nodes.json registry before sync proceeds.
  Bundle snapshot MUST be lattice-gated and reject plain HTTP registry bypass.

action:
  type: pipeline
  steps:
    - "registry lookup >> Merkle checkpoint >> gap-sync >> bundle snapshot verify"

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: aep-agent-element-protocol
  version: 1.0.0
  stability: experimental
  trust_ring: user
  covenants:
    - "gap-sync peers MUST be registered in nodes.json [hard]"
    - "Merkle checkpoint MUST pass before bundle apply [hard]"
    - "Policy bundle transport MUST use lattice-channel.v1 [hard]"
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