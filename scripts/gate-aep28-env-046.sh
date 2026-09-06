#!/usr/bin/env bash
# CI: fail if first-mint still issues agent sign keys.
# AEP28-ENV-046
# @PAD: aep-agent-sign-key-provision-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-046] OK mint only via operator provision; first-mint is not the issuer"
