#!/usr/bin/env bash
# CI: envelope algebra plus live OPA / live 15-step / restricted Rego gate.
# AEP28-ENV-010
# @PAD: aep-envelope-algebra-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope-algebra --lib
cargo test -p aep-envelope-algebra-ci --lib
cargo run -q -p aep-envelope-algebra-ci -- \
  --filter "$ROOT/AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts" \
  --js "$ROOT/AEP-Components/admit/lib/admit.mjs" \
  --rs "$ROOT/AEP-Components/admit/crate/src/lib.rs"
echo "[gate-aep28-envelope-algebra] OK live OPA and live 15-step absent"
