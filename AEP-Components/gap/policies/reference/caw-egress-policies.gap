address:
  domain: dev.aep.caw
  id: egress-policies.v1

pattern: |
  Named route lists for CAW sessions. A destination with no route is always denied.

action:
  type: structured
  schema: CawEgressPolicySet
  structured_generation: false
  content: |
    Materialize the route to the model gateway as the only way out of a sandbox.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  agent_permission:
    - agent_id: build-agent
      action: compile
    - agent_id: build-agent
      action: write
  wrap: caw
  action_path_prefix: caw
  aspect: objective

types:
  CawEgressPolicySet:
    format: json
    fields:
      records: array

extensions:
  aep:
    subprotocols:
      caw:
        validator: caw
        actions: [policy_compile]

---
kind: aep.caw.egress_policy
name: model-gateway
description: The one route to the declared model gateway
unmatched: deny
routes:
  - name: model-gateway
    scheme: https
    host: "${AEP_MODEL_GATEWAY_HOST}"
    port: 443
    decision: allow
