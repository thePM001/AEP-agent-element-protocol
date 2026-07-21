#!/usr/bin/env bash
# gate-no-noship-on-github.sh
# Policy: AEP-Policy-System/reference/aep-noship-distribution.gap
# Fail-closed: a git tip intended for github.com must not contain AEP-NOSHIP/
set -euo pipefail

REF="${1:-HEAD}"
log() { echo "[gate-no-noship-on-github] $*" >&2; }

if ! git rev-parse --verify "$REF" >/dev/null 2>&1; then
  log "FAIL: bad ref $REF"
  exit 1
fi

hits=$(git ls-tree -r --name-only "$REF" | grep -E '^AEP-NOSHIP(/|$)' || true)
if [ -n "$hits" ]; then
  log "FAIL: AEP-NOSHIP present on $REF (must never ship to github.com):"
  printf '%s\n' "$hits" | head -50 | sed 's/^/  /' >&2
  exit 1
fi

log "OK: no AEP-NOSHIP paths on $REF"
exit 0