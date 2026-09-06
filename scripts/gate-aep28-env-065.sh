#!/usr/bin/env bash
# CI: fail if Base Node still Admits immediately or drift is widened to pulse length.
# AEP28-ENV-065
# @PAD: aep-base-node-pulse-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node-pulse --lib
cargo run -q -p aep-base-node-pulse
cargo test -p aep-live-entry --lib
cargo test -p aep-envelope --lib
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-065] OK Base Node 1000 ms tic tac pulse with freeze-at-seal"
