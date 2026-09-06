#!/usr/bin/env bash
# CI: docking.rs facade at most 500 lines. Five split modules exist. Wire clocks from pulse crate.
# AEP28-ENV-079
# @PAD: aep28-env-079-dock-split-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SRC="$ROOT/AEP-Base-Node/crate/src"
for f in dock_freshness.rs dock_pulse.rs dock_rate.rs dock_serve.rs dock_apply.rs; do
  if [ ! -f "$SRC/$f" ]; then
    echo "[gate-aep28-env-079] missing $f" >&2
    exit 1
  fi
done
if [ ! -f "$SRC/docking.rs" ]; then
  echo "[gate-aep28-env-079] missing docking.rs" >&2
  exit 1
fi
lines=$(wc -l < "$SRC/docking.rs")
if [ "$lines" -gt 500 ]; then
  echo "[gate-aep28-env-079] docking.rs has $lines lines, cap is 500" >&2
  exit 1
fi
if grep -E -q '^[[:space:]]*const[[:space:]]+MAX_FRAME_AGE_SECS' "$SRC/docking.rs" "$SRC/dock_freshness.rs"; then
  echo "[gate-aep28-env-079] local MAX_FRAME_AGE_SECS const" >&2
  exit 1
fi
if grep -E -q '^[[:space:]]*const[[:space:]]+MAX_FRAME_FUTURE_SKEW_SECS' "$SRC/docking.rs" "$SRC/dock_freshness.rs"; then
  echo "[gate-aep28-env-079] local MAX_FRAME_FUTURE_SKEW_SECS const" >&2
  exit 1
fi
if ! grep -q 'MAX_FRAME_AGE_SECS' "$SRC/docking.rs"; then
  echo "[gate-aep28-env-079] docking.rs does not name MAX_FRAME_AGE_SECS" >&2
  exit 1
fi
if ! grep -q 'aep_base_node_pulse' "$SRC/docking.rs"; then
  echo "[gate-aep28-env-079] docking.rs does not name aep_base_node_pulse" >&2
  exit 1
fi
if ! grep -q 'fn handle_frame' "$SRC/docking.rs"; then
  echo "[gate-aep28-env-079] handle_frame left the facade" >&2
  exit 1
fi
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-079] OK docking facade split with pulse-crate wire clocks"
