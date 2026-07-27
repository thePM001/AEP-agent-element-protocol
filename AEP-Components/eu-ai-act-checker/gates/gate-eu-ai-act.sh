#!/usr/bin/env bash
# gate-eu-ai-act.sh
# ONE gate for the EU AI Act compliance checking pack.
# Definition file: AEP-Components/eu-ai-act-checker/EU-AI-ACT-PACK.json
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PACK="${EU_AI_ACT_PACK:-$ROOT/EU-AI-ACT-PACK.json}"
BIN="${EU_AI_ACT_CHECKER_BIN:-}"
log() { echo "[gate-eu-ai-act] $*" >&2; }
if [[ ! -f "$PACK" ]]; then
  log "FAIL: missing definition file $PACK"
  exit 1
fi
if [[ -z "$BIN" ]]; then
  if [[ -x "$ROOT/../../rust/target/release/eu-ai-act-checker" ]]; then
    BIN="$ROOT/../../rust/target/release/eu-ai-act-checker"
  elif [[ -x "$ROOT/crate/target/release/eu-ai-act-checker" ]]; then
    BIN="$ROOT/crate/target/release/eu-ai-act-checker"
  elif command -v eu-ai-act-checker >/dev/null 2>&1; then
    BIN="$(command -v eu-ai-act-checker)"
  else
    log "FAIL: eu-ai-act-checker binary not found (build: cargo build -p eu-ai-act-checker --release)"
    exit 1
  fi
fi
# Basic schema presence
if ! jq -e '.controls | length > 0' "$PACK" >/dev/null; then
  log "FAIL: pack has no controls"
  exit 1
fi
if ! jq -e '.pack_id == "eu-ai-act"' "$PACK" >/dev/null; then
  log "FAIL: pack_id must be eu-ai-act"
  exit 1
fi
"$BIN" --pack-root "$PACK" conformance
log "OK: EU AI Act checking pack green"
