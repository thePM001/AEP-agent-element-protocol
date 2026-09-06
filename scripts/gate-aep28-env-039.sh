#!/usr/bin/env bash
# CI: fail if product SDK lib.rs pub-uses run_meet or chain_meet_keeps_all_rows stays as a product evaluation test.
# AEP28-ENV-039
# @PAD: aep-sdk-run-meet-park-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-evaluation-chain --lib
cargo test --manifest-path internal-sdk/AEP-SDKs/rust/Cargo.toml --lib
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-039] OK run_meet parked off product SDK"
