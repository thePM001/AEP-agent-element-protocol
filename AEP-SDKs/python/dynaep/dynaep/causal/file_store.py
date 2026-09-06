# @PAD: /root/dynAEP/sdk/python/dynaep/causal/file_store.py
# ===========================================================================
# dynaep.causal.file_store - File-Based Durable Causal Store
# TA-3.1: JSONL append log with periodic compaction for persisting causal
# ordering state. Append operations are batched (same pattern as
# BufferedLedger from OPT-006). On load: read snapshot + replay append
# log entries written after the snapshot.
# ===========================================================================

from __future__ import annotations

import datetime
import json
import logging
import os
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional

from .durable_store import (
    BufferedEvent,
    DependencyEdge,
    DependencyGraph,
    AgentRegistration,
    CausalStateSnapshot,
    CausalPersistenceConfig,
)

logger = logging.getLogger("dynaep.causal.file_store")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

SNAPSHOT_FILE = "causal-snapshot.json"
APPEND_LOG_FILE = "causal-append.jsonl"
DEFAULT_FLUSH_INTERVAL_MS = 100
DEFAULT_FLUSH_BATCH_SIZE = 100
DEFAULT_COMPACT_INTERVAL_MS = 3600000


# ---------------------------------------------------------------------------
# Append Log Entry
# ---------------------------------------------------------------------------


@dataclass
class AppendLogEntry:
    """A single entry in the JSONL append log."""
    type: str  # "vector_clocks" | "reorder_buffer" | "dependency_graph" | "agent_registry" | "causal_position"
    timestamp: float
    data: Any


# ---------------------------------------------------------------------------
# FileBasedCausalStore
# ---------------------------------------------------------------------------


class FileBasedCausalStore:
    """File-based durable causal store using JSONL append log with periodic
    compaction. Writes are batched to minimize I/O overhead.

    Storage layout:
      {path}/causal-snapshot.json  - Full state snapshot (written on compact)
      {path}/causal-append.jsonl   - Append-only log of state changes
    """

    def __init__(
        self,
        path: str,
        flush_interval_ms: int = DEFAULT_FLUSH_INTERVAL_MS,
        flush_batch_size: int = DEFAULT_FLUSH_BATCH_SIZE,
        compact_interval_ms: int = DEFAULT_COMPACT_INTERVAL_MS,
    ) -> None:
        self._store_path = path
        self._snapshot_path = os.path.join(self._store_path, SNAPSHOT_FILE)
        self._append_log_path = os.path.join(self._store_path, APPEND_LOG_FILE)
        self._flush_interval_ms = flush_interval_ms
        self._flush_batch_size = flush_batch_size
        self._compact_interval_ms = compact_interval_ms

        # In-memory state
        self._vector_clocks: Dict[str, Dict[str, int]] = {}
        self._reorder_buffer: List[BufferedEvent] = []
        self._dependency_graph = DependencyGraph()
        self._agent_registry: Dict[str, AgentRegistration] = {}
        self._causal_position: int = 0
        self._last_persist_at: float = 0

        # Write batching
        self._pending_writes: List[AppendLogEntry] = []
        self._flush_timer: Optional[threading.Timer] = None
        self._compact_timer: Optional[threading.Timer] = None
        self._closed: bool = False
        self._loaded: bool = False

        # Ensure storage directory exists
        self._ensure_directory()

        # Start auto-flush timer
        self._start_flush_timer()

        # Start compaction timer
        self._start_compact_timer()

    # -----------------------------------------------------------------------
    # DurableCausalStore Implementation
    # -----------------------------------------------------------------------

    def save_vector_clocks(self, clocks: Dict[str, Dict[str, int]]) -> None:
        """Save all vector clocks."""
        self._vector_clocks = dict(clocks)
        self._queue_write(AppendLogEntry(
            type="vector_clocks",
            timestamp=self._now_ms(),
            data=clocks,
        ))

    def load_vector_clocks(self) -> Dict[str, Dict[str, int]]:
        """Load all vector clocks from persistent storage."""
        self._load_if_needed()
        return dict(self._vector_clocks)

    def save_reorder_buffer(self, events: List[BufferedEvent]) -> None:
        """Save the current reorder buffer contents."""
        self._reorder_buffer = list(events)
        self._queue_write(AppendLogEntry(
            type="reorder_buffer",
            timestamp=self._now_ms(),
            data=[_buffered_event_to_dict(e) for e in events],
        ))

    def load_reorder_buffer(self) -> List[BufferedEvent]:
        """Load the reorder buffer from persistent storage."""
        self._load_if_needed()
        return list(self._reorder_buffer)

    def save_dependency_graph(self, graph: DependencyGraph) -> None:
        """Save the dependency graph."""
        self._dependency_graph = DependencyGraph(
            edges=list(graph.edges),
            delivered_event_ids=list(graph.delivered_event_ids),
        )
        self._queue_write(AppendLogEntry(
            type="dependency_graph",
            timestamp=self._now_ms(),
            data=_dependency_graph_to_dict(graph),
        ))

    def load_dependency_graph(self) -> DependencyGraph:
        """Load the dependency graph from persistent storage."""
        self._load_if_needed()
        return DependencyGraph(
            edges=list(self._dependency_graph.edges),
            delivered_event_ids=list(self._dependency_graph.delivered_event_ids),
        )

    def save_agent_registry(self, agents: Dict[str, AgentRegistration]) -> None:
        """Save the agent registry."""
        self._agent_registry = dict(agents)
        self._queue_write(AppendLogEntry(
            type="agent_registry",
            timestamp=self._now_ms(),
            data={k: _agent_registration_to_dict(v) for k, v in agents.items()},
        ))

    def load_agent_registry(self) -> Dict[str, AgentRegistration]:
        """Load the agent registry from persistent storage."""
        self._load_if_needed()
        return dict(self._agent_registry)

    def save_causal_position(self, position: int) -> None:
        """Save the current global causal position counter."""
        self._causal_position = position
        self._queue_write(AppendLogEntry(
            type="causal_position",
            timestamp=self._now_ms(),
            data=position,
        ))

    def load_causal_position(self) -> int:
        """Load the global causal position counter."""
        self._load_if_needed()
        return self._causal_position

    def get_state_age(self) -> Optional[datetime.datetime]:
        """Get the age (timestamp) of the most recently persisted state."""
        # Check snapshot file first
        if os.path.exists(self._snapshot_path):
            try:
                with open(self._snapshot_path, "r", encoding="utf-8") as f:
                    snapshot = json.load(f)
                return datetime.datetime.fromtimestamp(
                    snapshot["snapshot_at"] / 1000.0,
                    tz=datetime.timezone.utc,
                )
            except (json.JSONDecodeError, KeyError, OSError):
                pass

        # Check append log for latest timestamp
        if os.path.exists(self._append_log_path):
            try:
                with open(self._append_log_path, "r", encoding="utf-8") as f:
                    raw = f.read()
                lines = [line for line in raw.strip().split("\n") if line]
                if lines:
                    last_entry = json.loads(lines[-1])
                    return datetime.datetime.fromtimestamp(
                        last_entry["timestamp"] / 1000.0,
                        tz=datetime.timezone.utc,
                    )
            except (json.JSONDecodeError, KeyError, OSError):
                pass

        # Check in-memory last persist time
        if self._last_persist_at > 0:
            return datetime.datetime.fromtimestamp(
                self._last_persist_at / 1000.0,
                tz=datetime.timezone.utc,
            )

        return None

    def compact(self) -> None:
        """Compact the store by writing a full snapshot and clearing the append log."""
        # Flush any pending writes first
        self._flush_pending_writes()

        now = self._now_ms()

        # Write full snapshot
        snapshot = {
            "vector_clocks": self._vector_clocks,
            "reorder_buffer": [_buffered_event_to_dict(e) for e in self._reorder_buffer],
            "dependency_graph": _dependency_graph_to_dict(self._dependency_graph),
            "agent_registry": {k: _agent_registration_to_dict(v) for k, v in self._agent_registry.items()},
            "causal_position": self._causal_position,
            "snapshot_at": now,
        }

        with open(self._snapshot_path, "w", encoding="utf-8") as f:
            json.dump(snapshot, f)

        # Clear the append log
        with open(self._append_log_path, "w", encoding="utf-8") as f:
            f.write("")

        self._last_persist_at = now

    def close(self) -> None:
        """Close the store and release resources."""
        self._closed = True

        # Stop timers
        if self._flush_timer is not None:
            self._flush_timer.cancel()
            self._flush_timer = None
        if self._compact_timer is not None:
            self._compact_timer.cancel()
            self._compact_timer = None

        # Flush remaining writes
        self._flush_pending_writes()

    # -----------------------------------------------------------------------
    # Private: Write Batching
    # -----------------------------------------------------------------------

    def _queue_write(self, entry: AppendLogEntry) -> None:
        """Queue a write entry for batched persistence."""
        if self._closed:
            return

        self._pending_writes.append(entry)
        self._last_persist_at = entry.timestamp

        # Flush if batch size reached
        if len(self._pending_writes) >= self._flush_batch_size:
            self._flush_pending_writes()

    def _flush_pending_writes(self) -> None:
        """Flush all pending writes to the append log."""
        if not self._pending_writes:
            return

        lines = []
        for entry in self._pending_writes:
            lines.append(json.dumps({
                "type": entry.type,
                "timestamp": entry.timestamp,
                "data": entry.data,
            }))
        self._pending_writes = []

        try:
            with open(self._append_log_path, "a", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
        except OSError:
            logger.warning("Failed to flush pending writes")

    def _start_flush_timer(self) -> None:
        """Start the periodic auto-flush timer."""
        if self._flush_interval_ms <= 0:
            return
        interval_s = self._flush_interval_ms / 1000.0
        self._flush_timer = threading.Timer(interval_s, self._flush_tick)
        self._flush_timer.daemon = True
        self._flush_timer.start()

    def _flush_tick(self) -> None:
        """Timer callback: flush and reschedule."""
        if self._closed:
            return
        self._flush_pending_writes()
        self._start_flush_timer()

    def _start_compact_timer(self) -> None:
        """Start the periodic compaction timer."""
        if self._compact_interval_ms <= 0:
            return
        interval_s = self._compact_interval_ms / 1000.0
        self._compact_timer = threading.Timer(interval_s, self._compact_tick)
        self._compact_timer.daemon = True
        self._compact_timer.start()

    def _compact_tick(self) -> None:
        """Timer callback: compact and reschedule."""
        if self._closed:
            return
        try:
            self.compact()
        except OSError:
            logger.warning("Compaction failed")
        self._start_compact_timer()

    # -----------------------------------------------------------------------
    # Private: Loading
    # -----------------------------------------------------------------------

    def _load_if_needed(self) -> None:
        """Load persisted state on first access."""
        if self._loaded:
            return
        self._loaded = True

        # Step 1: Load snapshot if it exists
        if os.path.exists(self._snapshot_path):
            try:
                with open(self._snapshot_path, "r", encoding="utf-8") as f:
                    snapshot = json.load(f)
                self._apply_snapshot(snapshot)
            except (json.JSONDecodeError, OSError):
                logger.warning("Failed to load snapshot, starting fresh")

        # Step 2: Replay append log entries after snapshot
        if os.path.exists(self._append_log_path):
            try:
                with open(self._append_log_path, "r", encoding="utf-8") as f:
                    raw = f.read()
                lines = [line for line in raw.strip().split("\n") if line]
                for line in lines:
                    try:
                        entry = json.loads(line)
                        self._apply_append_entry(entry)
                    except (json.JSONDecodeError, KeyError):
                        pass  # Skip malformed lines
            except OSError:
                logger.warning("Failed to replay append log")

    def _apply_snapshot(self, snapshot: Dict) -> None:
        """Apply a full snapshot to in-memory state."""
        # Vector clocks
        self._vector_clocks = {}
        raw_clocks = snapshot.get("vector_clocks", {})
        for key, value in raw_clocks.items():
            self._vector_clocks[key] = value

        # Reorder buffer
        raw_buffer = snapshot.get("reorder_buffer", [])
        self._reorder_buffer = [_dict_to_buffered_event(e) for e in raw_buffer]

        # Dependency graph
        raw_graph = snapshot.get("dependency_graph")
        if raw_graph is not None:
            self._dependency_graph = _dict_to_dependency_graph(raw_graph)
        else:
            self._dependency_graph = DependencyGraph()

        # Agent registry
        self._agent_registry = {}
        raw_agents = snapshot.get("agent_registry", {})
        for key, value in raw_agents.items():
            self._agent_registry[key] = _dict_to_agent_registration(value)

        # Causal position
        self._causal_position = snapshot.get("causal_position", 0)

        self._last_persist_at = snapshot.get("snapshot_at", 0)

    def _apply_append_entry(self, entry: Dict) -> None:
        """Apply a single append log entry to in-memory state."""
        entry_type = entry["type"]
        data = entry["data"]
        timestamp = entry.get("timestamp", 0)

        if entry_type == "vector_clocks":
            self._vector_clocks = {}
            for key, value in data.items():
                self._vector_clocks[key] = value

        elif entry_type == "reorder_buffer":
            self._reorder_buffer = [_dict_to_buffered_event(e) for e in data]

        elif entry_type == "dependency_graph":
            self._dependency_graph = _dict_to_dependency_graph(data)

        elif entry_type == "agent_registry":
            self._agent_registry = {}
            for key, value in data.items():
                self._agent_registry[key] = _dict_to_agent_registration(value)

        elif entry_type == "causal_position":
            self._causal_position = data

        if timestamp > self._last_persist_at:
            self._last_persist_at = timestamp

    # -----------------------------------------------------------------------
    # Private: Filesystem
    # -----------------------------------------------------------------------

    def _ensure_directory(self) -> None:
        """Ensure the storage directory exists."""
        Path(self._store_path).mkdir(parents=True, exist_ok=True)

    # -----------------------------------------------------------------------
    # Private: Utilities
    # -----------------------------------------------------------------------

    @staticmethod
    def _now_ms() -> float:
        """Return current time in milliseconds since epoch."""
        import time
        return time.time() * 1000.0


# ---------------------------------------------------------------------------
# Serialization Helpers
# ---------------------------------------------------------------------------


def _buffered_event_to_dict(event: BufferedEvent) -> Dict:
    """Serialize a BufferedEvent to a JSON-safe dict."""
    return {
        "event": event.event,
        "buffered_at": event.buffered_at,
        "partition_key": event.partition_key,
    }


def _dict_to_buffered_event(data: Dict) -> BufferedEvent:
    """Deserialize a dict to a BufferedEvent."""
    return BufferedEvent(
        event=data.get("event", {}),
        buffered_at=data.get("buffered_at", 0),
        partition_key=data.get("partition_key", ""),
    )


def _dependency_graph_to_dict(graph: DependencyGraph) -> Dict:
    """Serialize a DependencyGraph to a JSON-safe dict."""
    return {
        "edges": [
            {
                "event_id": e.event_id,
                "depends_on": e.depends_on,
                "partition_key": e.partition_key,
            }
            for e in graph.edges
        ],
        "delivered_event_ids": graph.delivered_event_ids,
    }


def _dict_to_dependency_graph(data: Dict) -> DependencyGraph:
    """Deserialize a dict to a DependencyGraph."""
    edges = []
    for e in data.get("edges", []):
        edges.append(DependencyEdge(
            event_id=e.get("event_id", ""),
            depends_on=e.get("depends_on", ""),
            partition_key=e.get("partition_key", ""),
        ))
    return DependencyGraph(
        edges=edges,
        delivered_event_ids=data.get("delivered_event_ids", []),
    )


def _agent_registration_to_dict(agent: AgentRegistration) -> Dict:
    """Serialize an AgentRegistration to a JSON-safe dict."""
    return {
        "agent_id": agent.agent_id,
        "registered_at": agent.registered_at,
        "last_sequence": agent.last_sequence,
        "last_event_id": agent.last_event_id,
        "capabilities": agent.capabilities,
    }


def _dict_to_agent_registration(data: Dict) -> AgentRegistration:
    """Deserialize a dict to an AgentRegistration."""
    return AgentRegistration(
        agent_id=data.get("agent_id", ""),
        registered_at=data.get("registered_at", 0),
        last_sequence=data.get("last_sequence", 0),
        last_event_id=data.get("last_event_id"),
        capabilities=data.get("capabilities", []),
    )
