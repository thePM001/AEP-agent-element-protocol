# @PAD: /root/dynAEP/sdk/python/dynaep/forecast/forecast_cache.py
"""Synchronous O(1) prediction cache for the forecast subsystem."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Optional

from dynaep.temporal.clock import BridgeClock
from dynaep.temporal.forecast import ForecastConfig, ForecastPoint, AnomalyResult


NUMERIC_DIMS = ("x", "y", "width", "height")


@dataclass
class CachedPrediction:
    """A cached forecast prediction for a single element."""
    target_id: str
    predictions: list  # list of ForecastPoint
    confidence: float
    forecasted_at: int  # bridge-authoritative time ms
    expires_at: int     # forecasted_at + horizon_ms


class ForecastCache:
    """Synchronous O(1) cache for forecast predictions used in the dynAEP
    event processing pipeline.

    The bridge calls this during event processing and it must NEVER block.
    All time operations use the bridge-authoritative clock.
    """

    def __init__(self, config: ForecastConfig, bridge_clock: BridgeClock) -> None:
        self._config = config
        self._bridge_clock = bridge_clock
        self._cache: dict[str, CachedPrediction] = {}
        self._pending: set[str] = set()
        self._debounce_cache: dict[str, int] = {}

    # -----------------------------------------------------------------------
    # Anomaly Detection
    # -----------------------------------------------------------------------

    def check_anomaly(
        self,
        target_id: str,
        proposed_state: dict,
    ) -> Optional[AnomalyResult]:
        """Check whether a proposed state change is anomalous relative to the
        cached forecast for the given target.

        Returns None on cache miss (prediction not found or expired). On cache
        hit, computes a z-score from the cached prediction vs the proposed
        state using quantile spread as the reference width.

        This method is synchronous and O(1) -- it reads only from the
        in-memory cache and never performs I/O or async work.
        """
        prediction = self.get_cached_prediction(target_id)
        if prediction is None or len(prediction.predictions) == 0:
            return None

        # Use the first prediction step as the expected state
        first_prediction: ForecastPoint = prediction.predictions[0]
        predicted_state = first_prediction.predicted_state
        quantile_low = first_prediction.quantile_low
        quantile_high = first_prediction.quantile_high

        # Compute per-dimension z-scores using quantile spread as reference width
        max_z_score: float = 0.0
        for dim in NUMERIC_DIMS:
            predicted = predicted_state.get(dim)
            proposed = proposed_state.get(dim)
            q_low = quantile_low.get(dim)
            q_high = quantile_high.get(dim)

            if (
                not isinstance(predicted, (int, float))
                or not isinstance(proposed, (int, float))
                or not isinstance(q_low, (int, float))
                or not isinstance(q_high, (int, float))
            ):
                continue

            spread = abs(q_high - q_low)
            half_spread = spread / 2.0
            deviation = abs(proposed - predicted)
            if half_spread > 0:
                z_score = deviation / half_spread
            else:
                z_score = 10.0 if deviation > 0 else 0.0

            if z_score > max_z_score:
                max_z_score = z_score

        is_anomaly = max_z_score > self._config.anomaly_threshold

        if max_z_score > self._config.anomaly_threshold * 2:
            recommendation = "require_approval"
        elif max_z_score > self._config.anomaly_threshold:
            recommendation = "warn"
        else:
            recommendation = "pass"

        return AnomalyResult(
            is_anomaly=is_anomaly,
            score=max_z_score,
            predicted=predicted_state,
            actual=proposed_state,
            recommendation=recommendation,
        )

    # -----------------------------------------------------------------------
    # Adaptive Debounce
    # -----------------------------------------------------------------------

    def get_adaptive_debounce(self, target_id: str) -> int:
        """Return the cached adaptive debounce value for the given target
        element. If no adaptive value has been computed yet, falls back to
        the default debounce_ms from the forecast configuration.
        """
        cached = self._debounce_cache.get(target_id)
        if cached is not None:
            return cached
        return self._config.debounce_ms

    # -----------------------------------------------------------------------
    # Cache Access
    # -----------------------------------------------------------------------

    def get_cached_prediction(self, target_id: str) -> Optional[CachedPrediction]:
        """Retrieve the cached prediction for the given target element.

        Returns None if no prediction is cached or if the cached entry has
        expired according to the bridge-authoritative clock.
        """
        entry = self._cache.get(target_id)
        if entry is None:
            return None
        if self.is_expired(entry):
            del self._cache[target_id]
            return None
        return entry

    # -----------------------------------------------------------------------
    # Cache Updates (called by ForecastWorker)
    # -----------------------------------------------------------------------

    def update_cache(self, target_id: str, prediction: CachedPrediction) -> None:
        """Insert or replace a cached prediction for the given target element.

        This method is called by the ForecastWorker after an async forecast
        computation completes. It does not block event processing.
        """
        self._cache[target_id] = prediction

    def update_debounce(self, target_id: str, debounce_ms: int) -> None:
        """Update the adaptive debounce value for the given target element.

        Called by the ForecastWorker to propagate computed debounce intervals
        into the synchronous cache layer.
        """
        self._debounce_cache[target_id] = debounce_ms

    # -----------------------------------------------------------------------
    # Pending Elements
    # -----------------------------------------------------------------------

    def mark_pending(self, target_id: str) -> None:
        """Mark an element as pending forecast computation.

        The ForecastWorker uses this to track which elements need new
        forecasts without blocking the event processing pipeline.
        """
        self._pending.add(target_id)

    def get_pending_elements(self) -> list[str]:
        """Retrieve and atomically clear the set of elements pending forecast
        computation. The ForecastWorker calls this to drain the pending queue
        and begin async forecast work for each element.
        """
        elements = list(self._pending)
        self._pending.clear()
        return elements

    # -----------------------------------------------------------------------
    # Expiry
    # -----------------------------------------------------------------------

    def is_expired(self, prediction: CachedPrediction) -> bool:
        """Check whether a cached prediction has expired.

        Uses the bridge-authoritative clock to compare the current time
        against the prediction's expires_at timestamp.
        """
        now = self._bridge_clock.now()
        return now > prediction.expires_at
