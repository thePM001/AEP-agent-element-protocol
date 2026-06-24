"""Lattice-gated transport for AEP Python SDK (no pip registry)."""

from __future__ import annotations

import json
import os
import subprocess
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Mapping, MutableMapping, Optional


def lattice_strict_enabled() -> bool:
    return os.environ.get("AEP_LATTICE_STRICT", "1") != "0"


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
        input=json.dumps(event),
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
        raise FileNotFoundError(f"lattice socket not found: {socket_path}")
    script = f"""
import socket, sys, json
path = {json.dumps(str(socket_path))}
payload = {json.dumps(line + chr(10))}
timeout = {timeout_ms}
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.settimeout(timeout / 1000.0)
sock.connect(path)
sock.sendall(payload.encode())
buf = b""
while True:
    chunk = sock.recv(4096)
    if not chunk:
        break
    buf += chunk
    if b"\\n" in buf:
        sys.stdout.write(buf.split(b"\\n", 1)[0].decode())
        break
sock.close()
"""
    proc = subprocess.run(
        [os.environ.get("PYTHON", "python3"), "-c", script],
        capture_output=True,
        text=True,
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(proc.stderr.strip() or "lattice socket write failed")
    return proc.stdout.strip()


def lattice_dock_request(
    socket_base: Path,
    dock_port: str,
    event: Mapping[str, Any],
) -> None:
    socket_path = socket_base / _dock_suffix(dock_port)
    sealed = build_lattice_frame(event)
    wire = json.dumps({"frame": sealed["frame"]})
    line = _send_lattice_line(socket_path, wire)
    resp = json.loads(line)
    if not resp.get("ok"):
        raise RuntimeError(resp.get("error") or "lattice frame rejected")


def lattice_gated_fetch(
    url: str,
    *,
    method: str = "GET",
    headers: Optional[Mapping[str, str]] = None,
    data: Optional[bytes] = None,
    meta: Optional[MutableMapping[str, Any]] = None,
    socket_base: Optional[Path] = None,
) -> bytes:
    if not lattice_strict_enabled():
        req = urllib.request.Request(url, data=data, method=method, headers=dict(headers or {}))
        with urllib.request.urlopen(req) as resp:
            return resp.read()

    base = socket_base or resolve_socket_base()
    meta = meta or {}
    event = {
        "agent_id": meta.get("agent_id", "lattice-gateway"),
        "channel_id": meta.get("channel_id", "ch-outbound-gateway"),
        "contract_id": meta.get("contract_id", "lattice-channel-default"),
        "event_type": meta.get("event_type", "LATTICE_GATEWAY_REQUEST"),
        "session_id": meta.get("session_id", "gateway-session"),
        "docking_port": "inference_engine",
        "trust_score": meta.get("trust_score", 750),
        "payload": {
            "url": url,
            "method": method,
            "gateway": meta.get("gateway", "http"),
            **(meta.get("payload_extra") or {}),
        },
    }
    lattice_dock_request(base, "inference_engine", event)
    inference_path = base / "inference"
    if not inference_path.exists():
        raise FileNotFoundError(
            f"inference_engine dock required for lattice-gated fetch: {inference_path}"
        )
    req = urllib.request.Request(url, data=data, method=method, headers=dict(headers or {}))
    try:
        with urllib.request.urlopen(req) as resp:
            return resp.read()
    except urllib.error.URLError as exc:
        raise RuntimeError(f"lattice-gated fetch failed: {exc}") from exc