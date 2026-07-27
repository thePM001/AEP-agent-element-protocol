// Lattice-policy.rego live evaluator via OPA CLI, with precompiled TypeScript fallback.
// @PAD: aep28-lattice-opa-runtime-v1

import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

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
  policy_source?: "opa_rego" | "precompiled_ts";
  rego_file_present?: boolean;
  opa_error?: string;
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
 * Precompiled lattice-policy.rego evaluation (fallback / parity).
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

  return {
    deny,
    warn,
    escalate,
    policy_loaded: true,
    policy_path: null,
    policy_source: "precompiled_ts",
  };
}

function resolveOpaBin(): string {
  return process.env.AEP_OPA_BIN || process.env.OPA_BIN || "opa";
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x));
}

/**
 * Live OPA evaluation of lattice-policy.rego.
 * Queries data.dynaep.lattice.{deny_lattice,warn_lattice,escalate_lattice}.
 */
export function evaluateLatticePolicyWithOpa(
  policyPath: string,
  input: LatticePolicyInput,
): LatticePolicyResult {
  const bin = resolveOpaBin();
  const dir = mkdtempSync(join(tmpdir(), "aep-opa-"));
  const inputPath = join(dir, "input.json");
  try {
    writeFileSync(inputPath, JSON.stringify(input));
    const r = spawnSync(
      bin,
      ["eval", "-d", policyPath, "-i", inputPath, "data.dynaep.lattice", "--format", "json"],
      {
        encoding: "utf8",
        maxBuffer: 8 * 1024 * 1024,
        timeout: Number(process.env.AEP_OPA_TIMEOUT_MS ?? 5000),
      },
    );
    if (r.error) {
      throw new Error(`opa spawn failed: ${r.error.message}`);
    }
    if (r.status !== 0) {
      throw new Error(
        `opa eval exit ${r.status}: ${(r.stderr || r.stdout || "").slice(0, 800)}`,
      );
    }
    const parsed = JSON.parse(r.stdout || "{}") as {
      result?: Array<{ expressions?: Array<{ value?: unknown }> }>;
    };
    const value = parsed.result?.[0]?.expressions?.[0]?.value as
      | {
          deny_lattice?: unknown;
          warn_lattice?: unknown;
          escalate_lattice?: unknown;
        }
      | undefined;
    if (!value || typeof value !== "object") {
      throw new Error("opa eval returned empty result");
    }
    // OPA set results may be arrays or objects with numeric keys
    const toMsgs = (x: unknown): string[] => {
      if (Array.isArray(x)) return asStringArray(x);
      if (x && typeof x === "object") return Object.values(x as object).map(String);
      return [];
    };
    return {
      deny: toMsgs(value.deny_lattice),
      warn: toMsgs(value.warn_lattice),
      escalate: toMsgs(value.escalate_lattice),
      policy_loaded: true,
      policy_path: policyPath,
      policy_source: "opa_rego",
      rego_file_present: true,
    };
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

export class LatticePolicyEvaluator {
  private readonly policyPath: string | null;
  private regoFilePresent = false;
  private opaAvailable: boolean | null = null;
  private preferOpa: boolean;

  constructor(policyPath?: string | null) {
    this.policyPath = policyPath ?? null;
    // Prefer OPA when .rego path is set (default on). Opt out: AEP_LATTICE_OPA=0
    const env = String(process.env.AEP_LATTICE_OPA ?? "1").trim().toLowerCase();
    this.preferOpa = env !== "0" && env !== "false" && env !== "off";
    if (this.policyPath && existsSync(this.policyPath)) {
      try {
        readFileSync(this.policyPath, "utf8");
        this.regoFilePresent = true;
      } catch {
        this.regoFilePresent = false;
      }
    }
  }

  private detectOpa(): boolean {
    if (this.opaAvailable !== null) return this.opaAvailable;
    const bin = resolveOpaBin();
    const r = spawnSync(bin, ["version"], { encoding: "utf8", timeout: 3000 });
    this.opaAvailable = r.status === 0;
    return this.opaAvailable;
  }

  isLoaded(): boolean {
    return true;
  }

  getPolicySource(): "opa_rego" | "precompiled_ts" {
    if (this.preferOpa && this.regoFilePresent && this.detectOpa()) return "opa_rego";
    return "precompiled_ts";
  }

  getPolicyPath(): string | null {
    return this.policyPath;
  }

  evaluate(input: LatticePolicyInput): LatticePolicyResult {
    // Live OPA path when rego present and OPA binary available
    if (this.preferOpa && this.regoFilePresent && this.policyPath) {
      if (this.detectOpa()) {
        try {
          return evaluateLatticePolicyWithOpa(this.policyPath, input);
        } catch (err) {
          // Fail closed unless explicit fallback allowed
          const allowFb =
            process.env.AEP_LATTICE_OPA_FALLBACK === "1" &&
            process.env.AEP_ENV !== "production";
          if (!allowFb) {
            return {
              deny: [
                `OPA lattice policy evaluation failed (fail-closed): ${
                  err instanceof Error ? err.message : String(err)
                }`,
              ],
              warn: [],
              escalate: [],
              policy_loaded: false,
              policy_path: this.policyPath,
              policy_source: "opa_rego",
              rego_file_present: true,
              opa_error: err instanceof Error ? err.message : String(err),
            };
          }
          const fb = evaluateLatticePolicy(input);
          fb.policy_path = this.policyPath;
          fb.rego_file_present = true;
          fb.opa_error = err instanceof Error ? err.message : String(err);
          return fb;
        }
      }
      // OPA binary missing while rego required: fail closed unless fallback
      if (process.env.AEP_LATTICE_OPA_FALLBACK !== "1") {
        return {
          deny: [
            "OPA binary not available for lattice-policy.rego (set AEP_LATTICE_OPA_FALLBACK=1 only for lab)",
          ],
          warn: [],
          escalate: [],
          policy_loaded: false,
          policy_path: this.policyPath,
          policy_source: "opa_rego",
          rego_file_present: true,
          opa_error: "opa binary missing",
        };
      }
    }

    const result = evaluateLatticePolicy(input);
    result.policy_path = this.policyPath;
    result.rego_file_present = this.regoFilePresent;
    return result;
  }
}
