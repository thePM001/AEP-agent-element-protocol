// Lattice-policy.rego precompiled evaluator (dynaep.lattice package rules).
// Loads policy path at init; evaluates bridge-supplied fields per lattice-policy.rego.

import { existsSync, readFileSync } from "node:fs";

export interface LatticePolicyInput {
  action_path: string;
  trust_tier: number;
  category: string;
  payload: Record<string, unknown>;
  agent_id: string;
  satisfied_actions: string[];
  parents_of: string[];
  is_root: boolean;
  all_actions: string[];
  simultaneous_outputs?: number;
  event_rate?: number;
}

export interface LatticePolicyResult {
  deny: string[];
  warn: string[];
  escalate: string[];
  policy_loaded: boolean;
  policy_path: string | null;
}

const CRITICAL_ACTIONS = new Set(["market:trade:execute", "agent:email:send"]);
const OUTPUT_ACTIONS = new Set([
  "output:notify",
  "output:ui_mutation",
  "output:speech",
  "output:haptic",
]);

const FORBIDDEN_SEQUENCES: Array<[string, string]> = [
  ["system:shutdown", "agent:register"],
  ["system:shutdown", "agent:ready"],
  ["system:shutdown", "agent:propose_action"],
  ["agent:deregister", "agent:propose_action"],
  ["agent:deregister", "agent:interest:register"],
  ["market:trade:execute", "market:price:update"],
  ["agent:email:send", "email:incoming"],
];

function trustTierLow(t: number): boolean {
  return t >= 1 && t <= 2;
}

function trustTierMid(t: number): boolean {
  return t >= 3 && t <= 4;
}

function trustTierHigh(t: number): boolean {
  return t === 5;
}

/**
 * Precompiled lattice-policy.rego evaluation.
 */
export function evaluateLatticePolicy(input: LatticePolicyInput): LatticePolicyResult {
  const deny: string[] = [];
  const warn: string[] = [];
  const escalate: string[] = [];

  const allSet = new Set(input.all_actions);
  if (!allSet.has(input.action_path)) {
    deny.push(`Unknown action path: '${input.action_path}' - not found in lattice registry`);
  }

  if (trustTierLow(input.trust_tier)) {
    if (input.category !== "external_event" && input.category !== "system_event") {
      deny.push(
        `Trust tier ${input.trust_tier} denied: tier 1-2 agents may only handle external_event or system_event (got '${input.category}')`,
      );
    }
    if (input.category === "agent_action") {
      deny.push(
        `Trust tier ${input.trust_tier} denied: agent_action category requires trust tier >= 3`,
      );
    }
  }

  if (trustTierMid(input.trust_tier) && CRITICAL_ACTIONS.has(input.action_path)) {
    deny.push(
      `Trust tier ${input.trust_tier} denied: critical action '${input.action_path}' requires trust tier 5`,
    );
  }

  if (!input.is_root && input.parents_of.length > 0) {
    const anyParent = input.parents_of.some((p) => input.satisfied_actions.includes(p));
    if (!anyParent) {
      deny.push(
        `Partial-order violation: none of the parent actions for '${input.action_path}' have been satisfied (parents: ${input.parents_of.join(", ")})`,
      );
    }
  }

  for (const [parent, child] of FORBIDDEN_SEQUENCES) {
    if (input.satisfied_actions.includes(parent) && child === input.action_path) {
      deny.push(`Forbidden sequence: '${input.action_path}' must not follow '${parent}'`);
    }
  }

  const eventRate = input.event_rate ?? 0;
  if (input.category === "agent_action" && eventRate > 10) {
    deny.push(
      `Rate limit exceeded: agent '${input.agent_id}' at ${eventRate} events/sec for agent_action category (max: 10)`,
    );
  }

  const simultaneous = input.simultaneous_outputs ?? 0;
  if (OUTPUT_ACTIONS.has(input.action_path) && simultaneous > 3) {
    deny.push(
      `Cross-modality ceiling exceeded: ${simultaneous} simultaneous outputs active (max: 3) for action '${input.action_path}'`,
    );
  }

  if (input.category === "output" && input.trust_tier < 2) {
    deny.push(`Trust tier ${input.trust_tier} denied: output actions require trust tier >= 2`);
  }

  if (trustTierMid(input.trust_tier) && input.category === "agent_action") {
    if (Object.keys(input.payload).length === 0) {
      warn.push(
        `Trust tier ${input.trust_tier} agent_action has empty payload - recommend supplying action context`,
      );
    }
  }

  if (trustTierHigh(input.trust_tier) && CRITICAL_ACTIONS.has(input.action_path)) {
    const hasReview = input.satisfied_actions.some(
      (a) => a.includes("validate") || a.includes("review"),
    );
    if (!hasReview) {
      warn.push(
        `Critical action '${input.action_path}' executed by trust tier ${input.trust_tier} without any prior validation or review step in satisfied actions`,
      );
    }
  }

  return { deny, warn, escalate, policy_loaded: true, policy_path: null };
}

export class LatticePolicyEvaluator {
  private readonly policyPath: string | null;
  private loaded = false;

  constructor(policyPath?: string | null) {
    this.policyPath = policyPath ?? null;
    if (this.policyPath && existsSync(this.policyPath)) {
      readFileSync(this.policyPath, "utf8");
      this.loaded = true;
    }
  }

  isLoaded(): boolean {
    return this.loaded;
  }

  getPolicyPath(): string | null {
    return this.policyPath;
  }

  evaluate(input: LatticePolicyInput): LatticePolicyResult {
    const result = evaluateLatticePolicy(input);
    result.policy_loaded = this.loaded;
    result.policy_path = this.policyPath;
    return result;
  }
}