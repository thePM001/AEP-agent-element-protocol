#!/usr/bin/env bash
# CI: envelope algebra plus live OPA / live 15-step / restricted Rego gate.
# AEP28-ENV-010
# @PAD: aep-envelope-algebra-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-envelope-algebra] OK live OPA and live 15-step absent"
