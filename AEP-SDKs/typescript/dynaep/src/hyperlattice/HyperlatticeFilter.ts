// One AEP Hyperlattice runtime crossing: action_path filter + lattice-policy.rego + GAP writing.gap

import type {
  ActionLattice,
  LatticeEvent,
  LatticeFilter,
  LatticeFilterResult,
  LatticeNode,
} from "../lattice/index.js";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  LatticePolicyEvaluator,
  type LatticePolicyInput,
  type LatticePolicyResult,
} from "./LatticePolicyEvaluator.js";

function defaultLatticePolicyPath(): string | null {
  const env = process.env.AEP_LATTICE_POLICY_REGO?.trim();
  if (env && existsSync(env)) return env;
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    // SDK tree may not ship rego; fall through to components path
    const candidates = [
      join(here, "../../../policies/lattice-policy.rego"),
      "/root/NLA-AEP-v2.8-open-source/AEP-Components/dynAEP/policies/lattice-policy.rego",
    ];
    for (const c of candidates) if (existsSync(c)) return c;
  } catch {}
  return null;
}

export interface HyperlatticeFilterConfig {
  latticePolicyPath?: string | null;
  gapWritingLint?: boolean;
  mode?: "strict" | "permissive" | "log_only";
}

export interface HyperlatticeCrossingResult {
  passed: boolean;
  lattice: LatticeFilterResult;
  lattice_policy: LatticePolicyResult;
  gap_writing_violations: Array<{ rule: string; message: string }>;
  reasons: string[];
}

const EM_DASH = /[\u2014\u2013\u2015\u2212]/;
const OXFORD_AND = /,\s+and\s+/;
const OXFORD_OR = /,\s+or\s+/;

function lintWritingGapText(text: string): Array<{ rule: string; message: string }> {
  const violations: Array<{ rule: string; message: string }> = [];
  if (EM_DASH.test(text)) {
    violations.push({ rule: "no_em_dashes", message: "Em-dash forbidden by writing.gap" });
  }
  if (OXFORD_AND.test(text)) {
    violations.push({ rule: "no_oxford_comma", message: 'Oxford comma before "and" forbidden by writing.gap' });
  }
  if (OXFORD_OR.test(text)) {
    violations.push({ rule: "no_oxford_comma", message: 'Oxford comma before "or" forbidden by writing.gap' });
  }
  return violations;
}

function collectPayloadStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) collectPayloadStrings(item, out);
    return;
  }
  if (value && typeof value === "object") {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectPayloadStrings(v, out);
    }
  }
}

/**
 * Unified hyperlattice crossing filter (one mechanism at runtime for action_path events).
 */
export class HyperlatticeFilter {
  private readonly latticePolicy: LatticePolicyEvaluator;
  private readonly eventTimestamps = new Map<string, number[]>();
  private readonly outputTimestamps: number[] = [];

  constructor(
    private readonly latticeFilter: LatticeFilter,
    private readonly lattice: ActionLattice,
    private readonly config: HyperlatticeFilterConfig = {},
  ) {
    this.latticePolicy = new LatticePolicyEvaluator(config.latticePolicyPath ?? defaultLatticePolicyPath());
    console.info(
      `[HyperlatticeFilter] lattice policy source=${this.latticePolicy.getPolicySource()}` +
        (config.latticePolicyPath ? ` path=${config.latticePolicyPath}` : ""),
    );
  }

  private buildLatticePolicyInput(
    event: LatticeEvent,
    node: LatticeNode,
  ): LatticePolicyInput {
    const parents = node.parents ?? [];
    const agentId = event.agent_id ?? "unknown";
    const now = Date.now();
    const windowMs = 1000;

    let times = this.eventTimestamps.get(agentId) ?? [];
    times = times.filter((t) => now - t < windowMs);
    times.push(now);
    this.eventTimestamps.set(agentId, times);

    const cat = String(node.category ?? "").toLowerCase();
    const isOutput =
      cat === "output" ||
      cat.includes("output") ||
      String(event.action_path ?? "").toLowerCase().includes("output");
    while (this.outputTimestamps.length && now - this.outputTimestamps[0] >= windowMs) {
      this.outputTimestamps.shift();
    }
    if (isOutput) this.outputTimestamps.push(now);

    return {
      action_path: event.action_path,
      trust_tier: event.trust_tier ?? 1,
      category: node.category,
      payload: (event.payload ?? {}) as Record<string, unknown>,
      agent_id: agentId,
      satisfied_actions: this.latticeFilter.getSatisfiedActions(),
      parents_of: parents,
      is_root: parents.length === 0,
      all_actions: this.latticeFilter.getAllActionPaths(),
      simultaneous_outputs: this.outputTimestamps.length,
      event_rate: times.length,
    };
  }

  getLatticeFilter(): LatticeFilter {
    return this.latticeFilter;
  }

  latticePolicyLoaded(): boolean {
    return this.latticePolicy.isLoaded();
  }

  /**
   * Single crossing pass: LatticeFilter + lattice-policy.rego + GAP writing.gap on payload strings.
   */
  async filterCrossing(
    event: LatticeEvent,
    governance: string,
    node: LatticeNode,
  ): Promise<HyperlatticeCrossingResult> {
    const reasons: string[] = [];
    const gapWritingLint = this.config.gapWritingLint !== false;
    const mode = this.config.mode ?? "strict";

    const lattice = await this.latticeFilter.filterAsync(event);
    if (!lattice.passed) {
      reasons.push(...lattice.constraints_failed.map((c) => c.reason));
    }

    const policyInput = this.buildLatticePolicyInput(event, node);
    const lattice_policy = this.latticePolicy.evaluate(policyInput);
    if (lattice_policy.deny.length > 0) {
      reasons.push(...lattice_policy.deny);
    }
    if ((lattice_policy.escalate?.length ?? 0) > 0) {
      reasons.push(...lattice_policy.escalate.map((e) => `escalate: ${e}`));
    }

    const gap_writing_violations: Array<{ rule: string; message: string }> = [];
    if (gapWritingLint) {
      const strings: string[] = [];
      collectPayloadStrings(event.payload, strings);
      for (const s of strings) {
        gap_writing_violations.push(...lintWritingGapText(s));
      }
    }
    if (gap_writing_violations.length > 0) {
      reasons.push(...gap_writing_violations.map((v) => v.message));
    }

    const hardFail =
      !lattice.passed ||
      lattice_policy.deny.length > 0 ||
      ((lattice_policy.escalate?.length ?? 0) > 0 && mode === "strict") ||
      (gapWritingLint && gap_writing_violations.length > 0);

    const forceLogOnly =
      mode === "log_only" &&
      process.env.AEP_ENV !== "production" &&
      process.env.AEP_HYPERLATTICE_LOG_ONLY !== "0";
    const passed = forceLogOnly ? true : !hardFail;

    return {
      passed,
      lattice,
      lattice_policy,
      gap_writing_violations,
      reasons,
    };
  }
}