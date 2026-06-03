/**
 * AEP Economics - Budget Enforcer
 * Tracks spend, enforces hard caps, warns at soft thresholds
 * AEP 2.75e
 */

import { BudgetConfig, BudgetStatus, CostEstimate } from './types';

export class BudgetEnforcer {
  private config: BudgetConfig;
  private spentMicroUsd: Map<string, number>;
  private periodStart: number;

  constructor(config: BudgetConfig) {
    this.config = config;
    this.spentMicroUsd = new Map();
    this.periodStart = Date.now();
  }

  check(estimate: CostEstimate, scope?: string): BudgetStatus {
    if (!this.config.enabled) {
      return { allowed: true, remaining_usd: Infinity, consumed_ratio: 0, warning: false };
    }
    const key = scope || "default";
    const proposed = estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0);
    const currentSpent = this.spentMicroUsd.get(key) || 0;
    const newTotal = currentSpent + proposed;
    const hardCapMicroUsd = this.config.hard_cap * 1000000;
    const consumedRatio = newTotal / hardCapMicroUsd;
    const remaining = hardCapMicroUsd - newTotal;
    const warning = this.config.soft_warning_at > 0 && consumedRatio >= this.config.soft_warning_at;

    if (this.config.mode === "deny" && newTotal > hardCapMicroUsd) {
      return {
        allowed: false,
        remaining_usd: Math.max(0, (hardCapMicroUsd - currentSpent) / 1000000),
        consumed_ratio: currentSpent / hardCapMicroUsd,
        warning,
        reason: "Budget hard cap exceeded: " + this.config.hard_cap + " USD",
      };
    }
    if (this.config.mode === "quota" && newTotal > hardCapMicroUsd) {
      return { allowed: false, remaining_usd: 0, consumed_ratio: 1, warning, reason: "Quota exhausted" };
    }
    return { allowed: true, remaining_usd: remaining / 1000000, consumed_ratio: consumedRatio, warning };
  }

  record(estimate: CostEstimate, scope?: string): void {
    if (!this.config.enabled) return;
    const key = scope || "default";
    const cost = estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0);
    this.spentMicroUsd.set(key, (this.spentMicroUsd.get(key) || 0) + cost);
  }

  resetPeriod(scope?: string): void {
    if (scope) { this.spentMicroUsd.delete(scope); }
    else { this.spentMicroUsd.clear(); }
    this.periodStart = Date.now();
  }

  getSpent(scope?: string): number {
    return ((this.spentMicroUsd.get(scope || "default") || 0) / 1000000);
  }

  maybeResetPeriod(): boolean {
    const now = Date.now();
    const periodMs = this.config.period === "daily" ? 86400000 : this.config.period === "monthly" ? 2592000000 : 0;
    if (periodMs > 0 && now - this.periodStart > periodMs) { this.resetPeriod(); return true; }
    return false;
  }

  validate(): string[] {
    const errors: string[] = [];
    if (this.config.hard_cap <= 0) errors.push("hard_cap must be > 0");
    if (this.config.soft_warning_at < 0 || this.config.soft_warning_at > 1) errors.push("soft_warning_at must be between 0 and 1");
    return errors;
  }
}

export function createBudgetEnforcer(config?: BudgetConfig): BudgetEnforcer {
  return new BudgetEnforcer(config || { enabled: false, mode: "warn", scope: "per-workspace", period: "monthly", hard_cap: 100, soft_warning_at: 0.8 });
}
