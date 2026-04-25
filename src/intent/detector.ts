export interface IntentBaseline {
  toolCategories: Map<string, number>;
  targetPrefixes: Map<string, number>;
  actionCount: number;
  locked: boolean;
}

export interface DriftScore {
  score: number;
  factors: string[];
  isWarmup: boolean;
}

export type DriftResponse = "warn" | "gate" | "deny" | "kill";

export interface IntentConfig {
  tracking: boolean;
  drift_threshold: number;
  warmup_actions: number;
  on_drift: DriftResponse;
}

export class IntentDriftDetector {
  private baseline: IntentBaseline;
  private warmupActions: number;
  private threshold: number;
  private recentTools: string[] = [];
  private recentTargets: string[] = [];

  constructor(config?: Partial<IntentConfig>) {
    this.warmupActions = config?.warmup_actions ?? 10;
    this.threshold = config?.drift_threshold ?? 0.5;
    this.baseline = {
      toolCategories: new Map(),
      targetPrefixes: new Map(),
      actionCount: 0,
      locked: false,
    };
  }

  recordAction(tool: string, input: Record<string, unknown>): DriftScore {
    this.baseline.actionCount++;
    const category = tool.split(":")[0] ?? tool;
    const target = this.extractPrefix(input);

    this.recentTools.push(category);
    if (target) this.recentTargets.push(target);

    // Keep last 50 actions
    if (this.recentTools.length > 50) this.recentTools.shift();
    if (this.recentTargets.length > 50) this.recentTargets.shift();

    const isWarmup = this.baseline.actionCount <= this.warmupActions;

    if (isWarmup) {
      // During warmup, build baseline
      this.baseline.toolCategories.set(
        category,
        (this.baseline.toolCategories.get(category) ?? 0) + 1
      );
      if (target) {
        this.baseline.targetPrefixes.set(
          target,
          (this.baseline.targetPrefixes.get(target) ?? 0) + 1
        );
      }

      if (this.baseline.actionCount === this.warmupActions) {
        this.baseline.locked = true;
      }

      return { score: 0, factors: [], isWarmup: true };
    }

    // Post-warmup: compute drift
    return this.computeDrift(category, target);
  }

  getBaseline(): IntentBaseline {
    return { ...this.baseline, toolCategories: new Map(this.baseline.toolCategories), targetPrefixes: new Map(this.baseline.targetPrefixes) };
  }

  isWarmedUp(): boolean {
    return this.baseline.locked;
  }

  private computeDrift(category: string, target: string | null): DriftScore {
    const factors: string[] = [];
    let score = 0;

    // Tool category drift
    if (!this.baseline.toolCategories.has(category)) {
      score += 0.3;
      factors.push(`New tool category: "${category}" not in baseline`);
    }

    // Target scope drift
    if (target && !this.baseline.targetPrefixes.has(target)) {
      score += 0.2;
      factors.push(`New target prefix: "${target}" not in baseline`);
    }

    // Frequency anomaly: check if recent actions deviate from baseline distribution
    const recentCategoryCounts = new Map<string, number>();
    for (const t of this.recentTools.slice(-10)) {
      recentCategoryCounts.set(t, (recentCategoryCounts.get(t) ?? 0) + 1);
    }

    const baselineTotal = Array.from(this.baseline.toolCategories.values()).reduce((a, b) => a + b, 0);
    for (const [cat, count] of recentCategoryCounts) {
      const baselineCount = this.baseline.toolCategories.get(cat) ?? 0;
      const baselineRatio = baselineTotal > 0 ? baselineCount / baselineTotal : 0;
      const recentRatio = count / Math.min(10, this.recentTools.length);

      if (recentRatio > baselineRatio * 3 && recentRatio > 0.5) {
        score += 0.15;
        factors.push(`Frequency anomaly: "${cat}" at ${(recentRatio * 100).toFixed(0)}% vs baseline ${(baselineRatio * 100).toFixed(0)}%`);
      }
    }

    // Repetition detection
    if (this.recentTools.length >= 5) {
      const last5 = this.recentTools.slice(-5);
      if (last5.every(t => t === last5[0])) {
        score += 0.2;
        factors.push(`Repetition detected: same tool "${last5[0]}" for 5 consecutive actions`);
      }
    }

    return { score: Math.min(1, score), factors, isWarmup: false };
  }

  private extractPrefix(input: Record<string, unknown>): string | null {
    const id = input.id ?? input.elementId ?? input.target;
    if (typeof id === "string" && id.includes("-")) {
      return id.split("-")[0];
    }
    const path = input.path;
    if (typeof path === "string") {
      const parts = path.split("/");
      return parts[0] || null;
    }
    return null;
  }
}
