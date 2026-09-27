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
# The Node suite runs only when the harness and at least one vitest file ship
# in the tree. Without them there is nothing to install or run while the manifest
# rows that name vitest have no runnable test yet.
if [ -f "$HARNESS/package.json" ] && find "$ROOT/AEP-Components/conformance/tests" -name '*.test.*' -print -quit | grep -q .; then
  if [ ! -d "$HARNESS/node_modules/vitest" ]; then
    echo "Installing local conformance harness (not npm registry distribution)..."
    npm install --prefix "$HARNESS" --no-save
  fi
  (cd "$HARNESS" && ./node_modules/.bin/vitest run)
else
  echo "SKIP Node integration checks: no harness package.json and no vitest files in the tree."
fi
echo

echo "== All conformance checks passed =="