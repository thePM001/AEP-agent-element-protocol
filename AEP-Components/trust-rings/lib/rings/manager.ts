// @PAD: p0-v275-c2-rings-core-enforcement-v1
// @GCDE: document_sha256=p0-v275-c2-rings-canModifyCore
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
    const raw = config.default ?? 2;
    // SEC-29: reject out-of-range rings
    if (typeof raw !== "number" || !Number.isInteger(raw) || raw < 0 || raw > 3) {
      throw new Error(`Invalid ring: ${String(raw)} (must be integer 0..3)`);
    }
    this.ring = raw as ExecutionRing;
  }

  getRing(): ExecutionRing {
    return this.ring;
  }

  getCapabilities(): RingCapabilities {
    const caps = RING_CAPABILITIES[this.ring];
    if (!caps) throw new Error(`Invalid ring state: ${this.ring}`);
    return { ...caps };
  }

  checkCapability(action: string): { allowed: boolean; reason?: string } {
    const caps = RING_CAPABILITIES[this.ring];
    if (!caps) {
      return { allowed: false, reason: `Invalid ring state: ${this.ring}` };
    }
    const a = (action ?? "").toLowerCase();
    let classified = false;

    if (a.includes("delete") || a.includes("remove")) {
      classified = true;
      if (!caps.canDelete) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit delete operations.` };
      }
    }

    if (a.includes("create") || a.includes("write")) {
      classified = true;
      if (!caps.canCreate) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit create/write operations.` };
      }
    }

    if (a.includes("update") || a.includes("modify") || a.includes("edit")) {
      classified = true;
      if (!caps.canUpdate) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit update operations.` };
      }
    }

    if (a.includes("network") || a.includes("fetch") || a.includes("http")) {
      classified = true;
      if (!caps.canNetwork) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit network operations.` };
      }
    }

    if (a.includes("spawn") || a.includes("sub_agent") || a.includes("delegate")) {
      classified = true;
      if (!caps.canSpawnSubAgents) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit sub-agent spawning.` };
      }
    }

    // Core modifications only when canModifyCore (Ring 0).
    // C-2: previous condition had empty body + operator-precedence bug, allowing all rings.
    if (a.includes("core") || a === "aep:update_element") {
      classified = true;
      if (!caps.canModifyCore) {
        return {
          allowed: false,
          reason: `Ring ${this.ring} does not permit core modifications.`,
        };
      }
    }

    // Shell / command execution is high risk (command:run, shell:exec, etc.).
    if (
      a.includes("command") ||
      a.includes("shell") ||
      a.includes("exec") ||
      a === "run" ||
      a.startsWith("command:") ||
      a.startsWith("shell:")
    ) {
      classified = true;
      // Require create + network (rings 0-1 only have both); ring 2/3 fail closed.
      if (!caps.canCreate || !caps.canNetwork) {
        return {
          allowed: false,
          reason: `Ring ${this.ring} does not permit command/shell execution.`,
        };
      }
    }

    // Explicit read-only tools (ring 3 safe path).
    if (
      a.includes("read") ||
      a.includes("list") ||
      a.includes("get") ||
      a.includes("query") ||
      a.includes("inspect") ||
      a.includes("status") ||
      a.includes("health")
    ) {
      classified = true;
      if (!caps.canRead) {
        return { allowed: false, reason: `Ring ${this.ring} does not permit read operations.` };
      }
    }

    // CRITICAL: non-keyword / unclassified tools fail closed (was fail-open allow).
    if (!classified) {
      if (!caps.canModifyCore) {
        return {
          allowed: false,
          reason: `Ring ${this.ring} denies unclassified tool "${action}" (fail-closed).`,
        };
      }
    }

    return { allowed: true };
  }

  canPromoteTo(targetRing: ExecutionRing, currentTrustTier: TrustTier): { allowed: boolean; reason?: string } {
    if (targetRing >= this.ring) {
      return { allowed: false, reason: `Cannot promote to ring ${targetRing} from ring ${this.ring}. Target must be lower number.` };
    }

    const tierOrder: TrustTier[] = ["untrusted", "provisional", "standard", "trusted", "privileged"];

    // HIGH fail-closed: every elevation target has approval + min trust gates
    if (targetRing === 2) {
      const promo = this.config.promotion?.to_ring_2;
      if (promo?.require_approval !== false) {
        return { allowed: false, reason: "Promotion to Ring 2 requires operator approval." };
      }
      const minTier = (promo?.min_trust_tier as TrustTier) ?? "provisional";
      const currentIdx = tierOrder.indexOf(currentTrustTier);
      const requiredIdx = tierOrder.indexOf(minTier);
      if (currentIdx < 0 || requiredIdx < 0 || currentIdx < requiredIdx) {
        return {
          allowed: false,
          reason: `Trust tier "${currentTrustTier}" does not meet minimum "${minTier}" for Ring 2.`,
        };
      }
    }

    if (targetRing === 1) {
      const promo = this.config.promotion?.to_ring_1;
      if (promo?.require_approval !== false) {
        return { allowed: false, reason: "Promotion to Ring 1 requires operator approval." };
      }
      const minTier = (promo?.min_trust_tier as TrustTier) ?? "standard";
      const currentIdx = tierOrder.indexOf(currentTrustTier);
      const requiredIdx = tierOrder.indexOf(minTier);
      if (currentIdx < 0 || requiredIdx < 0 || currentIdx < requiredIdx) {
        return {
          allowed: false,
          reason: `Trust tier "${currentTrustTier}" does not meet minimum "${minTier}" for Ring 1.`,
        };
      }
    }

    if (targetRing === 0) {
      const promo = this.config.promotion?.to_ring_0;
      if (promo?.require_approval !== false) {
        return { allowed: false, reason: "Promotion to Ring 0 requires operator approval." };
      }
      // H-33: always enforce min trust for Ring 0 (default privileged)
      const minTier = (promo?.min_trust_tier as TrustTier) ?? "privileged";
      const currentIdx = tierOrder.indexOf(currentTrustTier);
      const requiredIdx = tierOrder.indexOf(minTier);
      if (currentIdx < 0 || requiredIdx < 0 || currentIdx < requiredIdx) {
        return {
          allowed: false,
          reason: `Trust tier "${currentTrustTier}" does not meet minimum "${minTier}" for Ring 0.`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Promote to a lower ring number (higher privilege).
   * HIGH: must pass canPromoteTo(target, trustTier) - no silent bypass.
   */
  promote(targetRing: ExecutionRing, currentTrustTier: TrustTier = "untrusted"): void {
    if (targetRing < 0 || targetRing > 3) throw new Error(`Invalid ring: ${targetRing}`);
    // H-32: promote cannot demote
    if (targetRing >= this.ring) {
      throw new Error(`promote(${targetRing}) denied from ring ${this.ring}; use demote for higher rings`);
    }
    const gate = this.canPromoteTo(targetRing, currentTrustTier);
    if (!gate.allowed) {
      throw new Error(gate.reason ?? `promote(${targetRing}) denied by canPromoteTo`);
    }
    this.ring = targetRing;
  }

  /**
   * Demote to a higher ring number (lower privilege).
   * HIGH: demote must not elevate (targetRing must be > current ring).
   */
  demote(targetRing: ExecutionRing): void {
    if (targetRing < 0 || targetRing > 3) throw new Error(`Invalid ring: ${targetRing}`);
    if (targetRing <= this.ring) {
      throw new Error(
        `demote(${targetRing}) denied from ring ${this.ring}; demote only allows higher ring numbers (lower privilege)`
      );
    }
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
