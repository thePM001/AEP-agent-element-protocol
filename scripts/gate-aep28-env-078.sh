#!/usr/bin/env bash
# CI: official public run sequence. GitHub is a public mirror.
# AEP28-ENV-078
# @PAD: aep28-env-078-official-run-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [ -d "$ROOT/.github" ]; then
  echo "[gate-aep28-env-078] root GitHub workflow directory is present" >&2
  exit 1
fi
cargo test -p aep-base-node --lib
echo "[gate-aep28-env-078] OK official public run sequence. GitHub is a public mirror"
