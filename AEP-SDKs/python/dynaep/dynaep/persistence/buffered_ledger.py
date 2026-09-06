# @PAD: /root/dynAEP/sdk/python/dynaep/persistence/buffered_ledger.py
# ===========================================================================
# dynaep.persistence.buffered_ledger - Buffered Evidence Ledger
# Append-only SHA-256 hash chain recording every validation decision made
# by the bridge. Entries are buffered in memory and flushed in batches.
#
# OPT-006: Buffered Evidence Ledger and Persistence I/O
# ===========================================================================

"""Buffered evidence ledger with SHA-256 hash chain."""
from __future__ import annotations

import hashlib
import json
import threading
from dataclasses import dataclass, field
from typing import Callable, Optional

from dynaep.temporal.clock import BridgeClock


GENESIS_HASH = "0" * 64
DEFAULT_BUFFER_SIZE = 256
DEFAULT_FLUSH_INTERVAL_S = 5.0


@dataclass
class LedgerEntry:
    """A single validation decision in the evidence ledger."""
    seq: int
    bridge_time_ms: float
    decision: str  # accepted | rejected_temporal | rejected_causal | etc.
    target_id: str
    detail: str
    hash: Optional[str]
    prev_hash: str


class BufferedLedger:
    """Append-only SHA-256 hash chain with buffered flush.

    Entries are accumulated in memory. When the buffer reaches capacity
    or the flush timer fires, entries are drained and passed to the
    on_flush callback (which handles disk persistence). The critical
    path (record) is never blocked on I/O.
    """

    def __init__(
        self,
        bridge_clock: BridgeClock,
        buffer_size: int = DEFAULT_BUFFER_SIZE,
        flush_interval_s: float = DEFAULT_FLUSH_INTERVAL_S,
        hash_chain_enabled: bool = True,
        on_flush: Optional[Callable[[list[LedgerEntry]], None]] = None,
    ) -> None:
        self._bridge_clock = bridge_clock
        self._buffer_size = buffer_size
        self._flush_interval_s = flush_interval_s
        self._hash_chain_enabled = hash_chain_enabled
        self._on_flush = on_flush

        self._buffer: list[LedgerEntry] = []
        self._flushed: list[LedgerEntry] = []
        self._seq: int = 0
        self._prev_hash: str = GENESIS_HASH
        self._timer: Optional[threading.Timer] = None
        self._running: bool = False
        self._total_flushed: int = 0
        self._total_recorded: int = 0

    # -----------------------------------------------------------------------
    # Recording
    # -----------------------------------------------------------------------

    def record(self, decision: str, target_id: str, detail: str) -> None:
        """Record a validation decision in the ledger.

        The entry is appended to the in-memory buffer. If the buffer
        reaches capacity, an automatic flush is triggered.
        """
        self._seq += 1
        self._total_recorded += 1

        entry = LedgerEntry(
            seq=self._seq,
            bridge_time_ms=self._bridge_clock.now(),
            decision=decision,
            target_id=target_id,
            detail=detail,
            hash=None,
            prev_hash=self._prev_hash,
        )

        if self._hash_chain_enabled:
            payload = f"{entry.prev_hash}|{entry.seq}|{entry.bridge_time_ms}|{entry.decision}|{entry.target_id}|{entry.detail}"
            entry.hash = hashlib.sha256(payload.encode()).hexdigest()
            self._prev_hash = entry.hash

        self._buffer.append(entry)

        if len(self._buffer) >= self._buffer_size:
            self.flush()

    # -----------------------------------------------------------------------
    # Flushing
    # -----------------------------------------------------------------------

    def flush(self) -> int:
        """Flush the in-memory buffer.

        Returns the number of entries flushed.
        """
        if not self._buffer:
            return 0

        entries = list(self._buffer)
        self._buffer.clear()
        self._flushed.extend(entries)
        self._total_flushed += len(entries)

        if self._on_flush:
            self._on_flush(entries)

        return len(entries)

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
    # Query
    # -----------------------------------------------------------------------

    def get_flushed(self) -> list[LedgerEntry]:
        """Return all flushed entries."""
        return list(self._flushed)

    def get_buffered(self) -> list[LedgerEntry]:
        """Return entries currently in the buffer."""
        return list(self._buffer)

    def get_stats(self) -> dict:
        """Return ledger statistics."""
        return {
            "total_recorded": self._total_recorded,
            "total_flushed": self._total_flushed,
            "buffered": len(self._buffer),
            "current_seq": self._seq,
            "head_hash": self._prev_hash,
        }

    def verify_chain(self) -> int:
        """Verify hash chain integrity.

        Returns the index of the first broken link, or -1 if valid.
        """
        if not self._hash_chain_enabled:
            return -1

        expected_prev = GENESIS_HASH

        for i, entry in enumerate(self._flushed):
            if entry.prev_hash != expected_prev:
                return i
            if entry.hash:
                payload = f"{entry.prev_hash}|{entry.seq}|{entry.bridge_time_ms}|{entry.decision}|{entry.target_id}|{entry.detail}"
                computed = hashlib.sha256(payload.encode()).hexdigest()
                if computed != entry.hash:
                    return i
                expected_prev = entry.hash

        return -1

    # -----------------------------------------------------------------------
    # Serialization
    # -----------------------------------------------------------------------

    def serialize(self) -> str:
        """Serialize ledger state for persistence."""
        return json.dumps({
            "seq": self._seq,
            "prev_hash": self._prev_hash,
            "entries": [
                {
                    "seq": e.seq,
                    "bridge_time_ms": e.bridge_time_ms,
                    "decision": e.decision,
                    "target_id": e.target_id,
                    "detail": e.detail,
                    "hash": e.hash,
                    "prev_hash": e.prev_hash,
                }
                for e in self._flushed
            ],
        })

    def deserialize(self, data: str) -> None:
        """Restore ledger state from persisted data."""
        parsed = json.loads(data)
        self._seq = parsed.get("seq", 0)
        self._prev_hash = parsed.get("prev_hash", GENESIS_HASH)
        self._flushed.clear()
        for entry_data in parsed.get("entries", []):
            self._flushed.append(LedgerEntry(
                seq=entry_data["seq"],
                bridge_time_ms=entry_data["bridge_time_ms"],
                decision=entry_data["decision"],
                target_id=entry_data["target_id"],
                detail=entry_data["detail"],
                hash=entry_data.get("hash"),
                prev_hash=entry_data["prev_hash"],
            ))
        self._total_flushed = len(self._flushed)
