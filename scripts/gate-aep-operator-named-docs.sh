#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
fail=0
LIST="$ROOT/docs/operator-named-paths.list"
if [ ! -f "$LIST" ]; then echo named path list not in tree >&2; exit 1; fi
while IFS= read -r f; do
  [ -n "$f" ] || continue
  if [ ! -e "$ROOT/$f" ]; then echo named path not in tree: "$f" >&2; fail=1; fi
done < "$LIST"
if [ "$fail" -ne 0 ]; then exit 1; fi
echo OK named operator docs present
