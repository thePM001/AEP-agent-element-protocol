#!/usr/bin/env bash
# CI: fail if extra_walls conversion or a second id vocabulary remains.
# AEP28-ENV-049
# @PAD: aep-one-admit-id-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
cargo test -p aep-envelope --lib
cargo test -p aep-live-entry --lib
cargo test -p aep-dynaep --lib
cargo test -p aep-one-live-evaluation --lib
cargo test -p aep-base-node --test source_invariants
echo "[gate-aep28-env-049] OK one Admit function and one id vocabulary"
