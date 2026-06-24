# @PAD: /root/dynAEP/sdk/python/dynaep/causal/sparse_vector_clock.py
# ===========================================================================
# dynaep.causal.sparse_vector_clock - Sparse Vector Clock
# OPT-005: Efficient vector clock tracking only agents with non-zero entries.
# O(min(|A|, |B|)) comparison instead of O(totalAgents).
# ===========================================================================

from __future__ import annotations
import copy
from typing import Dict, Iterator, Tuple


class SparseVectorClock:
    """Sparse vector clock that only tracks agents with non-zero entries."""

    __slots__ = ("_entries",)

    def __init__(self, initial: Dict[str, int] | None = None) -> None:
        self._entries: Dict[str, int] = {}
        if initial:
            for k, v in initial.items():
                if v > 0:
                    self._entries[k] = v

    @property
    def size(self) -> int:
        return len(self._entries)

    def get(self, agent_id: str) -> int:
        return self._entries.get(agent_id, 0)

    def increment(self, agent_id: str) -> None:
        self._entries[agent_id] = self._entries.get(agent_id, 0) + 1

    def set(self, agent_id: str, value: int) -> None:
        if value <= 0:
            self._entries.pop(agent_id, None)
        else:
            self._entries[agent_id] = value

    def merge(self, other: SparseVectorClock) -> None:
        for agent_id, other_val in other._entries.items():
            current = self._entries.get(agent_id, 0)
            if other_val > current:
                self._entries[agent_id] = other_val

    def dominates(self, other: SparseVectorClock) -> bool:
        has_greater = False
        for agent_id, other_val in other._entries.items():
            this_val = self._entries.get(agent_id, 0)
            if this_val < other_val:
                return False
            if this_val > other_val:
                has_greater = True
        if not has_greater:
            for agent_id in self._entries:
                if agent_id not in other._entries:
                    has_greater = True
                    break
        return has_greater

    def is_concurrent_with(self, other: SparseVectorClock) -> bool:
        this_greater = False
        other_greater = False
        for agent_id, other_val in other._entries.items():
            this_val = self._entries.get(agent_id, 0)
            if this_val > other_val:
                this_greater = True
            if other_val > this_val:
                other_greater = True
            if this_greater and other_greater:
                return True
        if not this_greater:
            for agent_id in self._entries:
                if agent_id not in other._entries:
                    this_greater = True
                    break
        return this_greater and other_greater

    def clone(self) -> SparseVectorClock:
        return SparseVectorClock(copy.copy(self._entries))

    def to_dict(self) -> Dict[str, int]:
        return dict(self._entries)

    def entries(self) -> Iterator[Tuple[str, int]]:
        return iter(self._entries.items())

    def has(self, agent_id: str) -> bool:
        return agent_id in self._entries

    def remove(self, agent_id: str) -> None:
        self._entries.pop(agent_id, None)
