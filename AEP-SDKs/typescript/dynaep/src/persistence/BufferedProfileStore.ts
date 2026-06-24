// @PAD: /root/dynAEP/sdk/typescript/src/persistence/BufferedProfileStore.ts
// ===========================================================================
// @dynaep/core - Buffered Profile Store
// Wraps the AdaptiveProfileManager with buffered disk persistence.
// Profile changes are accumulated and flushed in batches rather than
// writing to disk on every update.
//
// OPT-006: Buffered Evidence Ledger and Persistence I/O
// ===========================================================================

import type { AdaptiveProfileManager } from "../temporal/perception-profile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProfileStoreConfig {
  /** Maximum dirty profiles before auto-flush. */
  bufferSize: number;
  /** Auto-flush interval in milliseconds. 0 disables. */
  flushIntervalMs: number;
  /** Persistence path for profile data. */
  persistencePath: string | null;
}

// ---------------------------------------------------------------------------
// BufferedProfileStore
// ---------------------------------------------------------------------------

export class BufferedProfileStore {
  private readonly profileManager: AdaptiveProfileManager;
  private readonly config: ProfileStoreConfig;
  private dirtyProfiles: Set<string>;
  private flushTimer: ReturnType<typeof setInterval> | null;
  private onFlush: ((serialized: string) => void) | null;
  private totalFlushes: number;

  constructor(
    profileManager: AdaptiveProfileManager,
    config?: Partial<ProfileStoreConfig>,
    onFlush?: (serialized: string) => void,
  ) {
    this.profileManager = profileManager;
    this.config = {
      bufferSize: config?.bufferSize ?? 64,
      flushIntervalMs: config?.flushIntervalMs ?? 10000,
      persistencePath: config?.persistencePath ?? null,
    };
    this.dirtyProfiles = new Set();
    this.flushTimer = null;
    this.onFlush = onFlush ?? null;
    this.totalFlushes = 0;
  }

  // -------------------------------------------------------------------------
  // Mark dirty
  // -------------------------------------------------------------------------

  /**
   * Mark a profile as dirty (modified since last flush). Called after
   * each profile update to track which profiles need persistence.
   *
   * @param userId - The user whose profile was modified.
   */
  markDirty(userId: string): void {
    this.dirtyProfiles.add(userId);

    if (this.dirtyProfiles.size >= this.config.bufferSize) {
      this.flush();
    }
  }

  // -------------------------------------------------------------------------
  // Flushing
  // -------------------------------------------------------------------------

  /**
   * Flush all dirty profiles to persistence. Serializes the entire
   * profile manager state and invokes the onFlush callback.
   *
   * @returns The number of dirty profiles flushed.
   */
  flush(): number {
    if (this.dirtyProfiles.size === 0) {
      return 0;
    }

    const count = this.dirtyProfiles.size;
    this.dirtyProfiles.clear();
    this.totalFlushes++;

    const serialized = this.profileManager.serialize();
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

  /**
   * Load persisted profile data.
   */
  load(data: string): void {
    this.profileManager.deserialize(data);
    this.dirtyProfiles.clear();
  }

  /**
   * Return store statistics.
   */
  getStats(): {
    dirtyCount: number;
    totalFlushes: number;
  } {
    return {
      dirtyCount: this.dirtyProfiles.size,
      totalFlushes: this.totalFlushes,
    };
  }
}
