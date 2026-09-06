#!/usr/bin/env bash
# CI: named kernel files have no non-test Result with String.
# AEP28-ENV-081
# @PAD: aep28-env-081-thiserror-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

FILES=(
  "AEP-Base-Node/crate/src/docking.rs"
  "AEP-Base-Node/crate/src/dock_freshness.rs"
  "AEP-Base-Node/crate/src/dock_pulse.rs"
  "AEP-Base-Node/crate/src/dock_rate.rs"
  "AEP-Base-Node/crate/src/dock_serve.rs"
  "AEP-Base-Node/crate/src/dock_apply.rs"
  "AEP-Base-Node/crate/src/dock_keys.rs"
  "AEP-Base-Node/crate/src/envelope_admit.rs"
  "AEP-Base-Node/crate/src/lattice_log.rs"
  "AEP-Base-Node/crate/src/task_manifest.rs"
  "AEP-Base-Node/crate/src/main.rs"
  "AEP-Base-Node/crate/src/lib.rs"
  "AEP-Components/live-entry/crate/src/lib.rs"
  "AEP-Components/evaluation-chain/crate/src/lib.rs"
)

strip_tests() {
  perl -0777 -e '
    local $_ = do { local $/; <> };
    1 while s/#\[cfg\(test\)\]\s*(?:pub\s+)?mod\s+\w+\s*(\{(?:[^{}]++|(?1))*\})//s;
    print;
  ' "$1"
}

fail=0
for rel in "${FILES[@]}"; do
  src="$ROOT/$rel"
  if [ ! -f "$src" ]; then
    echo "[gate-aep28-env-081] skip missing $rel"
    continue
  fi
  body="$(strip_tests "$src")"
  if printf '%s' "$body" | grep -E -n 'Result<[^>]*,[[:space:]]*String>' >/dev/null; then
    echo "[gate-aep28-env-081] non-test Result with String in $rel" >&2
    printf '%s' "$body" | grep -E -n 'Result<[^>]*,[[:space:]]*String>' >&2 || true
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  exit 1
fi

if ! grep -q 'pub enum BaseNodeError' "$ROOT/AEP-Base-Node/crate/src/error.rs"; then
  echo "[gate-aep28-env-081] missing BaseNodeError enum" >&2
  exit 1
fi
if ! grep -q 'thiserror.workspace = true' "$ROOT/AEP-Base-Node/crate/Cargo.toml"; then
  echo "[gate-aep28-env-081] base node Cargo.toml lacks thiserror" >&2
  exit 1
fi
if ! grep -q 'pub enum LiveEntryError' "$ROOT/AEP-Components/live-entry/crate/src/lib.rs"; then
  echo "[gate-aep28-env-081] missing LiveEntryError enum" >&2
  exit 1
fi
if ! grep -q 'thiserror.workspace = true' "$ROOT/AEP-Components/live-entry/crate/Cargo.toml"; then
  echo "[gate-aep28-env-081] live-entry Cargo.toml lacks thiserror" >&2
  exit 1
fi
if ! grep -q 'pub enum EvaluationChainError' "$ROOT/AEP-Components/evaluation-chain/crate/src/lib.rs"; then
  echo "[gate-aep28-env-081] missing EvaluationChainError enum" >&2
  exit 1
fi
if ! grep -q 'thiserror.workspace = true' "$ROOT/AEP-Components/evaluation-chain/crate/Cargo.toml"; then
  echo "[gate-aep28-env-081] evaluation-chain Cargo.toml lacks thiserror" >&2
  exit 1
fi

cargo test -p aep-base-node --lib
cargo test -p aep-live-entry --lib
cargo test -p aep-evaluation-chain --lib
echo "[gate-aep28-env-081] OK named kernel files use thiserror"
