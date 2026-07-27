# @PAD: /root/dynAEP/sdk/python/dynaep/causal/durable_store.py
# ===========================================================================
# dynaep.causal.durable_store - Durable Causal State Store Interface
# TA-3.1: Defines the interface for persisting causal ordering state across
# bridge restarts. Implementations include file-based (JSONL append log),
# SQLite, and external (Redis/PostgreSQL) adapters.
# ===========================================================================

from __future__ import annotations

import datetime
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Protocol


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class BufferedEvent:
    """A buffered event stored in the reorder buffer, awaiting delivery.

    Contains the event data plus metadata about when it was buffered
    and which partition it belongs to.
    """
    event: Dict
    buffered_at: float
    partition_key: str


@dataclass
class DependencyEdge:
    """Dependency graph edge: one event depends on another."""
    event_id: str
    depends_on: str
    partition_key: str


@dataclass
class DependencyGraph:
    """Serializable dependency graph for persistence."""
    edges: List[DependencyEdge] = field(default_factory=list)
    delivered_event_ids: List[str] = field(default_factory=list)


@dataclass
class AgentRegistration:
    """Agent registration record for persistence."""
    agent_id: str
    registered_at: float
    last_sequence: int
    last_event_id: Optional[str]
    capabilities: List[str] = field(default_factory=list)


@dataclass
class CausalStateSnapshot:
    """Complete snapshot of all causal state for persistence."""
    vector_clocks: Dict[str, Dict[str, int]]
    reorder_buffer: List[BufferedEvent]
    dependency_graph: DependencyGraph
    agent_registry: Dict[str, AgentRegistration]
    causal_position: int
    snapshot_at: float


@dataclass
class CausalPersistenceConfig:
    """Configuration for causal state persistence."""
    enabled: bool = True
    backend: str = "file"  # "file" | "sqlite" | "external"
    path: str = ""
    flush_interval_ms: int = 100
    flush_batch_size: int = 100
    compact_interval_ms: int = 3600000
    recovery_on_startup: bool = True
    max_recovery_gap_ms: int = 60000


# ---------------------------------------------------------------------------
# Interface
# ---------------------------------------------------------------------------


class DurableCausalStore(Protocol):
    """Interface for durable causal state storage.

    Implementations persist all causal ordering state so that the bridge
    can recover from crashes without losing vector clocks, reorder buffer
    contents, or dependency tracking.

    All methods are designed to accommodate both file and network-based
    backends. In the Python SDK, implementations use synchronous I/O
    with threading for background operations.
    """

    def save_vector_clocks(self, clocks: Dict[str, Dict[str, int]]) -> None:
        """Save all vector clocks.

        Keyed by partition key, each containing agent-to-sequence mappings.
        """
        ...

    def load_vector_clocks(self) -> Dict[str, Dict[str, int]]:
        """Load all vector clocks from persistent storage.

        Returns an empty dict if no state has been persisted.
        """
        ...

    def save_reorder_buffer(self, events: List[BufferedEvent]) -> None:
        """Save the current reorder buffer contents."""
        ...

    def load_reorder_buffer(self) -> List[BufferedEvent]:
        """Load the reorder buffer from persistent storage.

        Returns an empty list if no state has been persisted.
        """
        ...

    def save_dependency_graph(self, graph: DependencyGraph) -> None:
        """Save the dependency graph (edges + delivered event IDs)."""
        ...

    def load_dependency_graph(self) -> DependencyGraph:
        """Load the dependency graph from persistent storage.

        Returns a graph with empty edges and delivered_event_ids if none exists.
        """
        ...

    def save_agent_registry(self, agents: Dict[str, AgentRegistration]) -> None:
        """Save the agent registry (agent ID -> registration record)."""
        ...

    def load_agent_registry(self) -> Dict[str, AgentRegistration]:
        """Load the agent registry from persistent storage.

        Returns an empty dict if no state has been persisted.
        """
        ...

    def save_causal_position(self, position: int) -> None:
        """Save the current global causal position counter."""
        ...

    def load_causal_position(self) -> int:
        """Load the global causal position counter.

        Returns 0 if no state has been persisted.
        """
        ...

    def get_state_age(self) -> Optional[datetime.datetime]:
        """Get the age (timestamp) of the most recently persisted state.

        Returns None if no state has been persisted.
        """
        ...

    def compact(self) -> None:
        """Compact the store by replacing append logs with a single snapshot.

        This reduces storage size and load time.
        """
        ...

    def close(self) -> None:
        """Close the store and release any resources (file handles, connections)."""
        ...
