# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/causal.py
# ===========================================================================
# dynaep.temporal.causal - Causal Ordering Engine
# Provides causal event ordering with vector clocks, reorder buffering,
# conflict detection, and per-element history tracking. Ensures that
# concurrent distributed agents produce a consistent ordering of
# mutations on shared design elements.
# ===========================================================================

from __future__ import annotations
import copy
import threading
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("dynaep.temporal.causal")


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class CausalEvent:
    """A single event in the causal ordering pipeline."""
    event_id: str
    agent_id: str
    bridge_time_ms: int
    target_element_id: str
    sequence_number: int
    vector_clock: dict = field(default_factory=dict)
    causal_dependencies: list = field(default_factory=list)


@dataclass
class CausalViolation:
    """Describes a causal ordering violation for a specific event."""
    type: str  # "out_of_order" | "missing_dependency" | "duplicate_sequence" | "agent_clock_regression"
    event_id: str
    agent_id: str
    detail: str


@dataclass
class CausalOrderResult:
    """Result of processing a single event through the causal ordering engine."""
    ordered: bool
    position: int
    violations: list
    reordered_events: list


@dataclass
class CausalConfig:
    """Configuration for the causal ordering engine."""
    max_reorder_buffer_size: int = 64
    max_reorder_wait_ms: int = 200
    conflict_resolution: str = "last_write_wins"  # "last_write_wins" | "optimistic_locking"
    enable_vector_clocks: bool = True
    enable_element_history: bool = True
    history_depth: int = 100


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------


def _compare_vector_clocks(
    clock_a: dict[str, int],
    clock_b: dict[str, int],
) -> int:
    """Compare two vector clocks and determine dominance.

    Returns 1 if clock_a dominates clock_b, -1 if clock_b dominates
    clock_a, and 0 if they are concurrent (neither dominates).
    """
    all_agents = set(list(clock_a.keys()) + list(clock_b.keys()))
    a_greater = False
    b_greater = False

    for agent in all_agents:
        val_a = clock_a.get(agent, 0)
        val_b = clock_b.get(agent, 0)
        if val_a > val_b:
            a_greater = True
        if val_b > val_a:
            b_greater = True

    if a_greater and not b_greater:
        return 1
    if b_greater and not a_greater:
        return -1
    return 0


def _clone_record(source: dict[str, int]) -> dict[str, int]:
    """Create a shallow copy of a string-to-int mapping.

    Used to snapshot vector clocks without shared references between
    the engine and event producers.
    """
    result: dict[str, int] = {}
    for key in source:
        result[key] = source[key]
    return result


def _clone_event(event: CausalEvent) -> CausalEvent:
    """Create a deep copy of a CausalEvent.

    Clones the vector clock dict and dependencies list so that the
    original event object cannot be mutated through the copy.
    """
    return CausalEvent(
        event_id=event.event_id,
        agent_id=event.agent_id,
        bridge_time_ms=event.bridge_time_ms,
        target_element_id=event.target_element_id,
        sequence_number=event.sequence_number,
        vector_clock=_clone_record(event.vector_clock),
        causal_dependencies=list(event.causal_dependencies),
    )


# ---------------------------------------------------------------------------
# Causal Ordering Engine
# ---------------------------------------------------------------------------


class CausalOrderingEngine:
    """Maintains causal ordering of events from distributed agents.

    Uses vector clocks for causality tracking, a reorder buffer for
    out-of-sequence events, and per-element history for conflict detection.
    Events are delivered in causal order with violations reported for
    regressions, missing dependencies, and duplicates.
    """

    def __init__(self, config: CausalConfig) -> None:
        self._config = CausalConfig(
            max_reorder_buffer_size=config.max_reorder_buffer_size,
            max_reorder_wait_ms=config.max_reorder_wait_ms,
            conflict_resolution=config.conflict_resolution,
            enable_vector_clocks=config.enable_vector_clocks,
            enable_element_history=config.enable_element_history,
            history_depth=config.history_depth,
        )
        self._vector_clock: dict[str, int] = {}
        self._expected_sequence: dict[str, int] = {}
        self._reorder_buffer: list[CausalEvent] = []
        self._delivered_event_ids: set[str] = set()
        self._element_history_map: dict[str, list[CausalEvent]] = {}
        self._delivery_position: int = 0
        self._buffer_timers: dict[str, threading.Timer] = {}

    # -----------------------------------------------------------------------
    # Agent registration
    # -----------------------------------------------------------------------

    def register_agent(self, agent_id: str) -> None:
        """Register an agent by initializing its vector clock counter.

        Sets the counter to zero and the expected sequence number to 1
        so that the first event from this agent is properly accepted.
        """
        self._vector_clock[agent_id] = 0
        self._expected_sequence[agent_id] = 1
        registered_count = len(self._vector_clock)
        logger.debug("Registered agent %s, total agents: %d", agent_id, registered_count)

    # -----------------------------------------------------------------------
    # Event processing
    # -----------------------------------------------------------------------

    def process(self, event: CausalEvent) -> CausalOrderResult:
        """Process a single causal event through the ordering pipeline.

        The algorithm:
        1. Auto-registers unknown agents
        2. Checks for duplicate events
        3. Checks for clock regression (sequence number behind expected)
        4. Buffers out-of-order events with a timeout
        5. Validates causal dependency satisfaction
        6. Delivers in-order events immediately
        7. Merges vector clocks and records delivery
        8. Drains any now-deliverable buffered events
        """
        violations: list[CausalViolation] = []
        reordered_events: list[str] = []

        # Auto-register unknown agents
        if event.agent_id not in self._vector_clock:
            self.register_agent(event.agent_id)

        expected = self._expected_sequence[event.agent_id]
        incoming = event.sequence_number

        # Check for duplicate delivery
        if event.event_id in self._delivered_event_ids:
            violations.append(CausalViolation(
                type="duplicate_sequence",
                event_id=event.event_id,
                agent_id=event.agent_id,
                detail=(
                    "Event " + event.event_id
                    + " has already been delivered - skipping duplicate"
                ),
            ))
            return CausalOrderResult(
                ordered=False,
                position=-1,
                violations=violations,
                reordered_events=reordered_events,
            )

        # Check for clock regression
        if incoming < expected:
            violations.append(CausalViolation(
                type="agent_clock_regression",
                event_id=event.event_id,
                agent_id=event.agent_id,
                detail=(
                    "Agent " + event.agent_id + " sent sequence "
                    + str(incoming) + " but expected " + str(expected)
                    + " - clock has regressed"
                ),
            ))
            return CausalOrderResult(
                ordered=False,
                position=-1,
                violations=violations,
                reordered_events=reordered_events,
            )

        # Buffer out-of-order events
        if incoming > expected:
            violations.append(CausalViolation(
                type="out_of_order",
                event_id=event.event_id,
                agent_id=event.agent_id,
                detail=(
                    "Agent " + event.agent_id + " sent sequence "
                    + str(incoming) + " but expected " + str(expected)
                    + " - buffering for reorder"
                ),
            ))
            self._buffer_event(event)
            self._schedule_buffer_timeout(event.event_id, event.agent_id)
            return CausalOrderResult(
                ordered=False,
                position=-1,
                violations=violations,
                reordered_events=reordered_events,
            )

        # Check causal dependencies
        dep_violations = self._check_dependencies(event)
        for dep_v in dep_violations:
            violations.append(dep_v)

        if len(dep_violations) > 0:
            self._buffer_event(event)
            self._schedule_buffer_timeout(event.event_id, event.agent_id)
            return CausalOrderResult(
                ordered=False,
                position=-1,
                violations=violations,
                reordered_events=reordered_events,
            )

        # Deliver in-order event
        position = self._deliver_event(event)

        # Drain any now-deliverable buffered events
        drained_ids = self._drain_buffer(event.agent_id)
        for drained_id in drained_ids:
            reordered_events.append(drained_id)

        return CausalOrderResult(
            ordered=True,
            position=position,
            violations=violations,
            reordered_events=reordered_events,
        )

    # -----------------------------------------------------------------------
    # Query methods
    # -----------------------------------------------------------------------

    def get_vector_clock(self) -> dict[str, int]:
        """Return a defensive copy of the current vector clock state.

        Each entry maps an agent ID to its latest known counter value.
        The returned dict is independent of the engine's internal state.
        """
        snapshot = _clone_record(self._vector_clock)
        entry_count = len(snapshot)
        logger.debug("Vector clock snapshot has %d entries", entry_count)
        return snapshot

    def element_history(self, element_id: str) -> list[CausalEvent]:
        """Retrieve the history of causal events targeting a specific element.

        Returns a defensive copy of the event list. If no history exists
        for the given element, an empty list is returned.
        """
        history = self._element_history_map.get(element_id)
        if history is None:
            empty: list[CausalEvent] = []
            return empty
        copied = [_clone_event(evt) for evt in history]
        return copied

    def detect_conflicts(self, event_a: CausalEvent, event_b: CausalEvent) -> bool:
        """Determine whether two events are in causal conflict.

        Two events conflict when they both target the same element and
        neither event's vector clock dominates the other (concurrent).
        """
        if event_a.target_element_id != event_b.target_element_id:
            return False
        comparison = _compare_vector_clocks(event_a.vector_clock, event_b.vector_clock)
        is_concurrent = comparison == 0
        return is_concurrent

    # -----------------------------------------------------------------------
    # Buffer management
    # -----------------------------------------------------------------------

    def flush(self) -> list[CausalEvent]:
        """Drain the entire reorder buffer in best-effort causal order.

        Events are sorted by sequence number (ascending), then by bridge
        time for ties. All pending buffer timers are cancelled. Returns
        the list of events that were force-delivered.
        """
        sorted_buffer = sorted(
            self._reorder_buffer,
            key=lambda e: (e.sequence_number, e.bridge_time_ms),
        )
        flushed_events: list[CausalEvent] = []

        for event in sorted_buffer:
            self._deliver_event(event)
            flushed_events.append(_clone_event(event))

        self._reorder_buffer = []

        for timer_id, timer in list(self._buffer_timers.items()):
            timer.cancel()
            del self._buffer_timers[timer_id]

        return flushed_events

    def reset(self) -> None:
        """Reset all internal state to the initial empty configuration.

        Clears vector clocks, sequence expectations, buffers, timers,
        delivered event tracking, element history, and the delivery counter.
        """
        self._vector_clock = {}
        self._expected_sequence = {}

        for timer_id, timer in list(self._buffer_timers.items()):
            timer.cancel()

        self._buffer_timers = {}
        self._reorder_buffer = []
        self._delivered_event_ids = set()
        self._element_history_map = {}
        self._delivery_position = 0

    # -----------------------------------------------------------------------
    # Internal: delivery
    # -----------------------------------------------------------------------

    def _deliver_event(self, event: CausalEvent) -> int:
        """Deliver an event by advancing the vector clock and recording it.

        Increments the expected sequence for the agent, merges the event's
        vector clock, records element history, and returns the assigned
        delivery position.
        """
        if self._config.enable_vector_clocks:
            self._merge_vector_clock(event)
            current_val = self._vector_clock.get(event.agent_id, 0)
            self._vector_clock[event.agent_id] = current_val + 1

        self._expected_sequence[event.agent_id] = event.sequence_number + 1
        self._delivered_event_ids.add(event.event_id)

        position = self._delivery_position
        self._delivery_position += 1

        if self._config.enable_element_history:
            self._record_element_history(event)

        # Cancel any pending timer for this event
        existing_timer = self._buffer_timers.get(event.event_id)
        if existing_timer is not None:
            existing_timer.cancel()
            del self._buffer_timers[event.event_id]

        return position

    def _merge_vector_clock(self, event: CausalEvent) -> None:
        """Merge the incoming event's vector clock into the engine's clock.

        Takes the component-wise maximum for each agent entry so the
        engine tracks the latest known state from all agents.
        """
        incoming_clock = event.vector_clock
        agents = list(incoming_clock.keys())
        for agent in agents:
            current_val = self._vector_clock.get(agent, 0)
            incoming_val = incoming_clock.get(agent, 0)
            self._vector_clock[agent] = max(current_val, incoming_val)

    # -----------------------------------------------------------------------
    # Internal: dependency checks
    # -----------------------------------------------------------------------

    def _check_dependencies(self, event: CausalEvent) -> list[CausalViolation]:
        """Check whether all causal dependencies of an event have been delivered.

        Returns a list of violations for each dependency that has not
        been seen. An empty list means all dependencies are satisfied.
        """
        missing: list[CausalViolation] = []
        deps = event.causal_dependencies
        for dep_id in deps:
            if dep_id not in self._delivered_event_ids:
                violation = CausalViolation(
                    type="missing_dependency",
                    event_id=event.event_id,
                    agent_id=event.agent_id,
                    detail=(
                        "Event " + event.event_id + " depends on "
                        + dep_id + " which has not been delivered yet"
                    ),
                )
                missing.append(violation)
        return missing

    # -----------------------------------------------------------------------
    # Internal: buffer management
    # -----------------------------------------------------------------------

    def _buffer_event(self, event: CausalEvent) -> None:
        """Add an event to the reorder buffer.

        If the buffer exceeds the configured maximum size, the oldest
        event (by bridge time) is evicted and force-delivered.
        """
        cloned = _clone_event(event)
        self._reorder_buffer.append(cloned)
        current_size = len(self._reorder_buffer)

        if current_size > self._config.max_reorder_buffer_size:
            self._reorder_buffer.sort(key=lambda e: e.bridge_time_ms)
            evicted = self._reorder_buffer.pop(0)
            self._deliver_event(evicted)

    def _schedule_buffer_timeout(self, event_id: str, agent_id: str) -> None:
        """Schedule a timeout for a buffered event.

        When the timer fires, if the event is still in the buffer, it
        will be force-delivered to prevent indefinite waiting.
        """
        wait_seconds = self._config.max_reorder_wait_ms / 1000.0

        existing_timer = self._buffer_timers.get(event_id)
        if existing_timer is not None:
            existing_timer.cancel()
            del self._buffer_timers[event_id]

        def _on_timeout() -> None:
            idx = None
            for i, buffered in enumerate(self._reorder_buffer):
                if buffered.event_id == event_id:
                    idx = i
                    break
            if idx is not None:
                timed_out_event = self._reorder_buffer.pop(idx)
                self._deliver_event(timed_out_event)
            if event_id in self._buffer_timers:
                del self._buffer_timers[event_id]

        timer = threading.Timer(wait_seconds, _on_timeout)
        timer.daemon = True
        timer.start()
        self._buffer_timers[event_id] = timer

    # -----------------------------------------------------------------------
    # Internal: element history
    # -----------------------------------------------------------------------

    def _record_element_history(self, event: CausalEvent) -> None:
        """Record a delivered event in the element history map.

        Keyed by target element ID. If the history exceeds the configured
        depth, the oldest entries are trimmed from the front.
        """
        element_id = event.target_element_id
        history = self._element_history_map.get(element_id)

        if history is None:
            history = []
            self._element_history_map[element_id] = history

        history.append(_clone_event(event))

        if len(history) > self._config.history_depth:
            excess = len(history) - self._config.history_depth
            del history[:excess]

    # -----------------------------------------------------------------------
    # Internal: buffer draining
    # -----------------------------------------------------------------------

    def _drain_buffer(self, trigger_agent_id: str) -> list[str]:
        """Drain buffered events that have become deliverable.

        Iterates until no more events can be delivered. Returns the IDs
        of all events that were successfully delivered from the buffer.
        """
        delivered: list[str] = []
        progress = True

        while progress:
            progress = False
            deliverable_index = None

            for i, buffered in enumerate(self._reorder_buffer):
                expected = self._expected_sequence.get(buffered.agent_id)
                if expected is None:
                    continue
                if buffered.sequence_number != expected:
                    continue
                dep_check = self._check_dependencies(buffered)
                if len(dep_check) == 0:
                    deliverable_index = i
                    break

            if deliverable_index is not None:
                next_event = self._reorder_buffer.pop(deliverable_index)
                self._deliver_event(next_event)
                delivered.append(next_event.event_id)
                progress = True

        return delivered
