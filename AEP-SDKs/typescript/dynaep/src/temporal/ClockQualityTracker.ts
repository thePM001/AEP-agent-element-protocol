// @PAD: /root/dynAEP/sdk/typescript/src/temporal/ClockQualityTracker.ts
// ===========================================================================
// @dynaep/core - Clock Quality Tracker (TIM-Compatible)
// TA-3.2: Tracks bridge clock sync state and computes TIM-compatible
// metadata per the IETF Temporal Integrity Metadata (TIM) Internet-Draft.
// Provides sync state machine, confidence class computation, anomaly
// flag detection, and uncertainty estimation via Welford's algorithm.
// ===========================================================================

// Types

export interface TIMConfig {
  enabled: boolean;
  holdoverThreshold: number;     // consecutive failures before LOCKED->HOLDOVER
  freewheelThreshold: number;    // consecutive failures before HOLDOVER->FREEWHEEL
  uncertaintyEstimation: "variance" | "fixed";
  fixedUncertaintyNs: number;
}

export type SyncState = "LOCKED" | "HOLDOVER" | "FREEWHEEL";
export type ConfidenceClass = "A" | "B" | "C" | "D" | "E" | "F";
export type AnomalyFlag = "LARGE_STEP" | "HIGH_JITTER" | "SOURCE_CHANGE" | "SYNC_LOSS";

export interface TIMMetadata {
  sync_state: SyncState;
  uncertainty_ns: number;
  sequence_token: number;
  sync_source: string;
  confidence_class: ConfidenceClass;
  anomaly_flags: AnomalyFlag[];
}

// Welford's Online Algorithm for streaming variance computation
// This tracks mean and M2 (sum of squared differences from the mean)
// without storing the full history in memory.

class WelfordVariance {
  private count: number;
  private mean: number;
  private m2: number;

  constructor() {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
  }

  update(value: number): void {
    this.count++;
    const delta = value - this.mean;
    this.mean += delta / this.count;
    const delta2 = value - this.mean;
    this.m2 += delta * delta2;
  }

  getVariance(): number {
    if (this.count < 2) return 0;
    return this.m2 / (this.count - 1);
  }

  getStdDev(): number {
    return Math.sqrt(this.getVariance());
  }

  getCount(): number {
    return this.count;
  }

  reset(): void {
    this.count = 0;
    this.mean = 0;
    this.m2 = 0;
  }
}

// ClockQualityTracker

export class ClockQualityTracker {
  private readonly config: TIMConfig;
  private syncState: SyncState;
  private consecutiveFailures: number;
  private sequenceToken: number;
  private lastSyncSource: string;
  private currentAnomalyFlags: Set<AnomalyFlag>;
  private offsetVariance: WelfordVariance;
  private lastOffsetMs: number | null;
  private lastSyncAt: number;

  // Jitter detection
  private static readonly JITTER_THRESHOLD_MS = 50;
  private static readonly LARGE_STEP_THRESHOLD_MS = 1000;

  constructor(config: TIMConfig) {
    this.config = Object.freeze({ ...config });
    this.syncState = "FREEWHEEL"; // Start in FREEWHEEL per spec
    this.consecutiveFailures = 0;
    this.sequenceToken = 0;
    this.lastSyncSource = "none";
    this.currentAnomalyFlags = new Set();
    this.offsetVariance = new WelfordVariance();
    this.lastOffsetMs = null;
    this.lastSyncAt = 0;
  }

  // Record a successful sync
  recordSyncSuccess(offsetMs: number, source: string): void {
    if (!this.config.enabled) return;

    // Check for source change
    if (this.lastSyncSource !== "none" && this.lastSyncSource !== source) {
      this.currentAnomalyFlags.add("SOURCE_CHANGE");
    }

    // Check for large step
    if (this.lastOffsetMs !== null) {
      const step = Math.abs(offsetMs - this.lastOffsetMs);
      if (step > ClockQualityTracker.LARGE_STEP_THRESHOLD_MS) {
        this.currentAnomalyFlags.add("LARGE_STEP");
      }

      // Check for high jitter
      if (step > ClockQualityTracker.JITTER_THRESHOLD_MS && this.offsetVariance.getCount() > 2) {
        const stdDev = this.offsetVariance.getStdDev();
        if (step > stdDev * 3) {
          this.currentAnomalyFlags.add("HIGH_JITTER");
        }
      }
    }

    // Update variance tracker
    this.offsetVariance.update(offsetMs);

    // Clear SYNC_LOSS on success
    this.currentAnomalyFlags.delete("SYNC_LOSS");

    // Transition state
    this.syncState = "LOCKED";
    this.consecutiveFailures = 0;
    this.lastSyncSource = source;
    this.lastOffsetMs = offsetMs;
    this.lastSyncAt = Date.now();

    // Increment sequence token (monotonically increasing)
    this.sequenceToken++;
  }

  // Record a failed sync
  recordSyncFailure(): void {
    if (!this.config.enabled) return;

    this.consecutiveFailures++;

    if (this.syncState === "LOCKED") {
      if (this.consecutiveFailures >= this.config.holdoverThreshold) {
        this.syncState = "HOLDOVER";
      }
    } else if (this.syncState === "HOLDOVER") {
      if (this.consecutiveFailures >= this.config.freewheelThreshold) {
        this.syncState = "FREEWHEEL";
        this.currentAnomalyFlags.add("SYNC_LOSS");
      }
    }

    // Increment sequence token regardless of sync outcome
    this.sequenceToken++;
  }

  getSyncState(): SyncState {
    return this.syncState;
  }

  // Compute uncertainty in nanoseconds
  getUncertaintyNs(): number {
    if (!this.config.enabled) return 0;

    if (this.config.uncertaintyEstimation === "fixed") {
      return this.config.fixedUncertaintyNs;
    }

    // Variance-based: convert standard deviation from ms to ns
    if (this.offsetVariance.getCount() < 2) {
      // Not enough samples - use fixed fallback
      return this.config.fixedUncertaintyNs;
    }

    const stdDevMs = this.offsetVariance.getStdDev();
    // 2-sigma uncertainty in nanoseconds
    return Math.round(stdDevMs * 2 * 1_000_000);
  }

  // Compute confidence class based on sync source + uncertainty
  getConfidenceClass(): ConfidenceClass {
    if (!this.config.enabled) return "E";

    if (this.syncState === "FREEWHEEL") return "F";

    const uncertaintyNs = this.getUncertaintyNs();
    const source = this.lastSyncSource.toUpperCase();

    if (source === "PTP") {
      if (uncertaintyNs < 1_000) return "A";
      if (uncertaintyNs < 100_000) return "B";
      // PTP with high uncertainty falls through to system
    }

    if (source === "NTP") {
      if (uncertaintyNs < 10_000_000) return "C";
      if (uncertaintyNs < 100_000_000) return "D";
    }

    // System clock or high-uncertainty NTP/PTP
    return "E";
  }

  getAnomalyFlags(): AnomalyFlag[] {
    return Array.from(this.currentAnomalyFlags);
  }

  // Clear transient anomaly flags (called after they've been reported)
  clearTransientAnomalyFlags(): void {
    this.currentAnomalyFlags.delete("LARGE_STEP");
    this.currentAnomalyFlags.delete("HIGH_JITTER");
    this.currentAnomalyFlags.delete("SOURCE_CHANGE");
    // SYNC_LOSS persists until a successful sync
  }

  // Return the complete TIM-compatible metadata block
  getTIMBlock(): TIMMetadata {
    return {
      sync_state: this.syncState,
      uncertainty_ns: this.getUncertaintyNs(),
      sequence_token: this.sequenceToken,
      sync_source: this.lastSyncSource.toUpperCase(),
      confidence_class: this.getConfidenceClass(),
      anomaly_flags: this.getAnomalyFlags(),
    };
  }

  // Accessors for diagnostics
  getConsecutiveFailures(): number {
    return this.consecutiveFailures;
  }

  getSequenceToken(): number {
    return this.sequenceToken;
  }

  getLastSyncAt(): number {
    return this.lastSyncAt;
  }

  getLastSyncSource(): string {
    return this.lastSyncSource;
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }
}
