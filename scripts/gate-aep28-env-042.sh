#!/usr/bin/env bash
# CI: fail if wall_dag or wall_agent_may still opens on an empty node map.
# AEP28-ENV-042
# @PAD: aep-empty-lattice-close-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
cargo test -p aep-live-entry --lib
echo "[gate-aep28-env-042] OK empty lattice closes dag.membership and gap.agent_may"
