#!/usr/bin/env bash
# CI: fail if named surfaces still refuse to run
# AEP28-ENV-057
# @PAD: aep-named-surfaces-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-057] OK named surfaces execute"
