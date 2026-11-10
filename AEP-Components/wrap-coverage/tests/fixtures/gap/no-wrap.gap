# A GAP document with an empty wrap declares no wrap.
address:
  domain: fixture.wrap-coverage
  id: no-wrap.v1
pattern: |
  The grant below sits in no wrap.
metadata:
  version: "1.0.0"
  wrap: ""
  agent_permission:
    - agent_id: agent-c
      action: deploy:prod
