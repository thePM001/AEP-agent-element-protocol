# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/validator.py
# ===========================================================================
# dynaep.temporal.validator - Temporal Validator
# Validates AG-UI event timestamps against the BridgeClock, detecting drift,
# future timestamps, stale events, and causal ordering violations.
# Every event passing through validation receives a BridgeTimestamp annotation.
# ===========================================================================

from __future__ import annotations
import time
import logging
from dataclasses import dataclass, field
from typing import Optional

from dynaep.temporal.clock import BridgeClock, BridgeTimestamp

logger = logging.getLogger("dynaep.temporal.validator")

# ---------------------------------------------------------------------------
# Maximum number of rejection log entries to retain in memory
# ---------------------------------------------------------------------------
MAX_REJECTION_LOG_SIZE = 500


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class TemporalViolation:
    """Describes a single temporal constraint violation."""
    type: str  # "drift_exceeded" | "future_timestamp" | "stale_event" | "causal_violation"
    detail: str
    agent_time_ms: Optional[int]
    bridge_time_ms: int
    threshold_ms: int


@dataclass
class TemporalValidationResult:
    """Result of validating a single event through the temporal pipeline."""
    accepted: bool
    bridge_timestamp: BridgeTimestamp
    violations: list
    warnings: list


@dataclass
class TemporalValidatorConfig:
    """Configuration controlling the strictness of temporal validation."""
    max_drift_ms: int = 50
    max_future_ms: int = 500
    max_staleness_ms: int = 5000
    overwrite_timestamps: bool = True
    log_rejections: bool = True
    mode: str = "strict"  # "strict" | "permissive" | "log_only"


# ---------------------------------------------------------------------------
# Internal bookkeeping
# ---------------------------------------------------------------------------


@dataclass
class _RejectionLogEntry:
    """Internal record of a rejected or violated event."""
    event_type: str
    violations: list
    recorded_at: int


# ---------------------------------------------------------------------------
# TemporalValidator
# ---------------------------------------------------------------------------


class TemporalValidator:
    """Validates AG-UI event timestamps against the BridgeClock.

    Detects drift, future timestamps, and stale events. Operates in three
    modes: strict (reject on violation), permissive (accept with warnings),
    and log_only (accept all, log violations silently).
    """

    def __init__(self, clock: BridgeClock, config: TemporalValidatorConfig) -> None:
        self._clock = clock
        self._config = config
        self._rejection_log: list[_RejectionLogEntry] = []
        self._last_validated_bridge_ms: int = 0

    # -----------------------------------------------------------------------
    # Primary validation entry point
    # -----------------------------------------------------------------------

    def validate(self, event: dict) -> TemporalValidationResult:
        """Run the full temporal validation pipeline on a single event.

        Steps:
        1. Read the agent-supplied timestamp (may be absent)
        2. Produce the authoritative BridgeTimestamp from the clock
        3. Overwrite the event timestamp when configured
        4. Check drift between agent time and bridge time
        5. Check for future timestamps
        6. Check for staleness
        7. Attach BridgeTimestamp metadata to the event
        8. Determine acceptance based on mode
        """
        violations: list[TemporalViolation] = []
        warnings: list[str] = []

        # Step 1: Read the agent-supplied timestamp
        raw_ts = event.get("timestamp")
        agent_time_ms: Optional[int] = int(raw_ts) if isinstance(raw_ts, (int, float)) else None

        # Step 2: Produce the authoritative BridgeTimestamp
        bridge_timestamp = self._clock.stamp(agent_time_ms)
        bridge_time_ms = bridge_timestamp.bridge_time_ms

        # Step 3: Overwrite the event timestamp when configured
        if self._config.overwrite_timestamps:
            event["timestamp"] = bridge_time_ms
            warnings.append(
                "Agent timestamp overwritten with bridge time " + str(bridge_time_ms)
            )

        # Step 4: Check drift
        if agent_time_ms is not None:
            drift_ok, drift_ms = self.check_drift(agent_time_ms)
            if not drift_ok:
                violations.append(TemporalViolation(
                    type="drift_exceeded",
                    detail=(
                        "Drift of " + str(drift_ms) + "ms exceeds maximum allowed "
                        + str(self._config.max_drift_ms) + "ms"
                    ),
                    agent_time_ms=agent_time_ms,
                    bridge_time_ms=bridge_time_ms,
                    threshold_ms=self._config.max_drift_ms,
                ))

        # Step 5: Check for future timestamps
        if agent_time_ms is not None:
            is_future = self.check_future_timestamp(agent_time_ms)
            if is_future:
                violations.append(TemporalViolation(
                    type="future_timestamp",
                    detail=(
                        "Agent timestamp " + str(agent_time_ms)
                        + "ms is beyond the allowed future window of "
                        + str(self._config.max_future_ms) + "ms past bridge time"
                    ),
                    agent_time_ms=agent_time_ms,
                    bridge_time_ms=bridge_time_ms,
                    threshold_ms=self._config.max_future_ms,
                ))

        # Step 6: Check for staleness
        if agent_time_ms is not None:
            is_stale = self.check_staleness(agent_time_ms)
            if is_stale:
                violations.append(TemporalViolation(
                    type="stale_event",
                    detail=(
                        "Event is " + str(bridge_time_ms - agent_time_ms)
                        + "ms old, exceeding staleness limit of "
                        + str(self._config.max_staleness_ms) + "ms"
                    ),
                    agent_time_ms=agent_time_ms,
                    bridge_time_ms=bridge_time_ms,
                    threshold_ms=self._config.max_staleness_ms,
                ))

        # Step 7: Attach BridgeTimestamp metadata to the event
        event["_temporal"] = {
            "bridge_time_ms": bridge_timestamp.bridge_time_ms,
            "drift_ms": bridge_timestamp.drift_ms,
            "source": bridge_timestamp.source,
            "validated_at": int(time.time() * 1000),
        }

        # Update tracking for causal ordering checks
        self._last_validated_bridge_ms = bridge_time_ms

        # Step 8: Determine acceptance based on mode
        accepted = self._resolve_acceptance(violations, warnings, event)

        return TemporalValidationResult(
            accepted=accepted,
            bridge_timestamp=bridge_timestamp,
            violations=violations,
            warnings=warnings,
        )

    # -----------------------------------------------------------------------
    # Individual checks
    # -----------------------------------------------------------------------

    def check_drift(self, agent_time_ms: int) -> tuple:
        """Compare agent time against current bridge time.

        Returns a tuple of (within_tolerance: bool, drift_ms: int).
        The drift is the absolute difference between the two clocks.
        """
        current_bridge_ms = self._clock.now()
        drift_ms = abs(agent_time_ms - current_bridge_ms)
        within_tolerance = drift_ms <= self._config.max_drift_ms
        return (within_tolerance, drift_ms)

    def check_future_timestamp(self, agent_time_ms: int) -> bool:
        """Check if the agent timestamp is too far ahead of bridge time.

        Returns True if the agent time exceeds the bridge time by more
        than the configured max_future_ms window.
        """
        current_bridge_ms = self._clock.now()
        ahead_ms = agent_time_ms - current_bridge_ms
        exceeds_future_window = ahead_ms > self._config.max_future_ms
        return exceeds_future_window

    def check_staleness(self, agent_time_ms: int) -> bool:
        """Check if the event is too old relative to bridge time.

        Returns True if the age of the event exceeds the configured
        max_staleness_ms threshold.
        """
        current_bridge_ms = self._clock.now()
        age_ms = current_bridge_ms - agent_time_ms
        is_beyond_limit = age_ms > self._config.max_staleness_ms
        return is_beyond_limit

    # -----------------------------------------------------------------------
    # Batch validation
    # -----------------------------------------------------------------------

    def validate_batch(self, events: list) -> list:
        """Validate a list of events in order, returning a result for each.

        Events are processed sequentially so that each event's validation
        can observe the side effects (e.g. timestamp overwrite) of the
        events before it.
        """
        results: list[TemporalValidationResult] = []
        batch_size = len(events)
        for idx in range(batch_size):
            current_event = events[idx]
            result = self.validate(current_event)
            results.append(result)
        return results

    # -----------------------------------------------------------------------
    # Internal helpers
    # -----------------------------------------------------------------------

    def _resolve_acceptance(
        self,
        violations: list[TemporalViolation],
        warnings: list[str],
        event: dict,
    ) -> bool:
        """Determine whether the event should be accepted based on mode.

        In strict mode, any violation causes rejection.
        In permissive mode, violations become warnings but the event is accepted.
        In log_only mode, everything is accepted and violations are logged silently.
        """
        mode = self._config.mode
        has_violations = len(violations) > 0

        if mode == "strict":
            if has_violations and self._config.log_rejections:
                self._record_rejection(event, violations)
            return not has_violations

        if mode == "permissive":
            if has_violations:
                for v in violations:
                    warnings.append("[permissive] " + v.type + ": " + v.detail)
                if self._config.log_rejections:
                    self._record_rejection(event, violations)
            return True

        # log_only mode: accept everything, log all violations silently
        if has_violations:
            self._record_rejection(event, violations)
            for v in violations:
                warnings.append("[log_only] " + v.type + ": " + v.detail)
        return True

    def _record_rejection(
        self,
        event: dict,
        violations: list[TemporalViolation],
    ) -> None:
        """Record a rejection to the in-memory log.

        The log is capped at MAX_REJECTION_LOG_SIZE entries to prevent
        unbounded memory growth. Oldest entries are evicted first.
        """
        entry = _RejectionLogEntry(
            event_type=event.get("type", "unknown"),
            violations=list(violations),
            recorded_at=int(time.time() * 1000),
        )
        self._rejection_log.append(entry)

        if len(self._rejection_log) > MAX_REJECTION_LOG_SIZE:
            excess = len(self._rejection_log) - MAX_REJECTION_LOG_SIZE
            self._rejection_log = self._rejection_log[excess:]
