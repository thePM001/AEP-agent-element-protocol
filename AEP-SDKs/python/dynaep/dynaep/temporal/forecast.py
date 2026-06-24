# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/forecast.py
# ===========================================================================
# dynaep.temporal.forecast - Forecast Sidecar
# Provides runtime coordinate forecasting and anomaly detection for
# design elements using TimesFM (local or remote) and z-score analysis.
# Tracks element coordinate histories, produces horizon predictions,
# and computes adaptive debounce intervals from event cadence.
# ===========================================================================

from __future__ import annotations
import time
import math
import logging
import statistics
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("dynaep.temporal.forecast")


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class RuntimeCoordinates:
    """Spatial and visibility state of a design element at a point in time."""
    x: float
    y: float
    width: float
    height: float
    visible: bool
    rendered_at: str


@dataclass
class ForecastPoint:
    """A single prediction step within a forecast horizon."""
    offset_ms: int
    predicted_state: dict
    quantile_low: dict
    quantile_high: dict


@dataclass
class TemporalForecast:
    """Full forecast result for a tracked element."""
    target_id: str
    forecasted_at: int
    horizon_ms: int
    predictions: list
    confidence: float
    anomaly_detected: bool
    anomaly_score: float


@dataclass
class AnomalyResult:
    """Result of anomaly detection comparing predicted vs. actual state."""
    is_anomaly: bool
    score: float
    predicted: dict
    actual: dict
    recommendation: str


@dataclass
class ForecastConfig:
    """Configuration for the forecast sidecar."""
    enabled: bool = False
    timesfm_endpoint: Optional[str] = None
    timesfm_mode: str = "local"  # "local" | "remote"
    context_window: int = 64
    forecast_horizon: int = 12
    anomaly_threshold: float = 3.0
    debounce_ms: int = 250
    max_tracked_elements: int = 500


# ---------------------------------------------------------------------------
# Internal history entry
# ---------------------------------------------------------------------------


@dataclass
class _HistoryEntry:
    """A single coordinate snapshot with timestamp for history tracking."""
    coordinates: RuntimeCoordinates
    recorded_at_ms: int


# ---------------------------------------------------------------------------
# Forecast Sidecar
# ---------------------------------------------------------------------------


class ForecastSidecar:
    """Manages element coordinate histories, forecasting, and anomaly detection.

    Supports native TimesFM inference when the library is importable,
    HTTP-based remote inference via the timesfm_endpoint, and a simple
    linear extrapolation fallback when neither is available.
    """

    def __init__(self, config: ForecastConfig) -> None:
        self._config = config
        self._histories: dict[str, list[_HistoryEntry]] = {}
        self._last_forecast_time: dict[str, int] = {}
        self._is_available: bool = False
        self._last_check: int = 0
        self._model: object = None
        self._availability_cache_ttl_ms: int = 30_000

    # -----------------------------------------------------------------------
    # Availability
    # -----------------------------------------------------------------------

    def available(self) -> bool:
        """Check whether the forecasting backend is reachable.

        Tries to import TimesFM locally first. If that fails, checks the
        configured HTTP endpoint. Results are cached for 30 seconds to
        avoid repeated probes.
        """
        current_ms = int(time.time() * 1000)
        if (current_ms - self._last_check) < self._availability_cache_ttl_ms:
            return self._is_available

        self._last_check = current_ms

        # Try local TimesFM import
        if self._config.timesfm_mode == "local":
            try:
                import timesfm as _tfm
                if self._model is None:
                    self._model = _tfm
                self._is_available = True
                return True
            except ImportError:
                logger.debug("TimesFM not installed locally, checking remote endpoint")

        # Try remote endpoint health check
        if self._config.timesfm_endpoint is not None:
            try:
                import urllib.request
                url = self._config.timesfm_endpoint.rstrip("/") + "/health"
                req = urllib.request.Request(url, method="GET")
                with urllib.request.urlopen(req, timeout=5) as resp:
                    self._is_available = resp.status == 200
                    return self._is_available
            except Exception as exc:
                logger.debug("Remote TimesFM endpoint unreachable: %s", exc)

        self._is_available = False
        return False

    # -----------------------------------------------------------------------
    # Data ingestion
    # -----------------------------------------------------------------------

    def ingest(self, event: dict) -> None:
        """Store a coordinate snapshot for an element from an incoming event.

        Extracts the element_id and coordinate fields from the event dict,
        appends to the history, and trims to the configured context window.
        """
        element_id = event.get("element_id") or event.get("target_id")
        if element_id is None:
            logger.debug("Ingest event missing element_id or target_id, skipping")
            return

        coords = RuntimeCoordinates(
            x=float(event.get("x", 0.0)),
            y=float(event.get("y", 0.0)),
            width=float(event.get("width", 0.0)),
            height=float(event.get("height", 0.0)),
            visible=bool(event.get("visible", True)),
            rendered_at=str(event.get("rendered_at", "")),
        )

        entry = _HistoryEntry(
            coordinates=coords,
            recorded_at_ms=int(time.time() * 1000),
        )

        if element_id not in self._histories:
            # Enforce maximum tracked elements
            if len(self._histories) >= self._config.max_tracked_elements:
                oldest_key = min(
                    self._histories.keys(),
                    key=lambda k: (
                        self._histories[k][-1].recorded_at_ms
                        if self._histories[k]
                        else 0
                    ),
                )
                del self._histories[oldest_key]
            self._histories[element_id] = []

        history = self._histories[element_id]
        history.append(entry)

        # Trim history to context window
        if len(history) > self._config.context_window:
            excess = len(history) - self._config.context_window
            del history[:excess]

    # -----------------------------------------------------------------------
    # Forecasting
    # -----------------------------------------------------------------------

    def forecast(self, element_id: str) -> Optional[TemporalForecast]:
        """Produce a temporal forecast for a tracked element.

        Uses native TimesFM if importable, HTTP to the configured endpoint
        if available, or falls back to linear extrapolation. Returns None
        if the element has no history or fewer than 3 data points.
        """
        history = self._histories.get(element_id)
        if history is None or len(history) < 3:
            logger.debug("Insufficient history for element %s (need at least 3)", element_id)
            return None

        forecasted_at = int(time.time() * 1000)
        self._last_forecast_time[element_id] = forecasted_at

        # Extract time series for x, y, width, height
        x_series = [e.coordinates.x for e in history]
        y_series = [e.coordinates.y for e in history]
        w_series = [e.coordinates.width for e in history]
        h_series = [e.coordinates.height for e in history]
        timestamps = [e.recorded_at_ms for e in history]

        # Try native TimesFM
        if self._model is not None and self._config.timesfm_mode == "local":
            return self._forecast_native(
                element_id, forecasted_at, x_series, y_series, w_series, h_series, timestamps
            )

        # Try remote endpoint
        if self._config.timesfm_endpoint is not None:
            result = self._forecast_remote(
                element_id, forecasted_at, x_series, y_series, w_series, h_series
            )
            if result is not None:
                return result

        # Fallback to linear extrapolation
        return self._forecast_linear(
            element_id, forecasted_at, x_series, y_series, w_series, h_series, timestamps
        )

    def _forecast_native(
        self,
        element_id: str,
        forecasted_at: int,
        x_series: list[float],
        y_series: list[float],
        w_series: list[float],
        h_series: list[float],
        timestamps: list[int],
    ) -> Optional[TemporalForecast]:
        """Forecast using the locally imported TimesFM model.

        Feeds each coordinate dimension as a separate univariate series
        and combines the predictions into ForecastPoint objects.
        """
        horizon = self._config.forecast_horizon
        try:
            tfm = self._model
            all_series = [x_series, y_series, w_series, h_series]
            dim_names = ["x", "y", "width", "height"]
            all_predictions: dict[str, list[float]] = {}

            for dim_name, series in zip(dim_names, all_series):
                pred = tfm.forecast(series, horizon=horizon)  # type: ignore[attr-defined]
                if hasattr(pred, "tolist"):
                    all_predictions[dim_name] = pred.tolist()
                else:
                    all_predictions[dim_name] = list(pred)

            predictions = self._build_forecast_points(all_predictions, timestamps, horizon)
            avg_interval = self._mean_interval(timestamps)
            confidence = min(0.95, 0.5 + len(x_series) * 0.01)

            return TemporalForecast(
                target_id=element_id,
                forecasted_at=forecasted_at,
                horizon_ms=int(avg_interval * horizon),
                predictions=predictions,
                confidence=confidence,
                anomaly_detected=False,
                anomaly_score=0.0,
            )
        except Exception as exc:
            logger.warning("Native TimesFM forecast failed for %s: %s", element_id, exc)
            return None

    def _forecast_remote(
        self,
        element_id: str,
        forecasted_at: int,
        x_series: list[float],
        y_series: list[float],
        w_series: list[float],
        h_series: list[float],
    ) -> Optional[TemporalForecast]:
        """Forecast by sending coordinate series to the remote TimesFM endpoint.

        Posts JSON containing the four coordinate dimensions and parses
        the response into ForecastPoint objects.
        """
        import json
        import urllib.request

        endpoint = self._config.timesfm_endpoint
        if endpoint is None:
            return None

        url = endpoint.rstrip("/") + "/predict"
        payload = json.dumps({
            "element_id": element_id,
            "horizon": self._config.forecast_horizon,
            "series": {
                "x": x_series,
                "y": y_series,
                "width": w_series,
                "height": h_series,
            },
        }).encode("utf-8")

        try:
            req = urllib.request.Request(
                url,
                data=payload,
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                predictions_raw = body.get("predictions", [])
                predictions = []
                for p in predictions_raw:
                    predictions.append(ForecastPoint(
                        offset_ms=int(p.get("offset_ms", 0)),
                        predicted_state=p.get("predicted_state", {}),
                        quantile_low=p.get("quantile_low", {}),
                        quantile_high=p.get("quantile_high", {}),
                    ))
                return TemporalForecast(
                    target_id=element_id,
                    forecasted_at=forecasted_at,
                    horizon_ms=int(body.get("horizon_ms", 0)),
                    predictions=predictions,
                    confidence=float(body.get("confidence", 0.5)),
                    anomaly_detected=bool(body.get("anomaly_detected", False)),
                    anomaly_score=float(body.get("anomaly_score", 0.0)),
                )
        except Exception as exc:
            logger.warning("Remote forecast for %s failed: %s", element_id, exc)
            return None

    def _forecast_linear(
        self,
        element_id: str,
        forecasted_at: int,
        x_series: list[float],
        y_series: list[float],
        w_series: list[float],
        h_series: list[float],
        timestamps: list[int],
    ) -> TemporalForecast:
        """Forecast using simple linear extrapolation as a fallback.

        Computes the slope from the last two data points in each dimension
        and extends forward for the configured forecast horizon.
        """
        horizon = self._config.forecast_horizon
        avg_interval = self._mean_interval(timestamps)
        predictions: list[ForecastPoint] = []

        # Compute slopes from last two observations
        def slope(series: list[float]) -> float:
            if len(series) < 2:
                return 0.0
            delta = series[-1] - series[-2]
            return delta

        dx = slope(x_series)
        dy = slope(y_series)
        dw = slope(w_series)
        dh = slope(h_series)

        # Compute standard deviations for quantile estimates
        def safe_stdev(series: list[float]) -> float:
            if len(series) < 2:
                return 1.0
            return statistics.stdev(series) if statistics.stdev(series) > 0.0 else 1.0

        sx = safe_stdev(x_series)
        sy = safe_stdev(y_series)
        sw = safe_stdev(w_series)
        sh = safe_stdev(h_series)

        for step in range(1, horizon + 1):
            offset_ms = int(avg_interval * step)
            predicted = {
                "x": x_series[-1] + dx * step,
                "y": y_series[-1] + dy * step,
                "width": w_series[-1] + dw * step,
                "height": h_series[-1] + dh * step,
            }
            # 90% quantile band based on historical variance
            quantile_factor = 1.645 * math.sqrt(step)
            quantile_low = {
                "x": predicted["x"] - sx * quantile_factor,
                "y": predicted["y"] - sy * quantile_factor,
                "width": predicted["width"] - sw * quantile_factor,
                "height": predicted["height"] - sh * quantile_factor,
            }
            quantile_high = {
                "x": predicted["x"] + sx * quantile_factor,
                "y": predicted["y"] + sy * quantile_factor,
                "width": predicted["width"] + sw * quantile_factor,
                "height": predicted["height"] + sh * quantile_factor,
            }
            predictions.append(ForecastPoint(
                offset_ms=offset_ms,
                predicted_state=predicted,
                quantile_low=quantile_low,
                quantile_high=quantile_high,
            ))

        # Confidence decays with fewer observations
        confidence = min(0.80, 0.3 + len(x_series) * 0.008)

        return TemporalForecast(
            target_id=element_id,
            forecasted_at=forecasted_at,
            horizon_ms=int(avg_interval * horizon),
            predictions=predictions,
            confidence=confidence,
            anomaly_detected=False,
            anomaly_score=0.0,
        )

    # -----------------------------------------------------------------------
    # Anomaly detection
    # -----------------------------------------------------------------------

    def check_anomaly(self, element_id: str, proposed: dict) -> AnomalyResult:
        """Check whether a proposed state deviates anomalously from history.

        Computes the z-score per coordinate dimension using the element's
        historical mean and standard deviation. If the aggregate score
        exceeds the configured threshold, it is flagged as anomalous.
        """
        history = self._histories.get(element_id)
        if history is None or len(history) < 3:
            return AnomalyResult(
                is_anomaly=False,
                score=0.0,
                predicted={},
                actual=proposed,
                recommendation="Not enough history to evaluate anomaly",
            )

        dim_names = ["x", "y", "width", "height"]
        dim_series: dict[str, list[float]] = {
            "x": [e.coordinates.x for e in history],
            "y": [e.coordinates.y for e in history],
            "width": [e.coordinates.width for e in history],
            "height": [e.coordinates.height for e in history],
        }

        z_scores: dict[str, float] = {}
        predicted_means: dict[str, float] = {}

        for dim in dim_names:
            series = dim_series[dim]
            mean_val = statistics.mean(series)
            predicted_means[dim] = mean_val
            std_val = statistics.stdev(series) if len(series) > 1 else 1.0
            if std_val < 0.001:
                std_val = 0.001
            proposed_val = float(proposed.get(dim, mean_val))
            z_scores[dim] = abs(proposed_val - mean_val) / std_val

        # Aggregate score is the root-mean-square of individual z-scores
        sum_sq = sum(z * z for z in z_scores.values())
        aggregate_score = math.sqrt(sum_sq / len(z_scores))

        is_anomaly = aggregate_score > self._config.anomaly_threshold
        recommendation = "No action needed"
        if is_anomaly:
            worst_dim = max(z_scores.keys(), key=lambda k: z_scores[k])
            recommendation = (
                "Coordinate '" + worst_dim + "' deviates significantly "
                "(z=" + str(round(z_scores[worst_dim], 2)) + "). "
                "Review the proposed change or re-sync the element state."
            )

        return AnomalyResult(
            is_anomaly=is_anomaly,
            score=round(aggregate_score, 4),
            predicted=predicted_means,
            actual=proposed,
            recommendation=recommendation,
        )

    # -----------------------------------------------------------------------
    # History access
    # -----------------------------------------------------------------------

    def get_history(self, element_id: str) -> list:
        """Return a copy of the coordinate history for a given element.

        Each entry is a dict containing the coordinates and timestamp.
        Returns an empty list if the element is not tracked.
        """
        history = self._histories.get(element_id)
        if history is None:
            return []
        return [
            {
                "x": e.coordinates.x,
                "y": e.coordinates.y,
                "width": e.coordinates.width,
                "height": e.coordinates.height,
                "visible": e.coordinates.visible,
                "rendered_at": e.coordinates.rendered_at,
                "recorded_at_ms": e.recorded_at_ms,
            }
            for e in history
        ]

    # -----------------------------------------------------------------------
    # Adaptive debounce
    # -----------------------------------------------------------------------

    def adaptive_debounce(self, element_id: str) -> int:
        """Compute an adaptive debounce interval based on event cadence.

        Uses the median inter-event interval from the element's history,
        clamped to the range [50, 2000] milliseconds. Falls back to the
        configured default if there is insufficient history.
        """
        history = self._histories.get(element_id)
        if history is None or len(history) < 2:
            return self._config.debounce_ms

        intervals: list[int] = []
        for i in range(1, len(history)):
            delta = history[i].recorded_at_ms - history[i - 1].recorded_at_ms
            if delta > 0:
                intervals.append(delta)

        if len(intervals) == 0:
            return self._config.debounce_ms

        median_interval = int(statistics.median(intervals))
        clamped = max(50, min(2000, median_interval))
        return clamped

    # -----------------------------------------------------------------------
    # Pruning
    # -----------------------------------------------------------------------

    def prune(self, active_element_ids: list) -> None:
        """Remove history for elements not in the active set.

        This prevents unbounded memory growth when elements are removed
        from the design. Also cleans up last_forecast_time entries.
        """
        active_set = set(active_element_ids)
        stale_keys = [
            key for key in self._histories
            if key not in active_set
        ]
        for key in stale_keys:
            del self._histories[key]
            if key in self._last_forecast_time:
                del self._last_forecast_time[key]
        if len(stale_keys) > 0:
            logger.debug("Pruned %d stale element histories", len(stale_keys))

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _mean_interval(self, timestamps: list[int]) -> float:
        """Compute the mean interval between consecutive timestamps.

        Returns the configured debounce_ms as a fallback when there are
        fewer than two timestamps in the list.
        """
        if len(timestamps) < 2:
            return float(self._config.debounce_ms)
        intervals = []
        for i in range(1, len(timestamps)):
            delta = timestamps[i] - timestamps[i - 1]
            if delta > 0:
                intervals.append(delta)
        if len(intervals) == 0:
            return float(self._config.debounce_ms)
        return sum(intervals) / len(intervals)

    def _build_forecast_points(
        self,
        dim_predictions: dict[str, list[float]],
        timestamps: list[int],
        horizon: int,
    ) -> list[ForecastPoint]:
        """Build ForecastPoint objects from per-dimension prediction arrays.

        Each step produces a predicted state dict plus quantile bounds
        estimated at +/- 10% of the predicted value.
        """
        avg_interval = self._mean_interval(timestamps)
        points: list[ForecastPoint] = []
        dim_names = ["x", "y", "width", "height"]

        for step in range(horizon):
            offset_ms = int(avg_interval * (step + 1))
            predicted_state = {}
            quantile_low = {}
            quantile_high = {}

            for dim in dim_names:
                preds = dim_predictions.get(dim, [])
                if step < len(preds):
                    val = preds[step]
                else:
                    val = preds[-1] if preds else 0.0
                predicted_state[dim] = val
                spread = abs(val) * 0.10 if abs(val) > 0.01 else 1.0
                quantile_low[dim] = val - spread
                quantile_high[dim] = val + spread

            points.append(ForecastPoint(
                offset_ms=offset_ms,
                predicted_state=predicted_state,
                quantile_low=quantile_low,
                quantile_high=quantile_high,
            ))

        return points
