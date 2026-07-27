// @PAD: /root/dynAEP/sdk/typescript/src/forecast/ForecastCache.ts
// ===========================================================================
// @dynaep/core - Forecast Cache
// Synchronous O(1) cache for forecast predictions used in the dynAEP event
// processing pipeline. The bridge calls this during event processing and it
// must NEVER block. All time operations use the bridge-authoritative clock.
// ===========================================================================

import { BridgeClock } from "../temporal/clock";
import {
  ForecastConfig,
  RuntimeCoordinates,
  AnomalyResult,
  ForecastPoint,
} from "../temporal/forecast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CachedPrediction {
  targetId: string;
  predictions: ForecastPoint[];
  confidence: number;
  /** Bridge-authoritative time when the forecast was produced. */
  forecastedAt: number;
  /** Expiry time: forecastedAt + horizonMs. */
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Numeric dimension keys from RuntimeCoordinates used for z-score anomaly
 * detection. Non-numeric fields ("visible", "renderedAt") are excluded.
 */
const NUMERIC_DIMS: (keyof RuntimeCoordinates)[] = ["x", "y", "width", "height"];

// ---------------------------------------------------------------------------
// ForecastCache
// ---------------------------------------------------------------------------

export class ForecastCache {
  private readonly config: ForecastConfig;
  private readonly bridgeClock: BridgeClock;
  private readonly cache: Map<string, CachedPrediction>;
  private readonly pendingElements: Set<string>;
  private readonly debounceValues: Map<string, number>;

  constructor(config: ForecastConfig, bridgeClock: BridgeClock) {
    this.config = config;
    this.bridgeClock = bridgeClock;
    this.cache = new Map();
    this.pendingElements = new Set();
    this.debounceValues = new Map();
  }

  // -------------------------------------------------------------------------
  // Anomaly Detection
  // -------------------------------------------------------------------------

  /**
   * Check whether a proposed state change is anomalous relative to the
   * cached forecast for the given target. Returns null on cache miss
   * (prediction not found or expired). On cache hit, computes a z-score
   * from the cached prediction vs the proposed state using quantile spread
   * as the reference width.
   *
   * This method is synchronous and O(1) -- it reads only from the in-memory
   * cache and never performs I/O or async work.
   *
   * @param targetId - The element identifier to check against.
   * @param proposedState - The proposed runtime coordinates to evaluate.
   * @returns An AnomalyResult if a valid cached prediction exists, or null
   *          if no prediction is cached or the cached entry has expired.
   */
  checkAnomaly(
    targetId: string,
    proposedState: Partial<RuntimeCoordinates>
  ): AnomalyResult | null {
    const prediction = this.getCachedPrediction(targetId);
    if (!prediction || prediction.predictions.length === 0) {
      return null;
    }

    // Use the first prediction step as the expected state
    const firstPrediction = prediction.predictions[0];
    const predictedState = firstPrediction.predictedState;

    // Compute per-dimension z-scores using quantile spread as reference width
    let maxZScore = 0;
    for (const dim of NUMERIC_DIMS) {
      const predicted = predictedState[dim];
      const proposed = proposedState[dim];
      const qLow = firstPrediction.quantileLow[dim];
      const qHigh = firstPrediction.quantileHigh[dim];

      if (
        typeof predicted !== "number" ||
        typeof proposed !== "number" ||
        typeof qLow !== "number" ||
        typeof qHigh !== "number"
      ) {
        continue;
      }

      const spread = Math.abs(qHigh - qLow);
      const halfSpread = spread / 2;
      const deviation = Math.abs(proposed - predicted);
      const zScore = halfSpread > 0
        ? deviation / halfSpread
        : deviation > 0 ? 10 : 0;

      if (zScore > maxZScore) {
        maxZScore = zScore;
      }
    }

    const isAnomaly = maxZScore > this.config.anomalyThreshold;

    let recommendation: "pass" | "warn" | "require_approval";
    if (maxZScore > this.config.anomalyThreshold * 2) {
      recommendation = "require_approval";
    } else if (maxZScore > this.config.anomalyThreshold) {
      recommendation = "warn";
    } else {
      recommendation = "pass";
    }

    return {
      isAnomaly,
      score: maxZScore,
      predicted: predictedState,
      actual: proposedState,
      recommendation,
    };
  }

  // -------------------------------------------------------------------------
  // Adaptive Debounce
  // -------------------------------------------------------------------------

  /**
   * Return the cached adaptive debounce value for the given target element.
   * If no adaptive value has been computed yet, falls back to the default
   * debounceMs from the forecast configuration.
   *
   * @param targetId - The element identifier to look up.
   * @returns The debounce interval in milliseconds.
   */
  getAdaptiveDebounce(targetId: string): number {
    const cached = this.debounceValues.get(targetId);
    if (cached !== undefined) {
      return cached;
    }
    return this.config.debounceMs;
  }

  // -------------------------------------------------------------------------
  // Cache Access
  // -------------------------------------------------------------------------

  /**
   * Retrieve the cached prediction for the given target element. Returns
   * null if no prediction is cached or if the cached entry has expired
   * according to the bridge-authoritative clock.
   *
   * @param targetId - The element identifier to look up.
   * @returns The cached prediction, or null if absent or expired.
   */
  getCachedPrediction(targetId: string): CachedPrediction | null {
    const entry = this.cache.get(targetId);
    if (!entry) {
      return null;
    }
    if (this.isExpired(entry)) {
      this.cache.delete(targetId);
      return null;
    }
    return entry;
  }

  // -------------------------------------------------------------------------
  // Cache Updates (called by ForecastWorker)
  // -------------------------------------------------------------------------

  /**
   * Insert or replace a cached prediction for the given target element.
   * This method is called by the ForecastWorker after an async forecast
   * computation completes. It does not block event processing.
   *
   * @param targetId - The element identifier to cache for.
   * @param prediction - The new prediction to store.
   */
  updateCache(targetId: string, prediction: CachedPrediction): void {
    this.cache.set(targetId, prediction);
  }

  /**
   * Update the adaptive debounce value for the given target element.
   * Called by the ForecastWorker to propagate computed debounce intervals
   * into the synchronous cache layer.
   *
   * @param targetId - The element identifier to update.
   * @param debounceMs - The new adaptive debounce interval in milliseconds.
   */
  updateDebounce(targetId: string, debounceMs: number): void {
    this.debounceValues.set(targetId, debounceMs);
  }

  // -------------------------------------------------------------------------
  // Pending Elements
  // -------------------------------------------------------------------------

  /**
   * Mark an element as pending forecast computation. The ForecastWorker
   * uses this to track which elements need new forecasts without blocking
   * the event processing pipeline.
   *
   * @param targetId - The element identifier to mark as pending.
   */
  markPending(targetId: string): void {
    this.pendingElements.add(targetId);
  }

  /**
   * Retrieve and atomically clear the set of elements pending forecast
   * computation. The ForecastWorker calls this to drain the pending queue
   * and begin async forecast work for each element.
   *
   * @returns An array of element identifiers that were pending.
   */
  getPendingElements(): string[] {
    const elements = Array.from(this.pendingElements);
    this.pendingElements.clear();
    return elements;
  }

  // -------------------------------------------------------------------------
  // Expiry
  // -------------------------------------------------------------------------

  /**
   * Check whether a cached prediction has expired. Uses the
   * bridge-authoritative clock to compare the current time against the
   * prediction's expiresAt timestamp.
   *
   * @param prediction - The cached prediction to check.
   * @returns True if the current bridge time exceeds the prediction's
   *          expiry time, false otherwise.
   */
  isExpired(prediction: CachedPrediction): boolean {
    const now = this.bridgeClock.now();
    return now > prediction.expiresAt;
  }
}
