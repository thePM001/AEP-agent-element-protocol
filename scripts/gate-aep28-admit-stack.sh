#!/usr/bin/env bash
# One stack for AEP 2.8 Admit tickets 1-5.
# @PAD: aep28-admit-stack-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/gate-hyperlattice-ssot.sh"
bash "$ROOT/scripts/gate-admit-parity.sh"
cargo test -p aep-admit-opa-sole --lib
cargo run -q -p aep-admit-opa-sole -- --js "$ROOT/AEP-Components/admit/lib/admit.mjs" --rs "$ROOT/AEP-Components/admit/crate/src/lib.rs" --opa "$ROOT/AEP-Components/dynAEP/policies/lattice-policy.rego" --filter "$ROOT/AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"
bash "$ROOT/scripts/gate-dynaep-live-crossing-e2e.sh"
bash "$ROOT/scripts/gate-aep28-envelope-algebra.sh"
bash "$ROOT/scripts/gate-aep28-env-013.sh"
bash "$ROOT/scripts/gate-aep28-env-014.sh"
echo "[gate-aep28-admit-stack] OK"
cargo test -p aep-envelope-walls --lib
cargo run -q -p aep-envelope-walls -- --rego "$ROOT/AEP-Components/dynAEP/policies/lattice-policy.rego" --filter "$ROOT/AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"
cargo test -p aep-admit-channel-order-walls
