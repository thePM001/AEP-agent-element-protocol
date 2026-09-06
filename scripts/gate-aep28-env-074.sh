#!/usr/bin/env bash
# CI: compile wire sent_at freshness beside pulse hold. Fail if docking.rs keeps local copies.
# AEP28-ENV-074
# @PAD: aep28-env-074-wire-freshness-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node-pulse --lib
cargo run -q -p aep-base-node-pulse
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-074] OK wire sent_at freshness compiled beside pulse hold"
