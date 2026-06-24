# @PAD: /root/dynAEP/sdk/python/dynaep/workflow/temporal_primitives.py
# ===========================================================================
# dynaep.workflow.temporal_primitives - Workflow Temporal Primitives
# TA-3.3: Bridge-authoritative temporal primitives for workflow orchestration.
# All time measurements use the injected bridge clock (get_now) rather than
# time.time(), ensuring that deadlines, schedules, sleep/resume, and timeouts
# are governed by the same monotonic, NTP-synchronized time source used by
# the rest of the dynAEP temporal layer.
#
# The module is fully testable: pass a mock get_now callable to control time
# in unit tests without real clock dependencies.
# ===========================================================================

from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, TypeVar

logger = logging.getLogger("dynaep.workflow.temporal_primitives")

T = TypeVar("T")


# ---------------------------------------------------------------------------
# Errors
# ---------------------------------------------------------------------------


class TemporalTimeoutError(Exception):
    """Raised when a bridge-time timeout expires before the wrapped operation
    completes. Carries the elapsed bridge-time so callers can distinguish
    timeout from other failure modes.
    """

    def __init__(self, elapsed_ms: float) -> None:
        super().__init__(f"Temporal timeout after {elapsed_ms}ms (bridge time)")
        self.elapsed_ms = elapsed_ms


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class DeadlineHandle:
    """Handle returned by set_deadline. Identifies a registered deadline and
    carries the bridge-time at which it was created plus the absolute
    deadline timestamp.
    """
    task_id: str
    deadline_ms: float
    created_at: float


@dataclass
class ScheduleHandle:
    """Handle returned by schedule. Identifies an active recurring schedule
    and tracks when the next invocation is due.
    """
    schedule_id: str
    interval_ms: float
    next_run_ms: float


@dataclass
class SuspendedTask:
    """Snapshot of a suspended task. Records the bridge-time at which
    suspension occurred so that resume can compute elapsed bridge time.
    """
    task_id: str
    suspended_at: float


@dataclass
class SerializedDeadline:
    """Serializable form of a deadline for persistence across restarts."""
    task_id: str
    deadline_ms: float
    created_at: float


@dataclass
class SerializedSchedule:
    """Serializable form of a schedule for persistence across restarts."""
    schedule_id: str
    interval_ms: float
    next_run_ms: float
    last_run_ms: float


@dataclass
class SerializedSuspend:
    """Serializable form of a suspended task for persistence across restarts."""
    task_id: str
    suspended_at: float


# ---------------------------------------------------------------------------
# Internal State Types
# ---------------------------------------------------------------------------


@dataclass
class _DeadlineEntry:
    """Internal deadline tracking entry."""
    task_id: str
    deadline_ms: float
    created_at: float
    on_expired: Callable[[], None]


@dataclass
class _ScheduleEntry:
    """Internal schedule tracking entry."""
    schedule_id: str
    interval_ms: float
    next_run_ms: float
    last_run_ms: float
    callback: Callable[[], None]


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------


@dataclass
class TemporalPrimitivesConfig:
    """Configuration for the TemporalPrimitives polling loop."""
    poll_interval_ms: float = 50.0


# ---------------------------------------------------------------------------
# TemporalDeadline
# ---------------------------------------------------------------------------


class TemporalDeadline:
    """Bridge-authoritative deadline enforcement. Deadlines are expressed as
    absolute bridge-time timestamps. A polling loop checks all active
    deadlines against the current bridge time and fires the on_expired
    callback when a deadline is reached.

    Supports serialization/restoration for durable workflow persistence.
    """

    def __init__(self, get_now: Callable[[], float]) -> None:
        self._get_now = get_now
        self._deadlines: Dict[str, _DeadlineEntry] = {}

    def set_deadline(
        self,
        task_id: str,
        deadline_ms: float,
        on_expired: Callable[[], None],
    ) -> DeadlineHandle:
        """Register a deadline for a task. The deadline is an absolute bridge-time
        timestamp (ms). When bridge time reaches or exceeds deadline_ms, the
        on_expired callback is invoked and the deadline is removed.

        If a deadline already exists for this task_id, it is replaced.
        """
        created_at = self._get_now()
        entry = _DeadlineEntry(
            task_id=task_id,
            deadline_ms=deadline_ms,
            created_at=created_at,
            on_expired=on_expired,
        )
        self._deadlines[task_id] = entry
        return DeadlineHandle(
            task_id=task_id,
            deadline_ms=deadline_ms,
            created_at=created_at,
        )

    def cancel_deadline(self, handle: DeadlineHandle) -> None:
        """Cancel an active deadline. No-op if the deadline has already fired
        or does not exist.
        """
        self._deadlines.pop(handle.task_id, None)

    def tick(self) -> None:
        """Check all active deadlines against the current bridge time. Any
        deadline that has expired is fired and removed. This method is
        called by the TemporalPrimitives polling loop.
        """
        now = self._get_now()
        expired: List[str] = []

        for task_id, entry in self._deadlines.items():
            if now >= entry.deadline_ms:
                expired.append(task_id)

        for task_id in expired:
            entry = self._deadlines.pop(task_id, None)
            if entry is not None:
                try:
                    entry.on_expired()
                except Exception:
                    # Callback errors must not crash the polling loop
                    pass

    def active_count(self) -> int:
        """Return the number of active (non-expired) deadlines."""
        return len(self._deadlines)

    def serialize_deadlines(self) -> List[SerializedDeadline]:
        """Serialize all active deadlines for persistence. Callbacks are not
        serializable, so restore_deadlines requires re-supplying them.
        """
        result: List[SerializedDeadline] = []
        for entry in self._deadlines.values():
            result.append(SerializedDeadline(
                task_id=entry.task_id,
                deadline_ms=entry.deadline_ms,
                created_at=entry.created_at,
            ))
        return result

    def restore_deadlines(
        self,
        data: List[SerializedDeadline],
        default_on_expired: Optional[Callable[[], None]] = None,
    ) -> None:
        """Restore deadlines from serialized data. Because callbacks are not
        serializable, restored deadlines use a no-op callback. Callers
        should re-register deadlines with proper callbacks after restore,
        or supply a default on_expired via the optional second parameter.
        """
        noop: Callable[[], None] = lambda: None
        on_expired = default_on_expired if default_on_expired is not None else noop
        for item in data:
            entry = _DeadlineEntry(
                task_id=item.task_id,
                deadline_ms=item.deadline_ms,
                created_at=item.created_at,
                on_expired=on_expired,
            )
            self._deadlines[item.task_id] = entry


# ---------------------------------------------------------------------------
# TemporalSchedule
# ---------------------------------------------------------------------------


class TemporalSchedule:
    """Cron-like scheduling using bridge time. Schedules fire their callback
    at a fixed interval measured in bridge-time milliseconds. The polling
    loop advances each schedule when bridge time reaches its next_run_ms.

    Supports serialization/restoration for durable workflow persistence.
    """

    def __init__(self, get_now: Callable[[], float]) -> None:
        self._get_now = get_now
        self._schedules: Dict[str, _ScheduleEntry] = {}

    def schedule(
        self,
        schedule_id: str,
        interval_ms: float,
        callback: Callable[[], None],
    ) -> ScheduleHandle:
        """Register a recurring schedule. The callback fires every interval_ms
        bridge-time milliseconds, starting interval_ms from now.

        If a schedule already exists for this schedule_id, it is replaced.
        """
        now = self._get_now()
        next_run_ms = now + interval_ms
        entry = _ScheduleEntry(
            schedule_id=schedule_id,
            interval_ms=interval_ms,
            next_run_ms=next_run_ms,
            last_run_ms=0.0,
            callback=callback,
        )
        self._schedules[schedule_id] = entry
        return ScheduleHandle(
            schedule_id=schedule_id,
            interval_ms=interval_ms,
            next_run_ms=next_run_ms,
        )

    def cancel_schedule(self, handle: ScheduleHandle) -> None:
        """Cancel an active schedule. No-op if the schedule does not exist."""
        self._schedules.pop(handle.schedule_id, None)

    def tick(self) -> None:
        """Check all active schedules against the current bridge time. Any
        schedule whose next_run_ms has been reached fires its callback and
        advances next_run_ms by interval_ms. This method is called by the
        TemporalPrimitives polling loop.
        """
        now = self._get_now()

        for entry in self._schedules.values():
            if now >= entry.next_run_ms:
                entry.last_run_ms = now
                entry.next_run_ms = now + entry.interval_ms
                try:
                    entry.callback()
                except Exception:
                    # Callback errors must not crash the polling loop
                    pass

    def active_count(self) -> int:
        """Return the number of active schedules."""
        return len(self._schedules)

    def serialize_schedules(self) -> List[SerializedSchedule]:
        """Serialize all active schedules for persistence. Callbacks are not
        serializable, so restore_schedules requires re-supplying them.
        """
        result: List[SerializedSchedule] = []
        for entry in self._schedules.values():
            result.append(SerializedSchedule(
                schedule_id=entry.schedule_id,
                interval_ms=entry.interval_ms,
                next_run_ms=entry.next_run_ms,
                last_run_ms=entry.last_run_ms,
            ))
        return result

    def restore_schedules(
        self,
        data: List[SerializedSchedule],
        default_callback: Optional[Callable[[], None]] = None,
    ) -> None:
        """Restore schedules from serialized data. Because callbacks are not
        serializable, restored schedules use a no-op callback. Callers
        should re-register schedules with proper callbacks after restore,
        or supply a default callback via the optional second parameter.
        """
        noop: Callable[[], None] = lambda: None
        callback = default_callback if default_callback is not None else noop
        for item in data:
            entry = _ScheduleEntry(
                schedule_id=item.schedule_id,
                interval_ms=item.interval_ms,
                next_run_ms=item.next_run_ms,
                last_run_ms=item.last_run_ms,
                callback=callback,
            )
            self._schedules[item.schedule_id] = entry


# ---------------------------------------------------------------------------
# TemporalSleepResume
# ---------------------------------------------------------------------------


class TemporalSleepResume:
    """Suspend/resume primitives using bridge-time tracking.

    In the Python SDK, this class provides suspend/resume functionality
    without async sleep (which is JS-specific). Suspend records the current
    bridge time, and resume computes elapsed bridge time since suspension.

    Supports serialization/restoration for durable workflow persistence.
    """

    def __init__(self, get_now: Callable[[], float]) -> None:
        self._get_now = get_now
        self._suspended: Dict[str, SuspendedTask] = {}

    def suspend(self, task_id: str) -> SuspendedTask:
        """Suspend a task by recording the current bridge time. Returns a
        SuspendedTask snapshot that can be serialized for persistence.

        If the task is already suspended, the suspension time is updated.
        """
        suspended_at = self._get_now()
        task = SuspendedTask(task_id=task_id, suspended_at=suspended_at)
        self._suspended[task_id] = task
        return task

    def resume(self, task_id: str) -> Dict[str, float]:
        """Resume a previously suspended task. Computes the elapsed bridge time
        since suspension and removes the task from the suspended set.

        Raises ValueError if the task is not currently suspended.

        Returns a dict with key ``suspended_for_ms``.
        """
        task = self._suspended.get(task_id)
        if task is None:
            raise ValueError(f'Task "{task_id}" is not suspended')
        now = self._get_now()
        suspended_for_ms = now - task.suspended_at
        del self._suspended[task_id]
        return {"suspended_for_ms": suspended_for_ms}

    def suspended_count(self) -> int:
        """Return the number of currently suspended tasks."""
        return len(self._suspended)

    def serialize_suspended(self) -> List[SerializedSuspend]:
        """Serialize all suspended tasks for persistence."""
        result: List[SerializedSuspend] = []
        for task in self._suspended.values():
            result.append(SerializedSuspend(
                task_id=task.task_id,
                suspended_at=task.suspended_at,
            ))
        return result

    def restore_suspended(self, data: List[SerializedSuspend]) -> None:
        """Restore suspended tasks from serialized data."""
        for item in data:
            task = SuspendedTask(
                task_id=item.task_id,
                suspended_at=item.suspended_at,
            )
            self._suspended[item.task_id] = task


# ---------------------------------------------------------------------------
# TemporalTimeout
# ---------------------------------------------------------------------------


class TemporalTimeout:
    """Wrap any operation with a bridge-time timeout. If the operation
    does not complete before timeout_ms bridge-time elapses, a
    TemporalTimeoutError is raised.

    Unlike time.sleep-based timeouts, this measures elapsed time using the
    bridge clock, so it respects NTP corrections and clock slewing.
    """

    def __init__(self, get_now: Callable[[], float]) -> None:
        self._get_now = get_now

    def with_timeout(
        self,
        operation: Callable[[], T],
        timeout_ms: float,
        poll_interval_ms: float = 50.0,
    ) -> T:
        """Execute an operation with a bridge-time timeout. Runs the operation
        in a background thread and polls bridge time until either the
        operation completes or the timeout expires.

        Args:
            operation: The callable to wrap.
            timeout_ms: Maximum bridge-time milliseconds to wait.
            poll_interval_ms: Real-time polling interval for timeout checks.

        Returns:
            The result of the operation.

        Raises:
            TemporalTimeoutError: If the operation does not complete in time.
            Exception: Any exception raised by the operation.
        """
        start_time = self._get_now()
        result_holder: List[Any] = []
        error_holder: List[BaseException] = []
        done_event = threading.Event()

        def _run() -> None:
            try:
                result_holder.append(operation())
            except BaseException as exc:
                error_holder.append(exc)
            finally:
                done_event.set()

        thread = threading.Thread(target=_run, daemon=True)
        thread.start()

        poll_interval_s = poll_interval_ms / 1000.0
        while not done_event.is_set():
            elapsed = self._get_now() - start_time
            if elapsed >= timeout_ms:
                raise TemporalTimeoutError(elapsed)
            done_event.wait(timeout=poll_interval_s)

        if error_holder:
            raise error_holder[0]

        return result_holder[0]


# ---------------------------------------------------------------------------
# TemporalPrimitives (Unified Facade)
# ---------------------------------------------------------------------------


class TemporalPrimitives:
    """Unified facade for all workflow temporal primitives. Manages a single
    polling loop that drives deadline checking, schedule firing, and sleep
    wake-ups using the bridge clock.

    Usage::

        from dynaep.temporal import BridgeClock
        clock = BridgeClock(config)
        tp = TemporalPrimitives(lambda: clock.now())
        tp.start()

        # Deadline
        dh = tp.deadline.set_deadline("task-1", clock.now() + 5000, callback)

        # Schedule
        sh = tp.scheduler.schedule("heartbeat", 1000, callback)

        # Suspend/Resume
        tp.sleep_resume.suspend("task-2")
        result = tp.sleep_resume.resume("task-2")

        # Timeout
        result = tp.timeout.with_timeout(my_operation, 3000)

        tp.stop()
    """

    def __init__(
        self,
        get_now: Callable[[], float],
        config: Optional[TemporalPrimitivesConfig] = None,
    ) -> None:
        cfg = config if config is not None else TemporalPrimitivesConfig()
        self._poll_interval_ms = cfg.poll_interval_ms

        self.deadline = TemporalDeadline(get_now)
        self.scheduler = TemporalSchedule(get_now)
        self.sleep_resume = TemporalSleepResume(get_now)
        self.timeout = TemporalTimeout(get_now)

        self._timer: Optional[threading.Timer] = None
        self._running = False
        self._lock = threading.Lock()

    def start(self) -> None:
        """Start the polling loop. Ticks all sub-primitives (deadlines,
        schedules) at the configured interval.
        """
        with self._lock:
            if self._running:
                return
            self._running = True
        self._schedule_tick()

    def stop(self) -> None:
        """Stop the polling loop. Active deadlines, schedules, and suspended
        tasks remain registered but will not be checked until start() is
        called again.
        """
        with self._lock:
            self._running = False
            if self._timer is not None:
                self._timer.cancel()
                self._timer = None

    def tick(self) -> None:
        """Manually advance one tick. Useful in tests where the polling loop
        is not running and time is controlled externally.
        """
        self.deadline.tick()
        self.scheduler.tick()

    def is_running(self) -> bool:
        """Whether the polling loop is currently running."""
        return self._running

    # -----------------------------------------------------------------------
    # Private
    # -----------------------------------------------------------------------

    def _schedule_tick(self) -> None:
        """Schedule the next tick via threading.Timer."""
        with self._lock:
            if not self._running:
                return
            interval_s = self._poll_interval_ms / 1000.0
            self._timer = threading.Timer(interval_s, self._on_tick)
            self._timer.daemon = True
            self._timer.start()

    def _on_tick(self) -> None:
        """Timer callback: run one tick then schedule the next."""
        if not self._running:
            return
        try:
            self.tick()
        except Exception:
            # Tick errors must not crash the polling loop
            pass
        self._schedule_tick()
