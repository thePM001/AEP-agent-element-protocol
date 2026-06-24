address:
  domain: dev.aep.caw
  id: dev-multi-repo.v1

pattern: |
  Multi-repository development session with per-mount policy tiers.

action:
  type: structured
  schema: CawSandboxProfile
  structured_generation: true
  content: |
    Bind dev-multi-repo profile for cross-repo coding agents.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: user
  aspect: procedural

subprotocols:
  caw:
    validator: caw
    actions: [session_create, mount_bind, policy_compile]

types:
  CawSandboxProfile:
    format: json
    fields:
      profile_id: string
      mounts: array
---
kind: aep.caw.profile
profile_id: dev-multi-repo
name: dev-multi-repo
base_policy: dev-safe
enforcement_tier: shim
llm_proxy: true
compiled_runtime: false
mounts:
  - path: "${HOME}/projects/frontend"
    policy: workspace-rw
  - path: "${HOME}/projects/backend"
    policy: workspace-rw
  - path: "${HOME}/projects/shared-libs"
    policy: config-readonly