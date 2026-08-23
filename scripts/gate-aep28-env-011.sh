#!/usr/bin/env bash
# CI: journals after product tickets land.
# AEP28-ENV-011
# @PAD: aep-envelope-journals-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope-journals --lib
cargo run -q -p aep-envelope-journals -- --root "$ROOT/AEP-Components"
echo "[gate-aep28-env-011] OK product wave landed; journals allowed on Admit crate"
