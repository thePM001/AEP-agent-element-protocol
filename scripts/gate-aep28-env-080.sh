#!/usr/bin/env bash
# CI: production crate src has no mutex lock expect. Drain runs after stop.
# AEP28-ENV-080
# @PAD: aep28-env-080-dock-drain-ci-gate-v1
# @GCDE: gaplune.policy.v1
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
SRC="$ROOT/AEP-Base-Node/crate/src"

strip_tests() {
  perl -0777 -e '
    local $_ = do { local $/; <> };
    1 while s/#\[cfg\(test\)\]\s*(?:pub\s+)?mod\s+\w+\s*(\{(?:[^{}]++|(?1))*\})//s;
    print;
  ' "$1"
}

fail=0
shopt -s nullglob
for src in "$SRC"/*.rs "$SRC"/bin/*.rs; do
  base="$(basename "$src")"
  if [ "$base" = "docking_tests.rs" ]; then
    continue
  fi
  body="$(strip_tests "$src")"
  if printf '%s' "$body" | grep -E -n '\.lock\(\)\.expect' >/dev/null; then
    echo "[gate-aep28-env-080] production lock expect in $src" >&2
    printf '%s' "$body" | grep -E -n '\.lock\(\)\.expect' >&2 || true
    fail=1
  fi
done
if [ "$fail" -ne 0 ]; then
  exit 1
fi

if ! grep -q 'fn drain_docking_servers' "$SRC/dock_serve.rs"; then
  echo "[gate-aep28-env-080] missing drain_docking_servers in dock_serve.rs" >&2
  exit 1
fi
if ! grep -q 'fn unlink_sockets' "$SRC/dock_serve.rs"; then
  echo "[gate-aep28-env-080] missing unlink_sockets in dock_serve.rs" >&2
  exit 1
fi
if ! grep -q 'drain_docking_servers' "$SRC/main.rs"; then
  echo "[gate-aep28-env-080] main.rs does not drain after stop" >&2
  exit 1
fi
if ! grep -q 'close_sqlite' "$SRC/dock_pulse.rs"; then
  echo "[gate-aep28-env-080] missing close_sqlite" >&2
  exit 1
fi
if ! grep -q 'lock_or_deny' "$SRC/docking.rs"; then
  echo "[gate-aep28-env-080] missing lock_or_deny" >&2
  exit 1
fi
if ! grep -q 'stop_drains_dock_tasks_unlinks_sockets_and_closes_sqlite' "$SRC/docking_tests.rs"; then
  echo "[gate-aep28-env-080] missing drain lib test" >&2
  exit 1
fi

cargo test -p aep-base-node --lib
echo "[gate-aep28-env-080] OK drain after stop; production locks stay poison-safe"
