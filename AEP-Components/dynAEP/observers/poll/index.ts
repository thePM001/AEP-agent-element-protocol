// @PAD: /root/dynAEP/observers/poll/index.ts
// =============================================================================
// observers/poll/index.ts
// Poll-based observer adapter.
//
// Periodically polls an HTTP endpoint, compares the response with the
// previous snapshot, and emits a LatticeEvent whenever a change is detected.
//
// This adapter is designed for REST APIs that lack native webhook or SSE
// support.  It uses a diff-based strategy (deep equality on the response),
// so only actual changes trigger events rather than firing on every poll
// cycle.
//
// Two triggering modes:
//   1. Full-diff mode  - the entire response is compared with the prior
//      snapshot.  Any structural change produces a single event containing
//      the old and new values.
//   2. Array-diff mode - if the response is an array, elements are tracked
//      by a configurable `idKey` (default: "id").  Additions, removals, and
//      modifications are emitted as individual events.
//
// Example usage:
// ```
// const adapter = new PollObserverAdapter({
//   url: "https://api.example.com/orders",
//   intervalMs: 30_000,
//   headers: { Authorization: "Bearer <token>" },
//   mode: "array",
//   idKey: "orderId",
// });
// adapter.onEvent((event) => console.log(event));
// await adapter.start();
// ```
// =============================================================================

import { LatticeEvent, ObserverAdapter } from "../interface";
import { observerLatticeFetch } from "../lib/outbound-fetch";

// ── Configuration ──────────────────────────────────────────────────────────

export type PollMode = "full" | "array";

export interface PollObserverConfig {
  /** The HTTP endpoint to poll. */
  url: string;

  /** Poll interval in milliseconds.  (default: 60_000 - i.e. 1 minute) */
  intervalMs?: number;

  /**
   * Optional HTTP headers to send with every request
   * (e.g. Authorization, Accept).
   */
  headers?: Record<string, string>;

  /**
   * Polling mode:
   *   "full"  - compares the entire JSON response for changes.
   *   "array" - treats the response as an array and diffs elements by id.
   * (default: "full")
   */
  mode?: PollMode;

  /**
   * Key used to identify elements in array-diff mode.  Ignored in full mode.
   * (default: "id")
   */
  idKey?: string;

  /**
   * Default action_path for produced events.  (default: "poll:change")
   */
  actionPath?: string;

  /** Source identifier.  (default: "poll:<url-host>") */
  source?: string;

  /** Adapter name for logging.  (default: "poll:<url-host>") */
  name?: string;

  /** AbortSignal for external cancellation. */
  signal?: AbortSignal;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  intervalMs: 60_000,
  mode: "full" as PollMode,
  idKey: "id",
  actionPath: "poll:change",
};

// ── Adapter ────────────────────────────────────────────────────────────────

export class PollObserverAdapter implements ObserverAdapter {
  readonly name: string;
  private config: Required<
    Omit<PollObserverConfig, "headers" | "signal">
  > & { headers?: Record<string, string>; signal?: AbortSignal };
  private eventCallback: ((event: LatticeEvent) => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private previousSnapshot: unknown = null;
  private started = false;

  constructor(config: PollObserverConfig) {
    const urlHost = (() => {
      try {
        return new URL(config.url).host;
      } catch {
        return "unknown";
      }
    })();

    this.config = {
      url: config.url,
      intervalMs: config.intervalMs ?? DEFAULTS.intervalMs,
      mode: config.mode ?? DEFAULTS.mode,
      idKey: config.idKey ?? DEFAULTS.idKey,
      actionPath: config.actionPath ?? DEFAULTS.actionPath,
      source: config.source ?? `poll:${urlHost}`,
      name: config.name ?? `poll:${urlHost}`,
      headers: config.headers,
      signal: config.signal,
    };
    this.name = this.config.name;
  }

  // ── ObserverAdapter ──────────────────────────────────────────────────────

  /** Start the polling loop.  Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Wire up external abort signal
    if (this.config.signal) {
      this.config.signal.addEventListener(
        "abort",
        () => this.stop(),
        { once: true }
      );
    }

    console.log(
      `[${this.name}] Starting poll every ${this.config.intervalMs}ms ` +
        `(mode: ${this.config.mode})`
    );

    // Fire immediately, then on interval
    await this.poll();
    this.timer = setInterval(() => this.poll(), this.config.intervalMs);
  }

  /** Stop the polling loop.  Idempotent. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    console.log(`[${this.name}] Polling stopped`);
  }

  /** Register the event callback.  Replaces any previous callback. */
  onEvent(callback: (event: LatticeEvent) => void): void {
    this.eventCallback = callback;
  }

  // ── Polling ──────────────────────────────────────────────────────────────

  /**
   * Execute a single poll cycle: fetch the endpoint, compare with the
   * previous snapshot, and emit events for any changes detected.
   */
  private async poll(): Promise<void> {
    try {
      const response = await observerLatticeFetch(
        this.config.url,
        {
          method: "GET",
          headers: {
            Accept: "application/json",
            ...this.config.headers,
          },
        },
        {
          adapter: "poll",
          observer: this.name,
          payloadExtra: { mode: this.config.mode ?? "full" },
        },
      );

      if (!response.ok) {
        console.error(
          `[${this.name}] Poll returned HTTP ${response.status} ${response.statusText}`
        );
        return;
      }

      const data: unknown = await response.json();

      if (this.previousSnapshot === null) {
        // First poll - capture the snapshot but don't emit events.
        this.previousSnapshot = data;
        console.log(
          `[${this.name}] Initial snapshot captured (${this.describeSize(data)})`
        );
        return;
      }

      // Detect and emit changes
      if (this.config.mode === "array" && Array.isArray(data)) {
        this.detectArrayChanges(
          this.previousSnapshot as unknown[],
          data as unknown[]
        );
      } else {
        this.detectFullChange(data);
      }

      this.previousSnapshot = data;
    } catch (err: unknown) {
      if (!this.started) return;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[${this.name}] Poll error: ${message}`);
    }
  }

  // ── Diff detection - full mode ───────────────────────────────────────────

  /**
   * Full-diff mode: emit a single event if the current response differs
   * from the previous snapshot.
   */
  private detectFullChange(current: unknown): void {
    if (this.deepEqual(this.previousSnapshot, current)) return;

    const event: LatticeEvent = {
      source: this.config.source,
      action_path: this.config.actionPath,
      payload: {
        previous: this.previousSnapshot,
        current,
        polled_at: Date.now(),
      },
      bridge_timestamp: Date.now(),
    };

    this.eventCallback?.(event);
  }

  // ── Diff detection - array mode ──────────────────────────────────────────

  /**
   * Array-diff mode: compare two arrays and emit individual events for
   * added, removed, and modified elements.
   */
  private detectArrayChanges(
    previous: unknown[],
    current: unknown[]
  ): void {
    const prevMap = this.indexById(previous);
    const currMap = this.indexById(current);
    const idKey = this.config.idKey;

    // Added elements
    for (const [id, element] of Object.entries(currMap)) {
      if (!(id in prevMap)) {
        this.eventCallback?.({
          source: this.config.source,
          action_path: `${this.config.actionPath}:added`,
          payload: {
            element,
            [idKey]: id,
            polled_at: Date.now(),
          },
          bridge_timestamp: Date.now(),
        });
      }
    }

    // Removed elements
    for (const [id, element] of Object.entries(prevMap)) {
      if (!(id in currMap)) {
        this.eventCallback?.({
          source: this.config.source,
          action_path: `${this.config.actionPath}:removed`,
          payload: {
            element,
            [idKey]: id,
            polled_at: Date.now(),
          },
          bridge_timestamp: Date.now(),
        });
      }
    }

    // Modified elements
    for (const [id, prevElement] of Object.entries(prevMap)) {
      const currElement = currMap[id];
      if (currElement && !this.deepEqual(prevElement, currElement)) {
        this.eventCallback?.({
          source: this.config.source,
          action_path: `${this.config.actionPath}:modified`,
          payload: {
            previous: prevElement,
            current: currElement,
            [idKey]: id,
            polled_at: Date.now(),
          },
          bridge_timestamp: Date.now(),
        });
      }
    }
  }

  /**
   * Build an id → element map from an array of objects.
   * Elements that are not objects, or lack the id key, are skipped.
   */
  private indexById(arr: unknown[]): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    for (const item of arr) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const id = (item as Record<string, unknown>)[this.config.idKey];
        if (id !== undefined && id !== null) {
          map[String(id)] = item;
        }
      }
    }
    return map;
  }

  // ── Utilities ────────────────────────────────────────────────────────────

  /**
   * Deep equality check for JSON-serialisable values.
   * Handles primitives, objects, and arrays recursively.
   */
  private deepEqual(a: unknown, b: unknown): boolean {
    if (a === b) return true;
    if (a === null || b === null) return a === b;
    if (typeof a !== typeof b) return false;

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) => this.deepEqual(val, b[i]));
    }

    if (typeof a === "object" && typeof b === "object") {
      const aKeys = Object.keys(a as Record<string, unknown>);
      const bKeys = Object.keys(b as Record<string, unknown>);
      if (aKeys.length !== bKeys.length) return false;
      return aKeys.every(
        (key) =>
          Object.prototype.hasOwnProperty.call(b, key) &&
          this.deepEqual(
            (a as Record<string, unknown>)[key],
            (b as Record<string, unknown>)[key]
          )
      );
    }

    return false;
  }

  /** Describe the size of a data structure for log messages. */
  private describeSize(data: unknown): string {
    if (Array.isArray(data)) return `array[${data.length}]`;
    if (data && typeof data === "object")
      return `object{${Object.keys(data as Record<string, unknown>).length}}`;
    return String(data);
  }
}
