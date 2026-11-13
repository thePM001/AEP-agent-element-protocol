#!/usr/bin/env bash
# AEP 2.9 end to end run.
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
# The run is the operator for one temporary deployment. It checks the wrap
# coverage of deployment/, copies the lattice, the GAP grants and the wrapped
# CAW policy from that folder, writes a base node config, provisions an agent
# sign key and a task manifest, then it starts the kernel daemon and the dock
# gateway, then it runs the runner binary that prints the transcript.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PROFILE="${AEP_E2E_PROFILE:-release}"
BIN="$ROOT/rust/target/$PROFILE"
CAW_DIR="$ROOT/AEP-CAW"
CAW_BIN="$CAW_DIR/bin/aep-caw"
POLICY_DIR="$ROOT/AEP-Policy-System"
TRANSCRIPT="$HERE/END-TO-END-RUN.transcript.md"
DEPLOY="$HERE/deployment"
ATTACH_AGENT="agent-a"
ATTACH_ACTION="ucb:ingest"
ATTACH_SCENE="scene-ucb"

log() {
  printf '%s\n' "$*" >&2
}

need_binaries() {
  # Cargo rebuilds only what changed, so the run never uses a stale binary.
  # The run is a member of the root workspace and shares its target dir.
  log "building the kernel, the dock gateway and the run ($PROFILE)"
  local profile_flag="--release"
  if [ "$PROFILE" = "debug" ]; then
    profile_flag=""
  fi
  ( cd "$ROOT" && cargo build $profile_flag -p aep-base-node --bins -p aep-ucb -p aep-end-to-end-run )
  for name in aep-base-node aep-lattice-log aep-ucb aep-end-to-end-run; do
    if [ ! -x "$BIN/$name" ]; then
      log "missing $BIN/$name after the build"
      exit 1
    fi
  done
  # Go rebuilds only what changed, so the run never uses a stale CAW server
  # or seccomp wrapper either.
  log "building CAW"
  ( cd "$CAW_DIR" && make build )
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

log "checking wrap coverage of the deployment"
node "$ROOT/AEP-Components/wrap-coverage/lib/wrap-coverage.mjs" "$DEPLOY/wrap-coverage.yaml" >&2

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
  "version": "2.9",
  "base_node": {
    "socket_base": "$SOCK",
    "lattice_db": "$RUN_DIR/action-lattice.db",
    "lrps": ["dynaep-action-lattice", "lattice-channel-default"],
    "internet_up": true
  }
}
JSON

# The deployment folder beside this script holds the lattice, the two GAP
# grants of the caw wrap and the wrapped CAW policy. The run copies them into
# the run folder unchanged. The wrap coverage report reads the same files
# through deployment/wrap-coverage.yaml and the run stops when any agent
# credential, egress route, tool or lattice grant of the run sits outside a
# wrap. The CAW kernel dock gate seals one root:ping as caw-kernel-dock before
# every exec and the hub of the data folder also grants the attach agent its
# ingest path, so the pass ingest is admitted and the refuse ingest still
# fails on its manifest.
cp "$DEPLOY/lattice.yaml" "$RUN_DIR/lattice.yaml"
mkdir -p "$RUN_DIR/gap/policies/reference" "$RUN_DIR/caw-policies"
cp "$DEPLOY"/gap/*.gap "$RUN_DIR/gap/policies/reference/"
# A CAW session that names no policy asks for the policy named default, so the
# wrapped policy is deployed under that name.
cp "$DEPLOY/caw-policies/e2e-wrapped.yaml" "$RUN_DIR/caw-policies/default.yaml"

export AEP_DATA="$RUN_DIR"
export AEP_SOCKET_BASE="$SOCK"
export AEP_TASK_MANIFEST_DIR="$MANIFESTS"
export AEP_LATTICE_LOG_BIN="$BIN/aep-lattice-log"
export AEP_POLICY_SYSTEM_DIR="$POLICY_DIR"
# The walk does not use the Data Dock, but the daemon binds it on boot. A free
# loopback port keeps the run clear of a Base Node already serving on 8413.
DATA_DOCK_PORT="$(free_port)"
export DATA_DOCK_HOST=127.0.0.1
export DATA_DOCK_PORT

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
# The CAW network backend is eBPF enforce, which needs root and cgroup v2.
# Without them the run says so and runs the network rules unenforced.
CAW_EBPF=false
CAW_DEGRADED=true
if [ "$(id -u)" = "0" ] && [ -f /sys/fs/cgroup/cgroup.controllers ]; then
  CAW_EBPF=true
  CAW_DEGRADED=false
else
  log "WARNING: no root with cgroup v2; CAW network rules run unenforced (sandbox.allow_degraded)"
fi
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
  dir: "$RUN_DIR/caw-policies"
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
  allow_degraded: $CAW_DEGRADED
  fuse:
    enabled: false
  unix_sockets:
    enabled: true
    wrapper_bin: "$CAW_DIR/bin/aep-caw-unixwrap"
  seccomp:
    enabled: true
    execve:
      enabled: true
    file_monitor:
      enabled: true
      enforce_without_fuse: true
  network:
    enabled: false
    ebpf:
      enabled: $CAW_EBPF
      enforce: $CAW_EBPF
      required: $CAW_EBPF
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
