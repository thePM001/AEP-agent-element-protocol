// AEP Assistant Presets
// Four governance presets: strict, standard, relaxed and audit

import type { PresetConfig, AssistPreset } from "./types.js";

const STRICT: PresetConfig = {
  trust: { initial_score: 200, erosion_rate: 10 },
  ring: { default: 2 },
  intent: { tracking: true, drift_threshold: 0.3, warmup_actions: 5, on_drift: "deny" },
  gates: [
    { action: "file:delete", approval: "human", risk_level: "high" },
    { action: "aep:delete_element", approval: "human", risk_level: "high" },
    { action: "command:run", approval: "human", risk_level: "medium" },
  ],
  quantum: { enabled: true },
  streaming: { enabled: true, abort_on_violation: true },
  identity: { require_agent_identity: true },
  decomposition: { enabled: true },
  system: { max_actions_per_minute: 100, max_concurrent_sessions: 5 },
  session: { max_actions: 50, auto_bundle: true, bundle_on_terminate: true },
};

const STANDARD: PresetConfig = {
  trust: { initial_score: 500, erosion_rate: 5 },
  ring: { default: 2 },
  intent: { tracking: true, drift_threshold: 0.5, warmup_actions: 10, on_drift: "warn" },
  gates: [
    { action: "file:delete", approval: "human", risk_level: "high" },
    { action: "aep:delete_element", approval: "webhook", risk_level: "high" },
  ],
  quantum: { enabled: false },
  streaming: { enabled: true, abort_on_violation: true },
  identity: { require_agent_identity: false },
  decomposition: { enabled: false },
  system: { max_actions_per_minute: 200, max_concurrent_sessions: 20 },
  session: { max_actions: 100, auto_bundle: false, bundle_on_terminate: false },
};

const RELAXED: PresetConfig = {
  trust: { initial_score: 600, erosion_rate: 2 },
  ring: { default: 1 },
  intent: { tracking: false, drift_threshold: 0.7, warmup_actions: 10, on_drift: "warn" },
  gates: [],
  quantum: { enabled: false },
  streaming: { enabled: false, abort_on_violation: false },
  identity: { require_agent_identity: false },
  decomposition: { enabled: false },
  system: { max_actions_per_minute: 500, max_concurrent_sessions: 50 },
  session: { max_actions: 500, auto_bundle: false, bundle_on_terminate: false },
};

const AUDIT: PresetConfig = {
  trust: { initial_score: 500, erosion_rate: 0 },
  ring: { default: 3 },
  intent: { tracking: true, drift_threshold: 0.3, warmup_actions: 5, on_drift: "deny" },
  gates: [],
  quantum: { enabled: true },
  streaming: { enabled: true, abort_on_violation: true },
  identity: { require_agent_identity: true },
  decomposition: { enabled: false },
  system: { max_actions_per_minute: 200, max_concurrent_sessions: 10 },
  session: { max_actions: 1000, auto_bundle: true, bundle_on_terminate: true },
};

const PRESETS: Record<AssistPreset, PresetConfig> = {
  strict: STRICT,
  standard: STANDARD,
  relaxed: RELAXED,
  audit: AUDIT,
};

export function getPreset(name: AssistPreset): PresetConfig {
  return PRESETS[name];
}

export function getPresetNames(): AssistPreset[] {
  return ["strict", "standard", "relaxed", "audit"];
}

export function generatePolicyYaml(preset: AssistPreset, name: string, multiAgent: boolean): string {
  const p = PRESETS[preset];
  const gates = p.gates.map(g =>
    `  - action: "${g.action}"\n    approval: ${g.approval}\n    risk_level: ${g.risk_level}`
  ).join("\n");

  let yaml = `version: "2.2"
name: "${name}"

capabilities:
  - tool: "file:read"
    scope:
      paths: ["src/**", "tests/**", "docs/**"]
  - tool: "file:write"
    scope:
      paths: ["src/**", "tests/**"]
  - tool: "command:run"
    scope:
      binaries: ["npm", "node", "tsc", "git"]
  - tool: "aep:create_element"
    scope:
      element_prefixes: ["CP", "PN", "WD", "IC"]
      z_bands: ["20-29", "10-19"]
  - tool: "aep:update_element"
    scope:
      element_prefixes: ["CP", "PN", "WD"]
      exclude_ids: ["SH-00001"]

limits:
  max_runtime_ms: 600000
  max_files_changed: 50
  max_aep_mutations: 100

${gates ? `gates:\n${gates}\n` : "gates: []\n"}
forbidden:
  - pattern: "\\\\.env"
    reason: "Environment files may contain secrets"
  - pattern: "rm -rf /"
    reason: "Destructive filesystem operation"
  - pattern: "password|secret|api_key"
    reason: "Potential credential exposure"

session:
  max_actions: ${p.session.max_actions}
  max_denials: 20
  rate_limit:
    max_per_minute: 30
  escalation:
    - after_actions: ${Math.floor(p.session.max_actions * 0.5)}
      require: human_checkin
    - after_denials: 10
      require: pause
  auto_bundle: ${p.session.auto_bundle}
  bundle_on_terminate: ${p.session.bundle_on_terminate}

trust:
  initial_score: ${p.trust.initial_score}
  decay_rate: ${p.trust.erosion_rate}

ring:
  default: ${p.ring.default}

intent:
  tracking: ${p.intent.tracking}
  drift_threshold: ${p.intent.drift_threshold}
  warmup_actions: ${p.intent.warmup_actions}
  on_drift: ${p.intent.on_drift}

system:
  max_actions_per_minute: ${p.system.max_actions_per_minute}
  max_concurrent_sessions: ${p.system.max_concurrent_sessions}

evidence:
  enabled: true
  dir: "./ledgers"
`;

  if (p.quantum.enabled) {
    yaml += `\nquantum:\n  enabled: true\n`;
  }

  if (p.streaming.enabled) {
    yaml += `\nstreaming:\n  enabled: true\n  abort_on_violation: ${p.streaming.abort_on_violation}\n`;
  }

  if (multiAgent) {
    yaml += `\nidentity:\n  require_agent_identity: true\n  trusted_public_keys: []\n`;
  } else if (p.identity.require_agent_identity) {
    yaml += `\nidentity:\n  require_agent_identity: true\n  trusted_public_keys: []\n`;
  }

  if (p.decomposition.enabled) {
    yaml += `\ndecomposition:\n  enabled: true\n  max_depth: 5\n  max_children: 10\n  scope_inheritance: intersection\n  completion_gate: true\n`;
  }

  return yaml;
}
