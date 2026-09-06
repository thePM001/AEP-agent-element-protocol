address:
  domain: dev.aep.coding
  id: semantic-impact-envelope.v1

pattern: |
  Computed blast radius must not exceed declared envelope without justification.

action:
  type: structured
  schema: SieeVerdict
  structured_generation: true
  content: |
    Compare BlastRadiusReport.impact against IntentDeclaration.envelope.
    deny when exceeded and no justification; gate when justification supplied.

weight: 1.0

composition:
  type: atomic

metadata:
  provenance: "aep.phase11.seed"
  version: "1.0.0"
  stability: stable
  agent_may:
    - agent_id: grok-build
      action: write
    - agent_id: grok-build
      action: siee
  wrap: coding
  action_path_prefix: coding
  fscale:
    required.0.alias: nla-policy-scan
    required.0.id: FS.0.128.172
    required.1.alias: nla-lattice-api-route
    required.1.id: FS.0.128.22
  aspect: objective
  covenants:
    - "blast radius must be computed before any file write [hard]"
    - "envelope breach requires explicit justification [hard]"

subprotocols:
  coding-governance:
    validator: coding-governance
    actions: [siee_check]

types:
  SieeVerdict:
    format: json
    fields:
      verdict:
        type: enum
        values: [allow, gate, deny]
      within_envelope: boolean
      errors: array