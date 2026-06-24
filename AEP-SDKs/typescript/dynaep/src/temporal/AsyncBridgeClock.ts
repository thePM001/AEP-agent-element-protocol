// @PAD: /root/dynAEP/sdk/typescript/src/temporal/AsyncBridgeClock.ts
// ===========================================================================
// @dynaep/core - Async Bridge Clock with Slewing
// OPT-008: NTP sync is fully asynchronous (never blocks event processing).
// Clock corrections are applied via slewing (gradual adjustment) instead
// of stepping (instant jump) for corrections between 1ms and 1000ms.
//
// The now() method is synchronous, non-blocking, and monotonically
// non-decreasing. It completes in < 0.01ms (pure arithmetic).
// ===========================================================================

import * as dgram from "dgram";
import * as fs from "fs";
import type { ClockConfig, BridgeTimestamp, ClockHealth, SyncResult } from "./clock";
import type { ClockSyncEvent } from "./events";
import { createClockSyncEvent } from "./events";
import { ClockQualityTracker, type TIMConfig, type TIMMetadata } from "./ClockQualityTracker";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const NTP_UNIX_EPOCH_DELTA_SECONDS = 2208988800;
const NTP_PACKET_SIZE = 48;
const NTP_REQUEST_HEADER = 0x1b;
const DEFAULT_NTP_SERVER = "pool.ntp.org";
const NTP_PORT = 123;
const PTP_OFFSET_PATH = "/sys/class/ptp/ptp0/offset";
const NTP_TIMEOUT_MS = 5000;

/** Corrections smaller than this are ignored (within noise). */
const SLEW_IGNORE_THRESHOLD_MS = 1.0;

/** Corrections larger than this are stepped immediately. */
const SLEW_STEP_THRESHOLD_MS = 1000.0;

// ---------------------------------------------------------------------------
// AsyncBridgeClock
// ---------------------------------------------------------------------------

export class AsyncBridgeClock {
  private readonly config: ClockConfig;
  private activeProtocol: "ntp" | "ptp" | "system";
  private syncIntervalHandle: ReturnType<typeof setInterval> | null;
  private syncInProgress: boolean;
  private syncCount: number;
  private lastSyncSuccess: boolean;
  private lastSyncAt: number;
  private startedAt: number;

  // Time offsets
  private epochOffset: number;
  private currentNtpOffset: number;

  // Slewing state
  private slewRemainingMs: number;
  private slewStartPerf: number;
  private slewDurationMs: number;
  private slewTotalMs: number;

  // Monotonicity enforcement
  private lastReturnedMs: number;

  // Event listeners
  private readonly eventListeners: ((event: ClockSyncEvent) => void)[];

  // TA-3.2: TIM-compatible clock quality tracking
  private readonly clockQualityTracker: ClockQualityTracker | null;

  constructor(config: ClockConfig, timConfig?: TIMConfig) {
    this.config = Object.freeze({ ...config });
    this.activeProtocol = config.protocol;
    this.syncIntervalHandle = null;
    this.syncInProgress = false;
    this.syncCount = 0;
    this.lastSyncSuccess = false;
    this.lastSyncAt = 0;
    this.startedAt = performance.now();

    // Compute epoch offset: difference between performance.now() origin and Unix epoch
    // This is computed once and remains stable
    this.epochOffset = Date.now() - performance.now();
    this.currentNtpOffset = 0;

    // Slewing: no active slew
    this.slewRemainingMs = 0;
    this.slewStartPerf = 0;
    this.slewDurationMs = 0;
    this.slewTotalMs = 0;

    this.lastReturnedMs = 0;
    this.eventListeners = [];

    // TA-3.2: Initialize clock quality tracker if TIM config provided
    this.clockQualityTracker = timConfig ? new ClockQualityTracker(timConfig) : null;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin periodic async synchronization. Performs initial sync immediately,
   * then schedules recurring syncs at the configured interval.
   * NTP sync never blocks the event loop.
   */
  async start(): Promise<void> {
    await this.performAsyncSync();

    if (this.config.syncIntervalMs > 0) {
      this.syncIntervalHandle = setInterval(() => {
        // Fire-and-forget: never blocks
        this.performAsyncSync().catch(() => {
          // Sync failure handled internally
        });
      }, this.config.syncIntervalMs);
    }
  }

  /**
   * Stop periodic synchronization.
   */
  stop(): void {
    if (this.syncIntervalHandle !== null) {
      clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = null;
    }
  }

  // -------------------------------------------------------------------------
  // Timestamp Production
  // -------------------------------------------------------------------------

  /**
   * Return bridge-authoritative time in milliseconds.
   *
   * GUARANTEES:
   * - Synchronous: no await, no Promise, no I/O
   * - Non-blocking: pure arithmetic only
   * - Monotonically non-decreasing: never returns a lower value
   * - Includes active slew adjustment
   * - Completes in < 0.01ms
   *
   * Formula: performance.now() + epochOffset + currentNtpOffset + activeSlewAdjustment
   */
  now(): number {
    const perfNow = performance.now();

    // Compute slew adjustment
    let slewAdjustment = 0;
    if (this.slewRemainingMs !== 0 && this.slewDurationMs > 0) {
      const elapsed = perfNow - this.slewStartPerf;
      if (elapsed >= this.slewDurationMs) {
        // Slew complete: apply full correction
        slewAdjustment = this.slewTotalMs;
        this.slewRemainingMs = 0;
      } else {
        // Proportional slew: apply fraction of total correction
        const fraction = elapsed / this.slewDurationMs;
        slewAdjustment = this.slewTotalMs * fraction;
      }
    }

    let bridgeTimeMs = perfNow + this.epochOffset + this.currentNtpOffset + slewAdjustment;

    // Enforce monotonicity: never return a value less than previous
    // If slewing would cause backward movement, hold at last value
    if (bridgeTimeMs < this.lastReturnedMs) {
      bridgeTimeMs = this.lastReturnedMs;
    } else {
      this.lastReturnedMs = bridgeTimeMs;
    }

    return bridgeTimeMs;
  }

  /**
   * Produce a BridgeTimestamp with drift calculation and monotonicity.
   */
  stamp(agentTimeMs?: number | null): BridgeTimestamp {
    const bridgeTimeMs = this.now();
    const resolvedAgentTime = agentTimeMs !== undefined ? agentTimeMs : null;
    const driftMs = resolvedAgentTime !== null ? bridgeTimeMs - resolvedAgentTime : 0;

    return {
      bridgeTimeMs,
      agentTimeMs: resolvedAgentTime,
      driftMs,
      source: this.activeProtocol,
      syncedAt: this.lastSyncAt,
    };
  }

  // -------------------------------------------------------------------------
  // Health and Status
  // -------------------------------------------------------------------------

  health(): ClockHealth {
    const perfNow = performance.now();
    const uptimeMs = perfNow - this.startedAt;

    return {
      synced: this.isSynced(),
      lastSyncAt: this.lastSyncAt,
      currentOffsetMs: this.currentNtpOffset,
      protocol: this.activeProtocol,
      source: this.config.source || DEFAULT_NTP_SERVER,
      uptimeMs,
    };
  }

  isSynced(): boolean {
    if (this.lastSyncAt === 0) return false;
    const elapsed = Date.now() - this.lastSyncAt;
    return elapsed < this.config.syncIntervalMs * 3;
  }

  getActiveProtocol(): "ntp" | "ptp" | "system" {
    return this.activeProtocol;
  }

  getOffsetMs(): number {
    return this.currentNtpOffset;
  }

  getSyncCount(): number {
    return this.syncCount;
  }

  isAuthority(): boolean {
    return this.config.bridgeIsAuthority === true;
  }

  measureDrift(agentTimeMs: number): number {
    return this.now() - agentTimeMs;
  }

  /**
   * TA-3.2: Return the current TIM metadata block from the clock quality
   * tracker. Returns null if TIM is not configured.
   */
  getClockQuality(): TIMMetadata | null {
    if (!this.clockQualityTracker) return null;
    return this.clockQualityTracker.getTIMBlock();
  }

  /**
   * TA-3.2: Return the underlying ClockQualityTracker instance for
   * direct access to sync state, confidence class, and diagnostics.
   * Returns null if TIM is not configured.
   */
  getClockQualityTracker(): ClockQualityTracker | null {
    return this.clockQualityTracker;
  }

  /**
   * Register a listener for AEP_CLOCK_SYNC events.
   */
  onSync(listener: (event: ClockSyncEvent) => void): void {
    this.eventListeners.push(listener);
  }

  // -------------------------------------------------------------------------
  // Async Synchronization
  // -------------------------------------------------------------------------

  /**
   * Perform a single async sync. Never blocks the event loop.
   * Uses syncInProgress flag to prevent overlapping syncs.
   */
  private async performAsyncSync(): Promise<void> {
    if (this.syncInProgress) {
      return;
    }

    this.syncInProgress = true;

    try {
      let result: SyncResult;

      if (this.activeProtocol === "ptp") {
        result = this.syncViaPTP();
        if (!result.success) {
          result = await this.asyncSyncViaNTP();
          if (result.success) {
            this.activeProtocol = "ntp";
          }
        }
      } else if (this.activeProtocol === "ntp") {
        result = await this.asyncSyncViaNTP();
      } else {
        result = this.syncViaSystem();
      }

      if (!result.success) {
        result = this.syncViaSystem();
        this.activeProtocol = "system";
      }

      if (result.success) {
        this.applyCorrection(result.offsetMs);
        this.lastSyncAt = Date.now();
        this.lastSyncSuccess = true;
        this.syncCount++;

        // TA-3.2: Record successful sync in quality tracker
        if (this.clockQualityTracker) {
          this.clockQualityTracker.recordSyncSuccess(result.offsetMs, this.activeProtocol);
        }

        // Emit AEP_CLOCK_SYNC event with optional TIM block
        const syncParams: Parameters<typeof createClockSyncEvent>[0] = {
          bridgeTimeMs: this.now(),
          source: this.activeProtocol,
          offsetMs: result.offsetMs,
          syncedAt: this.lastSyncAt,
        };

        if (this.clockQualityTracker) {
          syncParams.tim = this.clockQualityTracker.getTIMBlock();
          this.clockQualityTracker.clearTransientAnomalyFlags();
        }

        const event = createClockSyncEvent(syncParams);

        for (const listener of this.eventListeners) {
          try {
            listener(event);
          } catch {
            // Listener errors must not crash sync
          }
        }
      } else {
        this.lastSyncSuccess = false;

        // TA-3.2: Record failed sync in quality tracker
        if (this.clockQualityTracker) {
          this.clockQualityTracker.recordSyncFailure();
        }
        if (typeof console !== "undefined") {
          console.warn(
            "[AsyncBridgeClock] NTP sync failed, retrying on next interval. " +
            "Keeping previous offset:",
            this.currentNtpOffset,
          );
        }
      }
    } catch {
      this.lastSyncSuccess = false;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Apply a clock correction via slewing or stepping.
   *
   * - |correction| < 1ms: ignore (within noise)
   * - 1ms <= |correction| <= 1000ms: slew over the next sync interval
   * - |correction| > 1000ms: step immediately (log warning)
   *
   * Slewing ensures monotonicity: negative corrections slow the clock
   * rather than moving it backward.
   */
  private applyCorrection(newOffsetMs: number): void {
    const correctionMs = newOffsetMs - this.currentNtpOffset;
    const absCorrectionMs = Math.abs(correctionMs);

    if (absCorrectionMs < SLEW_IGNORE_THRESHOLD_MS) {
      // Within noise: ignore
      return;
    }

    if (absCorrectionMs > SLEW_STEP_THRESHOLD_MS) {
      // Large correction: step immediately
      this.currentNtpOffset = newOffsetMs;
      this.slewRemainingMs = 0;
      this.slewTotalMs = 0;
      if (typeof console !== "undefined") {
        console.warn(
          `[AsyncBridgeClock] Large clock correction applied (step): ${correctionMs.toFixed(1)}ms`,
        );
      }
      return;
    }

    // Slew: spread the correction over the next sync interval
    // Complete any previous slew first
    if (this.slewRemainingMs !== 0) {
      this.currentNtpOffset += this.slewTotalMs;
      this.slewRemainingMs = 0;
    }

    this.slewTotalMs = correctionMs;
    this.slewRemainingMs = correctionMs;
    this.slewStartPerf = performance.now();
    this.slewDurationMs = this.config.syncIntervalMs;
  }

  // -------------------------------------------------------------------------
  // NTP (async, non-blocking)
  // -------------------------------------------------------------------------

  /**
   * SNTP sync via async UDP. Wrapped in a Promise, never blocks event loop.
   */
  private asyncSyncViaNTP(): Promise<SyncResult> {
    const server = this.config.source || DEFAULT_NTP_SERVER;
    const t0 = Date.now();

    return new Promise<SyncResult>((resolve) => {
      let resolved = false;
      const socket = dgram.createSocket("udp4");

      const timeoutHandle = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socket.close();
          resolve({ success: false, offsetMs: 0, latencyMs: 0 });
        }
      }, NTP_TIMEOUT_MS);

      socket.on("error", () => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutHandle);
          socket.close();
          resolve({ success: false, offsetMs: 0, latencyMs: 0 });
        }
      });

      socket.on("message", (msg: Buffer) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeoutHandle);
        const t3 = Date.now();

        if (msg.length < NTP_PACKET_SIZE) {
          socket.close();
          resolve({ success: false, offsetMs: 0, latencyMs: 0 });
          return;
        }

        const t1 = this.extractNTPTimestamp(msg, 32);
        const t2 = this.extractNTPTimestamp(msg, 40);
        const offsetMs = ((t1 - t0) + (t2 - t3)) / 2;
        const latencyMs = t3 - t0;

        socket.close();
        resolve({ success: true, offsetMs, latencyMs });
      });

      const packet = Buffer.alloc(NTP_PACKET_SIZE);
      packet[0] = NTP_REQUEST_HEADER;

      socket.send(packet, 0, NTP_PACKET_SIZE, NTP_PORT, server, (err) => {
        if (err && !resolved) {
          resolved = true;
          clearTimeout(timeoutHandle);
          socket.close();
          resolve({ success: false, offsetMs: 0, latencyMs: 0 });
        }
      });
    });
  }

  private extractNTPTimestamp(buffer: Buffer, byteOffset: number): number {
    const seconds = buffer.readUInt32BE(byteOffset);
    const fraction = buffer.readUInt32BE(byteOffset + 4);
    const unixSeconds = seconds - NTP_UNIX_EPOCH_DELTA_SECONDS;
    const fractionalMs = (fraction / 0x100000000) * 1000;
    return (unixSeconds * 1000) + fractionalMs;
  }

  // -------------------------------------------------------------------------
  // PTP (synchronous, fast)
  // -------------------------------------------------------------------------

  private syncViaPTP(): SyncResult {
    try {
      const raw = fs.readFileSync(PTP_OFFSET_PATH, "utf-8").trim();
      const nanoseconds = parseInt(raw, 10);
      if (isNaN(nanoseconds)) {
        return { success: false, offsetMs: 0, latencyMs: 0 };
      }
      return { success: true, offsetMs: nanoseconds / 1_000_000, latencyMs: 0 };
    } catch {
      return { success: false, offsetMs: 0, latencyMs: 0 };
    }
  }

  // -------------------------------------------------------------------------
  // System fallback
  // -------------------------------------------------------------------------

  private syncViaSystem(): SyncResult {
    if (typeof console !== "undefined") {
      console.warn(
        "[AsyncBridgeClock] Using system clock fallback - no external time source available.",
      );
    }
    return { success: true, offsetMs: 0, latencyMs: 0 };
  }
}
