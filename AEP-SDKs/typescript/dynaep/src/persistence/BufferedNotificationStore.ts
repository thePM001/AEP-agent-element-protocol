// @PAD: /root/dynAEP/sdk/typescript/src/persistence/BufferedNotificationStore.ts
// ===========================================================================
// @dynaep/core - Buffered Notification Store
// Buffers notification cadence state (delivery history, habituation
// counters) and flushes to disk in batches. Prevents per-notification
// disk I/O while preserving state across bridge restarts.
//
// OPT-006: Buffered Evidence Ledger and Persistence I/O
// ===========================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NotificationStoreConfig {
  /** Maximum dirty channels before auto-flush. */
  bufferSize: number;
  /** Auto-flush interval in milliseconds. 0 disables. */
  flushIntervalMs: number;
  /** Persistence path for notification state. */
  persistencePath: string | null;
}

export interface NotificationChannelState {
  /** Channel identifier (e.g., "email", "push", "sms"). */
  channelId: string;
  /** Timestamps of recent deliveries (ring buffer). */
  deliveryHistory: number[];
  /** Total deliveries since creation. */
  totalDelivered: number;
  /** Whether habituation has been reached. */
  habituated: boolean;
  /** Last delivery timestamp. */
  lastDeliveryMs: number;
}

// ---------------------------------------------------------------------------
// BufferedNotificationStore
// ---------------------------------------------------------------------------

export class BufferedNotificationStore {
  private readonly config: NotificationStoreConfig;
  private readonly channels: Map<string, NotificationChannelState>;
  private dirtyChannels: Set<string>;
  private flushTimer: ReturnType<typeof setInterval> | null;
  private onFlush: ((serialized: string) => void) | null;
  private totalFlushes: number;
  private maxHistoryLength: number;

  constructor(
    config?: Partial<NotificationStoreConfig>,
    onFlush?: (serialized: string) => void,
  ) {
    this.config = {
      bufferSize: config?.bufferSize ?? 32,
      flushIntervalMs: config?.flushIntervalMs ?? 10000,
      persistencePath: config?.persistencePath ?? null,
    };
    this.channels = new Map();
    this.dirtyChannels = new Set();
    this.flushTimer = null;
    this.onFlush = onFlush ?? null;
    this.totalFlushes = 0;
    this.maxHistoryLength = 100;
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /**
   * Record a notification delivery for the given channel. Appends the
   * timestamp to the delivery history ring buffer and marks the channel
   * as dirty for the next flush.
   *
   * @param channelId - The notification channel identifier.
   * @param deliveryMs - Bridge-authoritative delivery timestamp.
   */
  recordDelivery(channelId: string, deliveryMs: number): void {
    let state = this.channels.get(channelId);
    if (!state) {
      state = {
        channelId,
        deliveryHistory: [],
        totalDelivered: 0,
        habituated: false,
        lastDeliveryMs: 0,
      };
      this.channels.set(channelId, state);
    }

    state.deliveryHistory.push(deliveryMs);
    state.totalDelivered++;
    state.lastDeliveryMs = deliveryMs;

    // Ring buffer trim
    if (state.deliveryHistory.length > this.maxHistoryLength) {
      state.deliveryHistory.splice(0, state.deliveryHistory.length - this.maxHistoryLength);
    }

    this.dirtyChannels.add(channelId);

    if (this.dirtyChannels.size >= this.config.bufferSize) {
      this.flush();
    }
  }

  /**
   * Mark a channel as habituated.
   */
  markHabituated(channelId: string): void {
    const state = this.channels.get(channelId);
    if (state) {
      state.habituated = true;
      this.dirtyChannels.add(channelId);
    }
  }

  /**
   * Get channel state for gate evaluation.
   */
  getChannelState(channelId: string): NotificationChannelState | null {
    return this.channels.get(channelId) ?? null;
  }

  // -------------------------------------------------------------------------
  // Flushing
  // -------------------------------------------------------------------------

  /**
   * Flush all dirty channel states to persistence.
   *
   * @returns The number of dirty channels flushed.
   */
  flush(): number {
    if (this.dirtyChannels.size === 0) {
      return 0;
    }

    const count = this.dirtyChannels.size;
    this.dirtyChannels.clear();
    this.totalFlushes++;

    const serialized = this.serialize();
    if (this.onFlush) {
      this.onFlush(serialized);
    }

    return count;
  }

  /**
   * Start periodic auto-flush.
   */
  startAutoFlush(): void {
    if (this.flushTimer !== null || this.config.flushIntervalMs <= 0) {
      return;
    }
    this.flushTimer = setInterval(() => {
      this.flush();
    }, this.config.flushIntervalMs);
  }

  /**
   * Stop periodic auto-flush.
   */
  stopAutoFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Serialize all channel states for persistence.
   */
  serialize(): string {
    const data: Record<string, NotificationChannelState> = {};
    for (const [id, state] of this.channels) {
      data[id] = state;
    }
    return JSON.stringify(data);
  }

  /**
   * Restore channel states from persisted data.
   */
  deserialize(data: string): void {
    const parsed = JSON.parse(data) as Record<string, NotificationChannelState>;
    this.channels.clear();
    for (const [id, state] of Object.entries(parsed)) {
      this.channels.set(id, state);
    }
    this.dirtyChannels.clear();
  }

  /**
   * Return store statistics.
   */
  getStats(): {
    channelCount: number;
    dirtyCount: number;
    totalFlushes: number;
    totalDeliveries: number;
  } {
    let totalDeliveries = 0;
    for (const state of this.channels.values()) {
      totalDeliveries += state.totalDelivered;
    }
    return {
      channelCount: this.channels.size,
      dirtyCount: this.dirtyChannels.size,
      totalFlushes: this.totalFlushes,
      totalDeliveries,
    };
  }
}
