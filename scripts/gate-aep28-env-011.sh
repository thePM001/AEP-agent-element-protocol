#!/usr/bin/env bash
# CI: journals after product tickets land.
# AEP28-ENV-011
# AEP28-ENV-040: aep-envelope-journals is not a product workspace package.
# Journals run via nla-policy-scan on AEP-Base-Node/crate.
# @PAD: aep-envelope-journals-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
bash "$ROOT/scripts/gate-aep28-env-040.sh"
echo "[gate-aep28-env-011] OK journals crate is not a product workspace member"
