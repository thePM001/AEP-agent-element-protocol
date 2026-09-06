#!/usr/bin/env bash
# CI: fail if advertised AEP-NOSHIP/AEP-SDKs/python tree or lattice client is missing
# AEP28-ENV-060
# @PAD: aep-python-sdk-path-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-python-sdk-path --lib
cargo run -q -p aep-python-sdk-path
echo "[gate-aep28-env-060] OK advertised SDK path ships a client"
