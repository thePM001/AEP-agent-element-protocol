address:
  domain: aep.display.grants
  id: display-grants.v1
pattern: Unknown view source and sector DENY on miss. Empty grant list refuses. One grant names one agent one source and one sector. JSON body that skips the sealed frame is refused. Walls bind wrap display.
walls:
  - id: gap:display-api:unknown_view
    closed: true
    reason: Unknown view DENY on miss
  - id: gap:display-api:unknown_source
    closed: true
    reason: Unknown source DENY on miss
  - id: gap:display-api:unknown_sector
    closed: true
    reason: Unknown sector DENY on miss
  - id: gap:display-api:empty_grant
    closed: true
    reason: Empty grant list refuses
  - id: gap:display-api:grant
    closed: false
    reason: One grant names one agent one source and one sector
  - id: gap:display-api:sealed_frame
    closed: true
    reason: JSON body that skips the sealed frame is refused
grants:
  - agent_id: agent-a
    source_id: source.alpha
    sector_id: sector.one
  - agent_id: agent-a
    source_id: source.alpha
    sector_id: sector.two
  - agent_id: display-client
    source_id: source.alpha
    sector_id: sector.one
  - agent_id: display-client
    source_id: source.alpha
    sector_id: sector.two
action:
  type: reference
  content: Bind display grants. Unknown view source and sector DENY on miss.
weight: 1.0
composition:
  type: atomic
metadata:
  provenance: aep.display.grants
  version: 1.0.0
  stability: stable
  aspect: objective
  aep_version: 2.8.6
  wrap: display-api
