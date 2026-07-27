# @PAD: /root/dynAEP/sdk/python/dynaep/causal/partitioned_engine.py
# ===========================================================================
# dynaep.causal.partitioned_engine - Partitioned Causal Ordering Engine
# OPT-005: Partitions causal ordering by scene graph subtree.
# Uses threading.Lock for cross-partition moves in Python.
# ===========================================================================

from __future__ import annotations
import threading
import copy
import logging
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Set, Callable, Protocol

from .sparse_vector_clock import SparseVectorClock
from ..temporal.causal import CausalEvent, CausalViolation, CausalOrderResult, CausalConfig

logger = logging.getLogger("dynaep.causal.partitioned_engine")


class SceneGraph(Protocol):
    def get_parent(self, element_id: str) -> Optional[str]: ...
    def get_children(self, element_id: str) -> List[str]: ...
    def is_root(self, element_id: str) -> bool: ...


@dataclass
class PartitionStats:
    partition_key: str
    agent_count: int
    buffer_size: int
    buffer_capacity: int
    delivered_count: int
    conflict_count: int


@dataclass
class OrderingResult:
    ordered: bool
    position: int
    violations: List[CausalViolation]
    reordered_events: List[str]
    partition_key: str


class SubtreeOrderingContext:
    """Per-partition ordering with sparse vector clock and reorder buffer."""

    def __init__(self, partition_key: str, config: CausalConfig, buffer_capacity: int) -> None:
        self.partition_key = partition_key
        self._config = config
        self._buffer_capacity = buffer_capacity
        self._vector_clock = SparseVectorClock()
        self._expected_seq: Dict[str, int] = {}
        self._reorder_buffer: List[CausalEvent] = []
        self._delivered: Set[str] = set()
        self._element_history: Dict[str, List[CausalEvent]] = {}
        self._delivery_pos = 0
        self._conflict_count = 0
        self._lock = threading.Lock()

    def has_delivered(self, event_id: str) -> bool:
        return event_id in self._delivered

    def process(self, event: CausalEvent) -> CausalOrderResult:
        violations: List[CausalViolation] = []
        reordered: List[str] = []

        if event.agent_id not in self._expected_seq:
            self._expected_seq[event.agent_id] = 1

        if event.event_id in self._delivered:
            violations.append(CausalViolation(
                type="duplicate_sequence", event_id=event.event_id,
                agent_id=event.agent_id,
                detail=f"Event {event.event_id} already delivered in partition {self.partition_key}",
            ))
            return CausalOrderResult(ordered=False, position=-1, violations=violations, reordered_events=reordered)

        expected = self._expected_seq[event.agent_id]
        incoming = event.sequence_number

        if incoming < expected:
            violations.append(CausalViolation(
                type="agent_clock_regression", event_id=event.event_id,
                agent_id=event.agent_id,
                detail=f"Agent {event.agent_id} sent seq {incoming} but expected {expected}",
            ))
            return CausalOrderResult(ordered=False, position=-1, violations=violations, reordered_events=reordered)

        if incoming > expected:
            violations.append(CausalViolation(
                type="out_of_order", event_id=event.event_id,
                agent_id=event.agent_id,
                detail=f"Agent {event.agent_id} sent seq {incoming} but expected {expected} - buffering",
            ))
            self._buffer_event(event)
            return CausalOrderResult(ordered=False, position=-1, violations=violations, reordered_events=reordered)

        dep_violations = self._check_deps(event)
        if dep_violations:
            violations.extend(dep_violations)
            self._buffer_event(event)
            return CausalOrderResult(ordered=False, position=-1, violations=violations, reordered_events=reordered)

        position = self._deliver(event)
        reordered.extend(self._drain_buffer())
        return CausalOrderResult(ordered=True, position=position, violations=violations, reordered_events=reordered)

    def remove_element(self, element_id: str) -> None:
        self._element_history.pop(element_id, None)
        self._reorder_buffer = [e for e in self._reorder_buffer if e.target_element_id != element_id]

    def reset(self) -> None:
        self._vector_clock = SparseVectorClock()
        self._expected_seq.clear()
        self._reorder_buffer.clear()
        self._delivered.clear()
        self._element_history.clear()
        self._delivery_pos = 0
        self._conflict_count = 0

    def flush(self) -> List[CausalEvent]:
        sorted_buf = sorted(self._reorder_buffer, key=lambda e: (e.sequence_number, e.bridge_time_ms))
        flushed = []
        for event in sorted_buf:
            self._deliver(event)
            flushed.append(copy.deepcopy(event))
        self._reorder_buffer.clear()
        return flushed

    def get_stats(self) -> PartitionStats:
        return PartitionStats(
            partition_key=self.partition_key,
            agent_count=len(self._expected_seq),
            buffer_size=len(self._reorder_buffer),
            buffer_capacity=self._buffer_capacity,
            delivered_count=self._delivery_pos,
            conflict_count=self._conflict_count,
        )

    def _deliver(self, event: CausalEvent) -> int:
        if self._config.enable_vector_clocks:
            incoming = SparseVectorClock(event.vector_clock)
            self._vector_clock.merge(incoming)
            self._vector_clock.increment(event.agent_id)
        self._expected_seq[event.agent_id] = event.sequence_number + 1
        self._delivered.add(event.event_id)
        pos = self._delivery_pos
        self._delivery_pos += 1
        if self._config.enable_element_history:
            eid = event.target_element_id
            if eid not in self._element_history:
                self._element_history[eid] = []
            self._element_history[eid].append(copy.deepcopy(event))
            if len(self._element_history[eid]) > self._config.history_depth:
                self._element_history[eid] = self._element_history[eid][-self._config.history_depth:]
        return pos

    def _buffer_event(self, event: CausalEvent) -> None:
        self._reorder_buffer.append(copy.deepcopy(event))
        if len(self._reorder_buffer) > self._buffer_capacity:
            self._reorder_buffer.sort(key=lambda e: e.bridge_time_ms)
            evicted = self._reorder_buffer.pop(0)
            self._deliver(evicted)

    def _check_deps(self, event: CausalEvent, cross_check: Optional[Callable[[str], bool]] = None) -> List[CausalViolation]:
        missing = []
        for dep_id in event.causal_dependencies:
            local = dep_id in self._delivered
            cross = cross_check(dep_id) if cross_check else False
            if not local and not cross:
                missing.append(CausalViolation(
                    type="missing_dependency", event_id=event.event_id,
                    agent_id=event.agent_id,
                    detail=f"Event {event.event_id} depends on {dep_id} which has not been delivered",
                ))
        return missing

    def _drain_buffer(self) -> List[str]:
        delivered = []
        progress = True
        while progress:
            progress = False
            for i, buf in enumerate(self._reorder_buffer):
                expected = self._expected_seq.get(buf.agent_id)
                if expected is None:
                    continue
                if buf.sequence_number != expected:
                    continue
                if self._check_deps(buf):
                    continue
                self._reorder_buffer.pop(i)
                self._deliver(buf)
                delivered.append(buf.event_id)
                progress = True
                break
        return delivered


class PartitionedCausalEngine:
    """Causal ordering engine partitioned by scene graph subtree."""

    def __init__(self, config: CausalConfig, scene_graph: SceneGraph) -> None:
        self._config = config
        self._scene_graph = scene_graph
        self._partitions: Dict[str, SubtreeOrderingContext] = {}
        self._element_cache: Dict[str, str] = {}
        self._global_pos = 0
        self._partition_locks: Dict[str, threading.Lock] = {}

    def process_event(self, event: CausalEvent) -> OrderingResult:
        partition_key = self._compute_partition_key(event.target_element_id)
        partition = self._get_or_create(partition_key)

        def cross_check(dep_id: str) -> bool:
            for key, ctx in self._partitions.items():
                if key != partition_key and ctx.has_delivered(dep_id):
                    return True
            return False

        result = partition.process(event)
        if result.ordered:
            pos = self._global_pos
            self._global_pos += 1
            return OrderingResult(
                ordered=True, position=pos,
                violations=result.violations,
                reordered_events=result.reordered_events,
                partition_key=partition_key,
            )
        return OrderingResult(
            ordered=False, position=-1,
            violations=result.violations,
            reordered_events=result.reordered_events,
            partition_key=partition_key,
        )

    def handle_cross_partition_move(self, element_id: str, new_parent_id: str) -> Dict:
        old_key = self._compute_partition_key(element_id)
        new_key = self._compute_partition_key(new_parent_id)
        if old_key == new_key:
            return {"success": True, "old_partition": old_key, "new_partition": new_key}

        # Acquire locks in deterministic order
        first_key, second_key = sorted([old_key, new_key])
        first_lock = self._get_lock(first_key)
        second_lock = self._get_lock(second_key)

        with first_lock:
            with second_lock:
                old_partition = self._get_or_create(old_key)
                old_partition.remove_element(element_id)
                self._element_cache.pop(element_id, None)
                return {"success": True, "old_partition": old_key, "new_partition": new_key}

    def reset(self) -> None:
        for ctx in self._partitions.values():
            ctx.reset()
        self._partitions.clear()
        self._element_cache.clear()
        self._global_pos = 0

    def get_partition_stats(self) -> Dict[str, PartitionStats]:
        return {key: ctx.get_stats() for key, ctx in self._partitions.items()}

    def flush(self) -> List[CausalEvent]:
        result = []
        for ctx in self._partitions.values():
            result.extend(ctx.flush())
        return result

    def _compute_partition_key(self, element_id: str) -> str:
        cached = self._element_cache.get(element_id)
        if cached is not None:
            return cached

        current = element_id
        visited: Set[str] = set()

        while True:
            if current in visited:
                break
            visited.add(current)
            parent = self._scene_graph.get_parent(current)
            if parent is None or self._scene_graph.is_root(current):
                if current == element_id:
                    self._element_cache[element_id] = current
                    return current
                self._element_cache[element_id] = current
                return current
            if self._scene_graph.is_root(parent):
                self._element_cache[element_id] = current
                return current
            current = parent

        self._element_cache[element_id] = element_id
        return element_id

    def _get_or_create(self, key: str) -> SubtreeOrderingContext:
        if key not in self._partitions:
            count = max(1, len(self._partitions) + 1)
            capacity = max(4, self._config.max_reorder_buffer_size // count)
            self._partitions[key] = SubtreeOrderingContext(key, self._config, capacity)
        return self._partitions[key]

    def _get_lock(self, key: str) -> threading.Lock:
        if key not in self._partition_locks:
            self._partition_locks[key] = threading.Lock()
        return self._partition_locks[key]
