address:
  domain: dev.aep.caw
  id: ede-draft.v1

pattern: |
  Session of a coding agent in the tree of one EDE draft. The agent builds and tests
  with a toolchain that is mounted read only. The sandbox has no network.

action:
  type: structured
  schema: CawSandboxProfile
  structured_generation: true
  content: |
    Bind the tree of one draft read write, mount the toolchain trees read only and open no route.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  agent_permission:
    - agent_id: coding-agent
      action: compile
    - agent_id: coding-agent
      action: write
  wrap: caw
  action_path_prefix: caw
  aspect: objective
  scanners: [secrets, injection]

types:
  CawSandboxProfile:
    format: json
    fields:
      profile_id: string
      compiled_runtime: boolean
      llm_proxy: boolean

extensions:
  aep:
    subprotocols:
      caw:
        validator: caw
        actions: [session_create, policy_compile]

---
kind: aep.caw.profile
profile_id: ede-draft
name: ede-draft
base_policy: default
enforcement_tier: gvisor
llm_proxy: false
compiled_runtime: true
toolset: rust-draft-tools
mounts:
  - path: "${PROJECT_ROOT}"
    policy: workspace-rw
