// @PAD: /root/dynAEP/observers/sse/index.ts
// =============================================================================
// observers/sse/index.ts
// SSE (Server-Sent Events) consumer adapter.
//
// Connects to an external SSE endpoint, reads the event stream, and
// normalises each incoming event to a LatticeEvent.  If the connection
// drops, the adapter automatically reconnects with exponential backoff.
//
// SSE format consumed:
//   event: <type>
//   data: <JSON payload>
//   id: <optional event ID>
//
// Example usage:
// ```
// const adapter = new SSEConsumerAdapter({
//   url: "https://api.example.com/events",
//   reconnectBaseMs: 1000,
//   maxReconnectMs: 30000,
// });
// adapter.onEvent((event) => console.log(event));
// await adapter.start();
// ```
// =============================================================================

import { LatticeEvent, ObserverAdapter } from "../interface";
import { observerLatticeFetch } from "../lib/outbound-fetch";

// ── Configuration ──────────────────────────────────────────────────────────

export interface SSEConsumerConfig {
  /** The SSE endpoint URL to connect to. */
  url: string;

  /**
   * Base reconnection delay in milliseconds.  After each failed attempt
   * the delay doubles up to `maxReconnectMs`.  (default: 1000)
   */
  reconnectBaseMs?: number;

  /** Maximum reconnection delay in milliseconds.  (default: 30_000) */
  maxReconnectMs?: number;

  /**
   * Optional mapping from SSE event type to a LatticeEvent action_path.
   * Events whose type is not in this map will use the type as path directly.
   */
  typeToActionPath?: Record<string, string>;

  /** Default action_path when no mapping or event type is present. (default: "sse:event") */
  defaultActionPath?: string;

  /** Source identifier for produced events. (default: "sse:<hostname>") */
  source?: string;

  /** Adapter name for logging. (default: "sse:<url-host>") */
  name?: string;

  /** AbortSignal to allow external cancellation. */
  signal?: AbortSignal;
}

// ── Defaults ───────────────────────────────────────────────────────────────

const DEFAULTS = {
  reconnectBaseMs: 1_000,
  maxReconnectMs: 30_000,
  defaultActionPath: "sse:event",
};

// ── Adapter ────────────────────────────────────────────────────────────────

export class SSEConsumerAdapter implements ObserverAdapter {
  readonly name: string;
  private config: Required<
    Omit<
      SSEConsumerConfig,
      "typeToActionPath" | "signal"
    >
  > & { typeToActionPath?: Record<string, string>; signal?: AbortSignal };
  private eventCallback: ((event: LatticeEvent) => void) | null = null;
  private abortController: AbortController | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private started = false;

  constructor(config: SSEConsumerConfig) {
    const urlHost = (() => {
      try {
        return new URL(config.url).host;
      } catch {
        return "unknown";
      }
    })();

    this.config = {
      url: config.url,
      reconnectBaseMs: config.reconnectBaseMs ?? DEFAULTS.reconnectBaseMs,
      maxReconnectMs: config.maxReconnectMs ?? DEFAULTS.maxReconnectMs,
      defaultActionPath: config.defaultActionPath ?? DEFAULTS.defaultActionPath,
      source: config.source ?? `sse:${urlHost}`,
      name: config.name ?? `sse:${urlHost}`,
      typeToActionPath: config.typeToActionPath,
      signal: config.signal,
    };
    this.name = this.config.name;
  }

  // ── ObserverAdapter ──────────────────────────────────────────────────────

  /** Start the SSE consumer. Idempotent. */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    this.abortController = new AbortController();

    // If an external signal was provided, forward the abort.
    if (this.config.signal) {
      this.config.signal.addEventListener(
        "abort",
        () => this.abortController?.abort(),
        { once: true }
      );
    }

    this.connect();
  }

  /** Stop the SSE consumer. Idempotent. */
  async stop(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    // Clear any pending reconnect
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    // Abort the active connection
    this.abortController?.abort();
    this.abortController = null;

    console.log(`[${this.name}] Consumer stopped`);
  }

  /** Register the event callback. Replaces any previous callback. */
  onEvent(callback: (event: LatticeEvent) => void): void {
    this.eventCallback = callback;
  }

  // ── Connection management ────────────────────────────────────────────────

  private attemptCount = 0;

  /**
   * Initiate (or re-initiate) the SSE connection.
   * Uses the Fetch API with ReadableStream to consume the SSE text stream.
   */
  private async connect(): Promise<void> {
    if (!this.started) return;

    const attempt = ++this.attemptCount;
    console.log(
      `[${this.name}] Connecting (attempt ${attempt})...`
    );

    try {
      const response = await observerLatticeFetch(
        this.config.url,
        {
          method: "GET",
          headers: {
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
          signal: this.abortController?.signal,
        },
        {
          adapter: "sse",
          observer: this.name,
        },
      );

      if (!response.ok) {
        throw new Error(
          `HTTP ${response.status} ${response.statusText}`
        );
      }

      if (!response.body) {
        throw new Error("Response body is null (streaming not supported)");
      }

      console.log(`[${this.name}] Connected (HTTP ${response.status})`);
      this.attemptCount = 0; // reset counter on successful connection

      // Stream the response body as text
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (this.started) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE messages (delimited by double newline)
        const parts = buffer.split("\n\n");
        // The last element may be incomplete - keep it in the buffer.
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          this.processSSEMessage(part.trim());
        }
      }

      // If we exited the read loop but are still started, the stream ended.
      if (this.started) {
        console.log(`[${this.name}] Stream ended, reconnecting...`);
        this.scheduleReconnect();
      }
    } catch (err: unknown) {
      if (!this.started) return; // intentional stop

      const message =
        err instanceof Error ? err.message : String(err);
      console.error(`[${this.name}] Connection error: ${message}`);

      this.scheduleReconnect();
    }
  }

  /**
   * Schedule a reconnect with exponential backoff.
   * The delay doubles each attempt, capped at maxReconnectMs.
   */
  private scheduleReconnect(): void {
    if (!this.started) return;

    const delay = Math.min(
      this.config.reconnectBaseMs * Math.pow(2, this.attemptCount),
      this.config.maxReconnectMs
    );

    // Add jitter: ±20%
    const jitter = delay * (0.8 + Math.random() * 0.4);

    console.log(
      `[${this.name}] Reconnecting in ${Math.round(jitter)}ms ` +
        `(attempt ${this.attemptCount + 1})`
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, jitter);
  }

  // ── SSE parsing ──────────────────────────────────────────────────────────

  /**
   * Parse a single SSE message block and normalise it into a LatticeEvent.
   *
   * SSE message format:
   *   event: <type>
   *   data: <JSON or text>
   *   id: <event-id>
   */
  private processSSEMessage(block: string): void {
    if (!block) return;

    const lines = block.split("\n");
    let eventType = "";
    let data = "";
    let eventId = "";

    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventType = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        // SSE data lines may start with "data: " or "data:"
        data = line.slice(5).trim();
      } else if (line.startsWith("id:")) {
        eventId = line.slice(3).trim();
      }
      // Lines starting with ":" are comments; skip.
      // Lines starting with "retry:" could be handled but are omitted for brevity.
    }

    // SSE heartbeat (empty data) - skip
    if (!data && !eventType) return;

    // Determine action_path
    let actionPath: string;
    if (eventType && this.config.typeToActionPath?.[eventType]) {
      actionPath = this.config.typeToActionPath[eventType];
    } else if (eventType) {
      actionPath = eventType;
    } else {
      actionPath = this.config.defaultActionPath;
    }

    // Parse data as JSON if possible; otherwise wrap as text
    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(data) as Record<string, unknown>;
    } catch {
      payload = { text: data, event_id: eventId };
    }

    const event: LatticeEvent = {
      source: this.config.source,
      action_path: actionPath,
      payload,
      bridge_timestamp: Date.now(),
    };

    // Forward to callback
    this.eventCallback?.(event);
  }
}
