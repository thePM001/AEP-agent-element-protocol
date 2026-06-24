address:
  domain: com.nla.policy
  id: chunk-hash-verification.v1
pattern:
  guard: deployment of JavaScript or CSS chunks to Cloudflare CDN
  input:
    type: object
    schema: deployment_manifest
  output:
    type: object
    schema: verification_report
  constraints:
    - chunk_hash_must_change_on_source_change
    - no_dev_server_immutable_hashes
    - build_must_succeed_before_deploy
    - no_immutable_cache_without_content_hash
    - post_deploy_interactivity_check
  validators:
    - hash_change_validator
    - build_success_validator
    - cache_control_validator
    - interactivity_validator
action:
  type: pipeline
  steps:
    - verify_chunk_hashes_changed
    - run_npx_next_build
    - fix_errors_if_build_fails
    - deploy_to_cloudflare
    - verify_interactivity_incognito
weight: 0.95
composition:
  type: sequence
  steps:
    - address:
        domain: com.nla.policy
        id: chunk-hash-verification.v1
metadata:
  provenance: Created after Turbopack dev server served stale v2.6 chunk for 24+ hours despite source being v2.75, causing hydration revert on every load.
  version: 1.0.0
  stability: stable
  grade: 9
  aspect: procedural
  trust_ring: system
  tools:
    allowed:
      - npx
      - next
      - cloudflare
      - curl
      - node
    forbidden:
      - pnpm dev
      - turbopack
execution:
  retry:
    max_attempts: 3
    backoff: exponential
    backoff_base_ms: 5000
  timeout_ms: 600000
  on_exhaustion: escalate
