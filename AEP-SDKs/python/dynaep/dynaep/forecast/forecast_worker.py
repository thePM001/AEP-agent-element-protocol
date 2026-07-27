# @PAD: /root/dynAEP/sdk/python/dynaep/forecast/forecast_worker.py
# ===========================================================================
# dynaep.forecast.forecast_worker - Async Background Worker
# Batched TimesFM inference worker using threading.Timer for periodic
# inference ticks. Collects coordinate buffers, dispatches batch predictions
# to the TimesFM client, parses responses into CachedPredictions, and
# updates the ForecastCache. Event processing is NEVER blocked.
# ===========================================================================

"""Async background worker for batched TimesFM inference."""
from __future__ import annotations

import math
import threading
import statistics
import logging
from dataclasses import dataclass, field
from typing import Optional, Protocol

from dynaep.temporal.clock import BridgeClock
from dynaep.temporal.forecast import ForecastConfig, RuntimeCoordinates, ForecastPoint
from dynaep.forecast.forecast_cache import ForecastCache, CachedPrediction

logger = logging.getLogger("dynaep.forecast.worker")

NUMERIC_DIMS = ("x", "y", "width", "height")


# ---------------------------------------------------------------------------
# TimesFM Client Protocol
# ---------------------------------------------------------------------------


class TimesFMClient(Protocol):
    """Protocol describing the interface to a TimesFM inference backend.

    Implementations may wrap a local TimesFM model, a remote HTTP endpoint,
    or a subprocess-based JSON-RPC bridge. The ForecastWorker only depends
    on this protocol, not on any concrete implementation.
    """

    def batch_predict(self, requests: list[dict]) -> list[dict]:
        """Run batched time-series predictions.

        Each request dict contains:
            - element_id (str): the target element identifier
            - series (dict[str, list[float]]): per-dimension numeric series
            - horizon (int): number of forecast steps
            - context_length (int): context window size

        Each response dict contains:
            - element_id (str): echoed back from the request
            - predictions (dict[str, dict]): per-dimension predictions with
              keys 'point', 'quantile_low', 'quantile_high' each mapping
              to a list of floats
            - confidence (float): model confidence score
        """
        ...

    def available(self) -> bool:
        """Return True if the backend is ready to accept predictions."""
        ...


# ---------------------------------------------------------------------------
# ForecastWorker
# ---------------------------------------------------------------------------


class ForecastWorker:
    """Background worker that periodically drains coordinate buffers,
    dispatches batched TimesFM inference, and updates the ForecastCache.

    Uses threading.Timer for the periodic inference loop rather than asyncio,
    matching the simpler threading model of the Python SDK. All buffer access
    is protected by a threading.Lock for thread safety.
    """

    def __init__(
        self,
        cache: ForecastCache,
        timesfm: TimesFMClient,
        config: ForecastConfig,
        bridge_clock: BridgeClock,
    ) -> None:
        self._cache = cache
        self._timesfm = timesfm
        self._config = config
        self._bridge_clock = bridge_clock

        self._coordinate_buffers: dict[str, list[RuntimeCoordinates]] = {}
        self._timer: Optional[threading.Timer] = None
        self._running: bool = False
        self._lock: threading.Lock = threading.Lock()

    # -----------------------------------------------------------------------
    # Lifecycle
    # -----------------------------------------------------------------------

    def start(self) -> None:
        """Begin the timer-based inference loop.

        Schedules the first tick using the configured debounce_ms interval.
        Subsequent ticks are rescheduled by _tick() after each inference
        cycle completes. If the worker is already running, this is a no-op.
        """
        if self._running:
            logger.debug("ForecastWorker already running, ignoring start()")
            return

        self._running = True
        interval_s = self._config.debounce_ms / 1000.0
        self._timer = threading.Timer(interval_s, self._tick)
        self._timer.daemon = True
        self._timer.start()
        logger.info(
            "ForecastWorker started with %.0fms tick interval",
            self._config.debounce_ms,
        )

    def stop(self) -> None:
        """Cancel the timer and stop the inference loop.

        Any in-flight _tick() call will complete but no further ticks
        will be scheduled. Coordinate buffers are preserved for potential
        restart.
        """
        self._running = False
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None
        logger.info("ForecastWorker stopped")

    # -----------------------------------------------------------------------
    # Data Ingestion
    # -----------------------------------------------------------------------

    def record_coordinates(self, event: dict) -> None:
        """Record a coordinate event into the per-element buffer.

        Extracts target_id and coordinates from the event dict, appends
        the coordinates to the per-element ring buffer (trimmed to
        context_window), and marks the element as pending in the cache
        if no valid cached prediction exists.

        This method is thread-safe and non-blocking.

        Args:
            event: A dict containing at minimum 'target_id' and a
                'coordinates' dict with x, y, width, height, visible,
                and rendered_at fields. Falls back to 'element_id' if
                'target_id' is absent.
        """
        target_id = event.get("target_id") or event.get("element_id")
        if target_id is None:
            logger.debug("Event missing target_id/element_id, skipping")
            return

        coords_raw = event.get("coordinates", event)
        coords = RuntimeCoordinates(
            x=float(coords_raw.get("x", 0.0)),
            y=float(coords_raw.get("y", 0.0)),
            width=float(coords_raw.get("width", 0.0)),
            height=float(coords_raw.get("height", 0.0)),
            visible=bool(coords_raw.get("visible", True)),
            rendered_at=str(coords_raw.get("rendered_at", "")),
        )

        with self._lock:
            if target_id not in self._coordinate_buffers:
                self._coordinate_buffers[target_id] = []

            buffer = self._coordinate_buffers[target_id]
            buffer.append(coords)

            # Trim to context window
            if len(buffer) > self._config.context_window:
                excess = len(buffer) - self._config.context_window
                del buffer[:excess]

        # Mark pending in cache if no valid prediction exists
        cached = self._cache.get_cached_prediction(target_id)
        if cached is None:
            self._cache.mark_pending(target_id)

    # -----------------------------------------------------------------------
    # Inference Loop
    # -----------------------------------------------------------------------

    def _tick(self) -> None:
        """Core inference loop called by the timer.

        Drains pending elements from the cache, selects up to
        max_tracked_elements for batch inference, builds per-dimension
        series from coordinate buffers, dispatches to the TimesFM client,
        parses responses into CachedPredictions, updates the cache and
        adaptive debounce values, and reschedules the next tick.
        """
        try:
            self._run_inference_cycle()
        except Exception:
            logger.exception("ForecastWorker tick failed")
        finally:
            # Reschedule if still running
            if self._running:
                interval_s = self._config.debounce_ms / 1000.0
                self._timer = threading.Timer(interval_s, self._tick)
                self._timer.daemon = True
                self._timer.start()

    def _run_inference_cycle(self) -> None:
        """Execute a single inference cycle.

        Separated from _tick() for testability and clarity. This method
        performs the actual work of gathering pending elements, building
        batch requests, calling the TimesFM client, and updating the cache.
        """
        # Check backend availability
        if not self._timesfm.available():
            logger.debug("TimesFM backend unavailable, skipping inference cycle")
            return

        # Drain pending elements from cache
        pending = self._cache.get_pending_elements()
        if not pending:
            return

        # Limit to max_tracked_elements
        selected = pending[: self._config.max_tracked_elements]

        # Build batch requests from coordinate buffers
        batch_requests: list[dict] = []
        element_ids: list[str] = []

        with self._lock:
            for element_id in selected:
                buffer = self._coordinate_buffers.get(element_id)
                if buffer is None or len(buffer) < 3:
                    continue

                # Build per-dimension time series
                series: dict[str, list[float]] = {}
                for dim in NUMERIC_DIMS:
                    series[dim] = [getattr(c, dim) for c in buffer]

                batch_requests.append({
                    "element_id": element_id,
                    "series": series,
                    "horizon": self._config.forecast_horizon,
                    "context_length": self._config.context_window,
                })
                element_ids.append(element_id)

        if not batch_requests:
            return

        # Call TimesFM backend
        try:
            responses = self._timesfm.batch_predict(batch_requests)
        except Exception:
            logger.exception("TimesFM batch_predict failed")
            # Re-mark elements as pending so they are retried
            for eid in element_ids:
                self._cache.mark_pending(eid)
            return

        if responses is None:
            for eid in element_ids:
                self._cache.mark_pending(eid)
            return

        # Parse responses and update cache
        for i, response in enumerate(responses):
            if i >= len(element_ids):
                break

            resp_element_id = response.get("element_id", element_ids[i])
            try:
                prediction = self._parse_response(resp_element_id, response)
                self._cache.update_cache(resp_element_id, prediction)
            except Exception:
                logger.exception(
                    "Failed to parse response for element %s", resp_element_id
                )
                continue

            # Compute and update adaptive debounce
            debounce = self._compute_adaptive_debounce(resp_element_id)
            self._cache.update_debounce(resp_element_id, debounce)

    # -----------------------------------------------------------------------
    # Adaptive Debounce
    # -----------------------------------------------------------------------

    def _compute_adaptive_debounce(self, element_id: str) -> int:
        """Compute an adaptive debounce interval for the given element.

        Uses the length of the coordinate buffer as a proxy for update
        frequency: elements with dense histories get shorter debounce
        intervals (faster re-forecasting), while sparse histories get
        longer intervals. The result is clamped to [50, 2000] ms.

        Args:
            element_id: The element identifier to compute debounce for.

        Returns:
            The adaptive debounce interval in milliseconds.
        """
        with self._lock:
            buffer = self._coordinate_buffers.get(element_id)
            if buffer is None or len(buffer) < 2:
                return self._config.debounce_ms

            buffer_len = len(buffer)

        # Scale inversely with buffer density relative to context window.
        # A full buffer means high-frequency updates -> shorter debounce.
        # An almost-empty buffer means low-frequency updates -> longer debounce.
        fill_ratio = buffer_len / max(self._config.context_window, 1)

        # Interpolate between 2000ms (empty) and 50ms (full)
        raw_debounce = 2000.0 - (fill_ratio * (2000.0 - 50.0))

        clamped = max(50, min(2000, int(raw_debounce)))
        return clamped

    # -----------------------------------------------------------------------
    # Response Parsing
    # -----------------------------------------------------------------------

    def _parse_response(self, element_id: str, response: dict) -> CachedPrediction:
        """Parse a TimesFM response dict into a CachedPrediction.

        Expects the response to contain a 'predictions' dict keyed by
        dimension name (x, y, width, height), each with 'point',
        'quantile_low', and 'quantile_high' arrays. Constructs
        ForecastPoint objects for each forecast step.

        The forecasted_at timestamp is taken from the bridge-authoritative
        clock, and expires_at is set to forecasted_at + forecast_horizon.

        Args:
            element_id: The element this response corresponds to.
            response: The raw response dict from the TimesFM client.

        Returns:
            A CachedPrediction ready to be stored in the ForecastCache.
        """
        predictions_raw = response.get("predictions", {})

        # Extract per-dimension arrays
        dim_data: dict[str, dict[str, list[float]]] = {}
        for dim in NUMERIC_DIMS:
            entry = predictions_raw.get(dim)
            if entry is not None:
                dim_data[dim] = {
                    "point": entry.get("point", []) if isinstance(entry, dict) else [],
                    "low": entry.get("quantile_low", []) if isinstance(entry, dict) else [],
                    "high": entry.get("quantile_high", []) if isinstance(entry, dict) else [],
                }

        # Determine the number of forecast steps from the longest point array
        steps = 0
        for dim_entry in dim_data.values():
            point_len = len(dim_entry.get("point", []))
            if point_len > steps:
                steps = point_len

        # Build ForecastPoint objects
        predictions: list[ForecastPoint] = []

        if steps > 0:
            step_duration_ms = self._config.forecast_horizon / max(steps, 1)

            for i in range(steps):
                predicted_state: dict = {}
                quantile_low: dict = {}
                quantile_high: dict = {}

                for dim in NUMERIC_DIMS:
                    entry = dim_data.get(dim)
                    if entry is not None:
                        point_arr = entry.get("point", [])
                        low_arr = entry.get("low", [])
                        high_arr = entry.get("high", [])

                        predicted_state[dim] = (
                            point_arr[i] if i < len(point_arr) else 0.0
                        )
                        quantile_low[dim] = (
                            low_arr[i]
                            if i < len(low_arr)
                            else predicted_state.get(dim, 0.0)
                        )
                        quantile_high[dim] = (
                            high_arr[i]
                            if i < len(high_arr)
                            else predicted_state.get(dim, 0.0)
                        )

                predictions.append(
                    ForecastPoint(
                        offset_ms=round(step_duration_ms * (i + 1)),
                        predicted_state=predicted_state,
                        quantile_low=quantile_low,
                        quantile_high=quantile_high,
                    )
                )

        # Compute confidence from quantile spread
        confidence = self._compute_confidence(predictions)

        forecasted_at = self._bridge_clock.now()
        expires_at = forecasted_at + self._config.forecast_horizon

        return CachedPrediction(
            target_id=element_id,
            predictions=predictions,
            confidence=confidence,
            forecasted_at=forecasted_at,
            expires_at=expires_at,
        )

    # -----------------------------------------------------------------------
    # Confidence Estimation
    # -----------------------------------------------------------------------

    @staticmethod
    def _compute_confidence(predictions: list[ForecastPoint]) -> float:
        """Compute a confidence score from the quantile spread.

        Narrow quantile intervals indicate high confidence. The score is
        the average spread across all dimensions and all forecast steps,
        transformed via exponential decay to the range [0, 1].

        Args:
            predictions: The list of forecast points to score.

        Returns:
            A confidence value between 0.0 and 1.0.
        """
        if not predictions:
            return 0.0

        total_spread = 0.0
        count = 0

        for point in predictions:
            for dim in NUMERIC_DIMS:
                high = point.quantile_high.get(dim)
                low = point.quantile_low.get(dim)
                if isinstance(high, (int, float)) and isinstance(low, (int, float)):
                    total_spread += abs(high - low)
                    count += 1

        if count == 0:
            return 0.0

        avg_spread = total_spread / count
        decay_factor = 0.01
        confidence = math.exp(-decay_factor * avg_spread)
        return max(0.0, min(1.0, confidence))
