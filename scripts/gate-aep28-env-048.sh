#!/usr/bin/env bash
# CI: fail if dock request path still aborts on poisoned locks.
# AEP28-ENV-048
# @PAD: aep-dock-request-poison-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-dock-request-poison --lib
cargo run -q -p aep-dock-request-poison
cargo test -p aep-base-node --lib docking
echo "[gate-aep28-env-048] OK dock request returns ok false on poisoned locks"
