import type { TrustConfig, TrustTier, TrustEvent } from "./types.js";

export class TrustManager {
  private score: number;
  private config: TrustConfig;
  private events: TrustEvent[] = [];
  private lastActivityAt: number;

  constructor(config: TrustConfig) {
    this.config = config;
    this.score = config.initial_score ?? 500;
    this.lastActivityAt = Date.now();
  }

  getScore(): number {
    return this.score;
  }

  getTier(): TrustTier {
    if (this.score >= 800) return "privileged";
    if (this.score >= 600) return "trusted";
    if (this.score >= 400) return "standard";
    if (this.score >= 200) return "provisional";
    return "untrusted";
  }

  reward(reason: string, amount?: number): TrustEvent {
    const delta = amount ?? this.config.rewards?.successful_action ?? 5;
    return this.applyDelta("reward", reason, delta);
  }

  penalize(reason: string, penaltyType?: keyof NonNullable<TrustConfig["penalties"]>): TrustEvent {
    const penalties = this.config.penalties ?? {};
    let delta: number;
    if (penaltyType && penaltyType in penalties) {
      delta = -(penalties[penaltyType] ?? 50);
    } else {
      delta = -50;
    }
    return this.applyDelta("penalty", reason, delta);
  }

  applyDecay(): TrustEvent | null {
    const now = Date.now();
    const hoursInactive = (now - this.lastActivityAt) / (1000 * 60 * 60);
    if (hoursInactive < 1) return null;

    const decayRate = this.config.decay_rate ?? 5;
    const totalDecay = Math.floor(hoursInactive) * decayRate;
    if (totalDecay <= 0) return null;

    return this.applyDelta("decay", `Inactivity decay: ${Math.floor(hoursInactive)} hours`, -totalDecay);
  }

  meetsMinTier(requiredTier: TrustTier): boolean {
    const tierOrder: TrustTier[] = ["untrusted", "provisional", "standard", "trusted", "privileged"];
    const currentIdx = tierOrder.indexOf(this.getTier());
    const requiredIdx = tierOrder.indexOf(requiredTier);
    return currentIdx >= requiredIdx;
  }

  getEvents(): TrustEvent[] {
    return [...this.events];
  }

  markActivity(): void {
    this.lastActivityAt = Date.now();
  }

  private applyDelta(type: "reward" | "penalty" | "decay", reason: string, delta: number): TrustEvent {
    const scoreBefore = this.score;
    this.score = Math.max(0, Math.min(1000, this.score + delta));
    if (type !== "decay") {
      this.lastActivityAt = Date.now();
    }

    const event: TrustEvent = {
      type,
      reason,
      delta,
      scoreBefore,
      scoreAfter: this.score,
      timestamp: new Date().toISOString(),
    };
    this.events.push(event);
    return event;
  }
}
