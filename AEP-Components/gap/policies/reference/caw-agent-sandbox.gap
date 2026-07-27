address:
  domain: dev.aep.caw
  id: agent-sandbox.v1

pattern: |
  High-containment CAW session for untrusted agent code.
  Default deny with workspace scope, shim enforcement, lattice audit.

action:
  type: structured
  schema: CawSandboxProfile
  structured_generation: true
  content: |
    Activate agent-sandbox base policy with shim tier and LLM proxy enabled.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: sandbox
  aspect: procedural
  scanners: [secrets, injection, url]

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
      enforcement_tier:
        type: enum
        values: [shim, seccomp, landlock]
      llm_proxy: boolean
      compiled_runtime: boolean
---
kind: aep.caw.profile
profile_id: agent-sandbox
name: agent-sandbox
base_policy: agent-sandbox
enforcement_tier: shim
llm_proxy: true
compiled_runtime: false
mounts:
  - path: "${PROJECT_ROOT}"
    policy: workspace-rw
  - path: "/tmp"
    policy: workspace-rw