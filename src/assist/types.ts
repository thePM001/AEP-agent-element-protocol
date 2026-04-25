// AEP Assistant Types

export type AssistPreset = "strict" | "standard" | "relaxed" | "audit";
export type AssistAgent = "claude-code" | "cursor" | "codex";

export interface AssistSetupAnswers {
  agent: AssistAgent;
  preset: AssistPreset;
  multiAgent: boolean;
}

export interface AssistStatus {
  active: boolean;
  sessionId?: string;
  trustScore?: number;
  trustTier?: string;
  ring?: number;
  driftScore?: number;
  actionsAllowed: number;
  actionsDenied: number;
  actionsGated: number;
  ledgerEntries: number;
  chainValid: boolean;
}

export interface AssistIntent {
  type: "setup" | "status" | "settings" | "explain" | "emergency" | "report" | "proof" | "tasks" | "identity" | "covenant" | "unknown";
  detail?: string;
}

export interface PresetConfig {
  trust: {
    initial_score: number;
    erosion_rate: number;
  };
  ring: {
    default: number;
  };
  intent: {
    tracking: boolean;
    drift_threshold: number;
    warmup_actions: number;
    on_drift: "warn" | "gate" | "deny" | "kill";
  };
  gates: Array<{
    action: string;
    approval: "human" | "webhook";
    risk_level: string;
  }>;
  quantum: {
    enabled: boolean;
  };
  streaming: {
    enabled: boolean;
    abort_on_violation: boolean;
  };
  identity: {
    require_agent_identity: boolean;
  };
  decomposition: {
    enabled: boolean;
  };
  system: {
    max_actions_per_minute: number;
    max_concurrent_sessions: number;
  };
  session: {
    max_actions: number;
    auto_bundle: boolean;
    bundle_on_terminate: boolean;
  };
}
