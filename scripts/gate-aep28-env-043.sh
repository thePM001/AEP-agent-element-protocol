#!/usr/bin/env bash
# CI: fail if parent closure still leaks across agents.
# AEP28-ENV-043
# @PAD: aep-satisfied-actions-partition-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test --manifest-path internal-sdk/instruction-crates/satisfied-actions-partition/crate/Cargo.toml --lib
cargo run -q --manifest-path internal-sdk/instruction-crates/satisfied-actions-partition/crate/Cargo.toml
cargo test -p aep-envelope --lib
cargo test -p aep-dynaep --lib
cargo test -p aep-live-entry --lib
cargo test -p aep-admit-channel-order-walls --lib
echo "[gate-aep28-env-043] OK parent closure is partitioned by agent or session"
