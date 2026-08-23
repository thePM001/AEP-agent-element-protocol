#!/usr/bin/env bash
# Fail-closed SSOT: HyperlatticeFilter and LatticePolicyEvaluator must match
# across Components (canonical) and SDK replica. Produced by produce-aep-sdks.mjs.
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CANON="$ROOT/AEP-Components/dynAEP/bridge/hyperlattice"
REPLICA="$ROOT/AEP-SDKs/typescript/dynaep/src/hyperlattice"
fail() { echo "SSOT DRIFT: $*" >&2; exit 1; }
for name in HyperlatticeFilter.ts LatticePolicyEvaluator.ts compileLatticeWalls.ts compileChannelOrderWalls.ts compileTemporalWalls.ts; do
  a="$CANON/$name"
  b="$REPLICA/$name"
  [[ -f "$a" ]] || fail "missing canonical $a"
  [[ -f "$b" ]] || fail "missing replica $b"
  if ! cmp -s "$a" "$b"; then
    echo "files differ: $a vs $b" >&2
    diff -u "$a" "$b" | head -n 80 >&2 || true
    fail "$name"
  fi
done
echo "[gate-hyperlattice-ssot] ALLOW: Components and SDK hyperlattice trees are byte-identical"
if command -v cargo >/dev/null 2>&1 && [[ -f "$ROOT/Cargo.toml" ]]; then
  cargo test -p aep-hyperlattice-ssot --manifest-path "$ROOT/Cargo.toml" --lib
fi
