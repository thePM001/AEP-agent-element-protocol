address:
  domain: dev.aep.ede
  id: example-coding-agent-coding.v1

pattern: |
  Reference agent profile for enforced draft environments (AEP-Components/ede).
  The agent example-coding-agent changes the listed repositories only through aep-ede drafts:
  seed a clone, scan the change set, promote it as a pull request or a branch.
  Copy this file per agent. aep-ede profile init <agent-id> <owner/repo> creates one as well.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.9.ede"
  version: "1.0.0"
  stability: stable
  aspect: procedural
  agent_permission:
    - agent_id: example-coding-agent
      action: ede.seed
    - agent_id: example-coding-agent
      action: ede.scan
    - agent_id: example-coding-agent
      action: ede.promote
  ede_repos:
    - owner/repo
