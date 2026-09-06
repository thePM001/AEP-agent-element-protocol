#!/usr/bin/env bash
# CI: fail if aep-lattice-log Record writes without dock Admit.
# AEP28-ENV-044
# @PAD: aep-lattice-log-record-admit-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-044] OK Record goes through dock Admit or is not a kernel write path"
