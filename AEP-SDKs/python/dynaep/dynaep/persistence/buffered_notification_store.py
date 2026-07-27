# @PAD: /root/dynAEP/sdk/python/dynaep/persistence/buffered_notification_store.py
# ===========================================================================
# dynaep.persistence.buffered_notification_store - Buffered Notification Store
# Buffers notification cadence state (delivery history, habituation
# counters) and flushes to disk in batches. Prevents per-notification
# disk I/O while preserving state across bridge restarts.
#
# OPT-006: Buffered Evidence Ledger and Persistence I/O
# ===========================================================================

"""Buffered notification store with delivery history and habituation tracking."""
from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from typing import Callable, Optional


DEFAULT_BUFFER_SIZE = 32
DEFAULT_FLUSH_INTERVAL_S = 10.0
DEFAULT_MAX_HISTORY_LENGTH = 100


@dataclass
class NotificationChannelState:
    """State for a single notification channel."""
    channel_id: str
    delivery_history: list[float] = field(default_factory=list)
    total_delivered: int = 0
    habituated: bool = False
    last_delivery_ms: float = 0.0


class BufferedNotificationStore:
    """Buffers notification cadence state and flushes to disk in batches.

    Notification delivery timestamps are accumulated per channel. When
    the dirty channel count reaches capacity or the flush timer fires,
    the entire state is serialized and passed to the on_flush callback.
    """

    def __init__(
        self,
        buffer_size: int = DEFAULT_BUFFER_SIZE,
        flush_interval_s: float = DEFAULT_FLUSH_INTERVAL_S,
        max_history_length: int = DEFAULT_MAX_HISTORY_LENGTH,
        on_flush: Optional[Callable[[str], None]] = None,
    ) -> None:
        self._buffer_size = buffer_size
        self._flush_interval_s = flush_interval_s
        self._max_history_length = max_history_length
        self._on_flush = on_flush

        self._channels: dict[str, NotificationChannelState] = {}
        self._dirty_channels: set[str] = set()
        self._timer: Optional[threading.Timer] = None
        self._running: bool = False
        self._total_flushes: int = 0

    # -----------------------------------------------------------------------
    # Recording
    # -----------------------------------------------------------------------

    def record_delivery(self, channel_id: str, delivery_ms: float) -> None:
        """Record a notification delivery for the given channel.

        Appends the timestamp to the delivery history ring buffer and
        marks the channel as dirty for the next flush.
        """
        state = self._channels.get(channel_id)
        if state is None:
            state = NotificationChannelState(channel_id=channel_id)
            self._channels[channel_id] = state

        state.delivery_history.append(delivery_ms)
        state.total_delivered += 1
        state.last_delivery_ms = delivery_ms

        # Ring buffer trim
        if len(state.delivery_history) > self._max_history_length:
            state.delivery_history = state.delivery_history[-self._max_history_length:]

        self._dirty_channels.add(channel_id)

        if len(self._dirty_channels) >= self._buffer_size:
            self.flush()

    def mark_habituated(self, channel_id: str) -> None:
        """Mark a channel as habituated."""
        state = self._channels.get(channel_id)
        if state:
            state.habituated = True
            self._dirty_channels.add(channel_id)

    def get_channel_state(self, channel_id: str) -> Optional[NotificationChannelState]:
        """Get channel state for gate evaluation."""
        return self._channels.get(channel_id)

    # -----------------------------------------------------------------------
    # Flushing
    # -----------------------------------------------------------------------

    def flush(self) -> int:
        """Flush all dirty channel states to persistence.

        Returns the number of dirty channels flushed.
        """
        if not self._dirty_channels:
            return 0

        count = len(self._dirty_channels)
        self._dirty_channels.clear()
        self._total_flushes += 1

        serialized = self.serialize()
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
    # Serialization
    # -----------------------------------------------------------------------

    def serialize(self) -> str:
        """Serialize all channel states for persistence."""
        data: dict[str, dict] = {}
        for channel_id, state in self._channels.items():
            data[channel_id] = {
                "channel_id": state.channel_id,
                "delivery_history": state.delivery_history,
                "total_delivered": state.total_delivered,
                "habituated": state.habituated,
                "last_delivery_ms": state.last_delivery_ms,
            }
        return json.dumps(data)

    def deserialize(self, data: str) -> None:
        """Restore channel states from persisted data."""
        parsed = json.loads(data)
        self._channels.clear()
        for channel_id, state_data in parsed.items():
            self._channels[channel_id] = NotificationChannelState(
                channel_id=state_data["channel_id"],
                delivery_history=state_data.get("delivery_history", []),
                total_delivered=state_data.get("total_delivered", 0),
                habituated=state_data.get("habituated", False),
                last_delivery_ms=state_data.get("last_delivery_ms", 0.0),
            )
        self._dirty_channels.clear()

    # -----------------------------------------------------------------------
    # Stats
    # -----------------------------------------------------------------------

    def get_stats(self) -> dict:
        """Return store statistics."""
        total_deliveries = sum(s.total_delivered for s in self._channels.values())
        return {
            "channel_count": len(self._channels),
            "dirty_count": len(self._dirty_channels),
            "total_flushes": self._total_flushes,
            "total_deliveries": total_deliveries,
        }
