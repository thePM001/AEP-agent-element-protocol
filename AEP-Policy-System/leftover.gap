@PAD: gap-285-p10-leftover-v1
@GCDE: gap.policy.v1
schema_id: gap.nla.leftover-not-admit.v1
format: gap
json_prohibited: true
id: leftover-not-admit
ticket: GAP-285-P10
live_admit: false
title: Leftover yaml and rego files are not live Admit skins.
note: Leftover yaml and rego files sit beside live GAP reference docs and are not live Admit skins. Collect-all loads only GAP reference docs under AEP-Policy-System/reference. Operators use the reference GAP files from GAP-285-P6.
leftover_files:
  - aep-builder.policy.yaml
  - coding-agent.policy.yaml
  - content-safety.policy.yaml
  - covenant-only.policy.yaml
  - full-governance.policy.yaml
  - multi-agent.policy.yaml
  - network-egress-no-smtp.policy.yaml
  - readonly-auditor.policy.yaml
  - strict-production.policy.yaml
  - aep-memory-policy.rego
  - aep-policy.rego
p6_reference_gaps:
  - AEP-Policy-System/reference/writing.gap
  - AEP-Policy-System/reference/security.gap
  - AEP-Policy-System/reference/governance.gap
  - AEP-Policy-System/reference/deployment.gap
  - AEP-Policy-System/reference/network-egress-no-smtp.gap
  - AEP-Policy-System/reference/hipaa.gap
  - AEP-Policy-System/reference/gdpr.gap
  - AEP-Policy-System/reference/eu-ai-act.gap
  - AEP-Policy-System/reference/iso-42001.gap
  - AEP-Policy-System/reference/nist-ai-rmf.gap
  - AEP-Policy-System/reference/soc2-type2.gap
