// SDK copy of AEP-Components/dynAEP/bridge/lattice/index.ts (synced by produce-aep-sdks.mjs)
// =============================================================================
// Action Lattice protocol (AEP-Components/dynAEP/bridge/lattice/index.ts)
// Synced into AEP-SDKs/typescript/dynaep/src/protocol/action-lattice.ts by produce-aep-sdks.mjs.
//
// Each node in the lattice represents a system action with:
//   - category (external_event, system_event, agent_action, output)
//   - parents (partial order: what must happen first)
//   - children (what may follow)
//   - constraints (validation gates at event arrival time)
//   - trust_floor (minimum agent trust tier)
//
// The lattice filter validates every event against its partial-order
// closure and constraints BEFORE it reaches any output renderer.
// =============================================================================

import { readFileSync, existsSync } from "fs";
import { load } from "js-yaml";

// ── Types ────────────────────────────────────────────────────────────────

export type ActionCategory =
  | "external_event"
  | "system_event"
  | "agent_action"
  | "output";

/** Config hook name -> HookRegistry registration key */
export const HOOK_NAME_ALIASES: Record<string, string> = {
  mle: "mle-validator",
  "mle-validator": "mle-validator",
  noop: "noop",
};

export type LatticeGovernanceMode =
  | "filter_all"
  | "events_only"
  | "ui_only"
  | "disabled";

/**
 * Whether lattice filtering applies to an action category under a governance mode.
 */
export function governanceAppliesToCategory(
  governance: LatticeGovernanceMode,
  category: ActionCategory,
): boolean {
  if (governance === "disabled" || governance === "ui_only") {
    return false;
  }
  if (governance === "filter_all") {
    return true;
  }
  return category === "external_event" || category === "system_event";
}

export type ConstraintType =
  | "required_field"
  | "threshold"
  | "authorization"
  | "custom";

export interface LatticeConstraint {
  type: ConstraintType;
  field?: string;
  condition?: string;
  description?: string;
}

export interface LatticeNode {
  id: string;
  label: string;
  category: ActionCategory;
  parents: string[];
  children: string[];
  constraints: LatticeConstraint[];
  trust_floor: number;
}

export interface LatticeConfig {
  aep_version: string;
  dynaep_version: string;
  lattice_revision: number;
  actions: Record<string, Omit<LatticeNode, "id">>;
}

/**
 * Canonical event shape. Defined ONCE here -- every observer adapter
 * and every consumer imports this type. Do NOT redefine elsewhere.
 */
export interface LatticeEvent {
  /** Source identifier (e.g. "webhook:stripe", "eth:0x...") */
  source: string;
  /** Dot-delimited action path for lattice routing (e.g. "webhook:incoming") */
  action_path: string;
  /** Free-form payload carried to agents */
  payload: Record<string, unknown>;
  /** Millisecond epoch timestamp set by the bridge at ingest time */
  bridge_timestamp: number;
  /** Optional agent that originated this event (if known) */
  agent_id?: string;
  /** Agent trust tier (1-5, default 1 when unset) */
  trust_tier?: number;
}

export interface AgentInterest {
  agent_id: string;
  watch_paths: string[];
  notify: "wake" | "queue" | "log";
  max_rate?: string;
  constraints?: Record<string, unknown>;
}

export interface LatticeFilterResult {
  passed: boolean;
  action_path: string;
  matched_node: LatticeNode | null;
  constraints_passed: string[];
  constraints_failed: Array<{ constraint: LatticeConstraint; reason: string }>;
  partial_order_satisfied: boolean;
  missing_parents: string[];
  trust_sufficient: boolean;
  matched_interests: AgentInterest[];
  next_actions: string[];
  duration_us: number;
}

/**
 * Validation hook interface. Hooks receive the full event, lattice, and
 * matched node and return a pass/fail verdict. Used for custom constraints.
 */
export interface HookResult {
  passed: boolean;
  score: number;
  confidence: number;
  adjustments?: Record<string, unknown>;
  details?: string;
}

export interface ValidationHook {
  name: string;
  version: string;
  validate(
    event: LatticeEvent,
    lattice: ActionLattice,
    node: LatticeNode,
  ): Promise<HookResult>;
}

/**
 * Simple map-based hook registry.
 */
export class HookRegistry {
  private hooks: Map<string, ValidationHook> = new Map();

  register(hook: ValidationHook): void {
    if (this.hooks.has(hook.name)) {
      throw new Error(`HookRegistry: hook '${hook.name}' already registered (v${this.hooks.get(hook.name)!.version})`);
    }
    this.hooks.set(hook.name, hook);
  }

  get(name: string): ValidationHook | undefined {
    return this.hooks.get(name) ?? this.hooks.get(HOOK_NAME_ALIASES[name] ?? "");
  }

  has(name: string): boolean {
    return this.hooks.has(name);
  }

  unregister(name: string): boolean {
    return this.hooks.delete(name);
  }

  list(): Array<{ name: string; version: string }> {
    return Array.from(this.hooks.values()).map((h) => ({ name: h.name, version: h.version }));
  }

  get size(): number { return this.hooks.size; }
  clear(): void { this.hooks.clear(); }
}

// ── Action Lattice ───────────────────────────────────────────────────────

export class ActionLattice {
  private nodes: Map<string, LatticeNode> = new Map();
  private forwardEdges: Map<string, Set<string>> = new Map();

  constructor(config?: LatticeConfig) {
    if (config) {
      this.load(config);
    }
  }

  /** Load from parsed YAML config. Performs cycle detection. */
  load(config: LatticeConfig): void {
    this.nodes.clear();
    this.forwardEdges.clear();

    for (const [id, data] of Object.entries(config.actions)) {
      const node: LatticeNode = { id, ...data };
      this.nodes.set(id, node);

      // Build forward edges (parent -> child)
      for (const parent of node.parents) {
        if (!this.forwardEdges.has(parent)) {
          this.forwardEdges.set(parent, new Set());
        }
        this.forwardEdges.get(parent)!.add(id);
      }
    }

    // Validate references + detect cycles
    this.validate();
  }

  /** Load from YAML file path */
  loadFromFile(path: string): void {
    if (!existsSync(path)) {
      throw new Error(`Lattice file not found: ${path}`);
    }
    const raw = readFileSync(path, "utf8");
    const config = load(raw) as LatticeConfig;
    this.load(config);
  }

  /** Merge actions from YAML file without clearing existing nodes. */
  mergeFromFile(path: string): void {
    if (!existsSync(path)) {
      throw new Error(`Lattice file not found: ${path}`);
    }
    const raw = readFileSync(path, "utf8");
    const config = load(raw) as LatticeConfig;
    this.merge(config);
  }

  /** Merge actions from parsed YAML config. */
  merge(config: LatticeConfig): void {
    for (const [id, data] of Object.entries(config.actions)) {
      const node: LatticeNode = { id, ...data };
      this.nodes.set(id, node);
      for (const parent of node.parents) {
        if (!this.forwardEdges.has(parent)) {
          this.forwardEdges.set(parent, new Set());
        }
        this.forwardEdges.get(parent)!.add(id);
      }
    }
    this.validate();
  }

  /** Validate parent/child references + cycle detection */
  private validate(): void {
    // Check references
    for (const [id, node] of this.nodes) {
      for (const parent of node.parents) {
        if (!this.nodes.has(parent)) {
          throw new Error(
            `Lattice validation: action '${id}' references unknown parent '${parent}'`
          );
        }
      }
      for (const child of node.children) {
        if (!this.nodes.has(child)) {
          throw new Error(
            `Lattice validation: action '${id}' references unknown child '${child}'`
          );
        }
      }
    }

    // Cycle detection via DFS with recursion stack
    const visited = new Set<string>();
    const recStack = new Set<string>();

    const detectCycle = (id: string): boolean => {
      if (recStack.has(id)) return true;
      if (visited.has(id)) return false;

      visited.add(id);
      recStack.add(id);

      const children = this.forwardEdges.get(id);
      if (children) {
        for (const child of children) {
          if (detectCycle(child)) return true;
        }
      }

      recStack.delete(id);
      return false;
    };

    for (const id of this.nodes.keys()) {
      if (!visited.has(id) && detectCycle(id)) {
        throw new Error(`Lattice validation: cycle detected involving action '${id}'`);
      }
    }
  }

  /** Get a node by action path */
  get(path: string): LatticeNode | undefined {
    return this.nodes.get(path);
  }

  /** Check if a path exists in the lattice */
  has(path: string): boolean {
    return this.nodes.has(path);
  }

  /** Get all known action paths */
  paths(): string[] {
    return Array.from(this.nodes.keys());
  }

  /** Number of nodes */
  size(): number {
    return this.nodes.size;
  }

  /** All known action paths (alias for Rego policy consumption) */
  allActions(): string[] {
    return this.paths();
  }

  /**
   * Compute parents of a given path. Used by Rego policy integration.
   */
  parentsOf(path: string): string[] {
    const node = this.nodes.get(path);
    return node ? [...node.parents] : [];
  }

  /**
   * Check if an action path is a root node (no parents).
   */
  isRoot(path: string): boolean {
    const node = this.nodes.get(path);
    return node ? node.parents.length === 0 : false;
  }

  /**
   * Upper set: all nodes reachable by following children, INCLUDING the query node.
   */
  upperSet(path: string): string[] {
    const visited = new Set<string>([path]);
    const queue = [path];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const edges = this.forwardEdges.get(current);
      if (edges) {
        for (const child of edges) {
          if (!visited.has(child)) {
            visited.add(child);
            queue.push(child);
          }
        }
      }
    }
    return Array.from(visited);
  }

  /**
   * Lower set: all nodes reachable by following parents backward, INCLUDING the query node.
   */
  lowerSet(path: string): string[] {
    const visited = new Set<string>([path]);
    const queue = [path];
    while (queue.length > 0) {
      const current = queue.shift()!;
      const node = this.nodes.get(current);
      if (node) {
        for (const parent of node.parents) {
          if (!visited.has(parent)) {
            visited.add(parent);
            queue.push(parent);
          }
        }
      }
    }
    return Array.from(visited);
  }

  /**
   * Check if the partial order is satisfied for a given action.
   * All parents of the action must have been satisfied.
   * If perAgentSatisfied is provided, uses per-agent tracking; otherwise uses global.
   */
  partialOrderSatisfied(
    actionPath: string,
    satisfiedActions: Set<string>,
    agentId?: string,
  ): { satisfied: boolean; missing: string[] } {
    const node = this.nodes.get(actionPath);
    if (!node) {
      return { satisfied: false, missing: [actionPath] };
    }

    const missing: string[] = [];
    for (const parent of node.parents) {
      // Per-agent tracking: agent must have satisfied it, OR it's a global event (root)
      const key = agentId ? `${agentId}:${parent}` : parent;
      const globalKey = parent;
      if (!satisfiedActions.has(key) && !satisfiedActions.has(globalKey)) {
        missing.push(parent);
      }
    }

    return { satisfied: missing.length === 0, missing };
  }

  /**
   * Check trust level against an action's trust_floor (1-5).
   */
  trustSufficient(actionPath: string, trustTier: number): boolean {
    const node = this.nodes.get(actionPath);
    if (!node) return false;
    return trustTier >= node.trust_floor;
  }

  /**
   * Evaluate all constraints for an action against event payload.
   * Custom constraints dispatch to registered hooks if provided.
   */
  evaluateConstraints(
    actionPath: string,
    payload: Record<string, unknown>,
    hook?: ValidationHook,
  ): { passed: string[]; failed: Array<{ constraint: LatticeConstraint; reason: string }> } {
    const node = this.nodes.get(actionPath);
    if (!node) {
      return { passed: [], failed: [] };
    }

    const passed: string[] = [];
    const failed: Array<{ constraint: LatticeConstraint; reason: string }> = [];

    for (const constraint of node.constraints) {
      switch (constraint.type) {
        case "required_field": {
          if (constraint.field && payload[constraint.field] !== undefined) {
            // Check condition if specified (e.g. condition: "true" -> value must be true)
            if (constraint.condition) {
              const condCheck = this.evaluateRequiredFieldCondition(
                constraint.field,
                payload[constraint.field],
                constraint.condition,
              );
              if (condCheck.passed) {
                passed.push(constraint.field);
              } else {
                failed.push({ constraint, reason: condCheck.reason });
              }
            } else {
              passed.push(constraint.field);
            }
          } else {
            failed.push({
              constraint,
              reason: `Required field '${constraint.field}' is missing`,
            });
          }
          break;
        }
        case "threshold": {
          if (constraint.field && constraint.condition) {
            const value = payload[constraint.field];
            const result = this.evaluateThreshold(
              constraint.field,
              value,
              constraint.condition,
              payload,
            );
            if (result.passed) {
              passed.push(constraint.field);
            } else {
              failed.push({ constraint, reason: result.reason });
            }
          }
          break;
        }
        case "authorization": {
          if (constraint.field && constraint.condition) {
            const value = payload[constraint.field];
            const result = this.evaluateAuthorization(
              constraint.field,
              value,
              constraint.condition
            );
            if (result.passed) {
              passed.push(constraint.field);
            } else {
              failed.push({ constraint, reason: result.reason });
            }
          }
          break;
        }
        case "custom": {
          // Deferred to LatticeFilter.filterAsync() hook dispatch.
          break;
        }
        default:
          passed.push(`unknown:${constraint.type}`);
      }
    }

    return { passed, failed };
  }

  private evaluateRequiredFieldCondition(
    field: string,
    value: unknown,
    condition: string,
  ): { passed: boolean; reason: string } {
    if (condition === "true") {
      return {
        passed: value === true,
        reason: value === true ? "" : `Field '${field}' must be true (got ${JSON.stringify(value)})`,
      };
    }
    if (condition === "non_empty") {
      const empty = value === "" || value === null || value === undefined ||
        (Array.isArray(value) && value.length === 0) ||
        (typeof value === "object" && Object.keys(value as object).length === 0);
      return {
        passed: !empty,
        reason: empty ? `Field '${field}' must be non-empty` : "",
      };
    }
    return { passed: true, reason: "" };
  }

  private evaluateThreshold(
    field: string,
    value: unknown,
    condition: string,
    payload: Record<string, unknown> = {},
  ): { passed: boolean; reason: string } {
    if (value === undefined) {
      return { passed: false, reason: `Field '${field}' is undefined` };
    }

    if (condition === "exists") {
      return { passed: true, reason: "" };
    }
    if (condition === "defined") {
      return { passed: value !== null && value !== undefined, reason: "" };
    }
    if (condition.startsWith("> ")) {
      const threshold = parseFloat(condition.substring(2));
      const v = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(v)) {
        return { passed: false, reason: `Field '${field}' is not numeric` };
      }
      return {
        passed: v > threshold,
        reason: v > threshold ? "" : `${field} (${v}) is not > ${threshold}`,
      };
    }
    if (condition.startsWith(">= ")) {
      const threshold = parseFloat(condition.substring(3));
      const v = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(v)) {
        return { passed: false, reason: `Field '${field}' is not numeric` };
      }
      return {
        passed: v >= threshold,
        reason: v >= threshold ? "" : `${field} (${v}) is not >= ${threshold}`,
      };
    }
    if (condition.startsWith("< ")) {
      const threshold = parseFloat(condition.substring(2));
      const v = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(v)) {
        return { passed: false, reason: `Field '${field}' is not numeric` };
      }
      return {
        passed: v < threshold,
        reason: v < threshold ? "" : `${field} (${v}) is not < ${threshold}`,
      };
    }
    if (condition.startsWith("<= ")) {
      const threshold = parseFloat(condition.substring(3));
      const v = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(v)) {
        return { passed: false, reason: `Field '${field}' is not numeric` };
      }
      return {
        passed: v <= threshold,
        reason: v <= threshold ? "" : `${field} (${v}) is not <= ${threshold}`,
      };
    }
    if (condition === "within_range") {
      const v = typeof value === "number" ? value : parseFloat(String(value));
      if (isNaN(v)) {
        return { passed: false, reason: `Field '${field}' is not numeric` };
      }
      const range =
        payload.range && typeof payload.range === "object" && !Array.isArray(payload.range)
          ? (payload.range as Record<string, unknown>)
          : null;
      const minRaw =
        payload.min ??
        payload[`${field}_min`] ??
        range?.min;
      const maxRaw =
        payload.max ??
        payload[`${field}_max`] ??
        range?.max;
      if (minRaw === undefined || maxRaw === undefined) {
        return {
          passed: false,
          reason: `within_range requires min/max (or range.min/range.max) in payload for field '${field}'`,
        };
      }
      const min = typeof minRaw === "number" ? minRaw : parseFloat(String(minRaw));
      const max = typeof maxRaw === "number" ? maxRaw : parseFloat(String(maxRaw));
      if (isNaN(min) || isNaN(max)) {
        return { passed: false, reason: `within_range bounds for '${field}' are not numeric` };
      }
      if (min > max) {
        return { passed: false, reason: `within_range invalid bounds: min (${min}) > max (${max})` };
      }
      const inRange = v >= min && v <= max;
      return {
        passed: inRange,
        reason: inRange ? "" : `${field} (${v}) is not within range ${min}-${max}`,
      };
    }
    if (condition.startsWith("between ")) {
      const match = condition.match(/between\s+([\d.]+)\s+and\s+([\d.]+)/);
      if (match) {
        const min = parseFloat(match[1]);
        const max = parseFloat(match[2]);
        const v = typeof value === "number" ? value : parseFloat(String(value));
        if (isNaN(v)) {
          return { passed: false, reason: `Field '${field}' is not numeric` };
        }
        return {
          passed: v >= min && v <= max,
          reason:
            v >= min && v <= max
              ? ""
              : `${field} (${v}) is not between ${min} and ${max}`,
        };
      }
    }
    if (condition === "true") {
      return {
        passed: value === true || value === "true",
        reason: value === true || value === "true" ? "" : `${field} is not true`,
      };
    }

    return { passed: true, reason: "" };
  }

  private evaluateAuthorization(
    field: string,
    value: unknown,
    condition: string
  ): { passed: boolean; reason: string } {
    if (value === undefined) {
      return { passed: false, reason: `Authorization field '${field}' is missing` };
    }

    const tierMatch = condition.match(/>= (\d+)/);
    if (tierMatch) {
      const required = parseInt(tierMatch[1], 10);
      const actual = typeof value === "number" ? value : parseInt(String(value), 10);
      if (isNaN(actual)) {
        return { passed: false, reason: `Cannot parse trust tier from '${value}'` };
      }
      return {
        passed: actual >= required,
        reason:
          actual >= required
            ? ""
            : `Trust tier ${actual} below required ${required}`,
      };
    }

    if (condition === "matches_registered") {
      return {
        passed: typeof value === "string" && value.length > 0,
        reason:
          typeof value === "string" && value.length > 0
            ? ""
            : "Agent ID does not match any registered agent",
      };
    }

    return { passed: true, reason: "" };
  }
}

// ── Lattice Filter ──────────────────────────────────────────────────────

export class LatticeFilter {
  private lattice: ActionLattice;
  private interests: Map<string, AgentInterest> = new Map();
  /** Global satisfied set for system-level ordering. Per-agent tracking uses agentId:actionPath keys as well. */
  private satisfiedActions: Set<string> = new Set();
  private hookRegistry: HookRegistry;
  private hookName: string | null;

  constructor(lattice: ActionLattice, hookRegistry?: HookRegistry, hookName?: string) {
    this.lattice = lattice;
    this.hookRegistry = hookRegistry || new HookRegistry();
    this.hookName = hookName || null;
  }

  /** Register an agent's interest in lattice paths */
  registerInterest(interest: AgentInterest): void {
    this.interests.set(interest.agent_id, interest);
  }

  /** Remove an agent's interest registration */
  deregisterInterest(agentId: string): void {
    this.interests.delete(agentId);
  }

  /**
   * Mark an action as satisfied. Supports per-agent tracking via agentId prefix,
   * and always records in the global set for system-level ordering.
   */
  markSatisfied(actionPath: string, agentId?: string): void {
    this.satisfiedActions.add(actionPath);
    if (agentId) {
      this.satisfiedActions.add(`${agentId}:${actionPath}`);
    }
  }

  /** Check if an action path matches a glob pattern */
  pathMatchesGlob(glob: string, actionPath: string): boolean {
    const escaped = glob
      .replace(/[.+^${}()|[\]\\]/g, "\\$&")
      .replace(/\*\*/g, "___DOUBLESTAR___")
      .replace(/\*/g, "[^:]+")
      .replace(/___DOUBLESTAR___/g, ".*");
    const regex = new RegExp(`^${escaped}$`);
    return regex.test(actionPath);
  }

  /**
   * Filter a single event through the lattice.
   * On pass, automatically marks the action as satisfied.
   * Set autoMarkSatisfied=false to disable (caller must do it).
   */
  filter(
    event: LatticeEvent,
    autoMarkSatisfied: boolean = true,
    deferCustomHooks: boolean = false,
  ): LatticeFilterResult {
    const startTime = process.hrtime.bigint();

    const result: LatticeFilterResult = {
      passed: false,
      action_path: event.action_path,
      matched_node: null,
      constraints_passed: [],
      constraints_failed: [],
      partial_order_satisfied: false,
      missing_parents: [],
      trust_sufficient: false,
      matched_interests: [],
      next_actions: [],
      duration_us: 0,
    };

    // 1. Check lattice membership
    const node = this.lattice.get(event.action_path);
    if (!node) {
      result.constraints_failed.push({
        constraint: {
          type: "custom",
          description: "Action path not found in lattice",
        },
        reason: `Unknown action path: ${event.action_path}`,
      });
      result.duration_us = this.elapsedUs(startTime);
      return result;
    }
    result.matched_node = node;

    // 2. Check trust floor
    const agentTrust = event.trust_tier || 1;
    result.trust_sufficient = this.lattice.trustSufficient(
      event.action_path,
      agentTrust
    );
    if (!result.trust_sufficient) {
      result.constraints_failed.push({
        constraint: {
          type: "authorization",
          field: "trust_tier",
          condition: `>= ${node.trust_floor}`,
          description: `Agent trust tier ${agentTrust} below required ${node.trust_floor}`,
        },
        reason: `Insufficient trust: ${agentTrust} < ${node.trust_floor}`,
      });
      result.duration_us = this.elapsedUs(startTime);
      return result;
    }

    // 3. Check partial order closure (per-agent if agent_id provided)
    const orderCheck = this.lattice.partialOrderSatisfied(
      event.action_path,
      this.satisfiedActions,
      event.agent_id,
    );
    result.partial_order_satisfied = orderCheck.satisfied;
    result.missing_parents = orderCheck.missing;
    if (!orderCheck.satisfied) {
      result.constraints_failed.push({
        constraint: {
          type: "custom",
          description: "Partial order not satisfied",
        },
        reason: `Missing parent actions: ${orderCheck.missing.join(", ")}`,
      });
      result.duration_us = this.elapsedUs(startTime);
      return result;
    }

    // 4. Evaluate built-in constraints
    const constraintCheck = this.lattice.evaluateConstraints(
      event.action_path,
      event.payload,
    );
    result.constraints_passed = constraintCheck.passed;
    result.constraints_failed = constraintCheck.failed;
    if (constraintCheck.failed.length > 0) {
      result.duration_us = this.elapsedUs(startTime);
      return result;
    }

    // 5. Custom constraints require async hook dispatch (fail closed in sync path)
    const hasCustomConstraints = node.constraints.some((c) => c.type === "custom");
    if (hasCustomConstraints && !deferCustomHooks) {
      const resolvedHook = this.hookName
        ? (HOOK_NAME_ALIASES[this.hookName] ?? this.hookName)
        : null;
      if (!resolvedHook || !this.hookRegistry.get(resolvedHook)) {
        result.constraints_failed.push({
          constraint: {
            type: "custom",
            description: "Custom lattice constraint requires a registered validation hook",
          },
          reason: resolvedHook
            ? `Validation hook '${this.hookName}' is not registered`
            : "lattice.hook is not configured for custom constraints",
        });
        result.duration_us = this.elapsedUs(startTime);
        return result;
      }
      result.constraints_failed.push({
        constraint: {
          type: "custom",
          description: "Custom hook evaluation requires filterAsync()",
        },
        reason: "Use LatticeFilter.filterAsync() for events with custom lattice constraints",
      });
      result.duration_us = this.elapsedUs(startTime);
      return result;
    }

    // 6. Match agent interests (glob matching)
    for (const [, interest] of this.interests) {
      for (const watchPath of interest.watch_paths) {
        if (this.pathMatchesGlob(watchPath, event.action_path)) {
          result.matched_interests.push(interest);
          break;
        }
      }
    }

    // 7. Compute next actions (children of this node)
    result.next_actions = node.children;

    // 8. Mark as satisfied (auto) — deferred when custom hooks still pending
    if (autoMarkSatisfied && !(deferCustomHooks && hasCustomConstraints)) {
      this.markSatisfied(event.action_path, event.agent_id);
    }

    // All built-in checks passed (custom hook may still be pending)
    result.passed = true;
    result.duration_us = this.elapsedUs(startTime);
    return result;
  }

  /** Async filter with hook dispatch for custom constraints */
  async filterAsync(event: LatticeEvent, autoMarkSatisfied: boolean = true): Promise<LatticeFilterResult> {
    const startTime = process.hrtime.bigint();
    const node = this.lattice.get(event.action_path);
    const hasCustomConstraints = node?.constraints.some((c) => c.type === "custom") ?? false;

    if (hasCustomConstraints) {
      const resolvedHook = this.hookName
        ? (HOOK_NAME_ALIASES[this.hookName] ?? this.hookName)
        : null;
      if (!resolvedHook || !this.hookRegistry.get(resolvedHook)) {
        const fail: LatticeFilterResult = {
          passed: false,
          action_path: event.action_path,
          matched_node: node ?? null,
          constraints_passed: [],
          constraints_failed: [{
            constraint: {
              type: "custom",
              description: "Custom lattice constraint requires a registered validation hook",
            },
            reason: resolvedHook
              ? `Validation hook '${this.hookName}' is not registered`
              : "lattice.hook is not configured for custom constraints",
          }],
          partial_order_satisfied: false,
          missing_parents: [],
          trust_sufficient: false,
          matched_interests: [],
          next_actions: [],
          duration_us: this.elapsedUs(startTime),
        };
        return fail;
      }
    }

    const result = this.filter(event, false, hasCustomConstraints);

    if (!result.passed) {
      result.duration_us = this.elapsedUs(startTime);
      return result;
    }

    if (hasCustomConstraints && this.hookName && result.matched_node) {
      const resolvedHook = HOOK_NAME_ALIASES[this.hookName] ?? this.hookName;
      const hook = this.hookRegistry.get(resolvedHook);
      if (hook) {
        try {
          const hookResult = await hook.validate(event, this.lattice, result.matched_node);
          if (hookResult.passed) {
            result.constraints_passed.push(
              `hook:${resolvedHook}:${hookResult.score.toFixed(2)}`,
            );
          } else {
            result.passed = false;
            result.constraints_failed.push({
              constraint: { type: "custom", description: `Hook '${resolvedHook}' rejected` },
              reason:
                hookResult.details ||
                `Hook '${resolvedHook}' score ${hookResult.score.toFixed(2)} below threshold`,
            });
          }
        } catch (err) {
          result.passed = false;
          result.constraints_failed.push({
            constraint: { type: "custom", description: `Hook '${resolvedHook}' error` },
            reason: (err as Error).message,
          });
        }
      }
    }

    if (result.passed && autoMarkSatisfied) {
      this.markSatisfied(event.action_path, event.agent_id);
    }

    result.duration_us = this.elapsedUs(startTime);
    return result;
  }

  /** Filter multiple events in batch */
  filterBatch(events: LatticeEvent[], autoMarkSatisfied: boolean = true): LatticeFilterResult[] {
    return events.map((e) => this.filter(e, autoMarkSatisfied));
  }

  /** Seed the satisfied set for system startup sequence */
  seedStartupSequence(): void {
    this.markSatisfied("system:startup");
    this.markSatisfied("system:health:check");
    this.markSatisfied("system:ready");
  }

  /** Get the hook registry for external hook registration */
  getHookRegistry(): HookRegistry {
    return this.hookRegistry;
  }

  /** Get satisfied actions (for debugging / Rego policy feed) */
  getSatisfiedActions(): string[] {
    return Array.from(this.satisfiedActions);
  }

  /** Get all known lattice action paths (for Rego policy feed) */
  getAllActionPaths(): string[] {
    return this.lattice.allActions();
  }

  /** Get parent information for a path (for Rego policy feed) */
  getParents(path: string): string[] {
    return this.lattice.parentsOf(path);
  }

  /** Check if a path is a root node (for Rego policy feed) */
  isRootAction(path: string): boolean {
    return this.lattice.isRoot(path);
  }

  private elapsedUs(startTime: bigint): number {
    return Number(process.hrtime.bigint() - startTime) / 1000;
  }
}
