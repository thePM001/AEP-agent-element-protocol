# AEP Reference Policy - Security
# Part of the AEP 2.75 Reference Policy Lattice
# Gapc-validated, Apache 2.0

address:
  domain: aep.reference.security
  id: security-baseline.v1

pattern:
  guard: agent.action in ['file_write', 'network_connect', 'code_execute', 'shell_command']
  input:
    type: object
    schema: agent_action
  output:
    type: object
    schema: enforcement_result

action:
  type: pipeline
  steps:
    - scan_pii
    - scan_secrets
    - scan_injection
    - check_network_bind
    - verify_unicode
  parameters:
    scan_pii:
      patterns: [email, phone, ssn, credit_card, api_key]
      severity: hard
    scan_secrets:
      patterns: [private_key, token, password, secret]
      severity: hard
    scan_injection:
      patterns: [sql, xss, command, path_traversal]
      severity: hard
    check_network_bind:
      allowed_bindings: [127.0.0.1, ::1]
      severity: hard
    verify_unicode:
      forbidden: [U+2014, U+2013, U+202E, U+200B]
      severity: hard

weight: 1.0
composition:
  type: sequence
  steps: [scan_pii, scan_secrets, scan_injection, check_network_bind, verify_unicode]

metadata:
  provenance: AEP Reference Policy Lattice
  version: 2.75.0
  stability: stable
  trust_ring: system
  covenants:
    - text: "All agent outputs must be scanned for PII, secrets, injection patterns, unsafe network binds and forbidden unicode before release."
      severity: Hard
      id: security_baseline
