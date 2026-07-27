address:
  domain: dev.aep.caw
  id: coding-agent.v1

pattern: |
  Governed coding-agent session for any AEP-connected agent (Hermes, CCA, custom runners).
  Workspace read-write; agent config dirs read-only.

action:
  type: structured
  schema: CawSandboxProfile
  structured_generation: true
  content: |
    Bind coding-agent mount profile: full repo access, read-only agent configuration mounts.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: user
  aspect: procedural
  scanners: [secrets, injection]

subprotocols:
  caw:
    validator: caw
    actions: [session_create, mount_bind, policy_compile]

types:
  CawSandboxProfile:
    format: json
    fields:
      profile_id: string
      base_policy: string
      mounts: array
---
kind: aep.caw.profile
profile_id: coding-agent
name: coding-agent
base_policy: default
enforcement_tier: shim
llm_proxy: true
compiled_runtime: false
mounts:
  - path: "${PROJECT_ROOT}"
    policy: workspace-rw
  - path: "${AEP_AGENT_CONFIG_DIR}"
    policy: config-readonly
  - path: "${HOME}/.config/agent"
    policy: config-readonly
  - path: "${HOME}/.local/share/agent"
    policy: config-readonly