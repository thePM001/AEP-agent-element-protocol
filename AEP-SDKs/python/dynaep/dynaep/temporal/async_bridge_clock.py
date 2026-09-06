# @PAD: /root/dynAEP/sdk/python/dynaep/temporal/async_bridge_clock.py
# ===========================================================================
# dynaep.temporal.async_bridge_clock - Async Bridge Clock with Slewing
# OPT-008: NTP sync runs in a background thread (never blocks event
# processing). Clock corrections applied via slewing (gradual adjustment)
# instead of stepping for corrections between 1ms and 1000ms.
# ===========================================================================

from __future__ import annotations
import time
import socket
import struct
import os
import threading
import logging
from dataclasses import dataclass
from typing import Optional, List, Callable

logger = logging.getLogger("dynaep.temporal.async_bridge_clock")

NTP_UNIX_EPOCH_DELTA_SECONDS = 2208988800
NTP_PACKET_SIZE = 48
NTP_REQUEST_HEADER = 0x1B
DEFAULT_NTP_SERVER = "pool.ntp.org"
NTP_PORT = 123
PTP_OFFSET_PATH = "/sys/class/ptp/ptp0/offset"
NTP_TIMEOUT_SECONDS = 5.0
SLEW_IGNORE_THRESHOLD_MS = 1.0
SLEW_STEP_THRESHOLD_MS = 1000.0


@dataclass
class ClockConfig:
    protocol: str  # "ntp" | "ptp" | "system"
    source: str
    sync_interval_ms: int
    max_drift_ms: int
    bridge_is_authority: bool


@dataclass
class SyncResult:
    success: bool
    offset_ms: float
    latency_ms: float


class AsyncBridgeClock:
    """Bridge clock with async NTP sync and slewing corrections.

    Thread safety: now() is thread-safe (reads only from atomic-like state).
    Sync runs in a daemon thread and never blocks the main thread.
    """

    def __init__(self, config: ClockConfig) -> None:
        self._config = config
        self._active_protocol = config.protocol
        self._sync_in_progress = False
        self._sync_count = 0
        self._last_sync_success = False
        self._last_sync_at = 0.0
        self._started_at = time.monotonic()

        # Offsets
        self._epoch_offset = time.time() - time.monotonic()
        self._ntp_offset_ms = 0.0

        # Slewing
        self._slew_remaining_ms = 0.0
        self._slew_start_mono = 0.0
        self._slew_duration_ms = 0.0
        self._slew_total_ms = 0.0

        # Monotonicity
        self._last_returned_ms = 0.0
        self._lock = threading.Lock()

        # Timer thread
        self._timer: Optional[threading.Timer] = None
        self._running = False

        # Event listeners
        self._listeners: List[Callable] = []

    def start(self) -> None:
        """Begin periodic sync. Initial sync is synchronous; subsequent are async."""
        self._running = True
        self._perform_sync()
        if self._config.sync_interval_ms > 0:
            self._schedule_next_sync()

    def stop(self) -> None:
        self._running = False
        if self._timer:
            self._timer.cancel()
            self._timer = None

    def now(self) -> float:
        """Return bridge-authoritative time in milliseconds.

        GUARANTEES:
        - Non-blocking (pure arithmetic)
        - Monotonically non-decreasing
        - Includes active slew adjustment
        """
        mono = time.monotonic()

        # Slew adjustment
        slew = 0.0
        if self._slew_remaining_ms != 0 and self._slew_duration_ms > 0:
            elapsed = (mono - self._slew_start_mono) * 1000  # to ms
            if elapsed >= self._slew_duration_ms:
                slew = self._slew_total_ms
                self._slew_remaining_ms = 0
            else:
                fraction = elapsed / self._slew_duration_ms
                slew = self._slew_total_ms * fraction

        bridge_ms = (mono + self._epoch_offset) * 1000 + self._ntp_offset_ms + slew

        # Monotonicity
        with self._lock:
            if bridge_ms < self._last_returned_ms:
                bridge_ms = self._last_returned_ms
            else:
                self._last_returned_ms = bridge_ms

        return bridge_ms

    def on_sync(self, listener: Callable) -> None:
        self._listeners.append(listener)

    def is_synced(self) -> bool:
        if self._last_sync_at == 0:
            return False
        elapsed = (time.time() - self._last_sync_at) * 1000
        return elapsed < self._config.sync_interval_ms * 3

    def get_active_protocol(self) -> str:
        return self._active_protocol

    def get_offset_ms(self) -> float:
        return self._ntp_offset_ms

    def measure_drift(self, agent_time_ms: float) -> float:
        return self.now() - agent_time_ms

    # -----------------------------------------------------------------------
    # Internal sync
    # -----------------------------------------------------------------------

    def _schedule_next_sync(self) -> None:
        if not self._running:
            return
        interval_sec = self._config.sync_interval_ms / 1000.0
        self._timer = threading.Timer(interval_sec, self._async_sync_wrapper)
        self._timer.daemon = True
        self._timer.start()

    def _async_sync_wrapper(self) -> None:
        """Runs in a daemon thread."""
        try:
            self._perform_sync()
        except Exception:
            logger.warning("NTP sync failed, retrying on next interval")
        finally:
            self._schedule_next_sync()

    def _perform_sync(self) -> None:
        if self._sync_in_progress:
            return
        self._sync_in_progress = True
        try:
            result = SyncResult(success=False, offset_ms=0, latency_ms=0)

            if self._active_protocol == "ptp":
                result = self._sync_via_ptp()
                if not result.success:
                    result = self._sync_via_ntp()
                    if result.success:
                        self._active_protocol = "ntp"
            elif self._active_protocol == "ntp":
                result = self._sync_via_ntp()
            else:
                result = self._sync_via_system()

            if not result.success:
                result = self._sync_via_system()
                self._active_protocol = "system"

            if result.success:
                self._apply_correction(result.offset_ms)
                self._last_sync_at = time.time()
                self._last_sync_success = True
                self._sync_count += 1
                for listener in self._listeners:
                    try:
                        listener({
                            "source": self._active_protocol,
                            "offset_ms": result.offset_ms,
                            "synced_at": self._last_sync_at,
                        })
                    except Exception:
                        pass
            else:
                self._last_sync_success = False
                logger.warning("NTP sync failed, keeping previous offset: %s", self._ntp_offset_ms)
        finally:
            self._sync_in_progress = False

    def _apply_correction(self, new_offset_ms: float) -> None:
        correction = new_offset_ms - self._ntp_offset_ms
        abs_correction = abs(correction)

        if abs_correction < SLEW_IGNORE_THRESHOLD_MS:
            return

        if abs_correction > SLEW_STEP_THRESHOLD_MS:
            self._ntp_offset_ms = new_offset_ms
            self._slew_remaining_ms = 0
            self._slew_total_ms = 0
            logger.warning("Large clock correction (step): %.1fms", correction)
            return

        # Complete any previous slew
        if self._slew_remaining_ms != 0:
            self._ntp_offset_ms += self._slew_total_ms
            self._slew_remaining_ms = 0

        self._slew_total_ms = correction
        self._slew_remaining_ms = correction
        self._slew_start_mono = time.monotonic()
        self._slew_duration_ms = self._config.sync_interval_ms

    def _sync_via_ntp(self) -> SyncResult:
        server = self._config.source or DEFAULT_NTP_SERVER
        t0 = time.time() * 1000
        try:
            sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            sock.settimeout(NTP_TIMEOUT_SECONDS)
            packet = b"\x1b" + b"\x00" * 47
            sock.sendto(packet, (server, NTP_PORT))
            data, _ = sock.recvfrom(NTP_PACKET_SIZE)
            t3 = time.time() * 1000
            sock.close()

            if len(data) < NTP_PACKET_SIZE:
                return SyncResult(False, 0, 0)

            t1 = self._extract_ntp_ts(data, 32)
            t2 = self._extract_ntp_ts(data, 40)
            offset = ((t1 - t0) + (t2 - t3)) / 2
            latency = t3 - t0
            return SyncResult(True, offset, latency)
        except Exception:
            return SyncResult(False, 0, 0)

    @staticmethod
    def _extract_ntp_ts(data: bytes, offset: int) -> float:
        seconds = struct.unpack("!I", data[offset:offset + 4])[0]
        fraction = struct.unpack("!I", data[offset + 4:offset + 8])[0]
        unix_seconds = seconds - NTP_UNIX_EPOCH_DELTA_SECONDS
        frac_ms = (fraction / 0x100000000) * 1000
        return unix_seconds * 1000 + frac_ms

    def _sync_via_ptp(self) -> SyncResult:
        try:
            with open(PTP_OFFSET_PATH, "r") as f:
                raw = f.read().strip()
            ns = int(raw)
            return SyncResult(True, ns / 1_000_000, 0)
        except Exception:
            return SyncResult(False, 0, 0)

    def _sync_via_system(self) -> SyncResult:
        logger.warning("Using system clock fallback")
        return SyncResult(True, 0, 0)
