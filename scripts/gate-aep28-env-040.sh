#!/usr/bin/env bash
# CI: fail if aep-envelope-journals is a workspace package.
# AEP28-ENV-040
# @PAD: aep-envelope-journals-drop-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test --manifest-path retired-archive/instruction-crates/envelope-journals-drop/crate/Cargo.toml --lib
cargo run -q --manifest-path retired-archive/instruction-crates/envelope-journals-drop/crate/Cargo.toml
echo "[gate-aep28-env-040] OK envelope-journals is not a workspace package"
