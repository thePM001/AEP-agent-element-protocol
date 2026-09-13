#!/usr/bin/env bash
# AEP 2.8.6 end to end run.
#
# One command walks every layer twice. The refuse path runs first and every
# layer fails closed. The pass path runs second and the same layers allow.
#
# Layers, in order: a CAW session, a sealed capsule, the pulse, collect all,
# apply, a CAW exec, a dock attach and a ledger row.
#
# From the repository root:
#
#   ./AEP-User-Experience/examples/end-to-end-run/run.sh
#
# The first run builds the kernel, the dock gateway and the CAW binaries.
# The run writes its transcript to END-TO-END-RUN.transcript.md beside the
# script, with the run directory and the two loopback ports replaced by tokens.
#
# The run is the operator for one temporary deployment. It writes a base node
# config, a lattice for the attach, a provisioned agent sign key and a task
# manifest, then it starts the kernel daemon and the dock gateway, then it runs
# the runner binary that prints the transcript.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PROFILE="${AEP_E2E_PROFILE:-release}"
BIN="$ROOT/rust/target/$PROFILE"
CAW_DIR="$ROOT/AEP-CAW"
CAW_BIN="$CAW_DIR/bin/aep-caw"
POLICY_DIR="$ROOT/AEP-Policy-System"
TRANSCRIPT="$HERE/END-TO-END-RUN.transcript.md"
ATTACH_AGENT="agent-a"
ATTACH_ACTION="ucb:ingest"
ATTACH_SCENE="scene-ucb"

log() {
  printf '%s\n' "$*" >&2
}

need_binaries() {
  local missing=0
  for name in aep-base-node aep-lattice-log aep-ucb aep-end-to-end-run; do
    if [ ! -x "$BIN/$name" ]; then
      missing=1
    fi
  done
  if [ "$missing" = "1" ]; then
    log "building the kernel, the dock gateway and the run ($PROFILE)"
    ( cd "$ROOT" && cargo build --release -p aep-base-node --bins -p aep-ucb )
    ( cd "$ROOT" && cargo build --release --manifest-path "$HERE/Cargo.toml" )
  fi
  if [ ! -x "$CAW_BIN" ]; then
    log "building CAW"
    ( cd "$CAW_DIR" && make build )
  fi
}

free_port() {
  python3 -c 'import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()'
}

provenance_digest() {
  python3 -c 'import hashlib, sys
source, protocol, session = sys.argv[1], sys.argv[2], sys.argv[3]
print(hashlib.sha256((source + "|" + protocol + "|" + session).encode()).hexdigest())' "$1" "$2" "$3"
}

need_binaries

RUN_DIR="$(mktemp -d)"
SOCK="$RUN_DIR/sockets"
MANIFESTS="$RUN_DIR/ucb/manifests"
WORKSPACE="$RUN_DIR/workspace"
mkdir -p "$SOCK" "$MANIFESTS" "$WORKSPACE"

BASE_PID=""
UCB_PID=""
CAW_PID=""
cleanup() {
  if [ -n "$CAW_PID" ]; then kill "$CAW_PID" 2>/dev/null || true; fi
  if [ -n "$UCB_PID" ]; then kill "$UCB_PID" 2>/dev/null || true; fi
  if [ -n "$BASE_PID" ]; then kill "$BASE_PID" 2>/dev/null || true; fi
  wait 2>/dev/null || true
}
trap cleanup EXIT

cat > "$RUN_DIR/base-node.json" <<JSON
{
  "version": "2.8.6",
  "base_node": {
    "socket_base": "$SOCK",
    "lattice_db": "$RUN_DIR/action-lattice.db",
    "lrps": ["dynaep-action-lattice", "lattice-channel-default"],
    "internet_up": true
  }
}
JSON

cat > "$RUN_DIR/lattice.yaml" <<YAML
actions:
  $ATTACH_ACTION:
    category: external_event
    parents: []
    children: []
    agent_permission: ["$ATTACH_AGENT"]
YAML

export AEP_DATA="$RUN_DIR"
export AEP_SOCKET_BASE="$SOCK"
export AEP_TASK_MANIFEST_DIR="$MANIFESTS"
export AEP_LATTICE_LOG_BIN="$BIN/aep-lattice-log"
export AEP_POLICY_SYSTEM_DIR="$POLICY_DIR"

log "provisioning the attach agent sign key"
"$BIN/aep-base-node" --config "$RUN_DIR/base-node.json" \
  --provision-agent-sign-key --agent-id "$ATTACH_AGENT"

log "starting the kernel daemon"
"$BIN/aep-base-node" --daemon --config "$RUN_DIR/base-node.json" \
  > "$RUN_DIR/base-node.log" 2>&1 &
BASE_PID="$(jobs -p %+)"
for _ in $(seq 1 100); do
  if [ -S "$SOCK/validation" ]; then break; fi
  sleep 0.2
done
if [ ! -S "$SOCK/validation" ]; then
  log "the validation dock did not listen"
  tail -n 20 "$RUN_DIR/base-node.log" >&2 || true
  exit 1
fi

CAW_PORT="$(free_port)"
CAW_SERVER="http://127.0.0.1:$CAW_PORT"
cat > "$RUN_DIR/caw-server.yml" <<YAML
server:
  http:
    addr: "127.0.0.1:$CAW_PORT"
  grpc:
    enabled: false
  unix_socket:
    enabled: false
auth:
  type: "none"
metrics:
  enabled: false
health:
  path: "/health"
  readiness_path: "/ready"
policies:
  dir: "./configs/policies"
  default: "default"
sessions:
  base_dir: "$RUN_DIR/caw-sessions"
  max_sessions: 10
audit:
  enabled: true
  output: "$RUN_DIR/caw-audit.jsonl"
  storage:
    sqlite_path: "$RUN_DIR/caw-events.db"
sandbox:
  fuse:
    enabled: false
  network:
    enabled: false
  unix_sockets:
    enabled: false
  seccomp:
    execve:
      enabled: false
YAML

log "starting the CAW server"
( cd "$CAW_DIR" && exec "$CAW_BIN" server --config "$RUN_DIR/caw-server.yml" \
  > "$RUN_DIR/caw-server.log" 2>&1 ) &
CAW_PID="$(jobs -p %+)"
for _ in $(seq 1 100); do
  if curl -fsS "$CAW_SERVER/health" > /dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "$CAW_SERVER/health" > /dev/null 2>&1 || {
  log "the CAW server did not answer health"
  tail -n 20 "$RUN_DIR/caw-server.log" >&2 || true
  exit 1
}

UCB_PORT="$(free_port)"
UCB_URL="http://127.0.0.1:$UCB_PORT"
UCB_KEY="aep-e2e-dock-$UCB_PORT"

log "starting the dock gateway (UCB)"
UCB_HOST=127.0.0.1 UCB_PORT="$UCB_PORT" UCB_API_KEY="$UCB_KEY" \
  "$BIN/aep-ucb" > "$RUN_DIR/ucb.log" 2>&1 &
UCB_PID="$(jobs -p %+)"
for _ in $(seq 1 100); do
  if curl -fsS "$UCB_URL/health" > /dev/null 2>&1; then break; fi
  sleep 0.2
done
curl -fsS "$UCB_URL/health" > /dev/null 2>&1 || {
  log "the dock gateway did not answer health"
  tail -n 20 "$RUN_DIR/ucb.log" >&2 || true
  exit 1
}

log "running the end to end walk"
set +e
AEP_E2E_CAW_BIN="$CAW_BIN" \
AEP_E2E_CAW_SERVER="$CAW_SERVER" \
AEP_E2E_WORKSPACE="$WORKSPACE" \
AEP_E2E_UCB_URL="$UCB_URL" \
AEP_E2E_UCB_KEY="$UCB_KEY" \
AEP_E2E_BASE_NODE_CONFIG="$RUN_DIR/base-node.json" \
AEP_E2E_LATTICE_LOG_BIN="$BIN/aep-lattice-log" \
AEP_E2E_RUN_DIR="$RUN_DIR" \
AEP_E2E_ATTACH_ACTION="$ATTACH_ACTION" \
AEP_E2E_ATTACH_SCENE="$ATTACH_SCENE" \
AEP_E2E_ATTACH_AGENT="$ATTACH_AGENT" \
AEP_E2E_REFUSE_AGENT="agent-b" \
AEP_E2E_PROVENANCE_DIGEST_REFUSE="$(provenance_digest mcp 1.0 e2e-refuse)" \
AEP_E2E_PROVENANCE_DIGEST_PASS="$(provenance_digest mcp 1.0 e2e-pass)" \
  "$BIN/aep-end-to-end-run" | tee "$RUN_DIR/transcript.txt"
RUN_RC="${PIPESTATUS[0]}"
set -e

python3 - "$RUN_DIR/transcript.txt" "$TRANSCRIPT" "$RUN_DIR" "$CAW_PORT" "$UCB_PORT" <<'PY'
import sys

src, dest, run_dir, caw_port, ucb_port = sys.argv[1:6]
text = open(src).read()
text = text.replace(run_dir, "<run-dir>")
text = text.replace("127.0.0.1:" + caw_port, "<caw-port>")
text = text.replace("127.0.0.1:" + ucb_port, "<ucb-port>")
text = text.replace(caw_port, "<caw-port>")
text = text.replace(ucb_port, "<ucb-port>")
intro = (
    "This note records one observed run of the end to end example in this folder. "
    "The run walks every layer twice and prints the refuse path first and the pass path second. "
    "The last line of the pass section shows the ledger row that the kernel wrote.\n\n"
)
quoted = "\n".join("> " + line for line in text.splitlines())
open(dest, "w").write(intro + quoted + "\n")
PY

log "transcript written to $TRANSCRIPT"
exit "$RUN_RC"
