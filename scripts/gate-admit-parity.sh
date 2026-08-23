#!/usr/bin/env bash
# @PAD: aep-admit-parity-gate-v1
# @GCDE: gaplune.policy.v1
# CI job: Rust aep-admit versus admit.mjs on shared fixtures. Fail on mismatch.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
FIXTURES="${ROOT}/AEP-Components/admit/crate/fixtures"
JS="${ROOT}/AEP-Components/admit/lib/admit.mjs"

if ! command -v node >/dev/null 2>&1; then
  echo "gate-admit-parity: node is required" >&2
  exit 1
fi
if ! command -v cargo >/dev/null 2>&1; then
  echo "gate-admit-parity: cargo is required" >&2
  exit 1
fi

cargo test -p aep-admit --lib
cargo test -p aep-admit-parity --lib
cargo run -q -p aep-admit-parity -- --fixtures "$FIXTURES" --js "$JS"
echo "[gate-admit-parity] OK rust matches JS on shared fixtures"
