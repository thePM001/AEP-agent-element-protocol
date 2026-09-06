#!/usr/bin/env bash
# CI: slogan CI crates are not workspace members. One tests/source_invariants.rs.
# AEP28-ENV-059
# @PAD: aep-source-invariants-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-admit-live-dock --lib
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-059] OK folded slogan CI crates; live dock has no unused wall inventory"
