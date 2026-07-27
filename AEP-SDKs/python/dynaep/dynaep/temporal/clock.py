# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/clock.py
# ===========================================================================
# dynaep.temporal.clock - Bridge Clock Authority
# Provides synchronized time across the dynAEP temporal layer.
# The bridge clock is authoritative - agents derive their time from it.
# Supports NTP (SNTP over UDP), PTP (Linux hardware clock), and system
# fallback with monotonic enforcement on all produced timestamps.
# ===========================================================================

from __future__ import annotations
import time
import socket
import struct
import os
import logging
from dataclasses import dataclass, field
from typing import Optional

logger = logging.getLogger("dynaep.temporal.clock")

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# NTP epoch starts Jan 1, 1900. Unix epoch starts Jan 1, 1970.
# The difference is 70 years worth of seconds (including 17 leap years).
NTP_UNIX_EPOCH_DELTA_SECONDS = 2208988800

# Standard NTP packet size in bytes
NTP_PACKET_SIZE = 48

# First byte of NTP request: LI=0, Version=3, Mode=3 (client)
NTP_REQUEST_HEADER = 0x1B

# Default NTP server when none specified
DEFAULT_NTP_SERVER = "pool.ntp.org"

# Default NTP port
NTP_PORT = 123

# PTP offset file on Linux systems
PTP_OFFSET_PATH = "/sys/class/ptp/ptp0/offset"

# Timeout for NTP requests in seconds
NTP_TIMEOUT_SECONDS = 5.0


# ---------------------------------------------------------------------------
# Types
# ---------------------------------------------------------------------------


@dataclass
class ClockConfig:
    """Configuration for the bridge clock synchronization protocol."""
    protocol: str  # "ntp" | "ptp" | "system"
    source: str
    sync_interval_ms: int
    max_drift_ms: int
    bridge_is_authority: bool


@dataclass
class BridgeTimestamp:
    """A timestamp produced by the bridge clock with drift information."""
    bridge_time_ms: int
    agent_time_ms: Optional[int]
    drift_ms: int
    source: str
    synced_at: int


@dataclass
class ClockHealth:
    """Health snapshot describing the current state of the bridge clock."""
    synced: bool
    last_sync_at: int
    current_offset_ms: float
    protocol: str
    source: str
    uptime_ms: int


@dataclass
class SyncResult:
    """Result of a single synchronization cycle."""
    success: bool
    offset_ms: float
    latency_ms: float


# ---------------------------------------------------------------------------
# Bridge Clock Authority
# ---------------------------------------------------------------------------


class BridgeClock:
    """Authoritative time source for the dynAEP temporal layer.

    Supports NTP (SNTP over UDP), PTP (Linux hardware clock), and system
    fallback. Produces monotonic BridgeTimestamp objects that agents must
    defer to when bridge_is_authority is enabled.
    """

    def __init__(self, config: ClockConfig) -> None:
        self._config = config
        self._offset_ms: float = 0.0
        self._last_sync_at: int = 0
        self._synced: bool = False
        self._last_bridge_time_ms: int = 0
        self._started_at: int = int(time.time() * 1000)
        self._active_protocol: str = config.protocol
        self._sync_count: int = 0
        self._last_sync_success: bool = False

    # -----------------------------------------------------------------------
    # Synchronization
    # -----------------------------------------------------------------------

    def sync(self) -> SyncResult:
        """Execute a single synchronization cycle.

        Tries the configured protocol first, then falls back through
        PTP -> NTP -> system if the primary protocol fails.
        """
        before_ms = time.time() * 1000
        result: SyncResult

        if self._active_protocol == "ptp":
            result = self._sync_ptp()
            if not result.success:
                result = self._sync_ntp()
                if result.success:
                    self._active_protocol = "ntp"
        elif self._active_protocol == "ntp":
            result = self._sync_ntp()
        else:
            result = self._sync_system()

        if not result.success:
            result = self._sync_system()
            self._active_protocol = "system"

        if result.success:
            self._offset_ms = result.offset_ms
            self._last_sync_at = int(time.time() * 1000)
            after_ms = time.time() * 1000
            result = SyncResult(
                success=True,
                offset_ms=result.offset_ms,
                latency_ms=after_ms - before_ms,
            )
            self._synced = True
            self._last_sync_success = True
            self._sync_count += 1

        return result

    def _sync_ntp(self) -> SyncResult:
        """Synchronize via SNTP over UDP.

        Tries ntplib first if available, otherwise falls back to raw
        socket-based SNTP implementation. Computes clock offset using
        the standard NTP formula: ((t1 - t0) + (t2 - t3)) / 2.
        """
        try:
            import ntplib
            return self._sync_ntp_ntplib(ntplib)
        except ImportError:
            logger.debug("ntplib not available, using raw SNTP implementation")
            return self._sync_ntp_raw()

    def _sync_ntp_ntplib(self, ntplib_module: object) -> SyncResult:
        """Synchronize using the ntplib library for higher accuracy."""
        server = self._config.source or DEFAULT_NTP_SERVER
        client = ntplib_module.NTPClient()  # type: ignore[attr-defined]
        try:
            response = client.request(server, version=3)
            offset_ms = response.offset * 1000.0
            latency_ms = response.delay * 1000.0
            return SyncResult(success=True, offset_ms=offset_ms, latency_ms=latency_ms)
        except Exception as exc:
            logger.warning("ntplib sync to %s failed: %s", server, exc)
            return SyncResult(success=False, offset_ms=0.0, latency_ms=0.0)

    def _sync_ntp_raw(self) -> SyncResult:
        """Synchronize via raw SNTP over UDP socket.

        Sends a 48-byte NTP request packet and parses the transmit
        timestamp from bytes 40-47 of the response to compute offset.
        """
        server = self._config.source or DEFAULT_NTP_SERVER
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        sock.settimeout(NTP_TIMEOUT_SECONDS)
        packet = b'\x1b' + 47 * b'\0'
        t0 = time.time()
        try:
            sock.sendto(packet, (server, NTP_PORT))
            data, _ = sock.recvfrom(1024)
            t3 = time.time()
            if len(data) < NTP_PACKET_SIZE:
                logger.warning("NTP response too short: %d bytes", len(data))
                return SyncResult(success=False, offset_ms=0.0, latency_ms=0.0)
            # Parse server receive timestamp (bytes 32-39)
            recv_seconds = struct.unpack('!I', data[32:36])[0]
            recv_fraction = struct.unpack('!I', data[36:40])[0]
            t1 = (recv_seconds - NTP_UNIX_EPOCH_DELTA_SECONDS) + recv_fraction / (2 ** 32)
            # Parse server transmit timestamp (bytes 40-47)
            xmit_seconds = struct.unpack('!I', data[40:44])[0]
            xmit_fraction = struct.unpack('!I', data[44:48])[0]
            t2 = (xmit_seconds - NTP_UNIX_EPOCH_DELTA_SECONDS) + xmit_fraction / (2 ** 32)
            # Compute offset: ((t1 - t0) + (t2 - t3)) / 2
            offset = ((t1 - t0) + (t2 - t3)) / 2.0
            latency = t3 - t0
            return SyncResult(success=True, offset_ms=offset * 1000.0, latency_ms=latency * 1000.0)
        except (socket.timeout, OSError) as exc:
            logger.warning("NTP raw sync to %s failed: %s, falling back", server, exc)
            return SyncResult(success=False, offset_ms=0.0, latency_ms=0.0)
        finally:
            sock.close()

    def _sync_ptp(self) -> SyncResult:
        """Synchronize via PTP hardware clock.

        Reads the kernel-exposed offset from /sys/class/ptp/ptp0/offset
        and converts from nanoseconds to milliseconds. Only available on
        Linux hosts with PTP hardware support.
        """
        ptp_path = PTP_OFFSET_PATH
        try:
            with open(ptp_path, "r") as fh:
                raw_content = fh.read().strip()
        except (OSError, IOError) as exc:
            logger.debug("PTP offset file not readable: %s", exc)
            return SyncResult(success=False, offset_ms=0.0, latency_ms=0.0)

        try:
            nanoseconds = int(raw_content)
        except ValueError:
            logger.warning("PTP offset file contained non-numeric content: %r", raw_content)
            return SyncResult(success=False, offset_ms=0.0, latency_ms=0.0)

        offset_ms = nanoseconds / 1_000_000.0
        return SyncResult(success=True, offset_ms=offset_ms, latency_ms=0.0)

    def _sync_system(self) -> SyncResult:
        """System clock fallback with zero offset.

        Uses time.time() directly with no external synchronization.
        This is a degraded-accuracy mode that always succeeds.
        """
        logger.warning(
            "Using system clock fallback - accuracy is degraded. "
            "No external time source is available for synchronization."
        )
        offset_ms = 0.0
        latency_ms = 0.0
        return SyncResult(success=True, offset_ms=offset_ms, latency_ms=latency_ms)

    # -----------------------------------------------------------------------
    # Timestamp Production
    # -----------------------------------------------------------------------

    def now(self) -> int:
        """Return the bridge-authoritative current time in milliseconds.

        This is the system time adjusted by the synchronization offset,
        with monotonicity enforced so that successive calls never return
        a value lower than a previous call.
        """
        raw_bridge_time = int(time.time() * 1000) + int(self._offset_ms)
        if raw_bridge_time > self._last_bridge_time_ms:
            self._last_bridge_time_ms = raw_bridge_time
            return raw_bridge_time
        # Advance by 1ms to preserve strict ordering
        self._last_bridge_time_ms = self._last_bridge_time_ms + 1
        return self._last_bridge_time_ms

    def stamp(self, agent_timestamp_ms: Optional[int] = None) -> BridgeTimestamp:
        """Produce a BridgeTimestamp with monotonic bridge time.

        If an agent timestamp is provided, the drift between agent and
        bridge time is computed. The bridge time enforces monotonicity
        so that each stamp is at least as large as the previous one.
        """
        bridge_time_ms = self.now()
        drift_ms = 0
        if agent_timestamp_ms is not None:
            drift_ms = bridge_time_ms - agent_timestamp_ms

        return BridgeTimestamp(
            bridge_time_ms=bridge_time_ms,
            agent_time_ms=agent_timestamp_ms,
            drift_ms=drift_ms,
            source=self._active_protocol,
            synced_at=self._last_sync_at,
        )

    # -----------------------------------------------------------------------
    # Health and Status
    # -----------------------------------------------------------------------

    def is_synced(self) -> bool:
        """Check whether the clock is currently considered synchronized.

        A clock is synced if it has completed at least one successful sync
        and the time elapsed since the last sync is within three times
        the configured sync interval.
        """
        if self._last_sync_at == 0:
            return False
        elapsed = int(time.time() * 1000) - self._last_sync_at
        within_tolerance = elapsed < (self._config.sync_interval_ms * 3)
        drift_acceptable = abs(self._offset_ms) <= self._config.max_drift_ms
        return within_tolerance and drift_acceptable

    def measure_drift(self, agent_timestamp_ms: int) -> int:
        """Measure the drift between an agent timestamp and bridge time.

        Positive drift means the agent clock is behind the bridge clock.
        Negative drift means the agent clock is ahead.
        """
        bridge_now = int(time.time() * 1000) + int(self._offset_ms)
        drift = bridge_now - agent_timestamp_ms
        return abs(drift)

    def health(self) -> ClockHealth:
        """Return a complete ClockHealth snapshot.

        Includes sync status, current offset, active protocol, source,
        and uptime since the clock was created.
        """
        current_time_ms = int(time.time() * 1000)
        uptime_ms = current_time_ms - self._started_at
        synced = self.is_synced()

        return ClockHealth(
            synced=synced,
            last_sync_at=self._last_sync_at,
            current_offset_ms=self._offset_ms,
            protocol=self._active_protocol,
            source=self._config.source or DEFAULT_NTP_SERVER,
            uptime_ms=uptime_ms,
        )

    # -----------------------------------------------------------------------
    # Accessors
    # -----------------------------------------------------------------------

    def get_active_protocol(self) -> str:
        """Return the currently active synchronization protocol.

        This may differ from the configured protocol if a fallback occurred
        during synchronization.
        """
        proto = self._active_protocol
        return proto

    def get_offset_ms(self) -> float:
        """Return the current offset in milliseconds between the synchronized
        time source and the local system clock.
        """
        offset = self._offset_ms
        return offset

    def get_sync_count(self) -> int:
        """Return the total number of successful synchronization cycles
        completed since the clock was created.
        """
        count = self._sync_count
        return count

    def get_config(self) -> ClockConfig:
        """Return a copy of the configuration for this clock instance."""
        return ClockConfig(
            protocol=self._config.protocol,
            source=self._config.source,
            sync_interval_ms=self._config.sync_interval_ms,
            max_drift_ms=self._config.max_drift_ms,
            bridge_is_authority=self._config.bridge_is_authority,
        )

    def is_authority(self) -> bool:
        """Return whether the bridge is configured as the authoritative
        time source. When true, all agents must defer to bridge timestamps.
        """
        authority = self._config.bridge_is_authority
        return authority is True
