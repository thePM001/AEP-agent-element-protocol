address:
  domain: dev.aep.caw
  id: restricted.v1

pattern: |
  Minimal-access session for untrusted agents limited to a single project directory.

action:
  type: structured
  schema: CawSandboxProfile
  structured_generation: true
  content: |
    Activate restricted profile with minimal base policy and project-only mount.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.2.8.seed"
  version: "1.0.0"
  stability: stable
  trust_ring: sandbox
  aspect: procedural
  scanners: [secrets, injection, url, jailbreak]

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
---
kind: aep.caw.profile
profile_id: restricted
name: restricted
base_policy: minimal
enforcement_tier: seccomp
llm_proxy: true
compiled_runtime: false
mounts:
  - path: "${PROJECT_ROOT}"
    policy: project-only