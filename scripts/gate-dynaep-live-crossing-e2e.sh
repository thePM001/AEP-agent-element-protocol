#!/usr/bin/env bash
# CI: live crossing collect-all then OPA then Apply. Skip Apply when Admit fails.
# @PAD: aep-dynaep-live-crossing-e2e-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-dynaep-live-crossing-e2e --lib
cargo test -p aep-admit --lib
echo "[gate-dynaep-live-crossing-e2e] OK crate collect-all and skip Apply"
