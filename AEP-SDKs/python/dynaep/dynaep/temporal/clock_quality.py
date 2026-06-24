# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/clock_quality.py
# ===========================================================================
# dynaep.temporal.clock_quality - Clock Quality Tracker (TIM-Compatible)
# TA-3.2: Tracks bridge clock sync state and computes TIM-compatible
# metadata per the IETF Temporal Integrity Metadata (TIM) Internet-Draft.
# Provides sync state machine, confidence class computation, anomaly
# flag detection, and uncertainty estimation via Welford's algorithm.
# ===========================================================================

from __future__ import annotations

import math
import time
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import List, Set

logger = logging.getLogger("dynaep.temporal.clock_quality")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------


class SyncState(Enum):
    """Clock synchronization state per TIM spec."""
    LOCKED = "LOCKED"
    HOLDOVER = "HOLDOVER"
    FREEWHEEL = "FREEWHEEL"


class ConfidenceClass(Enum):
    """TIM confidence class based on sync source and uncertainty."""
    A = "A"
    B = "B"
    C = "C"
    D = "D"
    E = "E"
    F = "F"


class AnomalyFlag(Enum):
    """Anomaly flags detected during clock quality tracking."""
    LARGE_STEP = "LARGE_STEP"
    HIGH_JITTER = "HIGH_JITTER"
    SOURCE_CHANGE = "SOURCE_CHANGE"
    SYNC_LOSS = "SYNC_LOSS"


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class TIMConfig:
    """Configuration for TIM-compatible clock quality tracking."""
    enabled: bool = True
    holdover_threshold: int = 3       # consecutive failures before LOCKED->HOLDOVER
    freewheel_threshold: int = 10     # consecutive failures before HOLDOVER->FREEWHEEL
    uncertainty_estimation: str = "variance"  # "variance" | "fixed"
    fixed_uncertainty_ns: int = 10_000_000


@dataclass
class TIMMetadata:
    """Complete TIM-compatible metadata block."""
    sync_state: str
    uncertainty_ns: int
    sequence_token: int
    sync_source: str
    confidence_class: str
    anomaly_flags: List[str]


# ---------------------------------------------------------------------------
# Welford's Online Algorithm
# ---------------------------------------------------------------------------


class WelfordVariance:
    """Welford's online algorithm for streaming variance computation.

    Tracks mean and M2 (sum of squared differences from the mean)
    without storing the full history in memory.
    """

    def __init__(self) -> None:
        self._count: int = 0
        self._mean: float = 0.0
        self._m2: float = 0.0

    def update(self, value: float) -> None:
        """Add a new observation."""
        self._count += 1
        delta = value - self._mean
        self._mean += delta / self._count
        delta2 = value - self._mean
        self._m2 += delta * delta2

    def get_variance(self) -> float:
        """Return the sample variance (Bessel-corrected)."""
        if self._count < 2:
            return 0.0
        return self._m2 / (self._count - 1)

    def get_std_dev(self) -> float:
        """Return the sample standard deviation."""
        return math.sqrt(self.get_variance())

    def get_count(self) -> int:
        """Return the number of observations."""
        return self._count

    def reset(self) -> None:
        """Reset all tracked statistics."""
        self._count = 0
        self._mean = 0.0
        self._m2 = 0.0


# ---------------------------------------------------------------------------
# ClockQualityTracker
# ---------------------------------------------------------------------------


class ClockQualityTracker:
    """Tracks bridge clock sync state and computes TIM-compatible metadata.

    Implements the TIM sync state machine (FREEWHEEL -> LOCKED -> HOLDOVER
    -> FREEWHEEL), confidence class computation based on sync source and
    uncertainty, and anomaly detection for large steps, high jitter,
    source changes, and sync loss.
    """

    # Jitter detection thresholds
    JITTER_THRESHOLD_MS: float = 50.0
    LARGE_STEP_THRESHOLD_MS: float = 1000.0

    def __init__(self, config: TIMConfig) -> None:
        self._config = TIMConfig(
            enabled=config.enabled,
            holdover_threshold=config.holdover_threshold,
            freewheel_threshold=config.freewheel_threshold,
            uncertainty_estimation=config.uncertainty_estimation,
            fixed_uncertainty_ns=config.fixed_uncertainty_ns,
        )
        self._sync_state: SyncState = SyncState.FREEWHEEL  # Start in FREEWHEEL per spec
        self._consecutive_failures: int = 0
        self._sequence_token: int = 0
        self._last_sync_source: str = "none"
        self._current_anomaly_flags: Set[AnomalyFlag] = set()
        self._offset_variance = WelfordVariance()
        self._last_offset_ms: float | None = None
        self._last_sync_at: float = 0.0

    # -----------------------------------------------------------------------
    # Sync Recording
    # -----------------------------------------------------------------------

    def record_sync_success(self, offset_ms: float, source: str) -> None:
        """Record a successful clock sync.

        Updates the state machine, checks for anomalies, and advances
        the variance tracker with the new offset measurement.
        """
        if not self._config.enabled:
            return

        # Check for source change
        if self._last_sync_source != "none" and self._last_sync_source != source:
            self._current_anomaly_flags.add(AnomalyFlag.SOURCE_CHANGE)

        # Check for large step
        if self._last_offset_ms is not None:
            step = abs(offset_ms - self._last_offset_ms)
            if step > self.LARGE_STEP_THRESHOLD_MS:
                self._current_anomaly_flags.add(AnomalyFlag.LARGE_STEP)

            # Check for high jitter
            if step > self.JITTER_THRESHOLD_MS and self._offset_variance.get_count() > 2:
                std_dev = self._offset_variance.get_std_dev()
                if step > std_dev * 3:
                    self._current_anomaly_flags.add(AnomalyFlag.HIGH_JITTER)

        # Update variance tracker
        self._offset_variance.update(offset_ms)

        # Clear SYNC_LOSS on success
        self._current_anomaly_flags.discard(AnomalyFlag.SYNC_LOSS)

        # Transition state
        self._sync_state = SyncState.LOCKED
        self._consecutive_failures = 0
        self._last_sync_source = source
        self._last_offset_ms = offset_ms
        self._last_sync_at = time.time() * 1000.0

        # Increment sequence token (monotonically increasing)
        self._sequence_token += 1

    def record_sync_failure(self) -> None:
        """Record a failed clock sync.

        Advances the state machine from LOCKED -> HOLDOVER -> FREEWHEEL
        based on consecutive failure counts against configured thresholds.
        """
        if not self._config.enabled:
            return

        self._consecutive_failures += 1

        if self._sync_state == SyncState.LOCKED:
            if self._consecutive_failures >= self._config.holdover_threshold:
                self._sync_state = SyncState.HOLDOVER
        elif self._sync_state == SyncState.HOLDOVER:
            if self._consecutive_failures >= self._config.freewheel_threshold:
                self._sync_state = SyncState.FREEWHEEL
                self._current_anomaly_flags.add(AnomalyFlag.SYNC_LOSS)

        # Increment sequence token regardless of sync outcome
        self._sequence_token += 1

    # -----------------------------------------------------------------------
    # State Queries
    # -----------------------------------------------------------------------

    def get_sync_state(self) -> SyncState:
        """Return the current sync state."""
        return self._sync_state

    def get_uncertainty_ns(self) -> int:
        """Compute uncertainty in nanoseconds.

        Uses either fixed uncertainty or variance-based estimation
        depending on configuration. Variance-based returns 2-sigma
        uncertainty converted from milliseconds to nanoseconds.
        """
        if not self._config.enabled:
            return 0

        if self._config.uncertainty_estimation == "fixed":
            return self._config.fixed_uncertainty_ns

        # Variance-based: convert standard deviation from ms to ns
        if self._offset_variance.get_count() < 2:
            # Not enough samples - use fixed fallback
            return self._config.fixed_uncertainty_ns

        std_dev_ms = self._offset_variance.get_std_dev()
        # 2-sigma uncertainty in nanoseconds
        return round(std_dev_ms * 2 * 1_000_000)

    def get_confidence_class(self) -> ConfidenceClass:
        """Compute confidence class based on sync source and uncertainty.

        Classes A-B require PTP, C-D require NTP, E is system clock
        or high-uncertainty, F is FREEWHEEL state.
        """
        if not self._config.enabled:
            return ConfidenceClass.E

        if self._sync_state == SyncState.FREEWHEEL:
            return ConfidenceClass.F

        uncertainty_ns = self.get_uncertainty_ns()
        source = self._last_sync_source.upper()

        if source == "PTP":
            if uncertainty_ns < 1_000:
                return ConfidenceClass.A
            if uncertainty_ns < 100_000:
                return ConfidenceClass.B
            # PTP with high uncertainty falls through to system

        if source == "NTP":
            if uncertainty_ns < 10_000_000:
                return ConfidenceClass.C
            if uncertainty_ns < 100_000_000:
                return ConfidenceClass.D

        # System clock or high-uncertainty NTP/PTP
        return ConfidenceClass.E

    def get_anomaly_flags(self) -> List[AnomalyFlag]:
        """Return the current set of anomaly flags."""
        return list(self._current_anomaly_flags)

    def clear_transient_anomaly_flags(self) -> None:
        """Clear transient anomaly flags after they have been reported.

        SYNC_LOSS persists until a successful sync.
        """
        self._current_anomaly_flags.discard(AnomalyFlag.LARGE_STEP)
        self._current_anomaly_flags.discard(AnomalyFlag.HIGH_JITTER)
        self._current_anomaly_flags.discard(AnomalyFlag.SOURCE_CHANGE)

    def get_tim_block(self) -> TIMMetadata:
        """Return the complete TIM-compatible metadata block."""
        return TIMMetadata(
            sync_state=self._sync_state.value,
            uncertainty_ns=self.get_uncertainty_ns(),
            sequence_token=self._sequence_token,
            sync_source=self._last_sync_source.upper(),
            confidence_class=self.get_confidence_class().value,
            anomaly_flags=[f.value for f in self.get_anomaly_flags()],
        )

    # -----------------------------------------------------------------------
    # Diagnostics
    # -----------------------------------------------------------------------

    def get_consecutive_failures(self) -> int:
        """Return the count of consecutive sync failures."""
        return self._consecutive_failures

    def get_sequence_token(self) -> int:
        """Return the current monotonically increasing sequence token."""
        return self._sequence_token

    def get_last_sync_at(self) -> float:
        """Return the timestamp (ms) of the last successful sync."""
        return self._last_sync_at

    def get_last_sync_source(self) -> str:
        """Return the last sync source identifier."""
        return self._last_sync_source

    def is_enabled(self) -> bool:
        """Return whether TIM tracking is enabled."""
        return self._config.enabled
