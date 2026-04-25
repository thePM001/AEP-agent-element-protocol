import { randomUUID, createHash } from "node:crypto";
import type {
  Policy,
  AgentAction,
  Verdict,
  Capability,
  Gate,
  ForbiddenPattern,
} from "./types.js";
import type { Session } from "../session/session.js";
import type { TrustManager } from "../trust/manager.js";
import type { RingManager } from "../rings/manager.js";
import type { CovenantSpec } from "../covenant/types.js";
import { evaluateCovenant, type CovenantContext } from "../covenant/evaluator.js";
import type { IntentDriftDetector } from "../intent/detector.js";

export interface EvaluatorOptions {
  trustManager?: TrustManager;
  ringManager?: RingManager;
  covenant?: CovenantSpec;
  intentDetector?: IntentDriftDetector;
  systemRateCounter?: { count: number; windowStart: number };
  systemRateLimit?: number;
}

export class PolicyEvaluator {
  private policy: Policy;
  private policyHash: string;
  private trustManager?: TrustManager;
  private ringManager?: RingManager;
  private covenant?: CovenantSpec;
  private intentDetector?: IntentDriftDetector;
  private systemRateCounter?: { count: number; windowStart: number };
  private systemRateLimit: number;

  constructor(policy: Policy, options?: EvaluatorOptions) {
    this.policyHash = createHash("sha256")
      .update(JSON.stringify(policy))
      .digest("hex");
    Object.freeze(policy);
    this.policy = policy;
    this.trustManager = options?.trustManager;
    this.ringManager = options?.ringManager;
    this.covenant = options?.covenant;
    this.intentDetector = options?.intentDetector;
    this.systemRateCounter = options?.systemRateCounter;
    this.systemRateLimit = options?.systemRateLimit ?? policy.system?.max_actions_per_minute ?? 200;
  }

  getPolicyHash(): string {
    return this.policyHash;
  }

  setTrustManager(tm: TrustManager): void { this.trustManager = tm; }
  setRingManager(rm: RingManager): void { this.ringManager = rm; }
  setCovenant(c: CovenantSpec): void { this.covenant = c; }
  setIntentDetector(d: IntentDriftDetector): void { this.intentDetector = d; }
  setSystemRateCounter(c: { count: number; windowStart: number }): void { this.systemRateCounter = c; }

  evaluate(action: AgentAction, session: Session): Verdict {
    const actionId = randomUUID();

    // Policy integrity check -- detect runtime mutation
    const currentHash = createHash("sha256")
      .update(JSON.stringify(this.policy))
      .digest("hex");
    if (currentHash !== this.policyHash) {
      return this.deny(actionId, ["Policy integrity violation: policy has been mutated since evaluator creation."], session);
    }

    // Auto-activate on first evaluation
    if (session.state === "created") {
      session.activate();
    }

    // Step 1: Session state check
    if (session.state === "terminated") {
      return this.deny(actionId, ["Session is terminated."], session);
    }
    if (session.state === "paused") {
      return this.deny(
        actionId,
        ["Session is paused. Awaiting human approval to resume."],
        session
      );
    }

    // Step 2: Ring capability check (cheapest check first)
    if (this.ringManager) {
      const ringCheck = this.ringManager.checkCapability(action.tool);
      if (!ringCheck.allowed) {
        this.trustManager?.penalize("Ring capability denied", "structural_violation");
        return this.deny(actionId, [ringCheck.reason ?? "Ring capability check failed."], session);
      }
    }

    // Step 3: System-wide rate limit check
    if (this.systemRateCounter) {
      const now = Date.now();
      if (now - this.systemRateCounter.windowStart > 60_000) {
        this.systemRateCounter.count = 0;
        this.systemRateCounter.windowStart = now;
      }
      if (this.systemRateCounter.count >= this.systemRateLimit) {
        this.trustManager?.penalize("System rate limit exceeded", "rate_limit");
        return this.deny(actionId, [`System-wide rate limit exceeded: ${this.systemRateCounter.count}/${this.systemRateLimit} actions per minute.`], session);
      }
      this.systemRateCounter.count++;
    }

    // Step 4: Per-session rate limit check
    const rateLimit = this.policy.session.rate_limit;
    if (rateLimit) {
      const actionsInLastMinute = session.getActionsInLastMinute();
      if (actionsInLastMinute >= rateLimit.max_per_minute) {
        this.trustManager?.penalize("Rate limit exceeded", "rate_limit");
        return this.deny(
          actionId,
          [
            `Rate limit exceeded: ${actionsInLastMinute}/${rateLimit.max_per_minute} actions per minute.`,
          ],
          session
        );
      }
    }

    // Step 5: Intent drift check (skip during warmup)
    if (this.intentDetector) {
      const drift = this.intentDetector.recordAction(action.tool, action.input);
      if (!drift.isWarmup && drift.score >= (this.policy.intent?.drift_threshold ?? 0.5)) {
        const onDrift = this.policy.intent?.on_drift ?? "warn";
        const driftReasons = [`Intent drift detected (score: ${drift.score.toFixed(2)}): ${drift.factors.join(", ")}`];
        this.trustManager?.penalize("Intent drift detected", "intent_drift");

        if (onDrift === "deny" || onDrift === "kill") {
          return this.deny(actionId, driftReasons, session);
        }
        if (onDrift === "gate") {
          return this.gated(actionId, driftReasons, session);
        }
        // "warn" falls through - action proceeds but drift is logged
      }
    }

    // Step 6: Escalation check
    for (const rule of this.policy.session.escalation) {
      if (
        rule.after_actions !== undefined &&
        session.stats.actionsEvaluated >= rule.after_actions
      ) {
        if (rule.require === "terminate") {
          return this.deny(
            actionId,
            [`Escalation: terminate after ${rule.after_actions} actions.`],
            session
          );
        }
        if (rule.require === "pause" || rule.require === "human_checkin") {
          return this.gated(
            actionId,
            [
              `Escalation: ${rule.require} after ${rule.after_actions} actions.`,
            ],
            session
          );
        }
      }
      if (
        rule.after_minutes !== undefined &&
        session.stats.elapsedMs >= rule.after_minutes * 60_000
      ) {
        if (rule.require === "terminate") {
          return this.deny(
            actionId,
            [
              `Escalation: terminate after ${rule.after_minutes} minutes.`,
            ],
            session
          );
        }
        if (rule.require === "pause" || rule.require === "human_checkin") {
          return this.gated(
            actionId,
            [
              `Escalation: ${rule.require} after ${rule.after_minutes} minutes.`,
            ],
            session
          );
        }
      }
      if (
        rule.after_denials !== undefined &&
        session.stats.actionsDenied >= rule.after_denials
      ) {
        if (rule.require === "terminate") {
          return this.deny(
            actionId,
            [
              `Escalation: terminate after ${rule.after_denials} denials.`,
            ],
            session
          );
        }
        if (rule.require === "pause" || rule.require === "human_checkin") {
          return this.gated(
            actionId,
            [
              `Escalation: ${rule.require} after ${rule.after_denials} denials.`,
            ],
            session
          );
        }
      }
    }

    // Step 7: Covenant evaluation (agent-declared rules)
    if (this.covenant) {
      const ctx: CovenantContext = {
        action: action.tool,
        input: action.input,
        trustTier: this.trustManager?.getTier(),
        ring: this.ringManager?.getRing(),
      };
      const covenantResult = evaluateCovenant(this.covenant, ctx);
      if (!covenantResult.allowed) {
        this.trustManager?.penalize("Covenant violation", "policy_violation");
        return this.deny(actionId, [`Covenant: ${covenantResult.reason}`], session);
      }
    }

    // Step 8: Forbidden pattern check (operator-enforced)
    const forbiddenMatch = this.checkForbidden(action);
    if (forbiddenMatch) {
      const reasons = [
        `Forbidden pattern matched: "${forbiddenMatch.pattern}"`,
      ];
      if (forbiddenMatch.reason) {
        reasons.push(forbiddenMatch.reason);
      }
      this.trustManager?.penalize("Forbidden pattern match", "forbidden_match");
      session.recordAction("deny");
      return {
        decision: "deny",
        actionId,
        reasons,
        matchedForbidden: forbiddenMatch,
      };
    }

    // Step 9: Capability match + trust tier check
    const matchedCapability = this.matchCapability(action);
    if (!matchedCapability) {
      this.trustManager?.penalize("No matching capability", "policy_violation");
      return this.deny(
        actionId,
        [
          `No capability allows tool "${action.tool}" with the provided scope.`,
        ],
        session
      );
    }

    // Trust tier check on capability
    if (matchedCapability.min_trust_tier && this.trustManager) {
      if (!this.trustManager.meetsMinTier(matchedCapability.min_trust_tier as any)) {
        return this.deny(
          actionId,
          [`Trust tier "${this.trustManager.getTier()}" does not meet minimum "${matchedCapability.min_trust_tier}" for this capability.`],
          session
        );
      }
    }

    // Step 10: Budget/limit check
    const limits = this.policy.limits;
    if (
      limits.max_runtime_ms !== undefined &&
      session.stats.elapsedMs >= limits.max_runtime_ms
    ) {
      return this.deny(
        actionId,
        [
          `Runtime limit exceeded: ${session.stats.elapsedMs}ms >= ${limits.max_runtime_ms}ms.`,
        ],
        session
      );
    }
    const sessionConfig = this.policy.session;
    if (session.stats.actionsEvaluated >= sessionConfig.max_actions) {
      return this.deny(
        actionId,
        [
          `Action limit exceeded: ${session.stats.actionsEvaluated} >= ${sessionConfig.max_actions}.`,
        ],
        session
      );
    }
    if (
      sessionConfig.max_denials !== undefined &&
      session.stats.actionsDenied >= sessionConfig.max_denials
    ) {
      return this.deny(
        actionId,
        [
          `Denial limit exceeded: ${session.stats.actionsDenied} >= ${sessionConfig.max_denials}.`,
        ],
        session
      );
    }

    // Step 11: Gate check (human or webhook)
    const matchedGate = this.matchGate(action);
    if (matchedGate) {
      session.recordAction("gate");
      return {
        decision: "gate",
        actionId,
        reasons: [
          `Action "${action.tool}" requires ${matchedGate.approval} approval (risk: ${matchedGate.risk_level}).`,
        ],
        matchedCapability,
        matchedGate,
      };
    }

    // Step 12: Cross-agent verification (placeholder - checked at gateway level)
    // This step is handled by the gateway when multi-agent interactions are detected.

    // All checks passed - allow
    this.trustManager?.reward("Action permitted");
    this.trustManager?.markActivity();
    session.recordAction("allow");
    return {
      decision: "allow",
      actionId,
      reasons: ["Action permitted by policy."],
      matchedCapability,
    };
  }

  private deny(actionId: string, reasons: string[], session?: Session): Verdict {
    session?.recordAction("deny");
    return { decision: "deny", actionId, reasons };
  }

  private gated(
    actionId: string,
    reasons: string[],
    session?: Session
  ): Verdict {
    session?.recordAction("gate");
    return { decision: "gate", actionId, reasons };
  }

  private checkForbidden(action: AgentAction): ForbiddenPattern | null {
    const serialized = JSON.stringify(action.input);
    for (const fp of this.policy.forbidden) {
      try {
        const regex = new RegExp(fp.pattern);
        if (regex.test(action.tool) || regex.test(serialized)) {
          return fp;
        }
      } catch {
        // Treat as glob/literal match
        if (
          action.tool.includes(fp.pattern) ||
          serialized.includes(fp.pattern)
        ) {
          return fp;
        }
      }
    }
    return null;
  }

  private matchCapability(action: AgentAction): Capability | null {
    for (const cap of this.policy.capabilities) {
      if (!this.toolMatches(cap.tool, action.tool)) {
        continue;
      }
      if (this.scopeMatches(cap, action)) {
        return cap;
      }
    }
    return null;
  }

  private toolMatches(capTool: string, actionTool: string): boolean {
    if (capTool === actionTool) return true;
    if (capTool === "*") return true;
    if (capTool.endsWith(":*")) {
      const prefix = capTool.slice(0, -1);
      return actionTool.startsWith(prefix);
    }
    return false;
  }

  private scopeMatches(cap: Capability, action: AgentAction): boolean {
    const scope = cap.scope ?? {};
    if (Object.keys(scope).length === 0) return true;

    if (scope.element_prefixes && action.input.id) {
      const id = String(action.input.id);
      const prefix = id.split("-")[0];
      if (!scope.element_prefixes.includes(prefix)) {
        return false;
      }
    }

    if (scope.z_bands && action.input.z !== undefined) {
      const z = Number(action.input.z);
      const inBand = scope.z_bands.some((band: string) => {
        const parts = band.split("-");
        if (parts.length === 2) {
          const lo = parseInt(parts[0], 10);
          const hi = parseInt(parts[1], 10);
          return z >= lo && z <= hi;
        }
        return false;
      });
      if (!inBand) {
        return false;
      }
    }

    if (scope.exclude_ids && action.input.id) {
      const id = String(action.input.id);
      if (scope.exclude_ids.includes(id)) {
        return false;
      }
    }

    if (scope.paths && action.input.path) {
      const actionPath = String(action.input.path);
      const pathAllowed = scope.paths.some((p: string) =>
        this.pathMatches(p, actionPath)
      );
      if (!pathAllowed) {
        return false;
      }
    }

    if (scope.binaries && action.input.command) {
      const cmd = String(action.input.command).split(/\s+/)[0];
      if (
        !scope.binaries.includes(cmd) &&
        !scope.binaries.includes("*")
      ) {
        return false;
      }
    }

    return true;
  }

  private pathMatches(pattern: string, path: string): boolean {
    if (pattern === "*" || pattern === "**") return true;
    if (pattern.endsWith("/**")) {
      const prefix = pattern.slice(0, -3);
      return path.startsWith(prefix);
    }
    if (pattern.endsWith("/*")) {
      const prefix = pattern.slice(0, -2);
      return path.startsWith(prefix);
    }
    return path === pattern || path.startsWith(pattern + "/");
  }

  private matchGate(action: AgentAction): Gate | null {
    for (const gate of this.policy.gates) {
      if (this.toolMatches(gate.action, action.tool)) {
        return gate;
      }
    }
    for (const cap of this.policy.capabilities) {
      if (
        this.toolMatches(cap.tool, action.tool) &&
        cap.scope?.require_gate?.includes("true")
      ) {
        return {
          action: action.tool,
          approval: "human",
          risk_level: "high",
          timeout_ms: 30000,
        };
      }
    }
    return null;
  }
}
