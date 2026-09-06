#!/usr/bin/env bash
# CI: fail if banner version, workspace.package.version and CHANNEL_VERSION disagree.
# AEP28-ENV-029
set -euo pipefail
ROOT=$(cd $(dirname "$0")/..; pwd)
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-029] OK one version string"
