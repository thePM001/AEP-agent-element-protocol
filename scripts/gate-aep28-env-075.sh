#!/usr/bin/env bash
# CI: product version 2.8.5 is one string. Leftover Trust Rings stay archived.
# AEP28-ENV-075
# @PAD: aep28-env-075-version-ssot-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -e "$ROOT/AEP-Components/trust-rings" ]; then
  echo "[gate-aep28-env-075] leftover AEP-Components/trust-rings" >&2
  exit 1
fi
if [ ! -f "$ROOT/AEP-NOSHIP/retired/trust-rings/README.md" ]; then
  echo "[gate-aep28-env-075] archive missing AEP-NOSHIP/retired/trust-rings" >&2
  exit 1
fi
cargo test -p aep-base-node --test source_invariants version_ssot
echo "[gate-aep28-env-075] OK version 2.8.5 ssot and trust-rings archived"
