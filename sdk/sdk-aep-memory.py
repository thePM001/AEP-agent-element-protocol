"""
AEP Lattice Memory Module v2.0
==============================

Persistent memory for the AEP adjudication lattice. Stores validated proposals,
rejection episodes, and semantic attractors across validation runs.

Design invariant: Memory is READ-ONLY to validation logic. The accept/reject
decision is 100% deterministic and never influenced by memory state. Memory
only serves two auxiliary purposes:

  1. Proposal ranking -- surface historically successful patterns earlier.
  2. Attractor retrieval -- find the nearest accepted proposal for fast-path
     short-circuiting (caller decides whether to use it).

Two concrete backends are provided:

  - InMemoryFabric  -- pure Python lists, suitable for tests and short-lived
                       processes.
  - SQLiteFabric    -- durable SQLite storage with thread-safe access, suitable
                       for long-running agents and multi-step workflows.

Zero required dependencies beyond the Python standard library and sqlite3.
No numpy.
"""

from __future__ import annotations

import json
import math
import sqlite3
import threading
import uuid
from abc import ABC, abstractmethod
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Literal, Optional

__all__ = [
    "cosine_similarity",
    "MemoryEntry",
    "create_memory_entry",
    "MemoryFabric",
    "InMemoryFabric",
    "SQLiteFabric",
]


# ---------------------------------------------------------------------------
# Vector math
# ---------------------------------------------------------------------------

def cosine_similarity(a: List[float], b: List[float]) -> float:
    """Pure-Python cosine similarity between two equal-length vectors.

    Returns a float in [-1.0, 1.0].  If either vector has zero magnitude the
    result is 0.0 (graceful handling of degenerate inputs).
    """
    if len(a) != len(b):
        raise ValueError(
            f"Vector length mismatch: len(a)={len(a)}, len(b)={len(b)}"
        )
    if not a:
        return 0.0

    dot = 0.0
    mag_a = 0.0
    mag_b = 0.0
    for ai, bi in zip(a, b):
        dot += ai * bi
        mag_a += ai * ai
        mag_b += bi * bi

    if mag_a == 0.0 or mag_b == 0.0:
        return 0.0

    return dot / (math.sqrt(mag_a) * math.sqrt(mag_b))


# ---------------------------------------------------------------------------
# Data model
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class MemoryEntry:
    """A single lattice memory record.

    Frozen so that entries are immutable once created -- the append-only
    invariant is enforced at the data level, not just the API level.
    """

    id: str
    timestamp: str
    element_id: str
    domain: str  # one of "ui", "workflow", "api", "event", "iac"
    proposal: Dict[str, Any]
    result: Literal["accepted", "rejected"]
    errors: List[str]
    traversal_path: List[str]
    embedding: Optional[List[float]] = None
    metadata: Optional[Dict[str, Any]] = None


_VALID_DOMAINS = {"ui", "workflow", "api", "event", "iac"}
_VALID_RESULTS = {"accepted", "rejected"}


def create_memory_entry(
    element_id: str,
    domain: str,
    proposal: Dict[str, Any],
    result: Literal["accepted", "rejected"],
    errors: Optional[List[str]] = None,
    traversal_path: Optional[List[str]] = None,
    embedding: Optional[List[float]] = None,
    metadata: Optional[Dict[str, Any]] = None,
) -> MemoryEntry:
    """Factory that auto-generates ``id`` (uuid4) and ``timestamp`` (ISO 8601 UTC)."""

    if domain not in _VALID_DOMAINS:
        raise ValueError(
            f"Invalid domain {domain!r}. Must be one of {sorted(_VALID_DOMAINS)}"
        )
    if result not in _VALID_RESULTS:
        raise ValueError(
            f"Invalid result {result!r}. Must be one of {sorted(_VALID_RESULTS)}"
        )

    return MemoryEntry(
        id=str(uuid.uuid4()),
        timestamp=datetime.now(timezone.utc).isoformat(),
        element_id=element_id,
        domain=domain,
        proposal=proposal,
        result=result,
        errors=errors if errors is not None else [],
        traversal_path=traversal_path if traversal_path is not None else [],
        embedding=embedding,
        metadata=metadata,
    )


# ---------------------------------------------------------------------------
# Abstract base
# ---------------------------------------------------------------------------

class MemoryFabric(ABC):
    """Abstract memory backend for the adjudication lattice."""

    @abstractmethod
    def record(self, entry: MemoryEntry) -> None:
        """Append a validation result.  Append-only -- no updates or deletes."""
        ...

    @abstractmethod
    def find_nearest_attractor(
        self, embedding: List[float], limit: int = 5
    ) -> List[MemoryEntry]:
        """Return up to *limit* accepted entries nearest to *embedding*."""
        ...

    @abstractmethod
    def get_rejection_history(self, element_id: str) -> List[MemoryEntry]:
        """All rejected entries for the given element, oldest first."""
        ...

    @abstractmethod
    def get_acceptance_history(self, element_id: str) -> List[MemoryEntry]:
        """All accepted entries for the given element, oldest first."""
        ...

    @abstractmethod
    def get_validation_count(self, element_id: str) -> int:
        """Total number of validation records for *element_id*."""
        ...

    @abstractmethod
    def get_fast_path_hit(
        self, embedding: List[float], threshold: float = 0.95
    ) -> Optional[MemoryEntry]:
        """Return the nearest accepted entry if similarity >= *threshold*."""
        ...

    @abstractmethod
    def export_history(self) -> List[MemoryEntry]:
        """Return every entry in insertion order."""
        ...

    @abstractmethod
    def clear(self) -> None:
        """Wipe all stored entries.  Intended for testing."""
        ...


# ---------------------------------------------------------------------------
# In-memory backend
# ---------------------------------------------------------------------------

class InMemoryFabric(MemoryFabric):
    """Volatile, list-backed memory fabric.  Fast and dependency-free."""

    def __init__(self) -> None:
        self._entries: List[MemoryEntry] = []
        self._by_element: Dict[str, List[MemoryEntry]] = {}

    # -- writes -------------------------------------------------------------

    def record(self, entry: MemoryEntry) -> None:
        self._entries.append(entry)
        self._by_element.setdefault(entry.element_id, []).append(entry)

    def clear(self) -> None:
        self._entries.clear()
        self._by_element.clear()

    # -- reads --------------------------------------------------------------

    def find_nearest_attractor(
        self, embedding: List[float], limit: int = 5
    ) -> List[MemoryEntry]:
        scored: List[tuple[float, MemoryEntry]] = []
        for entry in self._entries:
            if entry.result != "accepted" or entry.embedding is None:
                continue
            sim = cosine_similarity(embedding, entry.embedding)
            scored.append((sim, entry))
        scored.sort(key=lambda t: t[0], reverse=True)
        return [entry for _, entry in scored[:limit]]

    def get_rejection_history(self, element_id: str) -> List[MemoryEntry]:
        return [
            e
            for e in self._by_element.get(element_id, [])
            if e.result == "rejected"
        ]

    def get_acceptance_history(self, element_id: str) -> List[MemoryEntry]:
        return [
            e
            for e in self._by_element.get(element_id, [])
            if e.result == "accepted"
        ]

    def get_validation_count(self, element_id: str) -> int:
        return len(self._by_element.get(element_id, []))

    def get_fast_path_hit(
        self, embedding: List[float], threshold: float = 0.95
    ) -> Optional[MemoryEntry]:
        best_sim = -1.0
        best_entry: Optional[MemoryEntry] = None
        for entry in self._entries:
            if entry.result != "accepted" or entry.embedding is None:
                continue
            sim = cosine_similarity(embedding, entry.embedding)
            if sim > best_sim:
                best_sim = sim
                best_entry = entry
        if best_entry is not None and best_sim >= threshold:
            return best_entry
        return None

    def export_history(self) -> List[MemoryEntry]:
        return list(self._entries)


# ---------------------------------------------------------------------------
# SQLite backend
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """\
CREATE TABLE IF NOT EXISTS memory (
    id TEXT PRIMARY KEY,
    timestamp TEXT NOT NULL,
    element_id TEXT NOT NULL,
    domain TEXT NOT NULL,
    proposal TEXT NOT NULL,
    result TEXT NOT NULL,
    errors TEXT NOT NULL,
    traversal_path TEXT NOT NULL,
    embedding TEXT,
    metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_element_id ON memory(element_id);
CREATE INDEX IF NOT EXISTS idx_result ON memory(result);
CREATE INDEX IF NOT EXISTS idx_domain ON memory(domain);
"""


def _entry_to_row(entry: MemoryEntry) -> tuple:
    """Serialize a MemoryEntry into a flat tuple for INSERT."""
    return (
        entry.id,
        entry.timestamp,
        entry.element_id,
        entry.domain,
        json.dumps(entry.proposal),
        entry.result,
        json.dumps(entry.errors),
        json.dumps(entry.traversal_path),
        json.dumps(entry.embedding) if entry.embedding is not None else None,
        json.dumps(entry.metadata) if entry.metadata is not None else None,
    )


def _row_to_entry(row: tuple) -> MemoryEntry:
    """Deserialize a database row back into a MemoryEntry."""
    (
        id_,
        timestamp,
        element_id,
        domain,
        proposal_json,
        result,
        errors_json,
        traversal_path_json,
        embedding_json,
        metadata_json,
    ) = row
    return MemoryEntry(
        id=id_,
        timestamp=timestamp,
        element_id=element_id,
        domain=domain,
        proposal=json.loads(proposal_json),
        result=result,
        errors=json.loads(errors_json),
        traversal_path=json.loads(traversal_path_json),
        embedding=json.loads(embedding_json) if embedding_json is not None else None,
        metadata=json.loads(metadata_json) if metadata_json is not None else None,
    )


class SQLiteFabric(MemoryFabric):
    """Durable, SQLite-backed memory fabric with thread-safe access.

    Parameters
    ----------
    db_path : str
        Path to the SQLite database file.  Use ``":memory:"`` for an
        ephemeral in-process database (useful for tests).
    """

    def __init__(self, db_path: str = "aep_memory.db") -> None:
        self._db_path = db_path
        self._lock = threading.Lock()
        self._conn = sqlite3.connect(db_path, check_same_thread=False)
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()

    # -- internal helpers ---------------------------------------------------

    def _execute(self, sql: str, params: tuple = ()) -> sqlite3.Cursor:
        """Execute under the write lock and return the cursor."""
        with self._lock:
            cursor = self._conn.execute(sql, params)
            self._conn.commit()
            return cursor

    def _query(self, sql: str, params: tuple = ()) -> List[tuple]:
        """Read query under the lock."""
        with self._lock:
            cursor = self._conn.execute(sql, params)
            return cursor.fetchall()

    # -- writes -------------------------------------------------------------

    def record(self, entry: MemoryEntry) -> None:
        self._execute(
            "INSERT INTO memory "
            "(id, timestamp, element_id, domain, proposal, result, "
            "errors, traversal_path, embedding, metadata) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            _entry_to_row(entry),
        )

    def clear(self) -> None:
        self._execute("DELETE FROM memory")

    # -- reads --------------------------------------------------------------

    def find_nearest_attractor(
        self, embedding: List[float], limit: int = 5
    ) -> List[MemoryEntry]:
        rows = self._query(
            "SELECT id, timestamp, element_id, domain, proposal, result, "
            "errors, traversal_path, embedding, metadata "
            "FROM memory WHERE result = 'accepted' AND embedding IS NOT NULL"
        )
        scored: List[tuple[float, MemoryEntry]] = []
        for row in rows:
            entry = _row_to_entry(row)
            if entry.embedding is not None:
                sim = cosine_similarity(embedding, entry.embedding)
                scored.append((sim, entry))
        scored.sort(key=lambda t: t[0], reverse=True)
        return [entry for _, entry in scored[:limit]]

    def get_rejection_history(self, element_id: str) -> List[MemoryEntry]:
        rows = self._query(
            "SELECT id, timestamp, element_id, domain, proposal, result, "
            "errors, traversal_path, embedding, metadata "
            "FROM memory WHERE element_id = ? AND result = 'rejected' "
            "ORDER BY timestamp ASC",
            (element_id,),
        )
        return [_row_to_entry(r) for r in rows]

    def get_acceptance_history(self, element_id: str) -> List[MemoryEntry]:
        rows = self._query(
            "SELECT id, timestamp, element_id, domain, proposal, result, "
            "errors, traversal_path, embedding, metadata "
            "FROM memory WHERE element_id = ? AND result = 'accepted' "
            "ORDER BY timestamp ASC",
            (element_id,),
        )
        return [_row_to_entry(r) for r in rows]

    def get_validation_count(self, element_id: str) -> int:
        rows = self._query(
            "SELECT COUNT(*) FROM memory WHERE element_id = ?",
            (element_id,),
        )
        return rows[0][0] if rows else 0

    def get_fast_path_hit(
        self, embedding: List[float], threshold: float = 0.95
    ) -> Optional[MemoryEntry]:
        rows = self._query(
            "SELECT id, timestamp, element_id, domain, proposal, result, "
            "errors, traversal_path, embedding, metadata "
            "FROM memory WHERE result = 'accepted' AND embedding IS NOT NULL"
        )
        best_sim = -1.0
        best_entry: Optional[MemoryEntry] = None
        for row in rows:
            entry = _row_to_entry(row)
            if entry.embedding is not None:
                sim = cosine_similarity(embedding, entry.embedding)
                if sim > best_sim:
                    best_sim = sim
                    best_entry = entry
        if best_entry is not None and best_sim >= threshold:
            return best_entry
        return None

    def export_history(self) -> List[MemoryEntry]:
        rows = self._query(
            "SELECT id, timestamp, element_id, domain, proposal, result, "
            "errors, traversal_path, embedding, metadata "
            "FROM memory ORDER BY rowid ASC"
        )
        return [_row_to_entry(r) for r in rows]

    def close(self) -> None:
        """Explicitly close the database connection."""
        with self._lock:
            self._conn.close()
