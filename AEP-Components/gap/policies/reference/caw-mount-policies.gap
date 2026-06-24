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
    Materialize workspace-rw, config-readonly, project-only, and minimal mount policies.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: system
  aspect: objective

subprotocols:
  caw:
    validator: caw
    actions: [policy_compile]

types:
  CawMountPolicySet:
    format: json
    fields:
      policies: array
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
  description: Limited read-write within project root only
  file_rules:
    - name: allow-project-rw
      paths: ["${MOUNT_PATH}", "${MOUNT_PATH}/**"]
      operations: ["read", "write", "create", "mkdir", "list", "stat"]
      decision: allow
    - name: soft-delete-project
      paths: ["${MOUNT_PATH}/**"]
      operations: ["delete", "rmdir"]
      decision: soft_delete
---
kind: aep.caw.mount_policy
name: minimal
policy:
  version: 1
  name: minimal
  description: Strict base policy for restricted agent sessions
  file_rules:
    - name: allow-tmp
      paths: ["/tmp/**"]
      operations: ["*"]
      decision: allow
    - name: deny-home-secrets
      paths: ["${HOME}/.ssh/**", "${HOME}/.gnupg/**", "${HOME}/.aws/**"]
      operations: ["*"]
      decision: deny
  command_rules:
    - name: deny-privilege-escalation
      commands: ["sudo", "su", "doas"]
      decision: deny