#!/usr/bin/env bash
# CI: fail if frame header binding still joins fields with 0x7c or skips length prefix.
# AEP28-ENV-047
# @PAD: aep-frame-header-binding-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-047] OK length-prefixed frame header binding; delimiter 0x7c in ids is Deny"
