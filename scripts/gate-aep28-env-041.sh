#!/usr/bin/env bash
# CI: cargo test on standalone dynAEP crate. No slogan crate.
# AEP28-ENV-041
# @PAD: aep-dynaep-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-dynaep --lib
echo "[gate-aep28-env-041] OK standalone aep-dynaep"
