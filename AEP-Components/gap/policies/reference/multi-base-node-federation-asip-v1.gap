address:
  domain: aep.multibasenode
  id: federation-asip.v1

pattern: |
  When optional Agentstream peers are deployed, federated search and capsule replication MUST use ASIP v0 wire.
  as-federated topology requires explicit agentstream_peers in nodes.json.
  Handshake MUST complete before stub replication or federated_search results return.

action:
  type: pipeline
  steps:
    - "ASIP handshake >> namespace bind >> federated_search >> stub count verify"

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: aep-agent-element-protocol
  version: 1.0.0
  stability: experimental
  agent_may:
    - agent_id: grok-build
      action: write
    - agent_id: grok-build
      action: federate
  wrap: federation
  action_path_prefix: federation
  fscale:
    required.0.alias: nla-policy-scan
    required.0.id: FS.0.128.172
    required.1.alias: nla-lattice-api-route
    required.1.id: FS.0.128.22
  covenants:
    - "federated_search MUST require completed ASIP handshake [hard]"
    - "as-federated MUST declare agentstream_peers in nodes.json [hard]"
    - "capsule_replicate MUST NOT run before handshake_ok [hard]"
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