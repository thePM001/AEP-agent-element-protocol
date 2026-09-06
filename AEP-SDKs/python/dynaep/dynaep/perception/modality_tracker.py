# @PAD: /root/dynAEP/sdk/python/dynaep/perception/modality_tracker.py
# ===========================================================================
# dynaep.perception.modality_tracker - Cross-Modality State Atomicity
# OPT-010: Provides atomic read-evaluate-update for the cross-modality
# constraint. Uses threading.Lock to protect the sequence:
#   get_active_state -> rego_evaluate -> record_activation
#
# THREAD SAFETY: The Python version MUST use threading.Lock because Python
# threading can preempt between any two bytecode instructions.
# ===========================================================================

from __future__ import annotations
import threading
from dataclasses import dataclass
from typing import Dict, Optional, List, Callable


@dataclass
class ModalityInfo:
    """Information about an active modality."""
    modality: str
    event_id: str
    started_at: float
    estimated_duration_ms: float


@dataclass
class ModalityState:
    """Current active modality count and list."""
    active_count: int
    active_modalities: List[str]


class ModalityTracker:
    """Tracks active output modalities with atomic state transitions.

    THREAD SAFETY:
    The get_active_state -> evaluate -> record_activation sequence
    MUST be protected by this tracker's lock in multi-threaded Python:

        with tracker.lock:
            state = tracker.get_active_state()
            rego_input["active_modalities"] = state
            result = rego_evaluator.evaluate(rego_input)
            if result.permitted:
                tracker.record_activation(modality, event_id, duration_ms)
        return result
    """

    def __init__(
        self,
        max_simultaneous: int = 3,
        clock_fn: Optional[Callable[[], float]] = None,
    ) -> None:
        self._max_simultaneous = max_simultaneous
        self._clock_fn = clock_fn  # Should return bridge-authoritative time in ms
        self._active: Dict[str, ModalityInfo] = {}
        self.lock = threading.Lock()

    def _now(self) -> float:
        """Get current bridge-authoritative time in ms."""
        if self._clock_fn:
            return self._clock_fn()
        import time
        return time.time() * 1000

    def get_active_state(self) -> ModalityState:
        """Returns current active modality count and list.

        Expires completed modalities based on estimated duration
        before returning the count.
        """
        self._expire_completed()
        modalities = list(self._active.keys())
        return ModalityState(
            active_count=len(modalities),
            active_modalities=modalities,
        )

    def record_activation(
        self,
        modality: str,
        event_id: str,
        duration_ms: float,
    ) -> None:
        """Record a new active modality.

        Called ONLY after successful Rego evaluation that permits the
        activation. In Python, MUST be called within the same lock scope
        as get_active_state().
        """
        now = self._now()
        self._active[modality] = ModalityInfo(
            modality=modality,
            event_id=event_id,
            started_at=now,
            estimated_duration_ms=duration_ms,
        )

    def record_completion(self, modality: str) -> None:
        """Explicitly marks a modality as completed."""
        self._active.pop(modality, None)

    def get_active_modalities(self) -> Dict[str, ModalityInfo]:
        """Full state for debugging/monitoring."""
        self._expire_completed()
        return dict(self._active)

    def get_max_simultaneous(self) -> int:
        return self._max_simultaneous

    def _expire_completed(self) -> None:
        """Expire modalities whose estimated duration has elapsed."""
        now = self._now()
        expired = [
            m for m, info in self._active.items()
            if now > info.started_at + info.estimated_duration_ms
        ]
        for m in expired:
            del self._active[m]
