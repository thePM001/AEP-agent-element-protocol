#!/usr/bin/env bash
# Runs every proof script of the CAW inside the caw-proof target of the image, with
# the pinned runsc and the programs of the image, as the user of the image.
# The CI job caw-gvisor runs the same scripts on a host.
# Exit 0 only when every proof script holds.
set -uo pipefail

if [ "$(id -u)" = 0 ]; then
  echo "aep-caw-proof: run as the user of the image, not as root"
  exit 2
fi

RUNSC=/usr/bin/runsc
BIN=/usr/local/bin
PROOF_BIN=/usr/local/lib/aep-caw-proof
CAW=/opt/aep/AEP-CAWs-RustGvisor
RESTRICTED="$CAW/aep-caw-policy/tests/fixtures/restricted.json"

FAILED=""
prove() {
  local name="$1"
  shift
  echo "== $name"
  if bash "$CAW/proof/$name.sh" "$@"; then
    echo "== $name holds"
  else
    echo "== $name FAILED"
    FAILED="$FAILED $name"
  fi
  echo
}

prove gvisor-facts "$RUNSC" "$PROOF_BIN/caw-trace-proof"
prove dock-acceptance "$BIN/aep-base-node" "$PROOF_BIN/caw-dock-proof"
prove core-acceptance "$RUNSC" "$PROOF_BIN/caw-run-proof" "$RESTRICTED" "$BIN/aep-caw-init" \
  "$BIN/aep-caw" "$CAW/proof/fixtures/egress-proof.json" "$BIN/aep-base-node"
prove hostile-corpus "$RUNSC" "$PROOF_BIN/caw-run-proof" "$RESTRICTED" "$BIN/aep-caw-init"
prove ede-pairing "$RUNSC" "$PROOF_BIN/caw-run-proof" "$CAW/proof/fixtures/ede-draft-proof.json" \
  "$BIN/aep-caw-init" /opt/rust/toolchain

if [ -z "$FAILED" ]; then
  echo "aep-caw-proof: every proof script holds"
  exit 0
fi
echo "aep-caw-proof: failed:$FAILED"
exit 1
