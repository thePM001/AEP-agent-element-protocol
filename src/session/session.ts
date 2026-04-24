import { randomUUID } from "node:crypto";
import type { Policy } from "../policy/types.js";

export type SessionState = "created" | "active" | "paused" | "terminated";

export interface SessionStats {
  actionsEvaluated: number;
  actionsAllowed: number;
  actionsDenied: number;
  actionsGated: number;
  elapsedMs: number;
  lastActionAt: Date | null;
}

export interface SessionReport {
  sessionId: string;
  duration: number;
  totalActions: number;
  allowed: number;
  denied: number;
  gated: number;
  terminationReason: string;
}

export class Session {
  readonly id: string;
  state: SessionState;
  readonly createdAt: Date;
  policy: Policy;
  stats: SessionStats;
  metadata: Record<string, string>;

  private actionTimestamps: number[] = [];

  constructor(policy: Policy, metadata?: Record<string, string>) {
    this.id = randomUUID();
    this.state = "created";
    this.createdAt = new Date();
    this.policy = policy;
    this.metadata = metadata ?? {};
    this.stats = {
      actionsEvaluated: 0,
      actionsAllowed: 0,
      actionsDenied: 0,
      actionsGated: 0,
      elapsedMs: 0,
      lastActionAt: null,
    };
  }

  activate(): void {
    if (this.state !== "created" && this.state !== "paused") {
      throw new Error(
        `Cannot activate session in state "${this.state}". Must be "created" or "paused".`
      );
    }
    this.state = "active";
  }

  pause(): void {
    if (this.state !== "active") {
      throw new Error(
        `Cannot pause session in state "${this.state}". Must be "active".`
      );
    }
    this.state = "paused";
  }

  terminate(reason: string): SessionReport {
    this.state = "terminated";
    const duration = Date.now() - this.createdAt.getTime();
    return {
      sessionId: this.id,
      duration,
      totalActions: this.stats.actionsEvaluated,
      allowed: this.stats.actionsAllowed,
      denied: this.stats.actionsDenied,
      gated: this.stats.actionsGated,
      terminationReason: reason,
    };
  }

  recordAction(decision: "allow" | "deny" | "gate"): void {
    const now = Date.now();
    this.stats.actionsEvaluated++;
    this.stats.lastActionAt = new Date(now);
    this.stats.elapsedMs = now - this.createdAt.getTime();
    this.actionTimestamps.push(now);

    if (decision === "allow") {
      this.stats.actionsAllowed++;
    } else if (decision === "deny") {
      this.stats.actionsDenied++;
    } else {
      this.stats.actionsGated++;
    }
  }

  getActionsInLastMinute(): number {
    const cutoff = Date.now() - 60_000;
    this.actionTimestamps = this.actionTimestamps.filter((t) => t > cutoff);
    return this.actionTimestamps.length;
  }
}
