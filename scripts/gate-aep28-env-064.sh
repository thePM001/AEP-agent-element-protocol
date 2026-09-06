#!/usr/bin/env bash
# CI: fail if CAW CVE demo trees remain in the attachable component set
# AEP28-ENV-064
# @PAD: aep-caw-cve-demo-trees-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-caw-cve-demo-trees --lib
cargo run -q -p aep-caw-cve-demo-trees
echo "[gate-aep28-env-064] OK CAW CVE demo trees are out of the attachable component set"
