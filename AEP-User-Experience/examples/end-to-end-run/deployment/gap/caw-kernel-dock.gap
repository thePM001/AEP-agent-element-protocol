address:
  domain: e2e.aep.caw
  id: e2e-kernel-dock.v1

pattern: |
  The kernel dock grant of the end to end run. The CAW server seals one
  root:ping as caw-kernel-dock before every exec and the exec starts only
  when the validation dock admits that ping.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep-end-to-end-run"
  version: "1.0.0"
  stability: stable
  wrap: caw
  agent_permission:
    - agent_id: caw-kernel-dock
      action: root:ping
---
kind: aep.caw.profile
profile_id: e2e-kernel-dock
name: e2e-kernel-dock
