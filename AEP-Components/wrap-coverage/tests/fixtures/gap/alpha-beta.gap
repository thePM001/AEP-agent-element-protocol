# Two wraps in one multi-document GAP file plus a CAW profile that names no wrap.
address:
  domain: fixture.wrap-coverage
  id: alpha.v1

pattern: |
  agent-a may read docs. agent-b may take any action.

metadata:
  version: "1.0.0"
  wrap: alpha
  agent_permission:
    - agent_id: agent-a
      action: read:docs
    - agent_id: agent-b
      action: "*"
---
address:
  domain: fixture.wrap-coverage
  id: beta.v1

pattern: |
  Any agent may run tools.

metadata:
  version: "1.0.0"
  wrap: beta
  agent_permission:
    - agent_id: "*"
      action: tool:run
---
kind: aep.caw.profile
profile_id: fixture
name: fixture
