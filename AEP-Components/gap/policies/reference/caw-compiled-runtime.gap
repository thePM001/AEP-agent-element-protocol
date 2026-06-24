address:
  domain: dev.aep.caw
  id: compiled-runtime.v1

pattern: |
  Deterministic compiled-runtime session with LLM proxy disabled.
  For plan-once execute-many agent workflows.

action:
  type: structured
  schema: CawSandboxProfile
  structured_generation: true
  content: |
    Activate compiled-runtime mode: no runtime LLM proxy, strict agent-sandbox policy.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: system
  aspect: objective
  scanners: [secrets, injection]

subprotocols:
  caw:
    validator: caw
    actions: [session_create, policy_compile]

types:
  CawSandboxProfile:
    format: json
    fields:
      profile_id: string
      compiled_runtime: boolean
      llm_proxy: boolean
---
kind: aep.caw.profile
profile_id: compiled-runtime
name: compiled-runtime
base_policy: agent-sandbox
enforcement_tier: seccomp
llm_proxy: false
compiled_runtime: true
mounts:
  - path: "${PROJECT_ROOT}"
    policy: workspace-rw