#!/usr/bin/env bash
# CI: fail if EPSCOM trust bundle claims ML-DSA while mode is sha256-structure
# AEP28-ENV-063
# @PAD: aep-epscom-trust-bundle-mode-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-epscom-trust-bundle-mode --lib
cargo run -q -p aep-epscom-trust-bundle-mode
echo "[gate-aep28-env-063] OK EPSCOM trust bundle does not claim ML-DSA on sha256-structure"
