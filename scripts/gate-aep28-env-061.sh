#!/usr/bin/env bash
# CI: fail if dock allow still falls through to ordinary fetch
# AEP28-ENV-061
# @PAD: aep-lattice-gated-fetch-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-lattice-gated-fetch --lib
cargo run -q -p aep-lattice-gated-fetch
echo "[gate-aep28-env-061] OK after dock allow bound http not ordinary fetch"
