#!/usr/bin/env bash
# CI: fail if README counts the library as 120-plus or by folder count
# AEP28-ENV-058
# @PAD: aep-library-layer-count-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-058] OK README counts the library by the layer table"
