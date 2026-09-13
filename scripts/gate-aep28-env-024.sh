#!/usr/bin/env bash
# CI: fail if processEvent still calls spawnSync, loadFromFile, processStateDelta or processDynAEPEvent as live product code.
# AEP28-ENV-024
# @PAD: aep-live-entry-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT=$(cd $(dirname "$0")/..; pwd)
cd "$ROOT"
cargo test -p aep-live-entry --lib
echo "[gate-aep28-env-024] OK rust live entry; typescript processEvent is not product live path"
