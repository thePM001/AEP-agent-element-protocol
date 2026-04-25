import type { FleetManager } from "./manager.js";
import type { AgentGateway } from "../gateway.js";
import type { CovenantSpec, CovenantRule } from "../covenant/types.js";
import type { SpawnResult } from "./types.js";

/**
 * Governs agent spawning in a fleet. Ensures child agents
 * inherit a subset of their parent's covenant and start
 * with reduced trust.
 */
export class SpawnGovernor {
  private fleetManager: FleetManager;
  private gateway: AgentGateway;
  private agentCovenants: Map<string, CovenantSpec> = new Map();
  private agentTrust: Map<string, number> = new Map();
  private agentRings: Map<string, number> = new Map();

  constructor(fleetManager: FleetManager, gateway: AgentGateway) {
    this.fleetManager = fleetManager;
    this.gateway = gateway;
  }

  /**
   * Register an agent's covenant so child validation can reference it.
   */
  setAgentCovenant(agentId: string, covenant: CovenantSpec): void {
    this.agentCovenants.set(agentId, covenant);
  }

  /**
   * Register an agent's trust and ring for inheritance.
   */
  setAgentState(agentId: string, trust: number, ring: number): void {
    this.agentTrust.set(agentId, trust);
    this.agentRings.set(agentId, ring);
  }

  /**
   * Validate whether a child agent may be spawned.
   *
   * 1. Check fleet is not at max_agents
   * 2. Load parent's covenant
   * 3. Verify child covenant is a subset of parent:
   *    - Child cannot permit anything parent forbids
   *    - Child cannot skip any parent require
   *    - Child ring must be >= parent ring (same or lower privilege)
   *    - Child trust starts at parent trust * 0.8
   * 4. On pass: register child in fleet
   * 5. On fail: reject with reason
   */
  validateSpawn(parentId: string, childCovenant: CovenantSpec): SpawnResult {
    const policy = this.fleetManager.getPolicy();
    const maxAgents = policy.max_agents ?? 10;
    const requireSubset = policy.require_parent_covenant_subset ?? true;

    // Step 1: capacity check
    if (this.fleetManager.getRegisteredCount() >= maxAgents) {
      return {
        allowed: false,
        reason: `Fleet at capacity: ${this.fleetManager.getRegisteredCount()}/${maxAgents}`,
        childTrust: 0,
        childRing: 3,
      };
    }

    const parentCovenant = this.agentCovenants.get(parentId);
    const parentTrust = this.agentTrust.get(parentId) ?? 500;
    const parentRing = this.agentRings.get(parentId) ?? 2;

    // Step 2+3: covenant subset validation
    if (requireSubset && parentCovenant) {
      // Child cannot permit anything parent forbids
      const parentForbids = parentCovenant.rules.filter(r => r.type === "forbid");
      for (const childRule of childCovenant.rules) {
        if (childRule.type === "permit") {
          for (const parentForbid of parentForbids) {
            if (childRule.action === parentForbid.action) {
              return {
                allowed: false,
                reason: `Child permits "${childRule.action}" which parent forbids.`,
                childTrust: 0,
                childRing: 3,
              };
            }
          }
        }
      }

      // Child cannot skip any parent require
      const parentRequires = parentCovenant.rules.filter(r => r.type === "require");
      for (const parentRequire of parentRequires) {
        const childHasRequire = childCovenant.rules.some(
          r => r.type === "require" && r.action === parentRequire.action
        );
        if (!childHasRequire) {
          return {
            allowed: false,
            reason: `Child missing required rule for "${parentRequire.action}" from parent.`,
            childTrust: 0,
            childRing: 3,
          };
        }
      }
    }

    // Calculate child trust and ring
    const childTrust = Math.floor(parentTrust * 0.8);
    const childRing = Math.max(parentRing, 2) as number; // same or lower privilege (higher number)

    // Step 4: register child in fleet
    const childAgentId = `child-${parentId}-${Date.now()}`;
    this.fleetManager.registerAgent(childAgentId, parentId);
    this.agentTrust.set(childAgentId, childTrust);
    this.agentRings.set(childAgentId, childRing);

    return {
      allowed: true,
      childTrust,
      childRing,
    };
  }
}
