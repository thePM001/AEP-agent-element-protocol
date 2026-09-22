address:
  domain: dev.aep.display
  id: display-api-permissions.v1

pattern: |
  Grant the display API action family to the display agents so a granted
  frontend may ingest a named source, stage a named sector, request and project
  a named view and list the loaded display catalog over the display dock. The
  grant wall in the display component still binds each agent to one source and
  one sector pair.

action:
  type: reference
  content: |
    Bind display API action permissions for the packaged display client.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.display"
  version: "1.0.0"
  stability: stable
  agent_permission:
    - agent_id: display-client
      action: display-api:attach
    - agent_id: display-client
      action: display-api:source:ingest
    - agent_id: display-client
      action: display-api:sector:stage
    - agent_id: display-client
      action: display-api:view:request
    - agent_id: display-client
      action: display-api:view:project
    - agent_id: display-client
      action: display-api:catalog:list
    - agent_id: agent-a
      action: display-api:attach
    - agent_id: agent-a
      action: display-api:source:ingest
    - agent_id: agent-a
      action: display-api:sector:stage
    - agent_id: agent-a
      action: display-api:view:request
    - agent_id: agent-a
      action: display-api:view:project
    - agent_id: agent-a
      action: display-api:catalog:list
  wrap: display-api
  action_path_prefix: display
