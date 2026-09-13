#!/usr/bin/env bash
# CI: fail if envelope_admit.rs calls both live_collect_all and process_event Admit on the same plaintext.
# AEP28-ENV-037
# @PAD: aep-one-live-evaluation-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope --lib
cargo test -p aep-live-entry --lib
cargo test -p aep-admit-live-dock --lib
cargo test -p aep-one-live-evaluation --lib
cargo run -q -p aep-one-live-evaluation
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-037] OK one live evaluation; dual combinator fails"
