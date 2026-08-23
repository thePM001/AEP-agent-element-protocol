#!/usr/bin/env bash
# CI: journals after residual wrap tickets land.
# AEP28-ENV-016
# @PAD: aep-envelope-wrap-journals-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope-wrap-journals --lib
echo "[gate-aep28-env-016] lib tests ran"
