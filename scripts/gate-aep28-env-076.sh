#!/usr/bin/env bash
# CI: ClosedWall carries class. EPSCOM stays 255. docking.rs stays one file.
# AEP28-ENV-076
# @PAD: aep28-env-076-closed-wall-class-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SRC="$ROOT/AEP-Components/wall-set-backpressure/crate/src/lib.rs"
if ! grep -q 'pub class: String' "$SRC"; then
  echo "[gate-aep28-env-076] ClosedWall lacks class" >&2
  exit 1
fi
if [ -d "$ROOT/AEP-Base-Node/crate/src/docking" ]; then
  echo "[gate-aep28-env-076] docking.rs split too early" >&2
  exit 1
fi
if [ ! -f "$ROOT/AEP-Base-Node/crate/src/docking.rs" ]; then
  echo "[gate-aep28-env-076] docking.rs missing" >&2
  exit 1
fi
if ! grep -q 'pub const EPSCOM_PRIORITY: u8 = 255' "$ROOT/AEP-Base-Node/crate/src/lib.rs"; then
  echo "[gate-aep28-env-076] EPSCOM_PRIORITY is not 255" >&2
  exit 1
fi
if ! grep -qiF 'writing walls govern output shape and are not transport security' "$ROOT/README.md"; then
  echo "[gate-aep28-env-076] README missing writing-wall instruction" >&2
  exit 1
fi
cargo test -p aep-wall-set-backpressure --lib
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-076] OK ClosedWall class and EPSCOM 255"
