import { randomUUID } from "node:crypto";
import type {
  Policy,
  AgentAction,
  Verdict,
  Capability,
  Gate,
  ForbiddenPattern,
} from "./types.js";
import type { Session } from "../session/session.js";

export class PolicyEvaluator {
  private policy: Policy;

  constructor(policy: Policy) {
    this.policy = policy;
  }

  evaluate(action: AgentAction, session: Session): Verdict {
    const actionId = randomUUID();

    // Auto-activate on first evaluation
    if (session.state === "created") {
      session.activate();
    }

    // 1. Session state check
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

    // 2. Rate limit check
    const rateLimit = this.policy.session.rate_limit;
    if (rateLimit) {
      const actionsInLastMinute = session.getActionsInLastMinute();
      if (actionsInLastMinute >= rateLimit.max_per_minute) {
        return this.deny(
          actionId,
          [
            `Rate limit exceeded: ${actionsInLastMinute}/${rateLimit.max_per_minute} actions per minute.`,
          ],
          session
        );
      }
    }

    // 3. Escalation check
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

    // 4. Forbidden pattern check
    const forbiddenMatch = this.checkForbidden(action);
    if (forbiddenMatch) {
      const reasons = [
        `Forbidden pattern matched: "${forbiddenMatch.pattern}"`,
      ];
      if (forbiddenMatch.reason) {
        reasons.push(forbiddenMatch.reason);
      }
      session.recordAction("deny");
      return {
        decision: "deny",
        actionId,
        reasons,
        matchedForbidden: forbiddenMatch,
      };
    }

    // 5. Capability check
    const matchedCapability = this.matchCapability(action);
    if (!matchedCapability) {
      return this.deny(
        actionId,
        [
          `No capability allows tool "${action.tool}" with the provided scope.`,
        ],
        session
      );
    }

    // 6. Budget/limit check
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

    // 7. Gate check
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

    // 8. Default: allow
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
        };
      }
    }
    return null;
  }
}
