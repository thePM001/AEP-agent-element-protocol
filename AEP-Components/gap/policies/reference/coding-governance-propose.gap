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
  trust_ring: user
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