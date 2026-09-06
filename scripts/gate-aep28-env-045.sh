#!/usr/bin/env bash
# CI: fail if default lattice_db is tmp or a world-writable parent is accepted without a test flag.
# AEP28-ENV-045
# @PAD: aep-lattice-db-parent-guard-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-045] OK default lattice_db off tmp; world-writable parent refused unless test flag"
