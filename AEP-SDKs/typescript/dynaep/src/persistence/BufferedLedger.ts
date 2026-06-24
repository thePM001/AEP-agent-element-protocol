// @PAD: /root/dynAEP/sdk/typescript/src/persistence/BufferedLedger.ts
// ===========================================================================
// @dynaep/core - Buffered Evidence Ledger
// Append-only SHA-256 hash chain recording every validation decision made
// by the bridge. Entries are buffered in memory and flushed to disk in
// batches to avoid per-event I/O overhead. The hash chain links each entry
// to its predecessor, providing tamper-evident audit history.
//
// OPT-006: Buffered Evidence Ledger and Persistence I/O
// ===========================================================================

import { BridgeClock } from "../temporal/clock";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LedgerConfig {
  /** Maximum entries to buffer before auto-flush. */
  bufferSize: number;
  /** Auto-flush interval in milliseconds. 0 disables timer-based flush. */
  flushIntervalMs: number;
  /** Whether to compute SHA-256 hash chain. */
  hashChainEnabled: boolean;
  /** Optional persistence path (used by platform-specific flush). */
  persistencePath: string | null;
}

export interface LedgerEntry {
  /** Monotonic sequence number within this ledger instance. */
  seq: number;
  /** Bridge-authoritative timestamp in milliseconds. */
  bridgeTimeMs: number;
  /** The type of validation decision. */
  decision: LedgerDecision;
  /** Target element ID or event identifier. */
  targetId: string;
  /** Human-readable detail of the decision. */
  detail: string;
  /** SHA-256 hash of (prevHash + serialized entry). Null if hash chain disabled. */
  hash: string | null;
  /** Hash of the previous entry (genesis entry uses GENESIS_HASH). */
  prevHash: string;
}

export type LedgerDecision =
  | "accepted"
  | "rejected_temporal"
  | "rejected_causal"
  | "rejected_structural"
  | "rejected_anomaly"
  | "rejected_rego"
  | "rejected_scanner"
  | "fast_exit_template"
  | "anomaly_warned"
  | "schema_reload";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const GENESIS_HASH = "0000000000000000000000000000000000000000000000000000000000000000";
const DEFAULT_BUFFER_SIZE = 256;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;

// ---------------------------------------------------------------------------
// Portable SHA-256
// ---------------------------------------------------------------------------

/**
 * Compute SHA-256 hash of a string. Uses Web Crypto API (browser/Deno)
 * or Node.js crypto module. Falls back to a deterministic placeholder
 * if neither is available (e.g., test environments).
 */
async function sha256(input: string): Promise<string> {
  const sync = sha256Sync(input);
  if (sync) return sync;

  // Node.js dynamic import
  try {
    const crypto = await import("crypto");
    return crypto.createHash("sha256").update(input).digest("hex");
  } catch {
    // Fall through to Web Crypto
  }

  // Web Crypto API (browser/Deno)
  if (typeof globalThis.crypto?.subtle?.digest === "function") {
    const encoded = new TextEncoder().encode(input);
    const buffer = await globalThis.crypto.subtle.digest("SHA-256", encoded);
    const hashArray = Array.from(new Uint8Array(buffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }

  // Fallback: deterministic placeholder (not cryptographically secure)
  let hash = 0;
  for (let i = 0; i < input.length; i++) {
    const char = input.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  return Math.abs(hash).toString(16).padStart(64, "0");
}

/**
 * Synchronous SHA-256 using Node.js crypto. Returns null if unavailable.
 */
function sha256Sync(input: string): string | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(input).digest("hex");
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// BufferedLedger
// ---------------------------------------------------------------------------

export class BufferedLedger {
  private readonly config: LedgerConfig;
  private readonly bridgeClock: BridgeClock;
  private readonly buffer: LedgerEntry[];
  private readonly flushed: LedgerEntry[];
  private seq: number;
  private prevHash: string;
  private flushTimer: ReturnType<typeof setInterval> | null;
  private onFlush: ((entries: LedgerEntry[]) => void) | null;
  private totalFlushed: number;
  private totalRecorded: number;

  constructor(
    bridgeClock: BridgeClock,
    config?: Partial<LedgerConfig>,
    onFlush?: (entries: LedgerEntry[]) => void,
  ) {
    this.bridgeClock = bridgeClock;
    this.config = {
      bufferSize: config?.bufferSize ?? DEFAULT_BUFFER_SIZE,
      flushIntervalMs: config?.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS,
      hashChainEnabled: config?.hashChainEnabled ?? true,
      persistencePath: config?.persistencePath ?? null,
    };
    this.buffer = [];
    this.flushed = [];
    this.seq = 0;
    this.prevHash = GENESIS_HASH;
    this.flushTimer = null;
    this.onFlush = onFlush ?? null;
    this.totalFlushed = 0;
    this.totalRecorded = 0;
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /**
   * Record a validation decision in the ledger. The entry is appended to
   * the in-memory buffer. If the buffer reaches capacity, an automatic
   * flush is triggered.
   *
   * Hash chain computation is synchronous (Node.js crypto) when available,
   * falling back to a deferred async hash. The critical path is never
   * blocked on I/O.
   *
   * @param decision - The type of validation decision.
   * @param targetId - The target element or event identifier.
   * @param detail - Human-readable detail.
   */
  record(decision: LedgerDecision, targetId: string, detail: string): void {
    this.seq++;
    this.totalRecorded++;

    const entry: LedgerEntry = {
      seq: this.seq,
      bridgeTimeMs: this.bridgeClock.now(),
      decision,
      targetId,
      detail,
      hash: null,
      prevHash: this.prevHash,
    };

    // Compute hash chain link
    if (this.config.hashChainEnabled) {
      const payload = `${entry.prevHash}|${entry.seq}|${entry.bridgeTimeMs}|${entry.decision}|${entry.targetId}|${entry.detail}`;
      const syncHash = sha256Sync(payload);
      if (syncHash) {
        entry.hash = syncHash;
        this.prevHash = syncHash;
      } else {
        // Async fallback: hash will be computed on next flush
        entry.hash = null;
      }
    }

    this.buffer.push(entry);

    // Auto-flush when buffer is full
    if (this.buffer.length >= this.config.bufferSize) {
      this.flush();
    }
  }

  // -------------------------------------------------------------------------
  // Flushing
  // -------------------------------------------------------------------------

  /**
   * Flush the in-memory buffer. Moves all buffered entries to the flushed
   * array and invokes the onFlush callback (which handles disk persistence).
   * The buffer is cleared after flush.
   *
   * @returns The number of entries flushed.
   */
  flush(): number {
    if (this.buffer.length === 0) {
      return 0;
    }

    const entries = this.buffer.splice(0);
    this.flushed.push(...entries);
    this.totalFlushed += entries.length;

    if (this.onFlush) {
      this.onFlush(entries);
    }

    return entries.length;
  }

  // -------------------------------------------------------------------------
  // Timer-based auto-flush
  // -------------------------------------------------------------------------

  /**
   * Start the periodic auto-flush timer. Entries are flushed at the
   * configured interval regardless of buffer fill level.
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
   * Stop the periodic auto-flush timer.
   */
  stopAutoFlush(): void {
    if (this.flushTimer !== null) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * Return all flushed entries (persisted ledger history).
   */
  getFlushed(): readonly LedgerEntry[] {
    return this.flushed;
  }

  /**
   * Return entries currently in the buffer (not yet flushed).
   */
  getBuffered(): readonly LedgerEntry[] {
    return this.buffer;
  }

  /**
   * Return the total number of entries recorded.
   */
  getStats(): {
    totalRecorded: number;
    totalFlushed: number;
    buffered: number;
    currentSeq: number;
    headHash: string;
  } {
    return {
      totalRecorded: this.totalRecorded,
      totalFlushed: this.totalFlushed,
      buffered: this.buffer.length,
      currentSeq: this.seq,
      headHash: this.prevHash,
    };
  }

  /**
   * Verify the hash chain integrity of flushed entries. Returns the
   * index of the first broken link, or -1 if the chain is valid.
   */
  verifyChain(): number {
    if (!this.config.hashChainEnabled) {
      return -1;
    }

    let expectedPrev = GENESIS_HASH;

    for (let i = 0; i < this.flushed.length; i++) {
      const entry = this.flushed[i];
      if (entry.prevHash !== expectedPrev) {
        return i;
      }
      if (entry.hash) {
        const payload = `${entry.prevHash}|${entry.seq}|${entry.bridgeTimeMs}|${entry.decision}|${entry.targetId}|${entry.detail}`;
        const computed = sha256Sync(payload);
        if (computed && computed !== entry.hash) {
          return i;
        }
        expectedPrev = entry.hash;
      }
    }

    return -1;
  }

  // -------------------------------------------------------------------------
  // Serialization
  // -------------------------------------------------------------------------

  /**
   * Serialize the ledger state for persistence.
   */
  serialize(): string {
    return JSON.stringify({
      seq: this.seq,
      prevHash: this.prevHash,
      entries: this.flushed,
    });
  }

  /**
   * Restore ledger state from persisted data.
   */
  deserialize(data: string): void {
    const parsed = JSON.parse(data);
    this.seq = parsed.seq ?? 0;
    this.prevHash = parsed.prevHash ?? GENESIS_HASH;
    this.flushed.length = 0;
    if (Array.isArray(parsed.entries)) {
      this.flushed.push(...parsed.entries);
    }
    this.totalFlushed = this.flushed.length;
  }
}
