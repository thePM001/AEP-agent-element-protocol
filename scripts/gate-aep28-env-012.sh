#!/usr/bin/env bash
# CI: wrap when lattice governance is disabled.
# AEP28-ENV-012
# @PAD: aep-envelope-wrap-disabled-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-012] OK wrap on disabled governance"
