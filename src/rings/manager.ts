import type { ExecutionRing, RingConfig, RingCapabilities } from "./types.js";
import type { TrustTier } from "../trust/types.js";

const RING_CAPABILITIES: Record<number, RingCapabilities> = {
  0: { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canNetwork: true, canSpawnSubAgents: true, canModifyCore: true },
  1: { canRead: true, canCreate: true, canUpdate: true, canDelete: true, canNetwork: true, canSpawnSubAgents: false, canModifyCore: false },
  2: { canRead: true, canCreate: true, canUpdate: true, canDelete: false, canNetwork: false, canSpawnSubAgents: false, canModifyCore: false },
  3: { canRead: true, canCreate: false, canUpdate: false, canDelete: false, canNetwork: false, canSpawnSubAgents: false, canModifyCore: false },
};

export class RingManager {
  private ring: ExecutionRing;
  private config: RingConfig;

  constructor(config: RingConfig) {
    this.config = config;
    this.ring = (config.default ?? 2) as ExecutionRing;
  }

  getRing(): ExecutionRing {
    return this.ring;
  }

  getCapabilities(): RingCapabilities {
    return { ...RING_CAPABILITIES[this.ring] };
  }

  checkCapability(action: string): { allowed: boolean; reason?: string } {
    const caps = RING_CAPABILITIES[this.ring];

    if (action.includes("delete") || action.includes("remove")) {
      if (!caps.canDelete) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit delete operations.` };
      }
    }

    if (action.includes("create") || action.includes("write")) {
      if (!caps.canCreate) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit create/write operations.` };
      }
    }

    if (action.includes("update") || action.includes("modify") || action.includes("edit")) {
      if (!caps.canUpdate) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit update operations.` };
      }
    }

    if (action.includes("network") || action.includes("fetch") || action.includes("http")) {
      if (!caps.canNetwork) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit network operations.` };
      }
    }

    if (action.includes("spawn") || action.includes("sub_agent") || action.includes("delegate")) {
      if (!caps.canSpawnSubAgents) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit sub-agent spawning.` };
      }
    }

    if (action.includes("core") || action === "aep:update_element" && this.ring > 0) {
      // Core modifications only for Ring 0
    }

    return { allowed: true };
  }

  canPromoteTo(targetRing: ExecutionRing, currentTrustTier: TrustTier): { allowed: boolean; reason?: string } {
    if (targetRing >= this.ring) {
      return { allowed: false, reason: `Cannot promote to ring ${targetRing} from ring ${this.ring}. Target must be lower number.` };
    }

    const tierOrder: TrustTier[] = ["untrusted", "provisional", "standard", "trusted", "privileged"];

    if (targetRing === 1) {
      const promo = this.config.promotion?.to_ring_1;
      if (promo?.require_approval) {
        return { allowed: false, reason: "Promotion to Ring 1 requires operator approval." };
      }
      if (promo?.min_trust_tier) {
        const currentIdx = tierOrder.indexOf(currentTrustTier);
        const requiredIdx = tierOrder.indexOf(promo.min_trust_tier as TrustTier);
        if (currentIdx < requiredIdx) {
          return { allowed: false, reason: `Trust tier "${currentTrustTier}" does not meet minimum "${promo.min_trust_tier}" for Ring 1.` };
        }
      }
    }

    if (targetRing === 0) {
      const promo = this.config.promotion?.to_ring_0;
      if (promo?.require_approval !== false) {
        return { allowed: false, reason: "Promotion to Ring 0 requires operator approval." };
      }
      if (promo?.min_trust_tier) {
        const currentIdx = tierOrder.indexOf(currentTrustTier);
        const requiredIdx = tierOrder.indexOf(promo.min_trust_tier as TrustTier);
        if (currentIdx < requiredIdx) {
          return { allowed: false, reason: `Trust tier "${currentTrustTier}" does not meet minimum "${promo.min_trust_tier}" for Ring 0.` };
        }
      }
    }

    return { allowed: true };
  }

  promote(targetRing: ExecutionRing): void {
    if (targetRing < 0 || targetRing > 3) throw new Error(`Invalid ring: ${targetRing}`);
    this.ring = targetRing;
  }

  demote(targetRing: ExecutionRing): void {
    if (targetRing < 0 || targetRing > 3) throw new Error(`Invalid ring: ${targetRing}`);
    this.ring = targetRing;
  }

  demoteOnTrustDrop(currentTrustTier: TrustTier): boolean {
    const tierRingMap: Record<string, ExecutionRing> = {
      untrusted: 3,
      provisional: 3,
      standard: 2,
      trusted: 1,
      privileged: 0,
    };

    const maxRing = tierRingMap[currentTrustTier] ?? 3;
    if (this.ring < maxRing) {
      this.ring = maxRing;
      return true;
    }
    return false;
  }
}
