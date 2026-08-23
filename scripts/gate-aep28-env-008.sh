#!/usr/bin/env bash
# CI: envelope algebra order, collect-all and Apply skip.
# @PAD: aep-envelope-algebra-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope-algebra --lib
echo "[gate-aep28-env-008] OK crate order collect-all and Apply skip"
