# An egress policy in a GAP file whose instruction document declares no wrap.
address:
  domain: fixture.wrap-coverage
  id: egress-no-wrap.v1

pattern: |
  A route outside every wrap.

metadata:
  version: "1.0.0"
---
kind: aep.caw.egress_policy
name: stray
unmatched: deny
routes:
  - name: docs-api
    scheme: https
    host: docs.example.com
    port: 443
    decision: allow
