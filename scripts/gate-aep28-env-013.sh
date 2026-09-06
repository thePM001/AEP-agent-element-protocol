#!/usr/bin/env bash
# CI: fail if filterCrossing still calls latticeFilter.filterAsync when AEP_LAB_LATTICE_FILTER is on.
# AEP28-ENV-013
# @PAD: aep-live-crossing-lab-off-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-013] OK live lab filter absent on filterCrossing"
