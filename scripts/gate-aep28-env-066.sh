#!/usr/bin/env bash
# CI: fail if unbound scene, channel, time or sequence still allow Admit.
# AEP28-ENV-066
# @PAD: aep-unbound-field-close-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-unbound-field-close --lib
cargo run -q -p aep-unbound-field-close
cargo test -p aep-envelope --lib
cargo test -p aep-dynaep --lib
cargo test -p aep-admit-temporal-bounds --lib
echo "[gate-aep28-env-066] OK unbound scene, channel, time and sequence close"
