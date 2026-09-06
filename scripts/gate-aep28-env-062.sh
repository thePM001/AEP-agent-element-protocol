#!/usr/bin/env bash
# CI: fail if AgentMesh docs sell zero-trust mesh attestation for a local cert
# AEP28-ENV-062
# @PAD: aep-agentmesh-local-issuance-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-agentmesh-local-issuance --lib
cargo run -q -p aep-agentmesh-local-issuance
echo "[gate-aep28-env-062] OK AgentMesh docs say local issuance"
