#!/usr/bin/env bash
# CI: live processEvent rejection is Admit collect-all walls then Apply.
# AEP28-ENV-015
# @PAD: aep-live-crossing-reject-copy-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-live-crossing-reject-copy --lib
cargo run -q -p aep-live-crossing-reject-copy -- --bridge "$ROOT/AEP-SDKs/typescript/dynaep/src/bridge.ts"
echo "[gate-aep28-env-015] OK live reject copy"
