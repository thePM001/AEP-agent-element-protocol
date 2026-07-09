address:
  domain: aep.multibasenode
  id: federation-capsule.v1

pattern: |
  Federation governed operations MAY append to a multi-base-node capsule trail when audit is enabled.
  Capsule prefix MUST be multi-base-node-sync and event types MUST include gap_sync or federated_search.
  Capsule trail is read-only audit.

action:
  type: pipeline
  steps:
    - "gap-sync or federated_search >> capsule append >> trail list verify"

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: aep-agent-element-protocol
  version: 1.0.0
  stability: experimental
  trust_ring: user
  covenants:
    - "capsule_prefix MUST be multi-base-node-sync [hard]"
    - "gap_sync and federated_search MUST emit trail entries when audit enabled [hard]"
    - "capsule_context MUST start with multi-base-node-sync- [hard]"
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