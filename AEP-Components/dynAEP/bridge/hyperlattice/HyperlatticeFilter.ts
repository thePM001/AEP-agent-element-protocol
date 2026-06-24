// One AEP Hyperlattice runtime crossing: action_path filter + lattice-policy.rego + GAP writing.gap

import type {
  ActionLattice,
  LatticeEvent,
  LatticeFilter,
  LatticeFilterResult,
  LatticeNode,
} from "../lattice/index.js";
import {
  LatticePolicyEvaluator,
  type LatticePolicyInput,
  type LatticePolicyResult,
} from "./LatticePolicyEvaluator.js";

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

function buildLatticePolicyInput(
  event: LatticeEvent,
  node: LatticeNode,
  latticeFilter: LatticeFilter,
  lattice: ActionLattice,
): LatticePolicyInput {
  const parents = node.parents ?? [];
  return {
    action_path: event.action_path,
    trust_tier: event.trust_tier ?? 1,
    category: node.category,
    payload: (event.payload ?? {}) as Record<string, unknown>,
    agent_id: event.agent_id ?? "unknown",
    satisfied_actions: latticeFilter.getSatisfiedActions(),
    parents_of: parents,
    is_root: parents.length === 0,
    all_actions: latticeFilter.getAllActionPaths(),
    simultaneous_outputs: 0,
    event_rate: 0,
  };
}

/**
 * Unified hyperlattice crossing filter (one mechanism at runtime for action_path events).
 */
export class HyperlatticeFilter {
  private readonly latticePolicy: LatticePolicyEvaluator;

  constructor(
    private readonly latticeFilter: LatticeFilter,
    private readonly lattice: ActionLattice,
    private readonly config: HyperlatticeFilterConfig = {},
  ) {
    this.latticePolicy = new LatticePolicyEvaluator(config.latticePolicyPath ?? null);
    if (config.latticePolicyPath && !this.latticePolicy.isLoaded()) {
      console.warn(
        `[HyperlatticeFilter] lattice-policy.rego not found at ${config.latticePolicyPath}; using precompiled rules`,
      );
    } else if (this.latticePolicy.isLoaded()) {
      console.info(`[HyperlatticeFilter] loaded lattice-policy.rego from ${config.latticePolicyPath}`);
    }
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

    const policyInput = buildLatticePolicyInput(event, node, this.latticeFilter, this.lattice);
    const lattice_policy = this.latticePolicy.evaluate(policyInput);
    if (lattice_policy.deny.length > 0) {
      reasons.push(...lattice_policy.deny);
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
      (gapWritingLint && gap_writing_violations.length > 0);

    const passed = mode === "log_only" ? true : !hardFail;

    return {
      passed,
      lattice,
      lattice_policy,
      gap_writing_violations,
      reasons,
    };
  }
}