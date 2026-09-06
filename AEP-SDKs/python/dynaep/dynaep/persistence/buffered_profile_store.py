# @PAD: /root/dynAEP/sdk/python/dynaep/persistence/buffered_profile_store.py
# ===========================================================================
# dynaep.persistence.buffered_profile_store - Buffered Profile Store
# Wraps the AdaptiveProfileManager with buffered disk persistence.
# Profile changes are accumulated and flushed in batches rather than
# writing to disk on every update.
#
# OPT-006: Buffered Evidence Ledger and Persistence I/O
# ===========================================================================

"""Buffered profile store with dirty-tracking and batched flush."""
from __future__ import annotations

import threading
from typing import Callable, Optional

from dynaep.temporal.perception_profile import AdaptiveProfileManager


DEFAULT_BUFFER_SIZE = 64
DEFAULT_FLUSH_INTERVAL_S = 10.0


class BufferedProfileStore:
    """Wraps AdaptiveProfileManager with buffered disk persistence.

    Profile changes are accumulated in a dirty set. When the dirty count
    reaches capacity or the flush timer fires, the entire profile manager
    state is serialized and passed to the on_flush callback. The critical
    path (mark_dirty) is never blocked on I/O.
    """

    def __init__(
        self,
        profile_manager: AdaptiveProfileManager,
        buffer_size: int = DEFAULT_BUFFER_SIZE,
        flush_interval_s: float = DEFAULT_FLUSH_INTERVAL_S,
        on_flush: Optional[Callable[[str], None]] = None,
    ) -> None:
        self._profile_manager = profile_manager
        self._buffer_size = buffer_size
        self._flush_interval_s = flush_interval_s
        self._on_flush = on_flush

        self._dirty_profiles: set[str] = set()
        self._timer: Optional[threading.Timer] = None
        self._running: bool = False
        self._total_flushes: int = 0

    # -----------------------------------------------------------------------
    # Mark dirty
    # -----------------------------------------------------------------------

    def mark_dirty(self, user_id: str) -> None:
        """Mark a profile as dirty (modified since last flush).

        Called after each profile update to track which profiles need
        persistence.
        """
        self._dirty_profiles.add(user_id)

        if len(self._dirty_profiles) >= self._buffer_size:
            self.flush()

    # -----------------------------------------------------------------------
    # Flushing
    # -----------------------------------------------------------------------

    def flush(self) -> int:
        """Flush all dirty profiles to persistence.

        Serializes the entire profile manager state and invokes the
        on_flush callback.

        Returns the number of dirty profiles flushed.
        """
        if not self._dirty_profiles:
            return 0

        count = len(self._dirty_profiles)
        self._dirty_profiles.clear()
        self._total_flushes += 1

        serialized = self._profile_manager.serialize()
        if self._on_flush:
            self._on_flush(serialized)

        return count

    # -----------------------------------------------------------------------
    # Timer-based auto-flush
    # -----------------------------------------------------------------------

    def start_auto_flush(self) -> None:
        """Start the periodic auto-flush timer."""
        if self._running or self._flush_interval_s <= 0:
            return
        self._running = True
        self._schedule_flush()

    def stop_auto_flush(self) -> None:
        """Stop the periodic auto-flush timer."""
        self._running = False
        if self._timer is not None:
            self._timer.cancel()
            self._timer = None

    def _schedule_flush(self) -> None:
        """Schedule the next flush tick."""
        if not self._running:
            return
        self._timer = threading.Timer(self._flush_interval_s, self._tick)
        self._timer.daemon = True
        self._timer.start()

    def _tick(self) -> None:
        """Timer callback: flush and reschedule."""
        self.flush()
        if self._running:
            self._schedule_flush()

    # -----------------------------------------------------------------------
    # Load
    # -----------------------------------------------------------------------

    def load(self, data: str) -> None:
        """Load persisted profile data."""
        self._profile_manager.deserialize(data)
        self._dirty_profiles.clear()

    # -----------------------------------------------------------------------
    # Stats
    # -----------------------------------------------------------------------

    def get_stats(self) -> dict:
        """Return store statistics."""
        return {
            "dirty_count": len(self._dirty_profiles),
            "total_flushes": self._total_flushes,
        }
