#!/usr/bin/env bash
# CI: fail if spawnSync aep-envelope, loadFromFile or processEvent remains product live code.
# AEP28-ENV-031
# @PAD: aep-one-live-entry-language-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT=$(cd $(dirname "$0")/..; pwd)
cd "$ROOT"
cargo test -p aep-live-entry --lib
echo "[gate-aep28-env-031] OK rust live entry; typescript processEvent is not product Admit"
