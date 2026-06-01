# AEP Reference Policy - Governance
# Part of the AEP 2.7 Reference Policy Lattice
# Gapc-validated, Apache 2.0

address:
  domain: aep.reference.governance
  id: governance-baseline.v1

pattern:
  guard: agent.operation in ['code_access', 'browser_operation', 'session_start', 'tool_call']
  input:
    type: object
    schema: governance_action
  output:
    type: object
    schema: enforcement_result

action:
  type: pipeline
  steps:
    - enforce_code_access
    - enforce_browser_sandbox
    - enforce_session_registration
    - enforce_violation_reporting
  parameters:
    enforce_code_access:
      allowed_methods: [gap_query, lattice_query, concept_search]
      blocked_methods: [grep, search_files, read_file_on_source]
      severity: hard
    enforce_browser_sandbox:
      sandbox_type: firecracker_microvm
      network_isolation: true
      severity: hard
    enforce_session_registration:
      required: true
      format: gap_document
      validator: gapc_290_rules
      severity: hard
    enforce_violation_reporting:
      scanners: [gray_text, em_dash, double_hyphen, oxford_comma, non_english, staging_url, circumvention, direct_code_write, missing_boot]
      report_endpoint: violation_registry
      severity: hard

weight: 1.0
composition:
  type: sequence
  steps: [enforce_code_access, enforce_browser_sandbox, enforce_session_registration, enforce_violation_reporting]

metadata:
  provenance: AEP Reference Policy Lattice
  version: 2.7.0
  stability: stable
  trust_ring: system
  covenants:
    - text: "All code lookups must go through GAP documents or lattice queries first. Never grep/search_files/read_file directly on source code."
      severity: Hard
      id: gap_first_code_access
    - text: "All browser operations must route through isolated sandbox (Firecracker microVM). Native browser tools are blocked."
      severity: Hard
      id: browser_sandbox
    - text: "Every agent must register its session before any work. Registration must be gapc-validated (290 GBNF rules)."
      severity: Hard
      id: session_registration
    - text: "Every agent must scan its output after every tool call and report all violations. Failure to report is itself a violation."
      severity: Hard
      id: violation_reporting
