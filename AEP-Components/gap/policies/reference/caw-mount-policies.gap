address:
  domain: dev.aep.caw
  id: mount-policies.v1

pattern: |
  Per-mount CAW policy templates compiled from GAP for multi-mount sessions.

action:
  type: structured
  schema: CawMountPolicySet
  structured_generation: false
  content: |
    Materialize workspace-rw, config-readonly, project-only and minimal mount policies.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  agent_permission:
    - agent_id: build-agent
      action: compile
    - agent_id: build-agent
      action: write
  wrap: caw
  action_path_prefix: caw
  aspect: objective

types:
  CawMountPolicySet:
    format: json
    fields:
      policies: array

extensions:
  aep:
    subprotocols:
      caw:
        validator: caw
        actions: [policy_compile]

---
kind: aep.caw.mount_policy
name: workspace-rw
policy:
  version: 1
  name: workspace-rw
  description: Read-write access within mounted workspace paths
  file_rules:
    - name: allow-workspace-rw
      paths: ["${MOUNT_PATH}", "${MOUNT_PATH}/**"]
      operations: ["read", "write", "create", "mkdir", "delete", "rename", "list", "stat"]
      decision: allow
---
kind: aep.caw.mount_policy
name: config-readonly
policy:
  version: 1
  name: config-readonly
  description: Read-only access to agent configuration directories
  file_rules:
    - name: allow-config-read
      paths: ["${MOUNT_PATH}", "${MOUNT_PATH}/**"]
      operations: ["read", "list", "stat"]
      decision: allow
    - name: deny-config-write
      paths: ["${MOUNT_PATH}/**"]
      operations: ["write", "create", "delete", "rename", "mkdir"]
      decision: deny
---
kind: aep.caw.mount_policy
name: project-only
policy:
  version: 1
  name: project-only
  description: Read-write access within the project root only
  file_rules:
    - name: allow-project-rw
      paths: ["${MOUNT_PATH}", "${MOUNT_PATH}/**"]
      operations: ["read", "write", "create", "mkdir", "delete", "rename", "list", "stat"]
      decision: allow
---
kind: aep.caw.mount_policy
name: minimal
policy:
  version: 1
  name: minimal
  description: Strict base policy for restricted agent sessions
  file_rules:
    - name: deny-home-secrets
      paths: ["${HOME}/.ssh/**", "${HOME}/.gnupg/**", "${HOME}/.aws/**"]
      operations: ["*"]
      decision: deny
  command_rules:
    - name: deny-privilege-escalation
      commands: ["sudo", "su", "doas"]
      decision: deny
---
kind: aep.caw.mount_policy
name: default
policy:
  version: 1
  name: default
  description: Base policy of a governed coding agent session
  file_rules:
    - name: deny-home-secrets
      paths: ["${HOME}/.ssh/**", "${HOME}/.gnupg/**", "${HOME}/.aws/**"]
      operations: ["*"]
      decision: deny
  command_rules:
    - name: deny-privilege-escalation
      commands: ["sudo", "su", "doas"]
      decision: deny
---
kind: aep.caw.mount_policy
name: agent-sandbox
policy:
  version: 1
  name: agent-sandbox
  description: Base policy of a session that runs code nobody reviewed
  file_rules:
    - name: deny-home-secrets
      paths: ["${HOME}/.ssh/**", "${HOME}/.gnupg/**", "${HOME}/.aws/**"]
      operations: ["*"]
      decision: deny
  command_rules:
    - name: deny-privilege-escalation
      commands: ["sudo", "su", "doas"]
      decision: deny
---
kind: aep.caw.mount_policy
name: dev-safe
policy:
  version: 1
  name: dev-safe
  description: Base policy of a development session over several repositories
  file_rules:
    - name: deny-home-secrets
      paths: ["${HOME}/.ssh/**", "${HOME}/.gnupg/**", "${HOME}/.aws/**"]
      operations: ["*"]
      decision: deny
  command_rules:
    - name: deny-privilege-escalation
      commands: ["sudo", "su", "doas"]
      decision: deny
