#!/usr/bin/env bash
# CI: fail if dock client still treats enqueue as Admit.
# AEP28-ENV-071
# @PAD: aep-dock-post-beat-collect-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-dock-post-beat-collect --lib
cargo run -q -p aep-dock-post-beat-collect
cargo test -p aep-base-node --lib
cargo check -p aep-ucb
echo "[gate-aep28-env-071] OK dock post-beat collect"
