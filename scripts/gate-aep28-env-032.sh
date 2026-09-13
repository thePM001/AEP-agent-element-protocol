#!/usr/bin/env bash
# CI: fail if a product Admit wall crate is a workspace member and not on the live dock path.
# AEP28-ENV-032
# @PAD: aep-admit-live-dock-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-admit-live-dock --lib
cargo test -p aep-envelope-walls --lib
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-032] OK live dock collect-all; product walls on live dock"
