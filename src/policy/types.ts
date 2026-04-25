import { z } from "zod";

export const CapabilitySchema = z.object({
  tool: z.string(),
  scope: z.record(z.array(z.string())).optional().default({}),
  min_trust_tier: z.string().optional(),
});

export const LimitsSchema = z.object({
  max_runtime_ms: z.number().positive().optional(),
  max_files_changed: z.number().nonnegative().optional(),
  max_aep_mutations: z.number().nonnegative().optional(),
  max_cost_usd: z.number().nonnegative().optional(),
});

export const GateSchema = z.object({
  action: z.string(),
  approval: z.enum(["human", "webhook"]),
  risk_level: z.enum(["low", "medium", "high", "critical"]),
  webhook_url: z.string().optional(),
  timeout_ms: z.number().positive().optional().default(30000),
});

export const ForbiddenPatternSchema = z.object({
  pattern: z.string(),
  reason: z.string().optional(),
  severity: z.enum(["hard", "soft"]).optional().default("hard"),
});

export const EscalationRuleSchema = z.object({
  after_actions: z.number().positive().optional(),
  after_minutes: z.number().positive().optional(),
  after_denials: z.number().positive().optional(),
  require: z.enum(["human_checkin", "pause", "terminate"]),
});

export const SessionConfigSchema = z.object({
  max_actions: z.number().positive(),
  max_denials: z.number().positive().optional(),
  rate_limit: z
    .object({
      max_per_minute: z.number().positive(),
    })
    .optional(),
  escalation: z.array(EscalationRuleSchema).optional().default([]),
  auto_bundle: z.boolean().optional().default(false),
  bundle_on_terminate: z.boolean().optional().default(false),
});

export const EvidenceConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  dir: z.string().optional().default("./ledgers"),
});

export const RemediationConfigSchema = z.object({
  max_retries: z.number().nonnegative().optional().default(3),
  cooldown_ms: z.number().nonnegative().optional().default(1000),
});

export const TrustConfigSchema = z.object({
  initial_score: z.number().min(0).max(1000).optional().default(500),
  decay_rate: z.number().nonnegative().optional().default(5),
  penalties: z.object({
    policy_violation: z.number().nonnegative().optional().default(50),
    structural_violation: z.number().nonnegative().optional().default(30),
    rate_limit: z.number().nonnegative().optional().default(10),
    forbidden_match: z.number().nonnegative().optional().default(100),
    intent_drift: z.number().nonnegative().optional().default(75),
  }).optional().default({}),
  rewards: z.object({
    successful_action: z.number().nonnegative().optional().default(5),
    successful_rollback: z.number().nonnegative().optional().default(10),
  }).optional().default({}),
}).optional();

export const RingConfigSchema = z.object({
  default: z.number().min(0).max(3).optional().default(2),
  promotion: z.object({
    to_ring_1: z.object({
      min_trust_tier: z.string().optional(),
      require_approval: z.boolean().optional().default(false),
    }).optional().default({}),
    to_ring_0: z.object({
      min_trust_tier: z.string().optional(),
      require_approval: z.boolean().optional().default(true),
    }).optional().default({}),
  }).optional().default({}),
}).optional();

export const IntentConfigSchema = z.object({
  tracking: z.boolean().optional().default(false),
  drift_threshold: z.number().min(0).max(1).optional().default(0.5),
  warmup_actions: z.number().positive().optional().default(10),
  on_drift: z.enum(["warn", "gate", "deny", "kill"]).optional().default("warn"),
}).optional();

export const IdentityConfigSchema = z.object({
  require_agent_identity: z.boolean().optional().default(false),
  trusted_public_keys: z.array(z.string()).optional().default([]),
}).optional();

export const QuantumConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
}).optional();

export const TimestampConfigSchema = z.object({
  tsa_url: z.string().nullable().optional().default(null),
  batch_size: z.number().positive().optional().default(10),
  flush_interval_ms: z.number().positive().optional().default(5000),
}).optional();

export const StreamingConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  abort_on_violation: z.boolean().optional().default(true),
}).optional();

export const SystemConfigSchema = z.object({
  max_actions_per_minute: z.number().positive().optional().default(200),
  max_concurrent_sessions: z.number().positive().optional().default(20),
}).optional();

export const CompletionCriterionSchema = z.object({
  type: z.enum(["all_children_complete", "tests_pass", "no_violations", "trust_above", "drift_below", "custom"]),
  value: z.union([z.number(), z.string()]).optional(),
  met: z.boolean().optional().default(false),
});

export const DecompositionConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  max_depth: z.number().positive().optional().default(5),
  max_children: z.number().positive().optional().default(10),
  scope_inheritance: z.literal("intersection").optional().default("intersection"),
  completion_gate: z.boolean().optional().default(false),
  completion_criteria: z.array(CompletionCriterionSchema).optional().default([]),
}).optional();

export const RecoveryConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  max_attempts: z.number().positive().optional().default(2),
}).optional();

export const ScannerItemConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  severity: z.enum(["hard", "soft"]).optional().default("hard"),
});

export const ToxicityScannerConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  severity: z.enum(["hard", "soft"]).optional().default("soft"),
  custom_words: z.array(z.string()).optional().default([]),
});

export const URLScannerConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  severity: z.enum(["hard", "soft"]).optional().default("soft"),
  allowlist: z.array(z.string()).optional().default([]),
  blocklist: z.array(z.string()).optional().default([]),
});

export const ScannersConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  pii: ScannerItemConfigSchema.optional().default({}),
  injection: ScannerItemConfigSchema.optional().default({}),
  secrets: ScannerItemConfigSchema.optional().default({}),
  jailbreak: ScannerItemConfigSchema.optional().default({}),
  toxicity: ToxicityScannerConfigSchema.optional().default({}),
  urls: URLScannerConfigSchema.optional().default({}),
}).optional();

export const WorkflowConfigSchema = z.object({
  enabled: z.boolean().optional().default(false),
  definition: z.string().optional(),
  templates: z.record(z.array(z.string())).optional().default({}),
}).optional();

export const TelemetryConfigSchema = z.object({
  otel_enabled: z.boolean().optional().default(false),
  otel_endpoint: z.string().optional(),
  service_name: z.string().optional().default("aep-agent"),
}).optional();

export const TrackingConfigSchema = z.object({
  tokens: z.boolean().optional().default(false),
  cost_per_million_input: z.number().nonnegative().optional(),
  cost_per_million_output: z.number().nonnegative().optional(),
  currency: z.string().optional().default("USD"),
}).optional();

export const PolicySchema = z.object({
  version: z.string(),
  name: z.string(),
  capabilities: z.array(CapabilitySchema),
  limits: LimitsSchema,
  gates: z.array(GateSchema).optional().default([]),
  evidence: EvidenceConfigSchema.optional().default({}),
  forbidden: z.array(ForbiddenPatternSchema).optional().default([]),
  session: SessionConfigSchema,
  remediation: RemediationConfigSchema.optional(),
  trust: TrustConfigSchema.optional(),
  ring: RingConfigSchema.optional(),
  covenant: z.string().optional(),
  intent: IntentConfigSchema.optional(),
  identity: IdentityConfigSchema.optional(),
  quantum: QuantumConfigSchema.optional(),
  timestamp: TimestampConfigSchema.optional(),
  system: SystemConfigSchema.optional(),
  streaming: StreamingConfigSchema.optional(),
  decomposition: DecompositionConfigSchema.optional(),
  recovery: RecoveryConfigSchema,
  scanners: ScannersConfigSchema,
  workflow: WorkflowConfigSchema,
  telemetry: TelemetryConfigSchema,
  tracking: TrackingConfigSchema,
});

export type Capability = z.infer<typeof CapabilitySchema>;
export type Limits = z.infer<typeof LimitsSchema>;
export type Gate = z.infer<typeof GateSchema>;
export type ForbiddenPattern = z.infer<typeof ForbiddenPatternSchema>;
export type EscalationRule = z.infer<typeof EscalationRuleSchema>;
export type SessionConfig = z.infer<typeof SessionConfigSchema>;
export type EvidenceConfig = z.infer<typeof EvidenceConfigSchema>;
export type RemediationConfig = z.infer<typeof RemediationConfigSchema>;
export type Policy = z.infer<typeof PolicySchema>;
export type TrustPolicyConfig = z.infer<typeof TrustConfigSchema>;
export type RingPolicyConfig = z.infer<typeof RingConfigSchema>;
export type IntentPolicyConfig = z.infer<typeof IntentConfigSchema>;
export type IdentityPolicyConfig = z.infer<typeof IdentityConfigSchema>;
export type QuantumPolicyConfig = z.infer<typeof QuantumConfigSchema>;
export type TimestampPolicyConfig = z.infer<typeof TimestampConfigSchema>;
export type SystemPolicyConfig = z.infer<typeof SystemConfigSchema>;
export type StreamingPolicyConfig = z.infer<typeof StreamingConfigSchema>;
export type DecompositionPolicyConfig = z.infer<typeof DecompositionConfigSchema>;
export type RecoveryPolicyConfig = z.infer<typeof RecoveryConfigSchema>;
export type ScannersPolicyConfig = z.infer<typeof ScannersConfigSchema>;
export type WorkflowPolicyConfig = z.infer<typeof WorkflowConfigSchema>;
export type TelemetryPolicyConfig = z.infer<typeof TelemetryConfigSchema>;
export type TrackingPolicyConfig = z.infer<typeof TrackingConfigSchema>;

export interface AgentAction {
  tool: string;
  input: Record<string, unknown>;
  timestamp: Date;
}

export interface Verdict {
  decision: "allow" | "deny" | "gate";
  actionId: string;
  reasons: string[];
  matchedCapability?: Capability;
  matchedGate?: Gate;
  matchedForbidden?: ForbiddenPattern;
  trustDelta?: number;
}
