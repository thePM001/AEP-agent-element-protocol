#!/usr/bin/env bash
# AEP 2.9 end to end run.
#
# One command walks every layer twice. The refuse path runs first and every
# layer fails closed. The pass path runs second and the same layers allow.
#
# Layers, in order: a sealed capsule, the pulse, collect all, apply, a dock
# attach and a ledger row.
#
# This release ships no host sandbox. The Go CAW is retired and a Rust CAW
# with gVisor replaces it, so the walk has no CAW session and no CAW exec
# layer until that CAW lands.
#
# From the repository root:
#
#   ./AEP-User-Experience/examples/end-to-end-run/run.sh
#
# The first run builds the kernel, the dock gateway and the runner.
# The run writes its transcript to END-TO-END-RUN.transcript.md beside the
# script, with the run directory and the loopback port replaced by tokens.
#
# The run is the operator for one temporary deployment. It checks the wrap
# coverage of deployment/, copies the lattice and the GAP grants from that
# folder, writes a base node config, provisions an agent sign key and a task
# manifest, then it starts the kernel daemon and the dock gateway, then it
# runs the runner binary that prints the transcript.

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
PROFILE="${AEP_E2E_PROFILE:-release}"
BIN="$ROOT/rust/target/$PROFILE"
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
}

free_port() {
  node -e 'const s = require("net").createServer();
s.listen(0, "127.0.0.1", () => { console.log(s.address().port); s.close(); });'
}

# The sha256 of source|protocol|session in hex.
provenance_digest() {
  printf '%s|%s|%s' "$1" "$2" "$3" | sha256sum | cut -d' ' -f1
}

need_binaries

log "checking wrap coverage of the deployment"
node "$ROOT/AEP-Components/wrap-coverage/lib/wrap-coverage.mjs" "$DEPLOY/wrap-coverage.yaml" >&2

RUN_DIR="$(mktemp -d)"
SOCK="$RUN_DIR/sockets"
MANIFESTS="$RUN_DIR/ucb/manifests"
mkdir -p "$SOCK" "$MANIFESTS"

BASE_PID=""
UCB_PID=""
cleanup() {
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

# The deployment folder beside this script holds the lattice and the GAP
# attach grant. The run copies them into the run folder unchanged. The wrap
# coverage report reads the same files through deployment/wrap-coverage.yaml
# and the run stops when any agent credential, egress route, tool or lattice
# grant of the run sits outside a wrap. The hub of the data folder grants the
# attach agent its ingest path, so the pass ingest is admitted and the refuse
# ingest still fails on its manifest.
cp "$DEPLOY/lattice.yaml" "$RUN_DIR/lattice.yaml"
mkdir -p "$RUN_DIR/gap/policies/reference"
cp "$DEPLOY"/gap/*.gap "$RUN_DIR/gap/policies/reference/"

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

# The transcript replaces the run directory and the loopback port by tokens and
# quotes every line of the run.
{
  printf '%s\n\n' "This note records one observed run of the end to end example in this folder. The run walks every layer twice and prints the refuse path first and the pass path second. The last line of the pass section shows the ledger row that the kernel wrote."
  sed -e "s|${RUN_DIR}|<run-dir>|g" \
    -e "s|127.0.0.1:${UCB_PORT}|<ucb-port>|g" \
    -e "s|${UCB_PORT}|<ucb-port>|g" \
    -e 's/^/> /' "$RUN_DIR/transcript.txt"
} > "$TRANSCRIPT"

log "transcript written to $TRANSCRIPT"
exit "$RUN_RC"
