#!/usr/bin/env bash
# CI: one kernel sequence and one SDK maturity table.
# AEP28-ENV-077
# @PAD: aep28-env-077-sdk-maturity-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants aep28_env_077
echo "[gate-aep28-env-077] OK kernel sequence and SDK maturity table"
