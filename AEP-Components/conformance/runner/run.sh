#!/usr/bin/env bash
# AEP 2.8 public-tier conformance runner.
# Usage: ./conformance/runner/run.sh [repo-root]
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
HARNESS="$ROOT/AEP-Components/conformance/harness"
cd "$ROOT"

echo "== AEP 2.8 conformance runner (Phase 8) =="
echo "Root: $ROOT"
echo

echo "-- Build release binaries for integration checks --"
cargo build --release -p aep-base-node -p aep-conformance
echo

echo "-- Rust mandatory checks (aep-conformance CC-01..CC-14) --"
cargo run --release -p aep-conformance
echo

echo "-- writing.gap documentation lint (CC-16) --"
node "$ROOT/AEP-Components/conformance/runner/lint-writing-gap.mjs" "$ROOT"
echo

echo "-- Node integration checks (vitest tests/conformance/) --"
if [ ! -d "$HARNESS/node_modules/vitest" ]; then
  echo "Installing local conformance harness (not npm registry distribution)..."
  npm install --prefix "$HARNESS" --no-save 2>/dev/null || npm install --prefix "$HARNESS"
fi
(cd "$HARNESS" && ./node_modules/.bin/vitest run)
echo

echo "== All conformance checks passed =="