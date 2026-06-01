# AEP Reference Policy - Writing Conventions
# Part of the AEP 2.7 Reference Policy Lattice
# Gapc-validated, Apache 2.0

address:
  domain: aep.reference.writing
  id: writing-conventions.v1

pattern:
  guard: agent.output.type == 'text'
  input:
    type: object
    schema: text_output
  output:
    type: object
    schema: enforcement_result

action:
  type: pipeline
  steps:
    - check_em_dash
    - check_en_dash
    - check_double_hyphen
    - check_oxford_comma
    - check_text_brightness
  parameters:
    check_em_dash:
      forbidden: [U+2014, U+2015, U+2E3A, U+2E3B]
      replacement: " - "
      severity: hard
    check_en_dash:
      forbidden: [U+2013, U+2212]
      replacement: "-"
      severity: hard
    check_double_hyphen:
      pattern: " -- "
      replacement: " - "
      exempt: [css_custom_properties, code_decrement_operators, sql_comments]
      severity: hard
    check_oxford_comma:
      pattern: ", and |, or "
      severity: hard
    check_text_brightness:
      min_brightness: "#F0F0F0"
      severity: hard

weight: 1.0
composition:
  type: sequence
  steps: [check_em_dash, check_en_dash, check_double_hyphen, check_oxford_comma, check_text_brightness]

metadata:
  provenance: AEP Reference Policy Lattice
  version: 2.7.0
  stability: stable
  trust_ring: system
  covenants:
    - text: "Zero em-dashes (U+2014), en-dashes (U+2013), horizontal bars (U+2015), two-em dashes (U+2E3A), three-em dashes (U+2E3B) or minus signs used as dashes (U+2212). Zero box-drawing dash circumventions (U+2500, U+2501). Replace with ' - ' (space-hyphen-space)."
      severity: Hard
      id: em_dash_forbidden
    - text: "Zero double-hyphens used as word separators. Zero Oxford commas. Minimum text brightness #F0F0F0."
      severity: Hard
      id: writing_conventions
