address:
  domain: dev.aep.coding
  id: propose-intent.v1

pattern: |
  Agent declares semantic intent and impact envelope before code changes.

action:
  type: structured
  schema: ProposeIntent
  structured_generation: true
  content: |
    Declare what you will change and the maximum blast radius you accept.
    Do not generate code until SIEE returns allow or gate.

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
      action: propose
  wrap: coding
  action_path_prefix: coding
  fscale:
    required.0.alias: nla-policy-scan
    required.0.id: FS.0.128.172
    required.1.alias: nla-lattice-api-route
    required.1.id: FS.0.128.22
  aspect: procedural
  subprotocols:
    coding-governance:
      validator: coding-governance
      actions: [propose, blast_radius]

types:
  ProposeIntent:
    format: json
    fields:
      statement: string
      envelope:
        type: object
        fields:
          max_files: integer
          max_lines: integer
          allowed_paths: array
          forbidden_paths: array
          semantic_tags: array