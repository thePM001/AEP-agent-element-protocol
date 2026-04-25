import { z } from "zod";

export const ExecutionRing = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
export type ExecutionRing = z.infer<typeof ExecutionRing>;

export const RingConfigSchema = z.object({
  default: ExecutionRing.optional().default(2),
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
});

export type RingConfig = z.infer<typeof RingConfigSchema>;

export interface RingCapabilities {
  canRead: boolean;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  canNetwork: boolean;
  canSpawnSubAgents: boolean;
  canModifyCore: boolean;
}
