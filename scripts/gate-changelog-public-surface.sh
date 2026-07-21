#!/usr/bin/env bash
# gate-changelog-public-surface.sh
# Policy: AEP-Policy-System/reference/changelog-public-surface.gap
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CHANGELOG="${1:-$ROOT/CHANGELOG.md}"
log() { echo "[gate-changelog-public-surface] $*" >&2; }
if [[ ! -f "$CHANGELOG" ]]; then log "FAIL: missing $CHANGELOG"; exit 1; fi
HITS=0
PATTERNS=(
  NOSHIP
  noship
  aep-noship
  gate-no-noship
  must\ never\ ship
  accidental\ path\ from\ public
  public\ GitHub\ boundary
  GitHub\ boundary
  internal-only\ engineering\ tree
  public\ surface\ cleanup
  incident\ fix
  aep-noship-distribution
  purge\ NOSHIP
  drop\ AEP-NOSHIP
  Removed\ accidental
)
for pat in "${PATTERNS[@]}"; do
  if grep -n -i -F -- "$pat" "$CHANGELOG" > /tmp/nla-cl-hits.txt; then
    log "FAIL: forbidden CHANGELOG token: $pat"
    sed "s/^/  /" /tmp/nla-cl-hits.txt >&2 || true
    HITS=$((HITS+1))
  fi
done
if [[ "$HITS" -gt 0 ]]; then log "FAIL: $HITS forbidden token class(es)"; exit 1; fi
log "OK: CHANGELOG public surface clean"
exit 0
