"""Lattice-gated transport for AEP SDK (no pip registry)."""

from __future__ import annotations

import base64
import json
import os
import socket
import subprocess
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Optional


def lattice_strict_enabled() -> bool:
    if os.environ.get("AEP_LATTICE_STRICT") == "0":
        if os.environ.get("AEP_LATTICE_STRICT_DEV") == "1":
            return False
        raise RuntimeError(
            "AEP_LATTICE_STRICT=0 refused outside AEP_LATTICE_STRICT_DEV=1"
        )
    return True


def assert_url_not_ssrf(raw: str):
    parsed = urllib.parse.urlparse(raw)
    if parsed.scheme not in ("http", "https"):
        raise RuntimeError("lattice-gated-fetch: blocked protocol")
    host = (parsed.hostname or "").lower()
    allow_loop = os.environ.get("AEP_LATTICE_ALLOW_LOOPBACK") == "1"
    allow_priv = os.environ.get("AEP_LATTICE_ALLOW_PRIVATE") == "1"
    is_loopback = host in ("localhost", "0.0.0.0", "::1") or host.startswith("127.")
    if allow_loop is False and is_loopback:
        raise RuntimeError("lattice-gated-fetch: loopback blocked")
    is_private = (
        host.startswith("10.")
        or host.startswith("192.168.")
        or host.startswith("169.254.")
        or host.endswith(".internal")
        or host.endswith(".local")
        or host in ("metadata", "metadata.google.internal")
    )
    if is_private is False and host.startswith("172."):
        parts = host.split(".")
        if len(parts) >= 2 and parts[1].isdigit():
            n = int(parts[1])
            if 16 <= n <= 31:
                is_private = True
    if allow_priv is False and is_private:
        raise RuntimeError("lattice-gated-fetch: private/metadata host blocked")


def resolve_socket_base() -> Path:
    if os.environ.get("AEP_SOCKET_BASE"):
        return Path(os.environ["AEP_SOCKET_BASE"])
    data = Path(os.environ.get("AEP_DATA", Path.home() / ".aep"))
    return data / "sockets"


def resolve_lattice_log_bin() -> str:
    return (
        os.environ.get("AEP_LATTICE_LOG_BIN")
        or os.environ.get("AEP_LATTICE_LOG_CLI")
        or "aep-lattice-log"
    )


def resolve_config_path() -> Optional[Path]:
    data = Path(os.environ.get("AEP_DATA", Path.home() / ".aep"))
    path = data / "base-node.json"
    return path if path.exists() else None


def build_lattice_frame(event: Mapping[str, Any]) -> dict[str, Any]:
    bin_path = resolve_lattice_log_bin()
    args: list[str] = []
    config_path = resolve_config_path()
    if config_path:
        args.extend(["--config", str(config_path)])
    args.append("build-frame")
    proc = subprocess.run(
        [bin_path, *args],
        input=json.dumps(dict(event)),
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "aep-lattice-log build-frame failed")
    parsed = json.loads(proc.stdout.strip())
    if "frame" not in parsed:
        raise RuntimeError("aep-lattice-log build-frame missing LatticeChannelFrame")
    return parsed


def _dock_suffix(dock_port: str) -> str:
    return {
        "inference_engine": "inference",
        "validation_engine": "validation",
        "future_features": "future",
        "regulation_module": "regulation",
    }.get(dock_port, dock_port)


def _send_lattice_line(socket_path: Path, line: str, timeout_ms: int = 8000) -> str:
    if not socket_path.exists():
        raise FileNotFoundError("lattice socket not found")
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout_ms / 1000.0)
    try:
        sock.connect(str(socket_path))
        sock.sendall((line + "\n").encode())
        buf = b""
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
            if b"\n" in buf:
                return buf.split(b"\n", 1)[0].decode()
        return buf.decode()
    finally:
        sock.close()


def lattice_dock_request(
    socket_base: Path,
    dock_port: str,
    event: Mapping[str, Any],
):
    socket_path = socket_base / _dock_suffix(dock_port)
    sealed = build_lattice_frame(event)
    wire = json.dumps({"frame": sealed["frame"]})
    line = _send_lattice_line(socket_path, wire)
    resp = json.loads(line)
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error") or "lattice frame rejected")
    return resp


def http_from_dock_allow(resp):
    http = resp.get("http")
    if not http:
        raise RuntimeError("lattice-gated-fetch: dock allow did not return http")
    raw = http.get("body_b64") or ""
    return __import__("base64").b64decode(raw) if raw else b""


def lattice_gated_fetch(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[Mapping[str, str]] = None,
    data: Optional[bytes] = None,
    meta: Optional[MutableMapping[str, Any]] = None,
    socket_base: Optional[Path] = None,
) -> bytes:
    assert_url_not_ssrf(url)
    if not lattice_strict_enabled():
        req = urllib.request.Request(
            url, data=data, method=method, headers=dict(headers or {})
        )
        with urllib.request.urlopen(req) as resp:
            return resp.read()

    base = socket_base or resolve_socket_base()
    meta = meta or {}
    event: dict[str, Any] = {
        "agent_id": meta.get("agent_id", "lattice-gateway"),
        "channel_id": meta.get("channel_id", "ch-outbound-gateway"),
        "contract_id": meta.get("contract_id", "lattice-channel-default"),
        "event_type": meta.get("event_type", "LATTICE_GATEWAY_REQUEST"),
        "session_id": meta.get("session_id", "gateway-session"),
        "docking_port": "inference_engine",
        "payload": {
            "url": url,
            "method": method,
            "gateway": meta.get("gateway", "http"),
            **(meta.get("payload_extra") or {}),
        },
    }
    if "trust_score" in meta:
        event["trust_score"] = meta["trust_score"]
    resp = lattice_dock_request(base, "inference_engine", event)
    return http_from_dock_allow(resp)
