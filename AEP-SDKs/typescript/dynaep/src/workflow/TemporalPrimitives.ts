// @PAD: /root/dynAEP/sdk/typescript/src/workflow/TemporalPrimitives.ts
// ===========================================================================
// @dynaep/core - Workflow Temporal Primitives
// TA-3.3: Bridge-authoritative temporal primitives for workflow orchestration.
// All time measurements use the injected bridge clock (getNow) rather than
// Date.now(), ensuring that deadlines, schedules, sleep/resume, and timeouts
// are governed by the same monotonic, NTP-synchronized time source used by
// the rest of the dynAEP temporal layer.
//
// The module is fully testable: pass a mock getNow function to control time
// in unit tests without real clock dependencies.
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Handle returned by setDeadline. Identifies a registered deadline and
 * carries the bridge-time at which it was created plus the absolute
 * deadline timestamp.
 */
export interface DeadlineHandle {
  taskId: string;
  deadlineMs: number;
  createdAt: number;
}

/**
 * Handle returned by schedule. Identifies an active recurring schedule
 * and tracks when the next invocation is due.
 */
export interface ScheduleHandle {
  scheduleId: string;
  intervalMs: number;
  nextRunMs: number;
}

/**
 * Snapshot of a suspended task. Records the bridge-time at which
 * suspension occurred so that resume can compute elapsed bridge time.
 */
export interface SuspendedTask {
  taskId: string;
  suspendedAt: number;
}

/**
 * Serializable form of a deadline for persistence across restarts.
 */
export interface SerializedDeadline {
  taskId: string;
  deadlineMs: number;
  createdAt: number;
}

/**
 * Serializable form of a schedule for persistence across restarts.
 */
export interface SerializedSchedule {
  scheduleId: string;
  intervalMs: number;
  nextRunMs: number;
  lastRunMs: number;
}

/**
 * Serializable form of a suspended task for persistence across restarts.
 */
export interface SerializedSuspend {
  taskId: string;
  suspendedAt: number;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a bridge-time timeout expires before the wrapped operation
 * completes. Carries the elapsed bridge-time so callers can distinguish
 * timeout from other failure modes.
 */
export class TemporalTimeoutError extends Error {
  readonly elapsedMs: number;

  constructor(elapsedMs: number) {
    super(`Temporal timeout after ${elapsedMs}ms (bridge time)`);
    this.name = "TemporalTimeoutError";
    this.elapsedMs = elapsedMs;
  }
}

// ---------------------------------------------------------------------------
// Internal State Types
// ---------------------------------------------------------------------------

interface DeadlineEntry {
  taskId: string;
  deadlineMs: number;
  createdAt: number;
  onExpired: () => void;
}

interface ScheduleEntry {
  scheduleId: string;
  intervalMs: number;
  nextRunMs: number;
  lastRunMs: number;
  callback: () => void;
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Configuration for the TemporalPrimitives polling loop.
 */
export interface TemporalPrimitivesConfig {
  /** Interval in real milliseconds between polling ticks. Default: 50. */
  pollIntervalMs?: number;
}

/** Default configuration values, frozen for safety. */
const DEFAULT_CONFIG: Readonly<Required<TemporalPrimitivesConfig>> = Object.freeze({
  pollIntervalMs: 50,
});

// ---------------------------------------------------------------------------
// TemporalDeadline
// ---------------------------------------------------------------------------

/**
 * Bridge-authoritative deadline enforcement. Deadlines are expressed as
 * absolute bridge-time timestamps. A polling loop checks all active
 * deadlines against the current bridge time and fires the onExpired
 * callback when a deadline is reached.
 *
 * Supports serialization/restoration for durable workflow persistence.
 */
export class TemporalDeadline {
  private readonly getNow: () => number;
  private readonly deadlines: Map<string, DeadlineEntry>;

  constructor(getNow: () => number) {
    this.getNow = getNow;
    this.deadlines = new Map();
  }

  /**
   * Register a deadline for a task. The deadline is an absolute bridge-time
   * timestamp (ms). When bridge time reaches or exceeds deadlineMs, the
   * onExpired callback is invoked and the deadline is removed.
   *
   * If a deadline already exists for this taskId, it is replaced.
   */
  setDeadline(
    taskId: string,
    deadlineMs: number,
    onExpired: () => void,
  ): DeadlineHandle {
    const createdAt = this.getNow();
    const entry: DeadlineEntry = { taskId, deadlineMs, createdAt, onExpired };
    this.deadlines.set(taskId, entry);
    return { taskId, deadlineMs, createdAt };
  }

  /**
   * Cancel an active deadline. No-op if the deadline has already fired
   * or does not exist.
   */
  cancelDeadline(handle: DeadlineHandle): void {
    this.deadlines.delete(handle.taskId);
  }

  /**
   * Check all active deadlines against the current bridge time. Any
   * deadline that has expired is fired and removed. This method is
   * called by the TemporalPrimitives polling loop.
   */
  tick(): void {
    const now = this.getNow();
    const expired: string[] = [];

    for (const [taskId, entry] of this.deadlines) {
      if (now >= entry.deadlineMs) {
        expired.push(taskId);
      }
    }

    for (const taskId of expired) {
      const entry = this.deadlines.get(taskId);
      if (entry) {
        this.deadlines.delete(taskId);
        try {
          entry.onExpired();
        } catch {
          // Callback errors must not crash the polling loop
        }
      }
    }
  }

  /**
   * Return the number of active (non-expired) deadlines.
   */
  activeCount(): number {
    return this.deadlines.size;
  }

  /**
   * Serialize all active deadlines for persistence. Callbacks are not
   * serializable, so restoreDeadlines requires re-supplying them.
   */
  serializeDeadlines(): SerializedDeadline[] {
    const result: SerializedDeadline[] = [];
    for (const entry of this.deadlines.values()) {
      result.push({
        taskId: entry.taskId,
        deadlineMs: entry.deadlineMs,
        createdAt: entry.createdAt,
      });
    }
    return result;
  }

  /**
   * Restore deadlines from serialized data. Because callbacks are not
   * serializable, restored deadlines use a no-op callback. Callers
   * should re-register deadlines with proper callbacks after restore,
   * or supply a default onExpired via the optional second parameter.
   */
  restoreDeadlines(
    data: SerializedDeadline[],
    defaultOnExpired?: () => void,
  ): void {
    for (const item of data) {
      const entry: DeadlineEntry = {
        taskId: item.taskId,
        deadlineMs: item.deadlineMs,
        createdAt: item.createdAt,
        onExpired: defaultOnExpired ?? (() => {}),
      };
      this.deadlines.set(item.taskId, entry);
    }
  }
}

// ---------------------------------------------------------------------------
// TemporalSchedule
// ---------------------------------------------------------------------------

/**
 * Cron-like scheduling using bridge time. Schedules fire their callback
 * at a fixed interval measured in bridge-time milliseconds. The polling
 * loop advances each schedule when bridge time reaches its nextRunMs.
 *
 * Supports serialization/restoration for durable workflow persistence.
 */
export class TemporalSchedule {
  private readonly getNow: () => number;
  private readonly schedules: Map<string, ScheduleEntry>;

  constructor(getNow: () => number) {
    this.getNow = getNow;
    this.schedules = new Map();
  }

  /**
   * Register a recurring schedule. The callback fires every intervalMs
   * bridge-time milliseconds, starting intervalMs from now.
   *
   * If a schedule already exists for this scheduleId, it is replaced.
   */
  schedule(
    scheduleId: string,
    intervalMs: number,
    callback: () => void,
  ): ScheduleHandle {
    const now = this.getNow();
    const nextRunMs = now + intervalMs;
    const entry: ScheduleEntry = {
      scheduleId,
      intervalMs,
      nextRunMs,
      lastRunMs: 0,
      callback,
    };
    this.schedules.set(scheduleId, entry);
    return { scheduleId, intervalMs, nextRunMs };
  }

  /**
   * Cancel an active schedule. No-op if the schedule does not exist.
   */
  cancelSchedule(handle: ScheduleHandle): void {
    this.schedules.delete(handle.scheduleId);
  }

  /**
   * Check all active schedules against the current bridge time. Any
   * schedule whose nextRunMs has been reached fires its callback and
   * advances nextRunMs by intervalMs. This method is called by the
   * TemporalPrimitives polling loop.
   */
  tick(): void {
    const now = this.getNow();

    for (const entry of this.schedules.values()) {
      if (now >= entry.nextRunMs) {
        entry.lastRunMs = now;
        entry.nextRunMs = now + entry.intervalMs;
        try {
          entry.callback();
        } catch {
          // Callback errors must not crash the polling loop
        }
      }
    }
  }

  /**
   * Return the number of active schedules.
   */
  activeCount(): number {
    return this.schedules.size;
  }

  /**
   * Serialize all active schedules for persistence. Callbacks are not
   * serializable, so restoreSchedules requires re-supplying them.
   */
  serializeSchedules(): SerializedSchedule[] {
    const result: SerializedSchedule[] = [];
    for (const entry of this.schedules.values()) {
      result.push({
        scheduleId: entry.scheduleId,
        intervalMs: entry.intervalMs,
        nextRunMs: entry.nextRunMs,
        lastRunMs: entry.lastRunMs,
      });
    }
    return result;
  }

  /**
   * Restore schedules from serialized data. Because callbacks are not
   * serializable, restored schedules use a no-op callback. Callers
   * should re-register schedules with proper callbacks after restore,
   * or supply a default callback via the optional second parameter.
   */
  restoreSchedules(
    data: SerializedSchedule[],
    defaultCallback?: () => void,
  ): void {
    for (const item of data) {
      const entry: ScheduleEntry = {
        scheduleId: item.scheduleId,
        intervalMs: item.intervalMs,
        nextRunMs: item.nextRunMs,
        lastRunMs: item.lastRunMs,
        callback: defaultCallback ?? (() => {}),
      };
      this.schedules.set(item.scheduleId, entry);
    }
  }
}

// ---------------------------------------------------------------------------
// TemporalSleepResume
// ---------------------------------------------------------------------------

/**
 * Pause/resume primitives using bridge-time tracking. Sleep returns a
 * Promise that resolves after the specified bridge-time duration. Suspend
 * records the current bridge time, and resume computes elapsed bridge
 * time since suspension.
 *
 * Supports serialization/restoration for durable workflow persistence.
 */
export class TemporalSleepResume {
  private readonly getNow: () => number;
  private readonly suspended: Map<string, SuspendedTask>;
  private readonly sleepers: Map<string, { wakeAtMs: number; resolve: () => void }>;

  constructor(getNow: () => number) {
    this.getNow = getNow;
    this.suspended = new Map();
    this.sleepers = new Map();
  }

  /**
   * Sleep for the specified duration in bridge-time milliseconds.
   * The returned Promise resolves when bridge time advances past the
   * wake-up point. Resolution is driven by the polling loop's tick().
   *
   * If a sleep already exists for this taskId, the previous sleep is
   * replaced (its Promise will never resolve).
   */
  sleep(taskId: string, durationMs: number): Promise<void> {
    const now = this.getNow();
    const wakeAtMs = now + durationMs;

    return new Promise<void>((resolve) => {
      this.sleepers.set(taskId, { wakeAtMs, resolve });
    });
  }

  /**
   * Suspend a task by recording the current bridge time. Returns a
   * SuspendedTask snapshot that can be serialized for persistence.
   *
   * If the task is already suspended, the suspension time is updated.
   */
  suspend(taskId: string): SuspendedTask {
    const suspendedAt = this.getNow();
    const task: SuspendedTask = { taskId, suspendedAt };
    this.suspended.set(taskId, task);
    return task;
  }

  /**
   * Resume a previously suspended task. Computes the elapsed bridge time
   * since suspension and removes the task from the suspended set.
   *
   * Throws if the task is not currently suspended.
   */
  resume(taskId: string): { suspendedForMs: number } {
    const task = this.suspended.get(taskId);
    if (!task) {
      throw new Error(`Task "${taskId}" is not suspended`);
    }
    const now = this.getNow();
    const suspendedForMs = now - task.suspendedAt;
    this.suspended.delete(taskId);
    return { suspendedForMs };
  }

  /**
   * Check all active sleepers against the current bridge time. Any
   * sleeper whose wake-up time has been reached is resolved and removed.
   * This method is called by the TemporalPrimitives polling loop.
   */
  tick(): void {
    const now = this.getNow();
    const woken: string[] = [];

    for (const [taskId, sleeper] of this.sleepers) {
      if (now >= sleeper.wakeAtMs) {
        woken.push(taskId);
      }
    }

    for (const taskId of woken) {
      const sleeper = this.sleepers.get(taskId);
      if (sleeper) {
        this.sleepers.delete(taskId);
        sleeper.resolve();
      }
    }
  }

  /**
   * Return the number of currently suspended tasks.
   */
  suspendedCount(): number {
    return this.suspended.size;
  }

  /**
   * Return the number of active sleepers.
   */
  sleeperCount(): number {
    return this.sleepers.size;
  }

  /**
   * Serialize all suspended tasks for persistence.
   */
  serializeSuspended(): SerializedSuspend[] {
    const result: SerializedSuspend[] = [];
    for (const task of this.suspended.values()) {
      result.push({
        taskId: task.taskId,
        suspendedAt: task.suspendedAt,
      });
    }
    return result;
  }

  /**
   * Restore suspended tasks from serialized data.
   */
  restoreSuspended(data: SerializedSuspend[]): void {
    for (const item of data) {
      const task: SuspendedTask = {
        taskId: item.taskId,
        suspendedAt: item.suspendedAt,
      };
      this.suspended.set(item.taskId, task);
    }
  }
}

// ---------------------------------------------------------------------------
// TemporalTimeout
// ---------------------------------------------------------------------------

/**
 * Wrap any async operation with a bridge-time timeout. If the operation
 * does not complete before timeoutMs bridge-time elapses, the returned
 * Promise rejects with a TemporalTimeoutError.
 *
 * Unlike setTimeout-based timeouts, this measures elapsed time using the
 * bridge clock, so it respects NTP corrections and clock slewing.
 */
export class TemporalTimeout {
  private readonly getNow: () => number;

  constructor(getNow: () => number) {
    this.getNow = getNow;
  }

  /**
   * Execute an async operation with a bridge-time timeout. If the
   * operation resolves before timeoutMs bridge-time elapses, its result
   * is returned. Otherwise, the Promise rejects with a TemporalTimeoutError.
   *
   * The timeout check uses a polling interval (default 50ms real time)
   * to compare bridge-time elapsed against the timeout threshold.
   *
   * @param operation - The async operation to wrap.
   * @param timeoutMs - Maximum bridge-time milliseconds to wait.
   * @param pollIntervalMs - Real-time polling interval for timeout checks. Default: 50.
   * @returns The result of the operation.
   * @throws TemporalTimeoutError if the operation does not complete in time.
   */
  withTimeout<T>(
    operation: () => Promise<T>,
    timeoutMs: number,
    pollIntervalMs: number = 50,
  ): Promise<T> {
    const startTime = this.getNow();

    return new Promise<T>((resolve, reject) => {
      let settled = false;
      let pollHandle: ReturnType<typeof setInterval> | null = null;

      const cleanup = (): void => {
        if (pollHandle !== null) {
          clearInterval(pollHandle);
          pollHandle = null;
        }
      };

      // Start the polling loop that checks bridge-time elapsed
      pollHandle = setInterval(() => {
        if (settled) {
          cleanup();
          return;
        }
        const elapsed = this.getNow() - startTime;
        if (elapsed >= timeoutMs) {
          settled = true;
          cleanup();
          reject(new TemporalTimeoutError(elapsed));
        }
      }, pollIntervalMs);

      // Run the operation
      operation().then(
        (result) => {
          if (!settled) {
            settled = true;
            cleanup();
            resolve(result);
          }
        },
        (error) => {
          if (!settled) {
            settled = true;
            cleanup();
            reject(error);
          }
        },
      );
    });
  }
}

// ---------------------------------------------------------------------------
// TemporalPrimitives (Unified Facade)
// ---------------------------------------------------------------------------

/**
 * Unified facade for all workflow temporal primitives. Manages a single
 * polling loop that drives deadline checking, schedule firing, and sleep
 * wake-ups using the bridge clock.
 *
 * Usage:
 * ```typescript
 * const clock = new AsyncBridgeClock(config);
 * const tp = new TemporalPrimitives(() => clock.now());
 * tp.start();
 *
 * // Deadline
 * const dh = tp.deadline.setDeadline("task-1", clock.now() + 5000, () => { ... });
 *
 * // Schedule
 * const sh = tp.scheduler.schedule("heartbeat", 1000, () => { ... });
 *
 * // Sleep
 * await tp.sleepResume.sleep("task-2", 2000);
 *
 * // Timeout
 * const result = await tp.timeout.withTimeout(() => fetchData(), 3000);
 *
 * tp.stop();
 * ```
 */
export class TemporalPrimitives {
  /** Bridge-authoritative deadline enforcement. */
  readonly deadline: TemporalDeadline;

  /** Cron-like scheduling using bridge time. */
  readonly scheduler: TemporalSchedule;

  /** Pause/resume with bridge-time tracking. */
  readonly sleepResume: TemporalSleepResume;

  /** Bridge-time timeout wrapper. */
  readonly timeout: TemporalTimeout;

  private readonly config: Readonly<Required<TemporalPrimitivesConfig>>;
  private pollHandle: ReturnType<typeof setInterval> | null;
  private running: boolean;

  /**
   * Create a new TemporalPrimitives instance.
   *
   * @param getNow - Bridge clock time source. Typically () => clock.now().
   * @param config - Optional polling configuration.
   */
  constructor(getNow: () => number, config?: TemporalPrimitivesConfig) {
    this.config = Object.freeze({
      pollIntervalMs: config?.pollIntervalMs ?? DEFAULT_CONFIG.pollIntervalMs,
    });
    this.deadline = new TemporalDeadline(getNow);
    this.scheduler = new TemporalSchedule(getNow);
    this.sleepResume = new TemporalSleepResume(getNow);
    this.timeout = new TemporalTimeout(getNow);
    this.pollHandle = null;
    this.running = false;
  }

  /**
   * Start the polling loop. Ticks all sub-primitives (deadlines,
   * schedules, sleepers) at the configured interval.
   */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.pollHandle = setInterval(() => {
      this.tick();
    }, this.config.pollIntervalMs);
  }

  /**
   * Stop the polling loop. Active deadlines, schedules, and sleepers
   * remain registered but will not be checked until start() is called
   * again.
   */
  stop(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.running = false;
  }

  /**
   * Manually advance one tick. Useful in tests where the polling loop
   * is not running and time is controlled externally.
   */
  tick(): void {
    this.deadline.tick();
    this.scheduler.tick();
    this.sleepResume.tick();
  }

  /**
   * Whether the polling loop is currently running.
   */
  isRunning(): boolean {
    return this.running;
  }
}
