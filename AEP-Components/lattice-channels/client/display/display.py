"""Display API client. Posts JSON with a sealed display frame and reads a JSON projection.

Sibling of the advertised lattice SDK at client/lattice.
Sealer is injected. This file does not open a PQC capsule.
"""

from __future__ import annotations

import json
import os
import socket
from typing import Any, Callable, Dict, Optional

DISPLAY_CONTRACT_ID = "aep-display-surface"
DISPLAY_KIND = "display"
ACTION_INGEST = "display:source:ingest"
ACTION_STAGE = "display:sector:stage"
ACTION_REQUEST = "display:view:request"
ACTION_PROJECT = "display:view:project"
SKIP_FRAME_REFUSED = "JSON body that skips the sealed frame is refused"

SendLine = Callable[[str], str]
Sealer = Callable[[Dict[str, Any], Dict[str, str]], Dict[str, Any]]


def _require_text(name: str, value: Optional[str]) -> str:
    trimmed = (value or "").strip()
    if trimmed == "":
        raise ValueError(name + " must not be empty")
    return trimmed


def display_plaintext(action_path: str, view: str, source: Optional[str] = None, sector: Optional[str] = None, payload: Any = None, include_payload: bool = False) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        "kind": DISPLAY_KIND,
        "action_path": _require_text("action_path", action_path),
        "view": _require_text("view", view),
    }
    source_id = (source or "").strip()
    sector_id = (sector or "").strip()
    if source_id:
        body["source"] = source_id
    if sector_id:
        body["sector"] = sector_id
    if include_payload:
        body["payload"] = payload
    elif payload is not None:
        body["payload"] = payload
    return body

def display_envelope(frame: Dict[str, Any], signer_public_hex: Optional[str] = None) -> str:
    if not isinstance(frame, dict):
        raise ValueError(SKIP_FRAME_REFUSED)
    if not frame:
        raise ValueError(SKIP_FRAME_REFUSED)
    body: Dict[str, Any] = {"frame": frame}
    signer = (signer_public_hex or "").strip()
    if signer:
        body["signer_public_hex"] = signer
    return json.dumps(body, separators=(",", ":"))


def collect_envelope(digest: str) -> str:
    return json.dumps({"collect": _require_text("digest", digest)}, separators=(",", ":"))


def _parse_dock_response(line: str) -> Dict[str, Any]:
    trimmed = (line or "").strip()
    if trimmed == "":
        raise ValueError("display dock returned an empty line")
    try:
        parsed = json.loads(trimmed)
    except ValueError:
        raise ValueError("display dock returned bytes that are not JSON")
    if not isinstance(parsed, dict):
        raise ValueError("display dock returned bytes that are not JSON")
    return parsed


def _projection_from(resp: Dict[str, Any]) -> Any:
    if resp.get("error"):
        raise ValueError(str(resp["error"]))
    if resp.get("ok") is False:
        raise ValueError("display dock refused the frame")
    if "projection" in resp:
        return resp["projection"]
    return None

def resolve_socket_path(socket_path: Optional[str] = None) -> str:
    if socket_path:
        if socket_path.strip():
            return socket_path
    base = os.environ.get("AEP_SOCKET_BASE")
    if base:
        return os.path.join(base, "display")
    data = os.environ.get("AEP_DATA")
    if not data:
        data = os.path.join(os.path.expanduser("~"), ".aep")
    return os.path.join(data, "sockets", "display")


def send_json_line(line: str, socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, timeout: float = 8.0) -> str:
    if host:
        if port:
            sock = socket.create_connection((host, int(port)), timeout=timeout)
        else:
            raise ValueError("display client needs host and port")
    else:
        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        sock.settimeout(timeout)
        sock.connect(resolve_socket_path(socket_path))
    try:
        sock.sendall((line + "\n").encode("utf-8"))
        buf = b""
        while b"\n" not in buf:
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
        return buf.split(b"\n", 1)[0].decode("utf-8")
    finally:
        sock.close()

def post_display_json(sealed: Dict[str, Any], socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, send_line: Optional[SendLine] = None) -> Any:
    frame = None
    if isinstance(sealed, dict):
        frame = sealed.get("frame")
    if not isinstance(frame, dict):
        raise ValueError(SKIP_FRAME_REFUSED)
    sender = send_line
    if sender is None:
        def sender(wire: str) -> str:
            return send_json_line(wire, socket_path=socket_path, host=host, port=port)
    first = _parse_dock_response(sender(display_envelope(frame, sealed.get("signer_public_hex"))))
    if first.get("pending"):
        if first.get("digest"):
            collected = _parse_dock_response(sender(collect_envelope(str(first["digest"]))))
            return _projection_from(collected)
    return _projection_from(first)


class DisplayClient:
    def __init__(self, sealer: Sealer, socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, send_line: Optional[SendLine] = None, agent_id: str = "display-client", channel_id: str = "ch-display", session_id: str = "display-session", signer_public_hex: Optional[str] = None) -> None:
        self.sealer = sealer
        self.socket_path = socket_path
        self.host = host
        self.port = port
        self.send_line = send_line
        self.agent_id = agent_id
        self.channel_id = channel_id
        self.session_id = session_id
        self.signer_public_hex = signer_public_hex
    def ingest(self, view: str, source: str, sector: str, payload: Any = None) -> Any:
        staged = payload
        if staged is None:
            staged = {}
        return self._roundtrip(display_plaintext(ACTION_INGEST, view, source, sector, staged, True))
    def stage(self, view: str, source: str, sector: str, payload: Any = None) -> Any:
        include_payload = payload is not None
        return self._roundtrip(display_plaintext(ACTION_STAGE, view, source, sector, payload, include_payload))
    def request(self, view: str) -> Any:
        return self._roundtrip(display_plaintext(ACTION_REQUEST, view))
    def project(self, view: str) -> Any:
        return self._roundtrip(display_plaintext(ACTION_PROJECT, view))
    def _roundtrip(self, plaintext: Dict[str, Any]) -> Any:
        sealed = self.sealer(plaintext, {"contractId": DISPLAY_CONTRACT_ID, "dockingPort": "DisplaySurface", "agentId": self.agent_id, "channelId": self.channel_id, "sessionId": self.session_id})
        if not isinstance(sealed, dict):
            raise ValueError(SKIP_FRAME_REFUSED)
        signer = sealed.get("signer_public_hex")
        if not signer:
            signer = self.signer_public_hex
        return post_display_json({"frame": sealed.get("frame"), "signer_public_hex": signer}, socket_path=self.socket_path, host=self.host, port=self.port, send_line=self.send_line)
