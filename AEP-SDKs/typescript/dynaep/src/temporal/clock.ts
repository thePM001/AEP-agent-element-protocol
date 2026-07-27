// @PAD: /root/dynAEP/sdk/typescript/src/temporal/clock.ts
// ===========================================================================
// @dynaep/core - Bridge Clock Authority
// Provides synchronized time across the dynAEP temporal layer.
// The bridge clock is authoritative - agents derive their time from it.
// Supports NTP (SNTP over UDP), PTP (Linux hardware clock), and system
// fallback with monotonic enforcement on all produced timestamps.
// ===========================================================================

import * as dgram from "dgram";
import * as fs from "fs";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ClockConfig {
  protocol: "ntp" | "ptp" | "system";
  source: string;
  syncIntervalMs: number;
  maxDriftMs: number;
  bridgeIsAuthority: boolean;
}

export interface BridgeTimestamp {
  bridgeTimeMs: number;
  agentTimeMs: number | null;
  driftMs: number;
  source: "ntp" | "ptp" | "system";
  syncedAt: number;
}

export interface ClockHealth {
  synced: boolean;
  lastSyncAt: number;
  currentOffsetMs: number;
  protocol: "ntp" | "ptp" | "system";
  source: string;
  uptimeMs: number;
}

export interface SyncResult {
  success: boolean;
  offsetMs: number;
  latencyMs: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// NTP epoch starts Jan 1, 1900. Unix epoch starts Jan 1, 1970.
// The difference is 70 years worth of seconds (including 17 leap years).
const NTP_UNIX_EPOCH_DELTA_SECONDS = 2208988800;

// Standard NTP packet size in bytes
const NTP_PACKET_SIZE = 48;

// First byte of NTP request: LI=0, Version=3, Mode=3 (client)
const NTP_REQUEST_HEADER = 0x1b;

// Default NTP server when none specified
const DEFAULT_NTP_SERVER = "pool.ntp.org";

// Default NTP port
const NTP_PORT = 123;

// PTP offset file on Linux systems
const PTP_OFFSET_PATH = "/sys/class/ptp/ptp0/offset";

// Timeout for NTP requests in milliseconds
const NTP_TIMEOUT_MS = 5000;

// ---------------------------------------------------------------------------
// Bridge Clock Authority
// ---------------------------------------------------------------------------

export class BridgeClock {
  private config: ClockConfig;
  private currentOffsetMs: number;
  private lastSyncAt: number;
  private lastBridgeTimeMs: number;
  private startedAt: number;
  private syncIntervalHandle: ReturnType<typeof setInterval> | null;
  private activeProtocol: "ntp" | "ptp" | "system";
  private syncCount: number;
  private lastSyncSuccess: boolean;

  constructor(config: ClockConfig) {
    this.config = Object.freeze({ ...config });
    this.currentOffsetMs = 0;
    this.lastSyncAt = 0;
    this.lastBridgeTimeMs = 0;
    this.startedAt = Date.now();
    this.syncIntervalHandle = null;
    this.activeProtocol = config.protocol;
    this.syncCount = 0;
    this.lastSyncSuccess = false;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Begin periodic synchronization. Performs an initial sync immediately,
   * then schedules recurring syncs at the configured interval.
   */
  async start(): Promise<void> {
    const initialResult = await this.sync();
    this.lastSyncSuccess = initialResult.success;

    if (this.config.syncIntervalMs > 0) {
      this.syncIntervalHandle = setInterval(async () => {
        const result = await this.sync();
        this.lastSyncSuccess = result.success;
        this.syncCount += 1;
      }, this.config.syncIntervalMs);
    }

    this.syncCount += 1;
  }

  /**
   * Stop periodic synchronization and release resources.
   * The clock can still be used for stamping after stopping,
   * but it will no longer re-sync automatically.
   */
  stop(): void {
    if (this.syncIntervalHandle !== null) {
      clearInterval(this.syncIntervalHandle);
      this.syncIntervalHandle = null;
    }

    this.lastSyncSuccess = false;
    this.syncCount = 0;
  }

  // -------------------------------------------------------------------------
  // Synchronization
  // -------------------------------------------------------------------------

  /**
   * Execute a single synchronization cycle. Tries the configured protocol
   * first, then falls back through PTP -> NTP -> system if needed.
   */
  async sync(): Promise<SyncResult> {
    const beforeMs = Date.now();
    let result: SyncResult;

    if (this.activeProtocol === "ptp") {
      result = this.syncViaPTP();
      if (!result.success) {
        result = await this.syncViaNTP();
        if (result.success) {
          this.activeProtocol = "ntp";
        }
      }
    } else if (this.activeProtocol === "ntp") {
      result = await this.syncViaNTP();
    } else {
      result = this.syncViaSystem();
    }

    if (!result.success) {
      result = this.syncViaSystem();
      this.activeProtocol = "system";
    }

    if (result.success) {
      this.currentOffsetMs = result.offsetMs;
      this.lastSyncAt = Date.now();
      const afterMs = Date.now();
      result.latencyMs = afterMs - beforeMs;
    }

    return result;
  }

  /**
   * Synchronize via SNTP over UDP. Sends a 48-byte NTP request to the
   * configured server and parses the response to compute the clock offset.
   * Offset formula: ((t1 - t0) + (t2 - t3)) / 2
   * where t0=client send, t1=server receive, t2=server transmit, t3=client receive.
   */
  private syncViaNTP(): Promise<SyncResult> {
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
        if (resolved) {
          return;
        }

        resolved = true;
        clearTimeout(timeoutHandle);
        const t3 = Date.now();

        if (msg.length < NTP_PACKET_SIZE) {
          socket.close();
          resolve({ success: false, offsetMs: 0, latencyMs: 0 });
          return;
        }

        // Parse server receive timestamp (bytes 32-39)
        const t1 = this.extractNTPTimestamp(msg, 32);

        // Parse server transmit timestamp (bytes 40-47)
        const t2 = this.extractNTPTimestamp(msg, 40);

        // Compute offset: ((t1 - t0) + (t2 - t3)) / 2
        const offsetMs = ((t1 - t0) + (t2 - t3)) / 2;
        const latencyMs = t3 - t0;

        socket.close();
        resolve({ success: true, offsetMs, latencyMs });
      });

      // Build NTP request packet (48 bytes, first byte = 0x1B)
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

  /**
   * Extract a timestamp from an NTP response buffer at the given byte offset.
   * NTP timestamps are 8 bytes: 4 bytes seconds + 4 bytes fraction,
   * counted from the NTP epoch (January 1, 1900).
   * Returns the timestamp in Unix milliseconds.
   */
  private extractNTPTimestamp(buffer: Buffer, byteOffset: number): number {
    const seconds = buffer.readUInt32BE(byteOffset);
    const fraction = buffer.readUInt32BE(byteOffset + 4);

    // Convert NTP epoch seconds to Unix epoch seconds
    const unixSeconds = seconds - NTP_UNIX_EPOCH_DELTA_SECONDS;

    // Convert fractional part to milliseconds (fraction / 2^32 * 1000)
    const fractionalMs = (fraction / 0x100000000) * 1000;

    return (unixSeconds * 1000) + fractionalMs;
  }

  /**
   * Synchronize via PTP hardware clock. Reads the kernel-exposed offset
   * from /sys/class/ptp/ptp0/offset and converts from nanoseconds to ms.
   * This is only available on Linux hosts with PTP hardware support.
   */
  private syncViaPTP(): SyncResult {
    const ptpPath = PTP_OFFSET_PATH;
    let rawContent: string;

    try {
      rawContent = fs.readFileSync(ptpPath, "utf-8").trim();
    } catch {
      return { success: false, offsetMs: 0, latencyMs: 0 };
    }

    const nanoseconds = parseInt(rawContent, 10);
    if (isNaN(nanoseconds)) {
      return { success: false, offsetMs: 0, latencyMs: 0 };
    }

    // Convert nanoseconds to milliseconds
    const offsetMs = nanoseconds / 1_000_000;
    return { success: true, offsetMs, latencyMs: 0 };
  }

  /**
   * System clock fallback. Uses Date.now() directly with zero offset.
   * This provides no external synchronization and should be treated
   * as a degraded-accuracy mode with a console warning.
   */
  private syncViaSystem(): SyncResult {
    const now = Date.now();
    const offsetMs = 0;
    const latencyMs = 0;

    if (typeof console !== "undefined") {
      console.warn(
        "[BridgeClock] Using system clock fallback - accuracy is degraded. " +
        "No external time source is available for synchronization."
      );
    }

    return { success: true, offsetMs, latencyMs };
  }

  // -------------------------------------------------------------------------
  // Timestamp Production
  // -------------------------------------------------------------------------

  /**
   * Produce a BridgeTimestamp. The bridge time is Date.now() plus the
   * current synchronization offset. Monotonicity is enforced: if the
   * computed bridge time would be less than the previously produced
   * timestamp, we use the previous value plus a fractional increment.
   */
  stamp(agentTimeMs?: number | null): BridgeTimestamp {
    const rawBridgeTime = Date.now() + this.currentOffsetMs;

    // Enforce monotonicity - each stamp must be >= the previous one
    let bridgeTimeMs: number;
    if (rawBridgeTime > this.lastBridgeTimeMs) {
      bridgeTimeMs = rawBridgeTime;
      this.lastBridgeTimeMs = bridgeTimeMs;
    } else {
      // Advance by a small fraction to keep strict ordering if desired
      bridgeTimeMs = this.lastBridgeTimeMs + 0.001;
      this.lastBridgeTimeMs = bridgeTimeMs;
    }

    const resolvedAgentTime = agentTimeMs !== undefined ? agentTimeMs : null;
    const driftMs = resolvedAgentTime !== null
      ? bridgeTimeMs - resolvedAgentTime
      : 0;

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

  /**
   * Return a complete ClockHealth snapshot describing the current state
   * of the bridge clock, including sync status, offset, protocol, and uptime.
   */
  health(): ClockHealth {
    const now = Date.now();
    const uptimeMs = now - this.startedAt;
    const synced = this.isSynced();

    return {
      synced,
      lastSyncAt: this.lastSyncAt,
      currentOffsetMs: this.currentOffsetMs,
      protocol: this.activeProtocol,
      source: this.config.source || DEFAULT_NTP_SERVER,
      uptimeMs,
    };
  }

  /**
   * Check whether the clock is currently considered synchronized.
   * A clock is synced if it has completed at least one successful sync
   * and the time elapsed since the last sync is within the configured
   * maximum drift tolerance window.
   */
  isSynced(): boolean {
    if (this.lastSyncAt === 0) {
      return false;
    }

    const elapsed = Date.now() - this.lastSyncAt;
    const withinTolerance = elapsed < (this.config.syncIntervalMs * 3);
    const driftAcceptable = Math.abs(this.currentOffsetMs) <= this.config.maxDriftMs;

    return withinTolerance && driftAcceptable;
  }

  /**
   * Measure the drift between an agent-reported timestamp and the
   * bridge clock's authoritative time. Positive drift means the agent
   * clock is behind the bridge clock; negative means it is ahead.
   */
  measureDrift(agentTimeMs: number): number {
    const bridgeNow = Date.now() + this.currentOffsetMs;
    const drift = bridgeNow - agentTimeMs;

    return drift;
  }

  // -------------------------------------------------------------------------
  // Accessors
  // -------------------------------------------------------------------------

  /**
   * Return the currently active synchronization protocol.
   * This may differ from the configured protocol if a fallback occurred.
   */
  getActiveProtocol(): "ntp" | "ptp" | "system" {
    const proto = this.activeProtocol;
    return proto;
  }

  /**
   * Return the current offset in milliseconds between the synchronized
   * time source and the local system clock.
   */
  getOffsetMs(): number {
    const offset = this.currentOffsetMs;
    return offset;
  }

  /**
   * Return the total number of synchronization cycles completed
   * since the clock was started.
   */
  getSyncCount(): number {
    const count = this.syncCount;
    return count;
  }

  /**
   * Return the full configuration object for this clock instance.
   * The returned object is frozen and cannot be modified.
   */
  getConfig(): ClockConfig {
    const cfg = this.config;
    return { ...cfg };
  }

  /**
   * Return the bridge-authoritative current time in milliseconds.
   * This is Date.now() adjusted by the synchronization offset.
   * Does not enforce monotonicity - use stamp() for ordered timestamps.
   */
  now(): number {
    const systemNow = Date.now();
    const adjusted = systemNow + this.currentOffsetMs;
    return adjusted;
  }

  /**
   * Return whether the bridge is configured as the authoritative
   * time source. When true, all agents must defer to bridge timestamps.
   */
  isAuthority(): boolean {
    const authority = this.config.bridgeIsAuthority;
    return authority === true;
  }
}
