#!/usr/bin/env bash
# CI: fail if Slack or Jira skip UCB real clients
# AEP28-ENV-054
# @PAD: aep-connector-ucb-clients-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-054] OK Slack and Jira real clients through UCB"
