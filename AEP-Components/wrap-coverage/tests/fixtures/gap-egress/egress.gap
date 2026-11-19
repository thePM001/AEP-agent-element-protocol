# CAW egress policies of the Rust CAW under the wrap alpha: named routes, catch-all
# routes, an address route and a policy that lets unmatched destinations pass.
address:
  domain: fixture.wrap-coverage
  id: egress.v1

pattern: |
  The routes out of the sandbox of the fixture profiles.

metadata:
  version: "1.0.0"
  wrap: alpha
  agent_permission:
    - agent_id: coding-agent
      action: compile
---
kind: aep.caw.egress_policy
name: named
unmatched: deny
routes:
  - name: docs-api
    scheme: https
    host: docs.example.com
    port: 443
    decision: allow
  - name: below-example
    scheme: https
    host: "*.example.com"
    port: 443
    decision: allow
  - name: model-gateway
    scheme: https
    host: "${AEP_MODEL_GATEWAY_HOST}"
    port: 443
    decision: allow
  - name: deny-rest
    scheme: https
    host: "*"
    port: 443
    decision: deny
---
kind: aep.caw.egress_policy
name: open
unmatched: deny
routes:
  - name: any-host
    scheme: https
    host: "*"
    port: 443
    decision: allow
  - name: every-com-name
    scheme: http
    host: "*.com"
    port: 80
    decision: allow
  - name: an-address
    scheme: https
    host: 10.0.0.1
    port: 443
    decision: allow
---
kind: aep.caw.egress_policy
name: loose
unmatched: allow
routes:
  - name: docs-api
    scheme: https
    host: docs.example.com
    port: 443
    decision: allow
