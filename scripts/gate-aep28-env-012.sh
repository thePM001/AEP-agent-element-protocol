#!/usr/bin/env bash
# CI: wrap when lattice governance is disabled.
# AEP28-ENV-012
# @PAD: aep-envelope-wrap-disabled-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope-wrap-disabled --lib
cargo run -q -p aep-envelope-wrap-disabled -- --bridge "$ROOT/AEP-SDKs/typescript/dynaep/src/bridge.ts"
echo "[gate-aep28-env-012] OK wrap on disabled governance"
