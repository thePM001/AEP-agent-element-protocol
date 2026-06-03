import { BudgetConfig, BudgetStatus, CostEstimate } from './types';

export class BudgetEnforcer {
  private config: BudgetConfig;
  private spendThisPeriod: number = 0;
  private periodStart: Date;

  constructor(config: BudgetConfig) {
    this.config = config;
    this.periodStart = new Date();
  }

  check(estimate: CostEstimate): BudgetStatus {
    if (!this.config.enabled) {
      return { allowed: true, remaining_usd: Infinity, consumed_ratio: 0, warning: false };
    }

    this.checkPeriodRotation();

    const estCostUSD = (estimate.estimated_prompt_micro_usd + (estimate.estimated_completion_micro_usd || 0)) / 1000000;
    const afterSpend = this.spendThisPeriod + estCostUSD;
    const remaining = Math.max(0, this.config.hard_cap - afterSpend);
    const consumedRatio = this.config.hard_cap > 0 ? afterSpend / this.config.hard_cap : 0;

    if (consumedRatio > 1 && this.config.mode === "deny") {
      return {
        allowed: false,
        remaining_usd: remaining,
        consumed_ratio: consumedRatio,
        warning: true,
        reason: "Budget exceeded: $" + afterSpend.toFixed(2) + " > $" + this.config.hard_cap,
      };
    }

    if (consumedRatio > this.config.soft_warning_at) {
      return {
        allowed: true,
        remaining_usd: remaining,
        consumed_ratio: consumedRatio,
        warning: true,
      };
    }

    return {
      allowed: true,
      remaining_usd: remaining,
      consumed_ratio: consumedRatio,
      warning: false,
    };
  }

  recordSpend(costUSD: number): void {
    this.spendThisPeriod += costUSD;
  }

  private checkPeriodRotation(): void {
    const now = new Date();
    if (this.config.period === "monthly" &&
        (now.getMonth() !== this.periodStart.getMonth() || now.getFullYear() !== this.periodStart.getFullYear())) {
      this.spendThisPeriod = 0;
      this.periodStart = now;
    }
    if (this.config.period === "daily" &&
        (now.getDate() !== this.periodStart.getDate() || now.getMonth() !== this.periodStart.getMonth() || now.getFullYear() !== this.periodStart.getFullYear())) {
      this.spendThisPeriod = 0;
      this.periodStart = now;
    }
  }

  getSpendToDate(): number {
    return this.spendThisPeriod;
  }

  reset(): void {
    this.spendThisPeriod = 0;
    this.periodStart = new Date();
  }
}

export function createBudgetEnforcer(config: BudgetConfig): BudgetEnforcer {
  return new BudgetEnforcer(config);
}
