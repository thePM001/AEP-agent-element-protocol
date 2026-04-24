import { z } from "zod";

export const CapabilitySchema = z.object({
  tool: z.string(),
  scope: z.record(z.array(z.string())).optional().default({}),
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
});

export const ForbiddenPatternSchema = z.object({
  pattern: z.string(),
  reason: z.string().optional(),
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
});

export const EvidenceConfigSchema = z.object({
  enabled: z.boolean().optional().default(true),
  dir: z.string().optional().default("./ledgers"),
});

export const RemediationConfigSchema = z.object({
  max_retries: z.number().nonnegative().optional().default(3),
  cooldown_ms: z.number().nonnegative().optional().default(1000),
});

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
}
