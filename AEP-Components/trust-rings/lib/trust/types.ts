import { z } from "zod";

export const TrustTier = z.enum(["untrusted", "provisional", "standard", "trusted", "privileged"]);
export type TrustTier = z.infer<typeof TrustTier>;

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
});

export type TrustConfig = z.infer<typeof TrustConfigSchema>;

export interface TrustEvent {
  type: "reward" | "penalty" | "decay";
  reason: string;
  delta: number;
  scoreBefore: number;
  scoreAfter: number;
  timestamp: string;
}
