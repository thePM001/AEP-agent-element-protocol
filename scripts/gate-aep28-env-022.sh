#!/usr/bin/env bash
# CI: fail if processEvent still calls sequential TypeScript deniers after Admit.
# AEP28-ENV-022
# @PAD: aep-no-sequential-ts-deny-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT=$(cd $(dirname "$0")/..; pwd)
cd "$ROOT"
cargo test -p aep-no-sequential-ts-deny --lib
cargo run -q -p aep-no-sequential-ts-deny
echo "[gate-aep28-env-022] OK no sequential TypeScript deny after Admit"
