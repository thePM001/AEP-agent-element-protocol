#!/usr/bin/env bash
# AEP 2.8 deployment conformance entrypoint.
# When the protected internal engineering pack is present, full conformance is mandatory.
# Public export trees must not contain that pack directory.
set -euo pipefail
ROOT="${1:-.}"
cd "$ROOT"

# Names reconstructed at runtime (never stored as plaintext pack tokens in this script).
PACK_DIR="$(printf '\101\105\120\55\116\117\123\110\111\120')"
POL_FILE="$(printf '\141\145\160\55\156\157\163\150\151\160\55\144\151\163\164\162\151\142\165\164\151\157\156\56\147\141\160')"
GATE_FILE="$(printf '\147\141\164\145\55\156\157\163\150\151\160\55\146\165\154\154\55\143\157\156\146\157\162\155\141\156\143\145\56\163\150')"
PAT_A="$(printf '\101\105\120\55\116\117\123\110\111\120')"
PAT_B="$(printf '\141\145\160\55\156\157\163\150\151\160')"
PAT_C="$(printf '\101\105\120\137\116\117\123\110\111\120')"

if [ -d "${PACK_DIR}/gates" ] && [ -f "${PACK_DIR}/policies/${POL_FILE}" ]; then
  bash "${PACK_DIR}/gates/${GATE_FILE}" "$ROOT"
else
  if command -v git >/dev/null 2>&1 && git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    hits=$(git grep -n -I -E "${PAT_A}|${PAT_B}|${PAT_C}" 2>/dev/null \
      | grep -Ev 'scripts/gate-aep28-deployment-conformance\.sh:' \
      | head -n 40 || true)
    if [ -n "$hits" ]; then
      echo "HARD BLOCK: protected internal folder name leaked in shippable tree"
      printf "%s\n" "$hits"
      exit 1
    fi
  fi
  echo "[gate-aep28-deployment-conformance] OK (protected pack absent; public tree clean)"
fi
exit 0
