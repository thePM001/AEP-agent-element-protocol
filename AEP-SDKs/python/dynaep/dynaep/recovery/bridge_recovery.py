# @PAD: /root/dynAEP/sdk/python/dynaep/recovery/bridge_recovery.py
# ===========================================================================
# dynaep.recovery.bridge_recovery - Bridge Recovery Protocol
# TA-3.4: Three-phase recovery protocol for bridge restarts. On restart the
# bridge checks for persisted causal state, announces recovery to agents,
# handles agent re-registration, and replays any buffered events from the
# durable store. This eliminates full resets when the bridge can recover
# within max_recovery_gap_ms of the last persisted snapshot.
#
# Phase 1: Announce Recovery  - load persisted state, emit RECOVERY or RESET
# Phase 2: Agent Re-register  - accept AEP_AGENT_REREGISTER, compare sequences
# Phase 3: Buffer Replay      - replay reorder buffer through causal engine
# ===========================================================================

from __future__ import annotations

import logging
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Protocol

logger = logging.getLogger("dynaep.recovery.bridge_recovery")


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class RecoveryConfig:
    """Configuration for the bridge recovery protocol.

    Attributes:
        max_recovery_gap_ms: Maximum age (in milliseconds) of persisted
            state that the bridge will accept for recovery. State older
            than this triggers a full reset instead.
        enabled: When False, the protocol always falls back to a full
            reset regardless of persisted state.
    """
    max_recovery_gap_ms: float
    enabled: bool


@dataclass
class RecoveryResult:
    """Result of a recovery attempt, capturing what was restored (or not)
    and any events lost during the gap.

    Attributes:
        recovered: True if persisted state was loaded successfully.
        source: Backend that provided the state, or "none" if recovery
            was skipped or failed.
        restored_agents: Agent IDs found in the persisted registry.
        restored_causal_position: Global causal position counter restored
            from the durable store.
        gap_ms: Milliseconds between the persisted snapshot and the
            current wall-clock time.
        dropped_events: Number of buffered events that failed replay
            during Phase 3.
        state_age: Human-readable description of the snapshot age
            (e.g. "12s", "3m 45s", "2h 10m").
    """
    recovered: bool
    source: str  # "file" | "sqlite" | "external" | "none"
    restored_agents: List[str] = field(default_factory=list)
    restored_causal_position: int = 0
    gap_ms: float = 0.0
    dropped_events: int = 0
    state_age: str = "0s"


# ---------------------------------------------------------------------------
# Protocol types (duck-typed store/engine interfaces)
# ---------------------------------------------------------------------------


class RecoveryStore(Protocol):
    """Duck-typed interface for the durable causal store used by recovery.

    Implementations must provide these methods. In practice, this is
    satisfied by ``DurableCausalStore`` or any compatible adapter.
    """

    def get_state_age(self) -> Any:
        """Return the timestamp of the most recently persisted state,
        or None if no state exists. May return a datetime or float.
        """
        ...

    def load_agent_registry(self) -> Dict[str, Any]:
        """Load the agent registry (agent_id -> registration record)."""
        ...

    def load_causal_position(self) -> int:
        """Load the global causal position counter."""
        ...

    def load_vector_clocks(self) -> Dict[str, Dict[str, int]]:
        """Load all vector clocks from persistent storage."""
        ...

    def load_reorder_buffer(self) -> List[Any]:
        """Load the reorder buffer from persistent storage."""
        ...


class RecoveryEngine(Protocol):
    """Duck-typed interface for the causal engine used by recovery.

    Implementations must provide these methods. In practice, this is
    satisfied by ``PartitionedCausalEngine`` or any compatible adapter.
    """

    def restore_from_store(self) -> None:
        """Restore engine state from the durable store."""
        ...

    def get_state_snapshot(self) -> Any:
        """Return a snapshot of the engine's current state."""
        ...

    def reset(self) -> None:
        """Fully reset the engine to initial state."""
        ...

    def process_event(self, event: Any) -> Any:
        """Process a single event through the causal engine."""
        ...


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def format_age(ms: float) -> str:
    """Format a duration in milliseconds as a human-readable age string.
    Produces compact output: "0s", "42s", "3m 12s", "1h 5m", "2d 3h".
    """
    if ms < 0:
        ms = 0

    total_seconds = int(ms / 1000)

    if total_seconds < 60:
        return f"{total_seconds}s"

    total_minutes = total_seconds // 60
    remaining_seconds = total_seconds % 60

    if total_minutes < 60:
        if remaining_seconds > 0:
            return f"{total_minutes}m {remaining_seconds}s"
        return f"{total_minutes}m"

    total_hours = total_minutes // 60
    remaining_minutes = total_minutes % 60

    if total_hours < 24:
        if remaining_minutes > 0:
            return f"{total_hours}h {remaining_minutes}m"
        return f"{total_hours}h"

    total_days = total_hours // 24
    remaining_hours = total_hours % 24

    if remaining_hours > 0:
        return f"{total_days}d {remaining_hours}h"
    return f"{total_days}d"


# ---------------------------------------------------------------------------
# BridgeRecoveryProtocol
# ---------------------------------------------------------------------------


class BridgeRecoveryProtocol:
    """Three-phase bridge recovery protocol (TA-3.4).

    Coordinates the recovery of causal ordering state after a bridge restart
    by loading persisted snapshots, re-registering agents, and replaying
    buffered events. Emits the appropriate temporal events so that agents
    can decide whether to resume or reset their own state.

    Usage::

        protocol = BridgeRecoveryProtocol(
            config, store, engine, lambda: clock.get_clock_quality()
        )

        result = protocol.attempt_recovery()
        # Use result.recovered to decide next steps

        # As agents re-register:
        reply = protocol.handle_agent_reregister(reregister_event)
        # Send reply back to the agent
    """

    def __init__(
        self,
        config: RecoveryConfig,
        store: RecoveryStore,
        engine: RecoveryEngine,
        get_clock_quality: Callable[[], Optional[Dict[str, str]]],
    ) -> None:
        self._config = RecoveryConfig(
            max_recovery_gap_ms=config.max_recovery_gap_ms,
            enabled=config.enabled,
        )
        self._store = store
        self._engine = engine
        self._get_clock_quality = get_clock_quality

        self._restored_agents: Optional[Dict[str, Any]] = None
        self._recovery_result: Optional[RecoveryResult] = None
        self._recovery_event: Optional[Dict[str, Any]] = None
        self._reset_event: Optional[Dict[str, Any]] = None

    # -----------------------------------------------------------------------
    # Phase 1: Announce Recovery
    # -----------------------------------------------------------------------

    def attempt_recovery(self) -> RecoveryResult:
        """Attempt to recover causal state from the durable store.

        If persisted state exists and its age is within ``max_recovery_gap_ms``,
        the state is loaded into the causal engine and a recovery event is
        produced. Otherwise the engine is fully reset and a reset event is
        produced instead.

        Returns:
            The recovery result describing what was restored.
        """
        # If the protocol is disabled, always fall back to full reset
        if not self._config.enabled:
            return self._perform_full_reset("manual")

        # Check for persisted state age
        state_date = self._store.get_state_age()

        if state_date is None:
            # No persisted state exists - full reset
            return self._perform_full_reset("clock_resync")

        now = time.time() * 1000.0

        # Support both datetime objects and raw float timestamps
        if hasattr(state_date, "timestamp"):
            state_ts = state_date.timestamp() * 1000.0
        else:
            state_ts = float(state_date) * 1000.0

        gap_ms = now - state_ts

        if gap_ms > self._config.max_recovery_gap_ms:
            # State is too old - full reset
            return self._perform_full_reset("clock_resync")

        # State is within recovery window - attempt to load it
        try:
            # Restore causal engine state from the durable store
            self._engine.restore_from_store()

            # Load the agent registry for Phase 2
            self._restored_agents = self._store.load_agent_registry()

            # Get the restored causal position
            causal_position = self._store.load_causal_position()

            # Get the restored vector clocks for the recovery event
            vector_clocks = self._store.load_vector_clocks()
            merged_vector_clock: Dict[str, int] = {}
            for _partition, agent_clocks in vector_clocks.items():
                for agent_id, seq in agent_clocks.items():
                    current = merged_vector_clock.get(agent_id, 0)
                    if seq > current:
                        merged_vector_clock[agent_id] = seq

            # Replay buffered events (Phase 3)
            dropped_events = self._replay_buffered_events()

            # Build the agent ID list from the registry
            agent_ids = list(self._restored_agents.keys())

            # Determine storage backend source
            source = self._detect_source()

            # Format the state age for the event
            state_age = format_age(gap_ms)

            # Build the recovery result
            result = RecoveryResult(
                recovered=True,
                source=source,
                restored_agents=agent_ids,
                restored_causal_position=causal_position,
                gap_ms=gap_ms,
                dropped_events=dropped_events,
                state_age=state_age,
            )
            self._recovery_result = result

            # Build the recovery event dict
            self._recovery_event = {
                "type": "AEP_TEMPORAL_RECOVERY",
                "recovered_at": now,
                "restored_agents": agent_ids,
                "restored_vector_clock": merged_vector_clock,
                "restored_causal_position": causal_position,
                "state_age": state_age,
                "gap_ms": gap_ms,
                "dropped_events": dropped_events,
                "source": source,
            }

            return result

        except Exception:
            # Recovery failed - fall back to full reset
            return self._perform_full_reset("clock_resync")

    # -----------------------------------------------------------------------
    # Phase 2: Agent Re-registration
    # -----------------------------------------------------------------------

    def handle_agent_reregister(self, event: Dict[str, Any]) -> Dict[str, Any]:
        """Handle an ``AEP_AGENT_REREGISTER`` event from an agent.

        Compares the agent's reported ``last_sequence`` against the persisted
        registry to determine whether the agent can resume, must reset, or
        is unknown to the bridge.

        Args:
            event: The re-registration event dict. Must contain ``agent_id``
                and ``last_sequence`` keys.

        Returns:
            A reregister result dict to send back to the agent.
        """
        agent_id = event.get("agent_id", "")
        last_sequence = event.get("last_sequence", 0)

        # Get the current bridge clock state for the response
        clock_quality = self._get_clock_quality()
        if clock_quality is not None:
            bridge_clock_state = {
                "sync_state": clock_quality.get("sync_state", "FREEWHEEL"),
                "confidence_class": clock_quality.get("confidence_class", "F"),
            }
        else:
            bridge_clock_state = {
                "sync_state": "FREEWHEEL",
                "confidence_class": "F",
            }

        # If no recovery has been performed or agents were not restored,
        # the agent is unknown
        if self._restored_agents is None:
            return {
                "type": "AEP_REREGISTER_RESULT",
                "agent_id": agent_id,
                "status": "unknown",
                "restored_sequence": 0,
                "gap_events": 0,
                "bridge_clock_state": bridge_clock_state,
            }

        registration = self._restored_agents.get(agent_id)

        if registration is None:
            # Agent is not in the persisted registry
            return {
                "type": "AEP_REREGISTER_RESULT",
                "agent_id": agent_id,
                "status": "unknown",
                "restored_sequence": 0,
                "gap_events": 0,
                "bridge_clock_state": bridge_clock_state,
            }

        # Agent is known - compare sequences
        reg_last_sequence = (
            registration.last_sequence
            if hasattr(registration, "last_sequence")
            else registration.get("last_sequence", 0)
        )

        if reg_last_sequence == last_sequence:
            # Sequences match: agent can resume from where it left off
            return {
                "type": "AEP_REREGISTER_RESULT",
                "agent_id": agent_id,
                "status": "resumed",
                "restored_sequence": reg_last_sequence,
                "gap_events": 0,
                "bridge_clock_state": bridge_clock_state,
            }

        # Sequences differ: agent must reset its state
        gap_events = abs(last_sequence - reg_last_sequence)

        return {
            "type": "AEP_REREGISTER_RESULT",
            "agent_id": agent_id,
            "status": "reset",
            "restored_sequence": reg_last_sequence,
            "gap_events": gap_events,
            "bridge_clock_state": bridge_clock_state,
        }

    # -----------------------------------------------------------------------
    # Accessors
    # -----------------------------------------------------------------------

    def get_recovery_result(self) -> Optional[RecoveryResult]:
        """Return the result of the most recent recovery attempt.
        Returns None if ``attempt_recovery()`` has not been called yet.
        """
        return self._recovery_result

    def get_recovery_event(self) -> Optional[Dict[str, Any]]:
        """Return the ``AEP_TEMPORAL_RECOVERY`` event produced during Phase 1.
        Returns None if recovery was not attempted or fell back to reset.
        """
        return self._recovery_event

    def get_reset_event(self) -> Optional[Dict[str, Any]]:
        """Return the ``AEP_TEMPORAL_RESET`` event produced during Phase 1.
        Returns None if recovery succeeded (no reset was needed).
        """
        return self._reset_event

    # -----------------------------------------------------------------------
    # Private Helpers
    # -----------------------------------------------------------------------

    def _perform_full_reset(self, reason: str) -> RecoveryResult:
        """Perform a full reset of the causal engine and produce an
        ``AEP_TEMPORAL_RESET`` event. Used when persisted state is missing,
        too old, or failed to load.
        """
        # Capture the old vector clock before resetting
        old_vector_clock: Dict[str, int] = {}
        try:
            snapshot = self._engine.get_state_snapshot()
            vector_clocks = (
                snapshot.vector_clocks
                if hasattr(snapshot, "vector_clocks")
                else getattr(snapshot, "get", lambda k, d: d)("vector_clocks", {})
            )
            for _partition, agent_clocks in (
                vector_clocks.items()
                if hasattr(vector_clocks, "items")
                else {}
            ):
                if hasattr(agent_clocks, "items"):
                    for agent_id, seq in agent_clocks.items():
                        current = old_vector_clock.get(agent_id, 0)
                        if seq > current:
                            old_vector_clock[agent_id] = seq
        except Exception:
            pass

        # Reset the engine
        self._engine.reset()

        # Emit AEP_TEMPORAL_RESET
        self._reset_event = {
            "type": "AEP_TEMPORAL_RESET",
            "reason": reason,
            "old_vector_clock": old_vector_clock,
            "new_vector_clock": {},
            "reset_at": time.time() * 1000.0,
        }

        # Clear any stale recovery state
        self._restored_agents = None
        self._recovery_event = None

        result = RecoveryResult(
            recovered=False,
            source="none",
            restored_agents=[],
            restored_causal_position=0,
            gap_ms=0.0,
            dropped_events=0,
            state_age="0s",
        )
        self._recovery_result = result

        return result

    def _replay_buffered_events(self) -> int:
        """Phase 3: Replay buffered events from the durable store through the
        causal engine. Returns the count of events that failed to replay
        (dropped events).
        """
        buffer = self._store.load_reorder_buffer()

        if not buffer:
            return 0

        dropped_events = 0

        # Sort buffered events by their buffered_at timestamp to replay in order
        sorted_buffer = sorted(
            buffer,
            key=lambda b: (
                b.buffered_at
                if hasattr(b, "buffered_at")
                else b.get("buffered_at", 0)
            ),
        )

        for buffered in sorted_buffer:
            try:
                event = (
                    buffered.event
                    if hasattr(buffered, "event")
                    else buffered.get("event")
                )
                result = self._engine.process_event(event)
                ordered = (
                    result.ordered
                    if hasattr(result, "ordered")
                    else result.get("ordered", False)
                )
                if not ordered:
                    dropped_events += 1
            except Exception:
                # Event failed to replay - count as dropped
                dropped_events += 1

        return dropped_events

    def _detect_source(self) -> str:
        """Detect the storage backend source by examining the durable store
        class name. Falls back to "file" if the backend cannot be determined.
        """
        ctor_name = type(self._store).__name__.lower()

        if "sqlite" in ctor_name:
            return "sqlite"
        if "redis" in ctor_name or "postgres" in ctor_name or "external" in ctor_name:
            return "external"

        return "file"
