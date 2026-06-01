# AEP Reference Policy - Deployment
# Part of the AEP 2.75 Reference Policy Lattice
# Gapc-validated, Apache 2.0

address:
  domain: aep.reference.deployment
  id: deployment-gate.v1

pattern:
  guard: agent.action in ['deploy', 'push', 'release', 'publish']
  input:
    type: object
    schema: deployment_action
  output:
    type: object
    schema: enforcement_result

action:
  type: pipeline
  steps:
    - require_human_approval
    - check_domain
    - verify_rollback_plan
    - validate_evidence_ledger
  parameters:
    require_human_approval:
      required: true
      timeout_minutes: 60
    check_domain:
      allowed_domains: []
      forbidden_patterns: [raw_ip, staging_in_production]
    verify_rollback_plan:
      required: true
    validate_evidence_ledger:
      min_chain_length: 1

weight: 1.0
composition:
  type: sequence
  steps: [require_human_approval, check_domain, verify_rollback_plan, validate_evidence_ledger]

metadata:
  provenance: AEP Reference Policy Lattice
  version: 2.75.0
  stability: stable
  trust_ring: system
  covenants:
    - text: "No deployment without explicit human approval. No silent builds. No unattended deploys. Semantic fringe cases: 'prepare'=build-only, 'could'=speculative."
      severity: Hard
      id: deployment_gate
    - text: "Deploy only to authorized domains. Never use raw IP addresses or staging URLs in production."
      severity: Hard
      id: domain_restriction
