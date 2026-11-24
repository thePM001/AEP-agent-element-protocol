#!/usr/bin/env bash
# AEP 2.9 end to end run.
#
# One command walks every layer twice. The refuse path runs first and every
# layer fails closed. The pass path runs second and the same layers allow.
#
# Layers, in order: a sealed capsule, the pulse, collect all, apply, a dock
# attach, a ledger row, a CAW session and a command in the gVisor sandbox of
# the CAW.
#
# The CAW needs the pinned gVisor of AEP-CAWs-RustGvisor/proof/install-runsc.sh
# and starts no sandbox as root, so the walk runs as the user of the
# deployment. Started as root, the script builds the binaries, copies them into
# a folder of the user nobody and runs the walk as nobody. AEP_E2E_BIN names a
# folder of built binaries and skips the build. AEP_E2E_TRANSCRIPT names the
# file the transcript goes to.
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
BIN="${AEP_E2E_BIN:-${CARGO_TARGET_DIR:-$ROOT/rust/target}/$PROFILE}"
BINARIES="aep-base-node aep-lattice-log aep-ucb aep-ucb-validate aep-end-to-end-run aep-caw aep-caw-init"
CAW_PROFILE="compiled-runtime"
POLICY_DIR="$ROOT/AEP-Policy-System"
TRANSCRIPT="${AEP_E2E_TRANSCRIPT:-$HERE/END-TO-END-RUN.transcript.md}"
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
  if [ -z "${AEP_E2E_BIN:-}" ]; then
    ( cd "$ROOT" && cargo build $profile_flag -p aep-base-node --bins -p aep-ucb -p aep-end-to-end-run -p aep-caw -p aep-caw-init )
  fi
  for name in $BINARIES; do
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

if [ "$(id -u)" = 0 ]; then
  # The CAW starts no sandbox as root. Root builds the binaries, then the walk runs as
  # the user nobody from a folder of that user and the transcript comes back here.
  need_binaries
  W="$(mktemp -d /var/tmp/aep-e2e.XXXXXX)"
  mkdir -p "$W/bin"
  for name in $BINARIES; do
    cp "$BIN/$name" "$W/bin/$name"
  done
  chown -R 65534:65534 "$W"
  set +e
  setpriv --reuid=65534 --regid=65534 --clear-groups \
    env HOME="$W" TMPDIR="$W" PATH="$PATH" AEP_E2E_BIN="$W/bin" \
    AEP_E2E_TRANSCRIPT="$W/transcript.md" bash "$HERE/run.sh"
  code=$?
  set -e
  if [ -f "$W/transcript.md" ]; then
    cp "$W/transcript.md" "$TRANSCRIPT"
  fi
  rm -rf "$W"
  exit "$code"
fi
# shellcheck source=../../../AEP-CAWs-RustGvisor/proof/runsc-pin.env
. "$ROOT/AEP-CAWs-RustGvisor/proof/runsc-pin.env"
if [ ! -x "$RUNSC_BIN" ]; then
  log "the pinned gVisor is missing at $RUNSC_BIN: run sudo bash AEP-CAWs-RustGvisor/proof/install-runsc.sh"
  exit 1
fi

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

log "preparing the CAW"
# The GAP compiler writes the resolved profile records of the reference policies
# into the data folder. The CAW asks the validation dock of the kernel above
# before every command, signed with the key the kernel provisioned at boot.
node "$ROOT/AEP-Components/gap/lib/gap-compile.mjs" --materialize "$RUN_DIR" > /dev/null
mkdir -p "$RUN_DIR/workspace" "$RUN_DIR/outside" "$RUN_DIR/home"
echo "outside-the-workspace" > "$RUN_DIR/outside/secret"
cat > "$RUN_DIR/caw-framework/caw.toml" <<TOML
allowed_profiles = ["$CAW_PROFILE"]
runsc = "$RUNSC_BIN"
init = "$BIN/aep-caw-init"
base_node_data = "$RUN_DIR"
dock_socket = "$SOCK/validation"
TOML

# The dock gateway reads the manifest signer keys of the agents at start, so the
# key that signs the task manifest of the attach agent is registered first.
log "registering the manifest signer key of the attach agent"
"$BIN/aep-end-to-end-run" provision-manifest-signer "$RUN_DIR" "$ATTACH_AGENT"

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
AEP_E2E_CAW_BIN="$BIN/aep-caw" \
AEP_E2E_CAW_DATA="$RUN_DIR" \
AEP_E2E_CAW_PROFILE="$CAW_PROFILE" \
AEP_E2E_CAW_WORKSPACE="$RUN_DIR/workspace" \
AEP_E2E_CAW_OUTSIDE="$RUN_DIR/outside/secret" \
AEP_E2E_CAW_HOME="$RUN_DIR/home" \
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
