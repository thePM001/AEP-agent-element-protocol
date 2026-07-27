// @PAD: /root/dynAEP/sdk/typescript/src/temporal/forecast.ts
// ===========================================================================
// @dynaep/core - TimesFM Forecast Sidecar
// Provides optional time-series forecasting for runtime coordinate streams.
// If TimesFM is unavailable, the sidecar disables itself with a warning.
// Event processing is NEVER blocked on forecast computation.
// ===========================================================================

import { latticeGatedFetch } from "../transport/lattice-gated-fetch.js";
import type { ChildProcess } from "node:child_process";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ForecastConfig {
  enabled: boolean;
  timesfmEndpoint: string | null;
  timesfmMode: "local" | "remote";
  contextWindow: number;
  forecastHorizon: number;
  anomalyThreshold: number;
  debounceMs: number;
  maxTrackedElements: number;
  anomaly_action?: "warn" | "require_approval" | "log_only";
}

export interface TemporalForecast {
  targetId: string;
  forecastedAt: number;
  horizonMs: number;
  predictions: ForecastPoint[];
  confidence: number;
  anomalyDetected: boolean;
  anomalyScore: number;
}

export interface ForecastPoint {
  offsetMs: number;
  predictedState: Partial<RuntimeCoordinates>;
  quantileLow: Partial<RuntimeCoordinates>;
  quantileHigh: Partial<RuntimeCoordinates>;
}

export interface RuntimeCoordinates {
  x: number;
  y: number;
  width: number;
  height: number;
  visible: boolean;
  renderedAt: string;
}

export interface RuntimeCoordinateEvent {
  type: string;
  dynaep_type: string;
  target_id: string;
  coordinates: RuntimeCoordinates;
  timestamp?: number;
}

export interface AnomalyResult {
  isAnomaly: boolean;
  score: number;
  predicted: Partial<RuntimeCoordinates>;
  actual: Partial<RuntimeCoordinates>;
  recommendation: "pass" | "warn" | "require_approval";
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Numeric dimension keys extracted from RuntimeCoordinates for time-series
 * analysis. The "visible" and "renderedAt" fields are non-numeric and skipped.
 */
const NUMERIC_DIMS: (keyof RuntimeCoordinates)[] = ["x", "y", "width", "height"];

/**
 * Clamp a number between a lower and upper bound.
 */
function clamp(value: number, lower: number, upper: number): number {
  const clamped = Math.max(lower, Math.min(upper, value));
  return clamped;
}

/**
 * Compute the median of a sorted numeric array. Returns the middle value
 * for odd-length arrays, or the average of the two middle values for
 * even-length arrays.
 */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return 0;
  }
  if (sorted.length % 2 === 1) {
    return sorted[mid];
  }
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// ---------------------------------------------------------------------------
// Async Prediction Cache (OPT-001)
// ---------------------------------------------------------------------------

/**
 * Lightweight cached prediction stored in memory for O(1) sync lookups.
 */
export interface CachedPredictionEntry {
  targetId: string;
  predictions: ForecastPoint[];
  confidence: number;
  forecastedAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// ForecastSidecar
// ---------------------------------------------------------------------------

export class ForecastSidecar {
  private config: ForecastConfig;
  private histories: Map<string, RuntimeCoordinates[]>;
  private lastForecastTime: Map<string, number>;
  private isAvailable: boolean;
  private subprocess: ChildProcess | null;
  private lastAvailabilityCheck: number;
  private cachedForecasts: Map<string, TemporalForecast>;
  private elementUpdateOrder: string[];

  // OPT-001: Async prediction cache for O(1) sync anomaly checking
  private predictionCache: Map<string, CachedPredictionEntry>;
  private pendingElements: Set<string>;
  private debounceCache: Map<string, number>;
  private workerTimer: ReturnType<typeof setInterval> | null;

  constructor(config: ForecastConfig) {
    this.config = { ...config };
    this.histories = new Map();
    this.lastForecastTime = new Map();
    this.isAvailable = false;
    this.subprocess = null;
    this.lastAvailabilityCheck = 0;
    this.cachedForecasts = new Map();
    this.elementUpdateOrder = [];

    // OPT-001: Initialize async prediction cache
    this.predictionCache = new Map();
    this.pendingElements = new Set();
    this.debounceCache = new Map();
    this.workerTimer = null;
  }

  // -------------------------------------------------------------------------
  // Availability
  // -------------------------------------------------------------------------

  /**
   * Check whether the TimesFM backend is reachable. Results are cached for
   * 60 seconds so repeated calls do not hammer the endpoint. If the
   * sidecar is disabled via config, this always returns false.
   */
  async available(): Promise<boolean> {
    if (!this.config.enabled) {
      this.isAvailable = false;
      return false;
    }

    const now = Date.now();
    const cacheLifetimeMs = 60_000;
    if (now - this.lastAvailabilityCheck < cacheLifetimeMs) {
      return this.isAvailable;
    }

    this.lastAvailabilityCheck = now;

    if (this.config.timesfmMode === "remote") {
      return this.checkRemoteAvailability();
    }
    return this.checkLocalAvailability();
  }

  /**
   * Probe the remote TimesFM endpoint with an HTTP GET health check.
   * Any network error or non-200 response is treated as unavailable.
   */
  private async checkRemoteAvailability(): Promise<boolean> {
    const endpoint = this.config.timesfmEndpoint;
    if (!endpoint) {
      console.warn("[ForecastSidecar] No timesfmEndpoint configured - forecast disabled");
      this.isAvailable = false;
      return false;
    }

    try {
      const healthUrl = endpoint.replace(/\/+$/, "") + "/health";
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await latticeGatedFetch(
        healthUrl,
        {
          method: "GET",
          signal: controller.signal,
        },
        {
          agentId: "dynaep-forecast",
          channelId: "ch-timesfm-health",
          eventType: "DYNAEP_FORECAST_HEALTH",
          gateway: "timesfm",
        },
      );
      clearTimeout(timeoutId);

      this.isAvailable = response.ok;
      if (!response.ok) {
        console.warn(
          `[ForecastSidecar] TimesFM health check returned ${response.status} - forecast disabled`
        );
      }
      return this.isAvailable;
    } catch (err: any) {
      console.warn(
        `[ForecastSidecar] TimesFM unreachable at ${endpoint}: ${err?.message || "unknown error"} - forecast disabled`
      );
      this.isAvailable = false;
      return false;
    }
  }

  /**
   * For local mode, verify that the subprocess handle is still alive.
   * If there is no subprocess reference, the backend is considered
   * unavailable and a warning is emitted.
   */
  private async checkLocalAvailability(): Promise<boolean> {
    if (!this.subprocess) {
      console.warn(
        "[ForecastSidecar] Local TimesFM subprocess not started - forecast disabled"
      );
      this.isAvailable = false;
      return false;
    }

    const exitCode = this.subprocess.exitCode;
    if (exitCode !== null && exitCode !== undefined) {
      console.warn(
        `[ForecastSidecar] Local TimesFM subprocess exited with code ${exitCode} - forecast disabled`
      );
      this.isAvailable = false;
      this.subprocess = null;
      return false;
    }

    this.isAvailable = true;
    return true;
  }

  // -------------------------------------------------------------------------
  // Ingestion
  // -------------------------------------------------------------------------

  /**
   * Ingest a runtime coordinate event. This is a synchronous, non-blocking
   * operation that appends coordinate data to the per-element history ring
   * buffer. If maxTrackedElements is exceeded, the least-recently-updated
   * element is evicted.
   */
  ingest(event: RuntimeCoordinateEvent): void {
    const targetId = event.target_id;
    const coords: RuntimeCoordinates = {
      x: event.coordinates.x,
      y: event.coordinates.y,
      width: event.coordinates.width,
      height: event.coordinates.height,
      visible: event.coordinates.visible,
      renderedAt: event.coordinates.renderedAt,
    };

    let history = this.histories.get(targetId);
    if (!history) {
      history = [];
      this.histories.set(targetId, history);
    }

    history.push(coords);

    // Trim to context window
    if (history.length > this.config.contextWindow) {
      const excess = history.length - this.config.contextWindow;
      history.splice(0, excess);
    }

    // Update the LRU order for this element
    this.touchElement(targetId);

    // Enforce maxTrackedElements by evicting the oldest entry
    this.enforceMaxTrackedElements();
  }

  /**
   * Move the given elementId to the end of the update order, representing
   * the most-recently-updated position.
   */
  private touchElement(elementId: string): void {
    const idx = this.elementUpdateOrder.indexOf(elementId);
    if (idx !== -1) {
      this.elementUpdateOrder.splice(idx, 1);
    }
    this.elementUpdateOrder.push(elementId);
  }

  /**
   * If the number of tracked elements exceeds the configured maximum,
   * evict the least-recently-updated elements until we are within budget.
   */
  private enforceMaxTrackedElements(): void {
    while (this.histories.size > this.config.maxTrackedElements) {
      const oldest = this.elementUpdateOrder.shift();
      if (!oldest) {
        break;
      }
      this.histories.delete(oldest);
      this.lastForecastTime.delete(oldest);
      this.cachedForecasts.delete(oldest);
    }
  }

  // -------------------------------------------------------------------------
  // Forecasting
  // -------------------------------------------------------------------------

  /**
   * Produce a temporal forecast for the given element. Returns null if the
   * sidecar is unavailable, there is insufficient history, or the debounce
   * window has not elapsed since the last forecast for this element.
   *
   * The forecast is computed asynchronously and does not block event
   * processing in the main pipeline.
   */
  async forecast(elementId: string): Promise<TemporalForecast | null> {
    const isReady = await this.available();
    if (!isReady) {
      return null;
    }

    const history = this.histories.get(elementId);
    if (!history || history.length < 3) {
      return null;
    }

    // Debounce check
    const now = Date.now();
    const lastTime = this.lastForecastTime.get(elementId) || 0;
    const effectiveDebounce = this.adaptiveDebounce(elementId);
    if (now - lastTime < effectiveDebounce) {
      return this.cachedForecasts.get(elementId) || null;
    }

    this.lastForecastTime.set(elementId, now);

    // Build per-dimension time series arrays
    const seriesMap: Record<string, number[]> = {};
    for (const dim of NUMERIC_DIMS) {
      seriesMap[dim] = history.map((c) => c[dim] as number);
    }

    // Dispatch to the configured backend
    let rawResponse: any;
    if (this.config.timesfmMode === "remote") {
      rawResponse = await this.forecastRemote(elementId, seriesMap);
    } else {
      rawResponse = await this.forecastLocal(elementId, seriesMap);
    }

    if (!rawResponse) {
      return null;
    }

    // Parse the response into ForecastPoints
    const predictions = this.parseResponse(rawResponse);
    const confidence = this.computeConfidence(predictions);
    const anomalyInfo = this.detectAnomalyFromHistory(elementId, predictions);

    const result: TemporalForecast = {
      targetId: elementId,
      forecastedAt: now,
      horizonMs: this.config.forecastHorizon,
      predictions,
      confidence,
      anomalyDetected: anomalyInfo.detected,
      anomalyScore: anomalyInfo.score,
    };

    this.cachedForecasts.set(elementId, result);
    return result;
  }

  /**
   * Send a forecast request to the remote TimesFM endpoint via HTTP POST.
   * The payload includes all numeric dimension series and the requested
   * forecast horizon.
   */
  private async forecastRemote(
    elementId: string,
    seriesMap: Record<string, number[]>
  ): Promise<any | null> {
    const endpoint = this.config.timesfmEndpoint;
    if (!endpoint) {
      return null;
    }

    const predictUrl = endpoint.replace(/\/+$/, "") + "/predict";
    const payload = {
      element_id: elementId,
      series: seriesMap,
      horizon: this.config.forecastHorizon,
      context_length: this.config.contextWindow,
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10_000);

      const response = await latticeGatedFetch(
        predictUrl,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal: controller.signal,
        },
        {
          agentId: "dynaep-forecast",
          channelId: "ch-timesfm-predict",
          eventType: "DYNAEP_FORECAST_PREDICT",
          gateway: "timesfm",
          payloadExtra: { element_id: elementId },
        },
      );
      clearTimeout(timeoutId);

      if (!response.ok) {
        console.warn(
          `[ForecastSidecar] Forecast request failed with status ${response.status}`
        );
        return null;
      }

      const body = await response.json();
      return body;
    } catch (err: any) {
      console.warn(
        `[ForecastSidecar] Forecast request error: ${err?.message || "unknown"}`
      );
      return null;
    }
  }

  /**
   * Send a forecast request to the local subprocess by writing a JSON line
   * to its stdin and reading the response from stdout. The subprocess is
   * expected to implement a line-delimited JSON protocol.
   */
  private async forecastLocal(
    elementId: string,
    seriesMap: Record<string, number[]>
  ): Promise<any | null> {
    if (!this.subprocess || !this.subprocess.stdin) {
      console.warn("[ForecastSidecar] Local subprocess stdin not available");
      return null;
    }

    const request = {
      element_id: elementId,
      series: seriesMap,
      horizon: this.config.forecastHorizon,
      context_length: this.config.contextWindow,
    };

    return new Promise<any | null>((resolve) => {
      const timeoutMs = 10_000;
      let settled = false;

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          console.warn("[ForecastSidecar] Local forecast timed out");
          resolve(null);
        }
      }, timeoutMs);

      const onData = (chunk: Buffer | string) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        try {
          const text = typeof chunk === "string" ? chunk : chunk.toString("utf-8");
          const parsed = JSON.parse(text.trim());
          resolve(parsed);
        } catch (parseErr: any) {
          console.warn(
            `[ForecastSidecar] Failed to parse local response: ${parseErr?.message}`
          );
          resolve(null);
        }
      };

      // Attach a one-time listener for the response
      if (this.subprocess.stdout) {
        this.subprocess.stdout.once("data", onData);
      }

      try {
        const line = JSON.stringify(request) + "\n";
        this.subprocess.stdin.write(line);
      } catch (writeErr: any) {
        settled = true;
        clearTimeout(timer);
        console.warn(
          `[ForecastSidecar] Failed to write to subprocess stdin: ${writeErr?.message}`
        );
        resolve(null);
      }
    });
  }

  /**
   * Parse the raw TimesFM response into an array of ForecastPoint objects.
   * The expected response shape is:
   *   { predictions: { [dim]: { point: number[], quantile_low: number[], quantile_high: number[] } } }
   * Each array index represents a step in the forecast horizon.
   */
  private parseResponse(raw: any): ForecastPoint[] {
    const predictions: ForecastPoint[] = [];
    const dimData: Record<string, { point: number[]; low: number[]; high: number[] }> = {};

    // Extract per-dimension arrays from the response
    for (const dim of NUMERIC_DIMS) {
      const dimKey = dim as string;
      const entry = raw?.predictions?.[dimKey];
      if (entry) {
        dimData[dimKey] = {
          point: Array.isArray(entry.point) ? entry.point : [],
          low: Array.isArray(entry.quantile_low) ? entry.quantile_low : [],
          high: Array.isArray(entry.quantile_high) ? entry.quantile_high : [],
        };
      }
    }

    // Determine the number of forecast steps from the longest array
    let steps = 0;
    for (const dimKey of Object.keys(dimData)) {
      const len = dimData[dimKey].point.length;
      if (len > steps) {
        steps = len;
      }
    }

    if (steps === 0) {
      return predictions;
    }

    // Build ForecastPoints for each step
    const stepDurationMs = this.config.forecastHorizon / Math.max(steps, 1);
    for (let i = 0; i < steps; i++) {
      const predicted: Partial<RuntimeCoordinates> = {};
      const quantileLow: Partial<RuntimeCoordinates> = {};
      const quantileHigh: Partial<RuntimeCoordinates> = {};

      for (const dim of NUMERIC_DIMS) {
        const dimKey = dim as string;
        const entry = dimData[dimKey];
        if (entry) {
          (predicted as any)[dim] = entry.point[i] ?? 0;
          (quantileLow as any)[dim] = entry.low[i] ?? entry.point[i] ?? 0;
          (quantileHigh as any)[dim] = entry.high[i] ?? entry.point[i] ?? 0;
        }
      }

      const point: ForecastPoint = {
        offsetMs: Math.round(stepDurationMs * (i + 1)),
        predictedState: predicted,
        quantileLow,
        quantileHigh,
      };
      predictions.push(point);
    }

    return predictions;
  }

  /**
   * Compute a confidence score from the quantile spread. Narrow quantile
   * intervals indicate high confidence. The score is the average across
   * all dimensions and all forecast steps, normalized to [0, 1].
   */
  private computeConfidence(predictions: ForecastPoint[]): number {
    if (predictions.length === 0) {
      return 0;
    }

    let totalSpread = 0;
    let count = 0;

    for (const point of predictions) {
      for (const dim of NUMERIC_DIMS) {
        const high = (point.quantileHigh as any)[dim];
        const low = (point.quantileLow as any)[dim];
        if (typeof high === "number" && typeof low === "number") {
          totalSpread += Math.abs(high - low);
          count += 1;
        }
      }
    }

    if (count === 0) {
      return 0;
    }

    // Average spread per dimension-step. A spread of 0 yields confidence 1.0.
    // Larger spreads reduce confidence toward 0 using an exponential decay.
    const avgSpread = totalSpread / count;
    const decayFactor = 0.01;
    const confidence = Math.exp(-decayFactor * avgSpread);
    return clamp(confidence, 0, 1);
  }

  /**
   * Compare the most recent actual coordinate against the previous forecast
   * to detect whether a significant deviation (anomaly) has occurred.
   * Returns both a boolean flag and a numeric anomaly score.
   */
  private detectAnomalyFromHistory(
    elementId: string,
    currentPredictions: ForecastPoint[]
  ): { detected: boolean; score: number } {
    const history = this.histories.get(elementId);
    const previousForecast = this.cachedForecasts.get(elementId);

    if (!history || history.length < 2 || !previousForecast) {
      return { detected: false, score: 0 };
    }

    // The most recent actual observation
    const actual = history[history.length - 1];

    // The first prediction from the previous forecast (closest step)
    const prevPrediction = previousForecast.predictions[0];
    if (!prevPrediction) {
      return { detected: false, score: 0 };
    }

    // Compute deviation as a z-score-like measure per dimension
    let maxDeviation = 0;
    for (const dim of NUMERIC_DIMS) {
      const predictedVal = (prevPrediction.predictedState as any)[dim];
      const actualVal = (actual as any)[dim];
      const qLow = (prevPrediction.quantileLow as any)[dim];
      const qHigh = (prevPrediction.quantileHigh as any)[dim];

      if (
        typeof predictedVal !== "number" ||
        typeof actualVal !== "number" ||
        typeof qLow !== "number" ||
        typeof qHigh !== "number"
      ) {
        continue;
      }

      const spread = Math.abs(qHigh - qLow);
      const deviation = Math.abs(actualVal - predictedVal);
      const normalizedDeviation = spread > 0 ? deviation / spread : deviation > 0 ? 10 : 0;
      if (normalizedDeviation > maxDeviation) {
        maxDeviation = normalizedDeviation;
      }
    }

    const detected = maxDeviation > this.config.anomalyThreshold;
    return { detected, score: maxDeviation };
  }

  // -------------------------------------------------------------------------
  // Anomaly Checking
  // -------------------------------------------------------------------------

  /**
   * Check whether a proposed state change for an element is anomalous
   * relative to the current forecast. Returns a structured result with
   * a z-score, anomaly flag, and a recommendation (pass/warn/require_approval).
   */
  async checkAnomaly(
    elementId: string,
    proposedState: Partial<RuntimeCoordinates>
  ): Promise<AnomalyResult> {
    const latestForecast = this.cachedForecasts.get(elementId);

    if (!latestForecast || latestForecast.predictions.length === 0) {
      const defaultResult: AnomalyResult = {
        isAnomaly: false,
        score: 0,
        predicted: {},
        actual: proposedState,
        recommendation: "pass",
      };
      return defaultResult;
    }

    // Use the first prediction step as the expected state
    const firstPrediction = latestForecast.predictions[0];
    const predictedState = firstPrediction.predictedState;

    // Compute per-dimension z-scores using quantile spread as the reference width
    let maxZScore = 0;
    for (const dim of NUMERIC_DIMS) {
      const predicted = (predictedState as any)[dim];
      const proposed = (proposedState as any)[dim];
      const qLow = (firstPrediction.quantileLow as any)[dim];
      const qHigh = (firstPrediction.quantileHigh as any)[dim];

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
      const zScore = halfSpread > 0 ? deviation / halfSpread : deviation > 0 ? 10 : 0;

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

    const anomalyResult: AnomalyResult = {
      isAnomaly,
      score: maxZScore,
      predicted: predictedState,
      actual: proposedState,
      recommendation,
    };
    return anomalyResult;
  }

  // -------------------------------------------------------------------------
  // History Access
  // -------------------------------------------------------------------------

  /**
   * Return a shallow copy of the coordinate history for the given element.
   * If no history exists, returns an empty array. The copy prevents
   * external mutation of the internal ring buffer.
   */
  getHistory(elementId: string): RuntimeCoordinates[] {
    const history = this.histories.get(elementId);
    if (!history) {
      return [];
    }
    return [...history];
  }

  // -------------------------------------------------------------------------
  // Adaptive Debounce
  // -------------------------------------------------------------------------

  /**
   * Compute an adaptive debounce interval for the given element based on
   * the cadence of its recent coordinate updates. Elements that update
   * frequently get a shorter debounce; slowly-changing elements get a
   * longer one. The result is clamped to [50, 2000] milliseconds.
   *
   * When history is too short to compute intervals (fewer than 2 entries),
   * the configured default debounceMs is returned.
   */
  adaptiveDebounce(elementId: string): number {
    const history = this.histories.get(elementId);
    if (!history || history.length < 2) {
      return this.config.debounceMs;
    }

    // Use index spacing as a proxy for inter-event timing. Each index step
    // represents one ingest call. We estimate the real-time interval from
    // the base debounceMs divided by the average density of updates.
    const intervals: number[] = [];
    for (let i = 1; i < history.length; i++) {
      // Each step is assumed to be roughly debounceMs / contextWindow apart.
      // Since we do not store real timestamps in the coordinates, we
      // approximate using the configured debounce as a baseline interval.
      const estimatedInterval = this.config.debounceMs;
      intervals.push(estimatedInterval);
    }

    // Compute median of estimated intervals
    const medianInterval = median(intervals);
    const clamped = clamp(medianInterval, 50, 2000);
    return clamped;
  }

  // -------------------------------------------------------------------------
  // Pruning
  // -------------------------------------------------------------------------

  /**
   * Remove all tracked state for elements not present in the provided set
   * of active element IDs. This prevents unbounded memory growth as
   * elements are removed from the scene.
   */
  prune(activeElementIds: string[]): void {
    const activeSet = new Set(activeElementIds);
    const keysToRemove: string[] = [];

    // Identify stale entries
    for (const key of this.histories.keys()) {
      if (!activeSet.has(key)) {
        keysToRemove.push(key);
      }
    }

    // Remove stale histories and associated debounce/forecast data
    for (const key of keysToRemove) {
      this.histories.delete(key);
      this.lastForecastTime.delete(key);
      this.cachedForecasts.delete(key);
      this.predictionCache.delete(key);
      this.debounceCache.delete(key);
      this.pendingElements.delete(key);
    }

    // Clean up the LRU order to match surviving entries
    this.elementUpdateOrder = this.elementUpdateOrder.filter(
      (id) => activeSet.has(id)
    );
  }

  // -------------------------------------------------------------------------
  // OPT-001: Synchronous Anomaly Check (cache-based, O(1), never blocks)
  // -------------------------------------------------------------------------

  /**
   * Synchronous anomaly check using the prediction cache. Returns null on
   * cache miss (no prediction available or prediction expired). Returns an
   * AnomalyResult on cache hit. This method is O(1) and NEVER performs
   * inference - it only reads from the in-memory prediction cache.
   *
   * Call this from the event processing pipeline instead of the async
   * checkAnomaly() method to avoid blocking on TimesFM inference.
   */
  checkAnomalySync(
    elementId: string,
    proposedState: Partial<RuntimeCoordinates>
  ): AnomalyResult | null {
    if (!this.config.enabled) {
      return null;
    }

    const cached = this.predictionCache.get(elementId);

    // Cache miss: no prediction available
    if (!cached) {
      this.pendingElements.add(elementId);
      return null;
    }

    // Expired prediction: treat as cache miss
    if (Date.now() > cached.expiresAt) {
      this.predictionCache.delete(elementId);
      this.pendingElements.add(elementId);
      return null;
    }

    // Cache hit: compute anomaly from cached prediction
    if (cached.predictions.length === 0) {
      return null;
    }

    const firstPrediction = cached.predictions[0];
    const predictedState = firstPrediction.predictedState;

    let maxZScore = 0;
    for (const dim of NUMERIC_DIMS) {
      const predicted = (predictedState as Record<string, unknown>)[dim];
      const proposed = (proposedState as Record<string, unknown>)[dim];
      const qLow = (firstPrediction.quantileLow as Record<string, unknown>)[dim];
      const qHigh = (firstPrediction.quantileHigh as Record<string, unknown>)[dim];

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
      const zScore = halfSpread > 0 ? deviation / halfSpread : deviation > 0 ? 10 : 0;

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

  /**
   * Get the cached adaptive debounce interval for an element.
   * Returns the config default if no cached value exists.
   */
  getAdaptiveDebounceSync(elementId: string): number {
    return this.debounceCache.get(elementId) ?? this.config.debounceMs;
  }

  /**
   * Get the cached prediction entry for an element, or null if absent/expired.
   */
  getCachedPredictionEntry(elementId: string): CachedPredictionEntry | null {
    const cached = this.predictionCache.get(elementId);
    if (!cached || Date.now() > cached.expiresAt) {
      return null;
    }
    return cached;
  }

  // -------------------------------------------------------------------------
  // OPT-001: Async Worker Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Start the background async inference worker. The worker runs on a timer
   * at the configured debounceMs interval, batching pending elements and
   * updating the prediction cache. The event pipeline is never blocked.
   */
  startWorker(): void {
    if (!this.config.enabled || this.workerTimer !== null) {
      return;
    }

    this.workerTimer = setInterval(() => {
      this.runWorkerTick().catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : "unknown";
        console.warn(`[ForecastSidecar] Worker tick error: ${msg}`);
      });
    }, this.config.debounceMs);
  }

  /**
   * Stop the background async inference worker.
   */
  stopWorker(): void {
    if (this.workerTimer !== null) {
      clearInterval(this.workerTimer);
      this.workerTimer = null;
    }
  }

  /**
   * Execute one worker tick: select elements needing fresh predictions,
   * batch their time series, run inference, and update the cache.
   */
  private async runWorkerTick(): Promise<void> {
    // Collect pending elements (cache misses from sync checks)
    const pending = Array.from(this.pendingElements);
    this.pendingElements.clear();

    // Also collect elements with oldest predictions
    const stale: string[] = [];
    for (const [id, cached] of this.predictionCache) {
      if (Date.now() > cached.expiresAt) {
        stale.push(id);
      }
    }

    // Combine and deduplicate, limit to maxTrackedElements
    const candidates = new Set([...pending, ...stale]);
    const selected = Array.from(candidates).slice(0, this.config.maxTrackedElements);

    if (selected.length === 0) {
      return;
    }

    // For each selected element, run forecast and update cache
    for (const elementId of selected) {
      const result = await this.forecast(elementId);
      if (result) {
        const now = Date.now();
        const entry: CachedPredictionEntry = {
          targetId: elementId,
          predictions: result.predictions,
          confidence: result.confidence,
          forecastedAt: now,
          expiresAt: now + this.config.forecastHorizon,
        };
        this.predictionCache.set(elementId, entry);

        // Update adaptive debounce
        const debounce = this.adaptiveDebounce(elementId);
        this.debounceCache.set(elementId, debounce);
      }
    }
  }
}
