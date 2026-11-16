#!/usr/bin/env bash
# Dock acceptance of the CAW: the kernel dock client is admitted by a live Base Node
# and refused when the Base Node is stopped or does not grant the ping.
# Usage: dock-acceptance.sh <path to aep-base-node> <path to caw-dock-proof>
# Starts one Base Node in a temporary folder with the lattice and the hub grant of
# proof/dock-deployment. Prints one line per check: CHECK <name> PASS|FAIL <detail>.
# Exit 0 only when every check holds.
set -uo pipefail

NODE="${1:?path to aep-base-node}"
PROOF="${2:?path to caw-dock-proof}"
HERE="$(cd "$(dirname "$0")" && pwd)"
POLICY_DIR="$(cd "$HERE/../.." && pwd)/AEP-Policy-System"

RUN="$(mktemp -d /var/tmp/caw-dock.XXXXXX)"
PID=""
cleanup() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; fi
  rm -rf "$RUN"
}
trap cleanup EXIT

FAILED=0
pass() { echo "CHECK $1 PASS $2"; }
fail() {
  FAILED=$((FAILED + 1))
  echo "CHECK $1 FAIL $2"
}

# start_node <folder> <with grant: yes|no>
start_node() {
  local dir="$1" grant="$2"
  mkdir -p "$dir/sockets" "$dir/ucb/manifests" "$dir/gap/policies/reference"
  cat > "$dir/base-node.json" <<JSON
{
  "version": "2.9",
  "base_node": {
    "socket_base": "$dir/sockets",
    "lattice_db": "$dir/action-lattice.db",
    "lrps": ["dynaep-action-lattice", "lattice-channel-default"],
    "internet_up": true
  }
}
JSON
  cp "$HERE/dock-deployment/lattice.yaml" "$dir/lattice.yaml"
  if [ "$grant" = yes ]; then
    cp "$HERE"/dock-deployment/gap/*.gap "$dir/gap/policies/reference/"
  fi
  AEP_DATA="$dir" AEP_SOCKET_BASE="$dir/sockets" AEP_TASK_MANIFEST_DIR="$dir/ucb/manifests" \
    AEP_POLICY_SYSTEM_DIR="$POLICY_DIR" DATA_DOCK_HOST=127.0.0.1 DATA_DOCK_PORT=0 \
    "$NODE" --daemon --config "$dir/base-node.json" > "$dir/base-node.log" 2>&1 &
  PID=$!
  for _ in $(seq 1 100); do
    if [ -S "$dir/sockets/validation" ]; then return 0; fi
    sleep 0.2
  done
  echo "the validation dock did not listen, end of the log:"
  tail -n 15 "$dir/base-node.log"
  return 1
}

stop_node() {
  if [ -n "$PID" ]; then kill "$PID" 2>/dev/null; wait "$PID" 2>/dev/null; fi
  PID=""
}

# ask <name> <folder> <want exit> <want text>
ask() {
  local name="$1" dir="$2" want_exit="$3" want_text="$4"
  local out
  out="$("$PROOF" "$dir" "$dir/sockets/validation" 2>&1)"
  local code=$?
  if [ "$code" = "$want_exit" ] && printf '%s' "$out" | grep -q -F -- "$want_text"; then
    pass "$name" "$(printf '%s' "$out" | head -1 | cut -c1-120)"
  else
    fail "$name" "exit $code, want $want_exit with: $want_text"
    printf '%s\n' "$out" | sed 's/^/    /' | head -6
    tail -n 8 "$dir/base-node.log" 2>/dev/null | sed 's/^/    log: /' | cut -c1-240
  fi
}

A="$RUN/granted"
if start_node "$A" yes; then
  ask live-node-admits-the-ping "$A" 0 "ADMITTED"
  ask second-ping-is-admitted-too "$A" 0 "ADMITTED"
  stop_node
  ask stopped-node-refuses "$A" 1 "REFUSED no validation dock"
else
  fail live-node-admits-the-ping "the Base Node did not start"
fi

B="$RUN/not-granted"
if start_node "$B" no; then
  ask node-without-the-grant-refuses "$B" 1 "REFUSED the validation dock refused the ping"
  stop_node
else
  fail node-without-the-grant-refuses "the Base Node did not start"
fi

C="$RUN/never-booted"
mkdir -p "$C/sockets"
ask folder-without-keys-refuses "$C" 1 "REFUSED the Base Node has no dock key"

echo
if [ "$FAILED" = 0 ]; then
  echo "dock-acceptance: every check holds"
  exit 0
fi
echo "dock-acceptance: $FAILED check or checks do not hold"
exit 1
