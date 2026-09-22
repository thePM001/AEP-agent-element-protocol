"""Display API client. Posts JSON with a sealed display frame and reads a JSON projection.

Sibling of the advertised lattice SDK at client/lattice.
The seal path ships with this file. A frontend author supplies no seal code.
Missing seal material DENY on miss.
"""

from __future__ import annotations

import json
import os
import socket
import ssl
import subprocess
import tempfile
import time
from typing import Any, Callable, Dict, Optional

DISPLAY_CONTRACT_ID = "aep-display-api"
DISPLAY_KIND = "display"
ACTION_INGEST = "display-api:source:ingest"
ACTION_STAGE = "display-api:sector:stage"
ACTION_REQUEST = "display-api:view:request"
ACTION_PROJECT = "display-api:view:project"
ACTION_LIST = "display-api:catalog:list"
DISPLAY_TLS_PORT = 28429
DISPLAY_HTTP_PATH = "/display"
DEFAULT_AGENT_ID = "display-client"
DEFAULT_SEAL_BINARY = "aep-base-node"
DISPLAY_ENVELOPE_TYPE = "CUSTOM"
DEFAULT_SCENE_ID = "display-api"
SKIP_FRAME_REFUSED = "JSON body that skips the sealed frame is refused"
MISSING_SEAL_MATERIAL = "missing seal material DENY on miss"

SendLine = Callable[[str], str]
Sealer = Callable[[Dict[str, Any], Dict[str, str]], Dict[str, Any]]


def _require_text(name: str, value: Optional[str]) -> str:
    trimmed = (value or "").strip()
    if trimmed == "":
        raise ValueError(name + " must not be empty")
    return trimmed


def _compact(body: Any) -> str:
    return json.dumps(body, separators=(",", ":"))


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
    return _compact(body)


def collect_envelope(digest: str) -> str:
    return _compact({"collect": _require_text("digest", digest)})


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


def _monotonic_sequence(previous: int) -> int:
    """Sequence number that never steps back for this agent.

    The dock refuses an agent clock regression, so a fresh client process takes
    the wall clock in milliseconds and keeps the larger of that and its own last
    number.
    """
    now_ms = int(time.time() * 1000)
    if now_ms > previous:
        return now_ms
    return previous + 1


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


def resolve_data_dir(data_dir: Optional[str] = None) -> str:
    if data_dir:
        if data_dir.strip():
            return data_dir
    base = os.environ.get("AEP_DATA")
    if base:
        return base
    return os.path.join(os.path.expanduser("~"), ".aep")


def resolve_lattice_db(data_dir: Optional[str] = None) -> str:
    if data_dir:
        if data_dir.strip():
            return os.path.join(data_dir, "action-lattice.db")
    base = os.environ.get("AEP_LATTICE_DB")
    if base:
        return base
    return os.path.join(resolve_data_dir(), "action-lattice.db")


def display_uses_tls(host=None, port=None):
    if port == DISPLAY_TLS_PORT:
        return True
    if os.environ.get("AEP_LATTICE_TRANSPORT") == "tls":
        if host:
            return True
    return False


def _load_tls_material():
    cert = os.environ.get("AEP_LATTICE_TLS_CERT")
    key = os.environ.get("AEP_LATTICE_TLS_KEY")
    ca = os.environ.get("AEP_LATTICE_TLS_CA")
    if not cert or not key or not ca:
        raise ValueError("AEP_LATTICE_TRANSPORT=tls requires AEP_LATTICE_TLS_CERT, AEP_LATTICE_TLS_KEY, AEP_LATTICE_TLS_CA")
    servername = os.environ.get("AEP_LATTICE_TLS_SERVERNAME")
    if not servername:
        servername = "aep-dock-server"
    return cert, key, ca, servername


def _tls_wrap(raw, host):
    cert, key, ca, servername = _load_tls_material()
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    ctx.verify_mode = ssl.CERT_REQUIRED
    ctx.check_hostname = True
    ctx.load_verify_locations(cadata=ca)
    cert_file = tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
    key_file = tempfile.NamedTemporaryFile(mode="w", suffix=".pem", delete=False)
    cert_file.write(cert)
    cert_file.close()
    key_file.write(key)
    key_file.close()
    ctx.load_cert_chain(cert_file.name, key_file.name)
    os.unlink(cert_file.name)
    os.unlink(key_file.name)
    return ctx.wrap_socket(raw, server_hostname=servername)


def _open_socket(socket_path: Optional[str], host: Optional[str], port: Optional[int], timeout: float):
    if host:
        if not port:
            raise ValueError("display client needs host and port")
        raw = socket.create_connection((host, int(port)), timeout=timeout)
        if display_uses_tls(host, int(port)):
            return _tls_wrap(raw, host)
        return raw
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(timeout)
    sock.connect(resolve_socket_path(socket_path))
    return sock


def http_request_bytes(body: str, path: Optional[str] = None) -> bytes:
    target = (path or DISPLAY_HTTP_PATH).strip()
    if not target.startswith("/"):
        target = "/" + target
    payload = body.encode("utf-8")
    head = (
        "POST " + target + " HTTP/1.1\r\n"
        "Host: aep-display-dock\r\n"
        "Content-Type: application/json\r\n"
        "Content-Length: " + str(len(payload)) + "\r\n"
        "Connection: close\r\n"
        "\r\n"
    )
    return head.encode("utf-8") + payload


def http_response_body(raw: bytes) -> str:
    marker = raw.find(b"\r\n\r\n")
    if marker < 0:
        marker = raw.find(b"\n\n")
        if marker < 0:
            raise ValueError("display dock returned bytes without an HTTP header block")
        return raw[marker + 2:].decode("utf-8", "replace").strip()
    return raw[marker + 4:].decode("utf-8", "replace").strip()


def _content_length(head: bytes) -> int:
    for raw in head.split(b"\r\n"):
        line = raw.decode("utf-8", "replace").strip().lower()
        if line.startswith("content-length:"):
            try:
                return int(line.split(":", 1)[1].strip())
            except ValueError:
                return -1
    return -1


def post_display_http(wire: str, socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, timeout: float = 8.0) -> str:
    """Post one JSON body and return the JSON body of the HTTP reply.

    The reader stops when the header block and the promised content length are
    both present, so the dock may keep the connection open.
    """
    sock = _open_socket(socket_path, host, port, timeout)
    try:
        sock.sendall(http_request_bytes(wire))
        buf = b""
        while True:
            marker = buf.find(b"\r\n\r\n")
            if marker >= 0:
                size = _content_length(buf[:marker])
                if size >= 0:
                    if len(buf) - (marker + 4) >= size:
                        break
            chunk = sock.recv(4096)
            if not chunk:
                break
            buf += chunk
    finally:
        sock.close()
    return http_response_body(buf)


def send_json_line(line: str, socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, timeout: float = 8.0) -> str:
    sock = _open_socket(socket_path, host, port, timeout)
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


def cli_sealer(agent_id: Optional[str] = None, binary: Optional[str] = None, lattice_db: Optional[str] = None, data_dir: Optional[str] = None, timeout: float = 30.0) -> Sealer:
    """Seal display plaintext with the shipped Base Node seal path.

    The command reads one JSON plaintext object on stdin and writes one JSON
    object with a frame and a signer public key on stdout. A missing binary, a
    missing key material or a refused plaintext raises MISSING_SEAL_MATERIAL.
    """
    resolved_agent = (agent_id or DEFAULT_AGENT_ID).strip()
    resolved_bin = (binary or os.environ.get("AEP_BASE_NODE_BIN") or DEFAULT_SEAL_BINARY).strip()
    resolved_db = lattice_db or resolve_lattice_db(data_dir)
    resolved_data = data_dir or resolve_data_dir()

    def sealer(plaintext: Dict[str, Any], meta: Dict[str, str]) -> Dict[str, Any]:
        if not isinstance(plaintext, dict):
            raise ValueError(SKIP_FRAME_REFUSED)
        env = dict(os.environ)
        env["AEP_DATA"] = resolved_data
        env["AEP_LATTICE_DB"] = resolved_db
        cmd = [resolved_bin, "--seal-display", "--agent-id", resolved_agent, "--lattice-db", resolved_db]
        try:
            done = subprocess.run(cmd, input=_compact(plaintext), capture_output=True, text=True, timeout=timeout, env=env)
        except (OSError, subprocess.SubprocessError):
            raise ValueError(MISSING_SEAL_MATERIAL)
        if done.returncode != 0:
            raise ValueError(MISSING_SEAL_MATERIAL)
        text = (done.stdout or "").strip()
        if not text:
            raise ValueError(MISSING_SEAL_MATERIAL)
        try:
            parsed = json.loads(text)
        except ValueError:
            raise ValueError(MISSING_SEAL_MATERIAL)
        if not isinstance(parsed, dict):
            raise ValueError(MISSING_SEAL_MATERIAL)
        if not isinstance(parsed.get("frame"), dict):
            raise ValueError(MISSING_SEAL_MATERIAL)
        return parsed

    return sealer


def post_display_json(sealed: Dict[str, Any], socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, send_line: Optional[SendLine] = None, http: Optional[bool] = None) -> Any:
    frame = None
    if isinstance(sealed, dict):
        frame = sealed.get("frame")
    if not isinstance(frame, dict):
        raise ValueError(SKIP_FRAME_REFUSED)
    use_http = http
    if use_http is None:
        use_http = True if host else False
    sender = send_line
    if sender is None:
        if use_http:
            def sender(wire: str) -> str:
                return post_display_http(wire, socket_path=socket_path, host=host, port=port)
        else:
            def sender(wire: str) -> str:
                return send_json_line(wire, socket_path=socket_path, host=host, port=port)
    first = _parse_dock_response(sender(display_envelope(frame, sealed.get("signer_public_hex"))))
    if first.get("pending"):
        if first.get("digest"):
            collected = _parse_dock_response(sender(collect_envelope(str(first["digest"]))))
            return _projection_from(collected)
    return _projection_from(first)


class DisplayClient:
    """Display API client for one agent.

    The sealer is optional. When the caller supplies none the shipped seal path
    runs the Base Node seal command for the agent id of this client.
    """

    def __init__(self, sealer: Optional[Sealer] = None, socket_path: Optional[str] = None, host: Optional[str] = None, port: Optional[int] = None, send_line: Optional[SendLine] = None, http: Optional[bool] = None, agent_id: str = DEFAULT_AGENT_ID, channel_id: str = "ch-display", session_id: str = "display-session", signer_public_hex: Optional[str] = None, seal_binary: Optional[str] = None, data_dir: Optional[str] = None, lattice_db: Optional[str] = None, scene_id: str = DEFAULT_SCENE_ID) -> None:
        self.agent_id = agent_id
        self.channel_id = channel_id
        self.session_id = session_id
        self.signer_public_hex = signer_public_hex
        if sealer is None:
            sealer = cli_sealer(agent_id=agent_id, binary=seal_binary, data_dir=data_dir, lattice_db=lattice_db)
        self.sealer = sealer
        self.socket_path = socket_path
        self.host = host
        self.port = port
        self.send_line = send_line
        self.http = http
        self.scene_id = scene_id
        self.sequence = 0
        self.requested = set()

    def ingest(self, view: str, source: str, sector: str, payload: Any = None) -> Any:
        staged = payload
        if staged is None:
            staged = {}
        return self._roundtrip(display_plaintext(ACTION_INGEST, view, source, sector, staged, True))

    def stage(self, view: str, source: str, sector: str, payload: Any = None) -> Any:
        include_payload = payload is not None
        return self._roundtrip(display_plaintext(ACTION_STAGE, view, source, sector, payload, include_payload))

    def request(self, view: str) -> Any:
        result = self._roundtrip(display_plaintext(ACTION_REQUEST, view))
        self.requested.add(view)
        return result

    def project(self, view: str) -> Any:
        if view not in self.requested:
            self.requested.add(view)
            self._roundtrip(display_plaintext(ACTION_REQUEST, view))
        return self._roundtrip(display_plaintext(ACTION_PROJECT, view))

    def list_catalog(self, view: str = "view.alpha") -> Any:
        return self._roundtrip(display_plaintext(ACTION_LIST, view))

    def seal(self, plaintext: Dict[str, Any]) -> Dict[str, Any]:
        meta = {"contractId": DISPLAY_CONTRACT_ID, "dockingPort": "DisplayApi", "agentId": self.agent_id, "channelId": self.channel_id, "sessionId": self.session_id}
        return self.sealer(plaintext, meta)

    def _roundtrip(self, plaintext: Dict[str, Any]) -> Any:
        body = dict(plaintext)
        body["type"] = DISPLAY_ENVELOPE_TYPE
        body["agent_id"] = self.agent_id
        body["target_id"] = self.scene_id
        self.sequence = _monotonic_sequence(self.sequence)
        body["_sequenceNumber"] = self.sequence
        sealed = self.seal(body)
        if not isinstance(sealed, dict):
            raise ValueError(SKIP_FRAME_REFUSED)
        signer = sealed.get("signer_public_hex")
        if not signer:
            signer = self.signer_public_hex
        return post_display_json({"frame": sealed.get("frame"), "signer_public_hex": signer}, socket_path=self.socket_path, host=self.host, port=self.port, send_line=self.send_line, http=self.http)
