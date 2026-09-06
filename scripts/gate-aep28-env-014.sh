#!/usr/bin/env bash
# CI: fail if processEvent still has else-if labLatticeFilterEnabled that runs filterAsync with no Admit walls.
# AEP28-ENV-014
# @PAD: aep-process-event-admit-walls-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT=$(cd $(dirname "$0")/..; pwd)
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-014] OK processEvent Admit walls"
