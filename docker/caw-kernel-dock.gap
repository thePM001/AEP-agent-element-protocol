address:
  domain: dev.aep.caw
  id: kernel-dock.v1

pattern: |
  The hub grant of the CAW kernel dock in the Docker image. Before every command
  the CAW seals one root:ping as caw-kernel-dock and Admit lets it through only on
  this grant and the grant in the lattice. The entrypoint seeds this file into the
  hub of a fresh data folder and never overwrites a hub the operator placed.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep-docker-image"
  version: "1.0.0"
  stability: stable
  wrap: caw
  agent_permission:
    - agent_id: caw-kernel-dock
      action: root:ping
