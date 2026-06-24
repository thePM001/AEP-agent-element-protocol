// @PAD: /root/dynAEP/sdk/typescript/src/forecast/ForecastWorker.ts
// ===========================================================================
// @dynaep/core - Forecast Worker
// Async background worker that batches TimesFM inference calls and updates
// the ForecastCache. Coordinate events are buffered per-element, and the
// inference loop runs on a configurable interval, selecting pending and
// stale elements for batch prediction.
// ===========================================================================

import type { ForecastCache, CachedPrediction } from "./ForecastCache";
import type { BridgeClock } from "../temporal/clock";
import type {
  ForecastConfig,
  RuntimeCoordinates,
  RuntimeCoordinateEvent,
  ForecastPoint,
} from "../temporal/forecast";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Client interface for batched TimesFM inference. Implementations may
 * target a local subprocess, a remote HTTP endpoint, or a mock for testing.
 */
export interface TimesFMClient {
  batchPredict(
    requests: BatchPredictRequest[]
  ): Promise<BatchPredictResponse[]>;
  available(): Promise<boolean>;
}

/**
 * A single element's prediction request within a batch.
 */
export interface BatchPredictRequest {
  elementId: string;
  series: Record<string, number[]>;
  horizon: number;
  contextLength: number;
}

/**
 * A single element's prediction response from the TimesFM backend.
 * Each dimension key maps to point estimates and quantile bounds.
 */
export interface BatchPredictResponse {
  elementId: string;
  predictions: Record<
    string,
    { point: number[]; quantile_low: number[]; quantile_high: number[] }
  >;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * Numeric dimension keys extracted from RuntimeCoordinates for time-series
 * analysis. Non-numeric fields (visible, renderedAt) are excluded.
 */
const NUMERIC_DIMS = ["x", "y", "width", "height"] as const;

/** Minimum adaptive debounce in milliseconds. */
const MIN_DEBOUNCE_MS = 50;

/** Maximum adaptive debounce in milliseconds. */
const MAX_DEBOUNCE_MS = 2000;

/** Maximum number of elements to include in a single batch request. */
const MAX_BATCH_SIZE = 50;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a number between a lower and upper bound.
 */
function clamp(value: number, lower: number, upper: number): number {
  return Math.max(lower, Math.min(upper, value));
}

// ---------------------------------------------------------------------------
// ForecastWorker
// ---------------------------------------------------------------------------

/**
 * Async background worker that batches TimesFM inference calls and keeps
 * the ForecastCache up to date. Coordinate events are buffered per-element,
 * and the inference loop selects pending and stale cache entries for
 * efficient batch prediction.
 */
export class ForecastWorker {
  private readonly cache: ForecastCache;
  private readonly timesfm: TimesFMClient;
  private readonly config: ForecastConfig;
  private readonly bridgeClock: BridgeClock;

  private coordinateBuffers: Map<string, RuntimeCoordinates[]>;
  private intervalHandle: ReturnType<typeof setInterval> | null;
  private running: boolean;

  constructor(
    cache: ForecastCache,
    timesfm: TimesFMClient,
    config: ForecastConfig,
    bridgeClock: BridgeClock
  ) {
    this.cache = cache;
    this.timesfm = timesfm;
    this.config = config;
    this.bridgeClock = bridgeClock;

    this.coordinateBuffers = new Map();
    this.intervalHandle = null;
    this.running = false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin the async inference loop. The worker ticks at `config.debounceMs`
   * intervals, batching pending elements and dispatching them to the
   * TimesFM backend. Calling start() when already running is a no-op.
   */
  start(): void {
    if (this.running) {
      return;
    }

    this.running = true;
    this.intervalHandle = setInterval(() => {
      void this.tick();
    }, this.config.debounceMs);
  }

  /**
   * Stop the inference loop and release the interval timer. The worker
   * can be restarted by calling start() again. Coordinate buffers are
   * preserved across stop/start cycles.
   */
  stop(): void {
    if (this.intervalHandle !== null) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.running = false;
  }

  // -------------------------------------------------------------------------
  // Ingestion
  // -------------------------------------------------------------------------

  /**
   * Record an incoming runtime coordinate event. Called by the bridge when
   * `AEP_RUNTIME_COORDINATES` events arrive. The coordinates are appended
   * to the per-element buffer, trimmed to `config.contextWindow`, and the
   * element is marked as pending in the cache if no valid prediction exists.
   *
   * @param event - The runtime coordinate event to ingest.
   */
  recordCoordinates(event: RuntimeCoordinateEvent): void {
    const elementId = event.target_id;
    const coords: RuntimeCoordinates = {
      x: event.coordinates.x,
      y: event.coordinates.y,
      width: event.coordinates.width,
      height: event.coordinates.height,
      visible: event.coordinates.visible,
      renderedAt: event.coordinates.renderedAt,
    };

    let buffer = this.coordinateBuffers.get(elementId);
    if (!buffer) {
      buffer = [];
      this.coordinateBuffers.set(elementId, buffer);
    }

    buffer.push(coords);

    // Trim buffer to context window
    if (buffer.length > this.config.contextWindow) {
      const excess = buffer.length - this.config.contextWindow;
      buffer.splice(0, excess);
    }

    // Mark as pending if the cache has no valid prediction for this element
    const existing = this.cache.getCachedPrediction(elementId);
    if (!existing || existing.expiresAt <= this.bridgeClock.now()) {
      this.cache.markPending(elementId);
    }
  }

  // -------------------------------------------------------------------------
  // Inference Loop
  // -------------------------------------------------------------------------

  /**
   * Core inference loop tick. Selects pending and stale elements, builds
   * a batched prediction request, dispatches to TimesFM, and updates
   * the cache with results and adaptive debounce values.
   */
  private async tick(): Promise<void> {
    if (!this.running) {
      return;
    }

    const isAvailable = await this.timesfm.available();
    if (!isAvailable) {
      return;
    }

    // Collect elements that need prediction
    const selectedElements = this.selectElements();
    if (selectedElements.length === 0) {
      return;
    }

    // Build batch request
    const requests: BatchPredictRequest[] = [];
    for (const elementId of selectedElements) {
      const buffer = this.coordinateBuffers.get(elementId);
      if (!buffer || buffer.length < 3) {
        continue;
      }

      const series: Record<string, number[]> = {};
      for (const dim of NUMERIC_DIMS) {
        series[dim] = buffer.map((c) => c[dim]);
      }

      requests.push({
        elementId,
        series,
        horizon: this.config.forecastHorizon,
        contextLength: this.config.contextWindow,
      });
    }

    if (requests.length === 0) {
      return;
    }

    // Dispatch batch prediction
    let responses: BatchPredictResponse[];
    try {
      responses = await this.timesfm.batchPredict(requests);
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : "unknown error";
      console.warn(
        `[ForecastWorker] Batch prediction failed: ${message}`
      );
      return;
    }

    // Process responses
    for (const response of responses) {
      const prediction = this.parseResponse(response.elementId, response);
      this.cache.updateCache(response.elementId, prediction);

      const adaptiveDebounce = this.computeAdaptiveDebounce(
        response.elementId
      );
      this.cache.updateDebounce(response.elementId, adaptiveDebounce);
    }
  }

  /**
   * Select elements for the next batch prediction. Prioritizes pending
   * elements (cache misses), then fills remaining capacity with elements
   * whose predictions are oldest, up to the configured batch size.
   */
  private selectElements(): string[] {
    const batchSize = Math.min(
      MAX_BATCH_SIZE,
      this.config.maxTrackedElements
    );
    const selected: string[] = [];
    const selectedSet = new Set<string>();

    // Priority 1: pending elements (cache misses)
    const pending = this.cache.getPendingElements();
    for (const elementId of pending) {
      if (selected.length >= batchSize) {
        break;
      }
      if (this.coordinateBuffers.has(elementId)) {
        selected.push(elementId);
        selectedSet.add(elementId);
      }
    }

    // Priority 2: elements with coordinate buffers not yet in pending
    if (selected.length < batchSize) {
      for (const elementId of this.coordinateBuffers.keys()) {
        if (selected.length >= batchSize) {
          break;
        }
        if (selectedSet.has(elementId)) {
          continue;
        }
        const cached = this.cache.getCachedPrediction(elementId);
        if (!cached || cached.expiresAt <= this.bridgeClock.now()) {
          selected.push(elementId);
          selectedSet.add(elementId);
        }
      }
    }

    return selected;
  }

  // -------------------------------------------------------------------------
  // Response Parsing
  // -------------------------------------------------------------------------

  /**
   * Parse a BatchPredictResponse into a CachedPrediction. Extracts per-
   * dimension point estimates and quantile bounds, constructs ForecastPoint
   * arrays, and sets temporal metadata using the bridge clock.
   */
  private parseResponse(
    elementId: string,
    response: BatchPredictResponse
  ): CachedPrediction {
    const dimData: Record<
      string,
      { point: number[]; low: number[]; high: number[] }
    > = {};

    // Extract per-dimension arrays from the response
    for (const dim of NUMERIC_DIMS) {
      const entry = response.predictions[dim];
      if (entry) {
        dimData[dim] = {
          point: Array.isArray(entry.point) ? entry.point : [],
          low: Array.isArray(entry.quantile_low) ? entry.quantile_low : [],
          high: Array.isArray(entry.quantile_high)
            ? entry.quantile_high
            : [],
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

    // Build ForecastPoints for each step
    const points: ForecastPoint[] = [];
    const stepDurationMs =
      this.config.forecastHorizon / Math.max(steps, 1);

    for (let i = 0; i < steps; i++) {
      const predictedState: Partial<RuntimeCoordinates> = {};
      const quantileLow: Partial<RuntimeCoordinates> = {};
      const quantileHigh: Partial<RuntimeCoordinates> = {};

      for (const dim of NUMERIC_DIMS) {
        const entry = dimData[dim];
        if (entry) {
          predictedState[dim] = entry.point[i] ?? 0;
          quantileLow[dim] = entry.low[i] ?? entry.point[i] ?? 0;
          quantileHigh[dim] = entry.high[i] ?? entry.point[i] ?? 0;
        }
      }

      points.push({
        offsetMs: Math.round(stepDurationMs * (i + 1)),
        predictedState,
        quantileLow,
        quantileHigh,
      });
    }

    const forecastedAt = this.bridgeClock.now();
    const expiresAt = forecastedAt + this.config.forecastHorizon;

    return {
      targetId: elementId,
      predictions: points,
      confidence: 1.0,
      forecastedAt,
      expiresAt,
    };
  }

  // -------------------------------------------------------------------------
  // Adaptive Debounce
  // -------------------------------------------------------------------------

  /**
   * Compute an adaptive debounce interval for the given element based on
   * inter-event spacing in the coordinate buffer. Elements that receive
   * frequent updates get a shorter debounce; slowly-changing elements
   * get a longer one. The result is clamped to [50, 2000] milliseconds.
   *
   * When the buffer has fewer than 2 entries, the configured default
   * debounceMs is returned.
   */
  private computeAdaptiveDebounce(elementId: string): number {
    const buffer = this.coordinateBuffers.get(elementId);
    if (!buffer || buffer.length < 2) {
      return this.config.debounceMs;
    }

    // Compute inter-event intervals from renderedAt timestamps.
    // Each entry carries a renderedAt ISO string; we parse consecutive
    // pairs to derive real-time spacing.
    const intervals: number[] = [];
    for (let i = 1; i < buffer.length; i++) {
      const prevTime = Date.parse(buffer[i - 1].renderedAt);
      const currTime = Date.parse(buffer[i].renderedAt);

      // Only use valid, positive intervals
      if (
        !isNaN(prevTime) &&
        !isNaN(currTime) &&
        currTime > prevTime
      ) {
        intervals.push(currTime - prevTime);
      }
    }

    if (intervals.length === 0) {
      return this.config.debounceMs;
    }

    // Use the median inter-event interval as the adaptive debounce.
    // Median is robust against outliers from bursts or pauses.
    const sorted = [...intervals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const medianInterval =
      sorted.length % 2 === 1
        ? sorted[mid]
        : (sorted[mid - 1] + sorted[mid]) / 2;

    return clamp(medianInterval, MIN_DEBOUNCE_MS, MAX_DEBOUNCE_MS);
  }
}
