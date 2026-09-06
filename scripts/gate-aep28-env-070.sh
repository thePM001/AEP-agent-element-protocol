#!/usr/bin/env bash
# CI: fail if dock Deny still ships only a joined error string.
# AEP28-ENV-070
# @PAD: aep-wall-set-backpressure-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-wall-set-backpressure --lib
cargo run -q -p aep-wall-set-backpressure
cargo test -p aep-live-entry --lib
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-070] OK wall-set backpressure"
