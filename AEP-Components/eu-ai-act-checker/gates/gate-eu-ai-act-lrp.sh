#!/usr/bin/env bash
# Fail-closed gate for EU AI Act LRP pack + checker
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PACK="$ROOT/AEP-Components/wizard/lrp/modules/eu-ai-act"
BIN="${EU_AI_ACT_CHECKER_BIN:-}"
if [[ -z "$BIN" ]]; then
  if [[ -x "$ROOT/rust/target/release/eu-ai-act-checker" ]]; then
    BIN="$ROOT/rust/target/release/eu-ai-act-checker"
  elif command -v eu-ai-act-checker >/dev/null 2>&1; then
    BIN="$(command -v eu-ai-act-checker)"
  else
    echo "[gate-eu-ai-act-lrp] FAIL: eu-ai-act-checker binary not found" >&2
    exit 1
  fi
fi
for f in CONTROL-CATALOG.json RISK-CLASSES.json ROLES.json ARTICLE-MAP.json; do
  [[ -f "$PACK/$f" ]] || { echo "[gate-eu-ai-act-lrp] FAIL: missing $f" >&2; exit 1; }
done
jq -e '.maturity | test("^enforced_v1")' "$PACK/CONTROL-CATALOG.json" >/dev/null \
  || { echo "[gate-eu-ai-act-lrp] FAIL: maturity not enforced_v1*" >&2; exit 1; }
jq -e '.pattern.invariants | length >= 5' "$ROOT/AEP-Policy-System/reference/eu-ai-act.gap" >/dev/null \
  || { echo "[gate-eu-ai-act-lrp] FAIL: eu-ai-act.gap missing invariants" >&2; exit 1; }
if command -v rg >/dev/null 2>&1; then
  if rg -n 'certified EU AI Act|EU AI Act certified|full Regulation coverage' \
    "$ROOT/docs/compliance/COMPLIANCE.md" \
    "$ROOT/docs/compliance/COMPLIANCE-LRP.md" \
    "$ROOT/AEP-Components/wizard/lrp/modules/eu-ai-act.json" 2>/dev/null; then
    echo "[gate-eu-ai-act-lrp] FAIL: honesty boast phrase found" >&2
    exit 1
  fi
fi
"$BIN" --pack-root "$PACK" conformance
echo "[gate-eu-ai-act-lrp] PASS"
