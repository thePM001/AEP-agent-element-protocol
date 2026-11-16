#!/usr/bin/env bash
# Core acceptance of the CAW: what the policy allows passes with no deny event and
# what it refuses fails inside the sandbox with exactly one deny event.
# Usage: core-acceptance.sh <path to runsc> <path to caw-run-proof> <profile record>
# Runs as a user that is not root. A root caller is handed over to the user nobody.
# Prints one line per check: CHECK <name> PASS|FAIL <detail>. Exit 0 only when every
# check holds.
set -uo pipefail

RUNSC="${1:?path to runsc}"
PROOF="${2:?path to caw-run-proof}"
RECORD="${3:?profile record}"

if [ "$(id -u)" = 0 ]; then
  W="$(mktemp -d /var/tmp/caw-accept.XXXXXX)"
  cp "$0" "$W/core-acceptance.sh"
  cp "$PROOF" "$W/caw-run-proof"
  cp "$RECORD" "$W/record.json"
  chown -R 65534:65534 "$W"
  setpriv --reuid=65534 --regid=65534 --clear-groups \
    env HOME="$W" CAW_ACCEPT_WORK="$W" PATH="$PATH" \
    bash "$W/core-acceptance.sh" "$RUNSC" "$W/caw-run-proof" "$W/record.json"
  code=$?
  rm -rf "$W"
  exit "$code"
fi

W="${CAW_ACCEPT_WORK:-$(mktemp -d /var/tmp/caw-accept.XXXXXX)}"
cleanup() {
  if [ -z "${CAW_ACCEPT_WORK:-}" ]; then rm -rf "$W"; fi
}
trap cleanup EXIT

P="$W/home/project"
mkdir -p "$P" "$W/outside"
echo "outside-secret" > "$W/outside/secret"
cp /usr/bin/true "$W/outside/tool"
chmod 0755 "$W/outside/tool"
echo "hello" > "$P/readme.txt"
export CAW_PROOF_HOME="$W/home"

FAILED=0
N=0
# check <name> <want exit> <want deny count> <want deny kind or -> <want text in output or -> <command...>
check() {
  local name="$1" want_exit="$2" want_deny="$3" want_kind="$4" want_text="$5"
  shift 5
  N=$((N + 1))
  local out="$W/out$N.txt"
  "$PROOF" "$RUNSC" "$RECORD" "$P" "$W/work$N" "$@" > "$out" 2>&1
  local code=$?
  local result deny kinds complete problem=""
  result="$(grep '^RESULT ' "$out" | tail -1)"
  deny="$(grep -c '^DENY ' "$out")"
  kinds="$(grep '^DENY ' "$out" | sed 's/^DENY kind=\([a-z-]*\) .*/\1/' | sort -u | tr '\n' ' ')"
  complete="$(printf '%s' "$result" | sed -n 's/.* dropped=0 complete=true$/yes/p')"
  [ -n "$result" ] || problem="no result line"
  [ -n "$problem" ] || [ "$complete" = yes ] || problem="the trace stream lost points or did not end in order"
  [ -n "$problem" ] || [ "$code" = "$want_exit" ] || problem="exit $code, want $want_exit"
  [ -n "$problem" ] || [ "$deny" = "$want_deny" ] || problem="$deny deny events, want $want_deny"
  [ -n "$problem" ] || [ "$want_kind" = - ] || [ "$kinds" = "$want_kind " ] || problem="deny kinds [$kinds], want $want_kind"
  [ -n "$problem" ] || [ "$want_text" = - ] || grep -q -F -- "$want_text" "$out" || problem="the output lacks: $want_text"
  if [ -z "$problem" ]; then
    echo "CHECK $name PASS exit $code with $deny deny events"
  else
    FAILED=$((FAILED + 1))
    echo "CHECK $name FAIL $problem"
    sed 's/^/    /' "$out" | tail -15
  fi
}

check allowed-read-write-list 0 0 - "hello" \
  sh -c "echo hi > $P/new.txt && cat $P/new.txt $P/readme.txt && ls $P"
check denied-file-read 2 1 file-outside "target=$W/outside/secret " \
  sh -c "exec < $W/outside/secret"
check denied-exec 7 1 exec-outside "target=$W/outside/tool " \
  sh -c "$W/outside/tool; exit 7"
check denied-exec-in-workspace 7 1 exec-in-mount "rule=allow-project-rw" \
  sh -c "cp /usr/bin/ls $P/copied && $P/copied; exit 7"
check read-only-root 7 0 - "Read-only file system" \
  sh -c "echo x > /usr/bin/planted; exit 7"
check program-outside-the-toolset 7 0 - "not found" \
  sh -c "id; exit 7"
check environment-built-from-nothing 0 0 - "HOME=/tmp" \
  env
check exit-code-of-the-command 42 0 - - \
  sh -c "exit 42"

if [ -f "$P/new.txt" ]; then
  echo "CHECK workspace-write-on-host PASS the write reached the host folder"
else
  FAILED=$((FAILED + 1))
  echo "CHECK workspace-write-on-host FAIL the write did not reach the host folder"
fi
if grep -q -E '^(AWS|GITHUB|SSH|CAW_PROOF)' "$W/out7.txt" 2>/dev/null; then
  FAILED=$((FAILED + 1))
  echo "CHECK no-variable-of-the-caller FAIL a variable of the caller reached the sandbox"
else
  echo "CHECK no-variable-of-the-caller PASS no variable of the caller reached the sandbox"
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "core-acceptance: every check holds"
  exit 0
fi
echo "core-acceptance: $FAILED check or checks do not hold"
exit 1
