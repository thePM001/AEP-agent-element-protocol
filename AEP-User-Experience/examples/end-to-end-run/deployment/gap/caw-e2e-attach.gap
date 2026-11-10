address:
  domain: e2e.aep.caw
  id: e2e-attach.v1

pattern: |
  The attach grant of the end to end run. The dock gateway ingests one fact as
  agent-a on ucb:ingest and Admit lets it through only on this grant.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep-end-to-end-run"
  version: "1.0.0"
  stability: stable
  wrap: caw
  agent_permission:
    - agent_id: agent-a
      action: ucb:ingest
---
kind: aep.caw.profile
profile_id: e2e-attach
name: e2e-attach
