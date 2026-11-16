address:
  domain: dev.aep.caw
  id: kernel-dock.v1

pattern: |
  The hub grant of the CAW kernel dock. Before every command the CAW seals one
  root:ping as caw-kernel-dock and Admit lets it through only on this grant.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep-caw-dock-acceptance"
  version: "1.0.0"
  stability: stable
  wrap: caw
  agent_permission:
    - agent_id: caw-kernel-dock
      action: root:ping
