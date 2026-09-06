// @PAD: gap-285-p10-policy-leftover-files-v1
// @GCDE: gaplune.policy.v1
// Leftover yaml and rego files sit beside live GAP reference docs and are not live Admit skins.

export const LEFTOVER_LIVE_ADMIT = false;
export const LEFTOVER_NAMING =
  "Leftover yaml and rego files sit beside live GAP reference docs and are not live Admit skins.";
export const COLLECT_ALL_ONLY_GAP =
  "Collect-all loads only GAP reference docs under AEP-Policy-System/reference.";
export const P6_POINTER = "Operators use the reference GAP files from GAP-285-P6.";

export const LEFTOVER_FILES = [
  "aep-builder.policy.yaml",
  "coding-agent.policy.yaml",
  "content-safety.policy.yaml",
  "covenant-only.policy.yaml",
  "full-governance.policy.yaml",
  "multi-agent.policy.yaml",
  "network-egress-no-smtp.policy.yaml",
  "readonly-auditor.policy.yaml",
  "strict-production.policy.yaml",
  "aep-memory-policy.rego",
  "aep-policy.rego",
];

export const P6_REFERENCE_GAPS = [
  "AEP-Policy-System/reference/writing.gap",
  "AEP-Policy-System/reference/security.gap",
  "AEP-Policy-System/reference/governance.gap",
  "AEP-Policy-System/reference/deployment.gap",
  "AEP-Policy-System/reference/network-egress-no-smtp.gap",
  "AEP-Policy-System/reference/hipaa.gap",
  "AEP-Policy-System/reference/gdpr.gap",
  "AEP-Policy-System/reference/eu-ai-act.gap",
  "AEP-Policy-System/reference/iso-42001.gap",
  "AEP-Policy-System/reference/nist-ai-rmf.gap",
  "AEP-Policy-System/reference/soc2-type2.gap",
];

export function leftoverSuffix(name) {
  return name.endsWith(".policy.yaml") || name.endsWith(".rego");
}

export function namesLeftoverNotAdmit(src) {
  const l = String(src).toLowerCase();
  return l.includes("leftover") && l.includes("not") && l.includes("live") && l.includes("admit");
}
