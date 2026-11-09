#!/usr/bin/env bash
# AEP 2.9 public-tier conformance runner.
# Usage: AEP-Components/conformance/runner/run.sh [repo-root]
#
# Runs every check the manifest lists and fails unless each one ran and passed.
# Checks in the manifest planned list run nowhere and carry no compliance claim.
# Needs cargo and node 22 with npm. The language neutral vectors also run
# here: once against the Rust kernel, which is normative, once through the
# TypeScript helpers and once through the example third-party runner, which
# needs no Rust toolchain.
set -euo pipefail

ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
CONF="$ROOT/AEP-Components/conformance"
MANIFEST="$CONF/tests/manifest.json"
HARNESS="$CONF/harness"
CHECK="$CONF/runner/manifest-check.mjs"
cd "$ROOT"

REPORTS="$(mktemp -d)"
trap 'rm -rf "$REPORTS"' EXIT
: > "$REPORTS/ran.txt"

echo "== AEP 2.9 conformance runner =="
echo "Root: $ROOT"
echo

echo "-- Manifest --"
node "$CHECK" validate "$MANIFEST"
echo "manifest ok"
echo

echo "-- Build release binaries --"
cargo build --release -p aep-base-node -p aep-conformance -p aep-lattice-memory
TARGET_DIR="$(cargo metadata --format-version 1 --no-deps \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).target_directory))')"
BIN="$TARGET_DIR/release"
export AEP_LATTICE_LOG_BIN="$BIN/aep-lattice-log"
export AEP_MEMORY_CLI="$BIN/aep-memory"
echo

echo "-- Kernel checks (aep-conformance) --"
"$BIN/aep-conformance" > "$REPORTS/rust-report.json"
echo

echo "-- cargo test checks --"
while IFS=$'\t' read -r ids args; do
  [ -n "$ids" ] || continue
  echo "$ids: cargo test --release $args"
  # The manifest holds the argument list, one word per argument.
  read -r -a argv <<< "$args"
  cargo test --release "${argv[@]}"
  echo "$ids" >> "$REPORTS/ran.txt"
done < <(node "$CHECK" cargo-tests "$MANIFEST")
echo

echo "-- node checks --"
while IFS=$'\t' read -r ids file; do
  [ -n "$ids" ] || continue
  echo "$ids: node $file"
  node "$ROOT/$file" "$ROOT"
  echo "$ids" >> "$REPORTS/ran.txt"
done < <(node "$CHECK" node-checks "$MANIFEST")
echo

echo "-- Kernel fixtures for the vitest checks --"
# The operator provision step mints the sign key of the agent the CC-15 frame
# builder signs as. HOME and AEP_DATA stay inside the report folder.
FIXTURES="$REPORTS/fixtures"
mkdir -p "$FIXTURES"
chmod 700 "$FIXTURES"
HOME="$FIXTURES" AEP_DATA="$FIXTURES" "$BIN/aep-base-node" \
  --lattice-db "$FIXTURES/action-lattice.db" \
  --provision-agent-sign-key --agent-id AG-CONF-15 > "$FIXTURES/provision-AG-CONF-15.txt"
export AEP_CONFORMANCE_FIXTURES="$FIXTURES"
echo "provisioned AG-CONF-15 in $FIXTURES"
echo

echo "-- vitest checks and TypeScript vectors --"
if [ ! -x "$HARNESS/node_modules/.bin/vitest" ]; then
  echo "Installing the local harness from its lock file (not a registry distribution)..."
  npm ci --prefix "$HARNESS" --no-audit --no-fund
fi
"$HARNESS/node_modules/.bin/vitest" run --config "$HARNESS/vitest.config.mjs" \
  --reporter=default --reporter=json --outputFile.json="$REPORTS/vitest-report.json"
echo

echo "-- Vectors against the Rust kernel (normative) --"
"$BIN/aep-conformance" vectors "$CONF/vectors/v1" > "$REPORTS/vectors-rust.json"
echo

echo "-- Vectors through the example third-party runner (no Rust) --"
node "$CONF/vectors/examples/third-party-runner/run-vectors.mjs" \
  --vectors "$CONF/vectors/v1" \
  --require dock-socket,dock-request,dock-answer,mesh-mode
echo

echo "-- Accounting --"
node "$CHECK" account "$MANIFEST" "$REPORTS"
echo
echo "== All conformance checks passed =="
