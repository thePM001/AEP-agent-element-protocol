#!/usr/bin/env bash
# Core acceptance of the CAW: what the policy allows passes with no deny event and
# what it refuses fails inside the sandbox with exactly one deny event.
# Usage: core-acceptance.sh <runsc> <caw-run-proof> <profile record> <aep-caw-init> [aep-caw] [egress record]
# With aep-caw the script also checks the command: it creates a session and its exec
# refuses with the rule kernel-dock-silent while the build has no kernel dock client.
# With the egress record it also checks the egress proxy: a request with no route, an
# address literal, a name with a loopback address and a connect past the proxy each
# fail with exactly one deny event.
# Runs as a user that is not root. A root caller is handed over to the user nobody.
# Prints one line per check: CHECK <name> PASS|FAIL <detail>. Exit 0 only when every
# check holds.
set -uo pipefail

RUNSC="${1:?path to runsc}"
PROOF="${2:?path to caw-run-proof}"
RECORD="${3:?profile record}"
INIT="${4:?path to aep-caw-init}"
CAW="${5:-}"
EGRESS_RECORD="${6:-}"

if [ "$(id -u)" = 0 ]; then
  W="$(mktemp -d /var/tmp/caw-accept.XXXXXX)"
  cp "$0" "$W/core-acceptance.sh"
  cp "$PROOF" "$W/caw-run-proof"
  cp "$RECORD" "$W/record.json"
  cp "$INIT" "$W/aep-caw-init"
  CAWCOPY=""
  if [ -n "$CAW" ]; then cp "$CAW" "$W/aep-caw"; CAWCOPY="$W/aep-caw"; fi
  EGRESSCOPY=""
  if [ -n "$EGRESS_RECORD" ]; then cp "$EGRESS_RECORD" "$W/egress-record.json"; EGRESSCOPY="$W/egress-record.json"; fi
  chown -R 65534:65534 "$W"
  setpriv --reuid=65534 --regid=65534 --clear-groups \
    env HOME="$W" CAW_ACCEPT_WORK="$W" PATH="$PATH" \
    bash "$W/core-acceptance.sh" "$RUNSC" "$W/caw-run-proof" "$W/record.json" "$W/aep-caw-init" "$CAWCOPY" "$EGRESSCOPY"
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
export CAW_PROOF_INIT="$INIT"

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
  local result deny kinds complete audit problem=""
  result="$(grep '^RESULT ' "$out" | tail -1)"
  deny="$(grep -c '^DENY ' "$out")"
  kinds="$(grep '^DENY ' "$out" | sed 's/^DENY kind=\([a-z-]*\) .*/\1/' | sort -u | tr '\n' ' ')"
  complete="$(printf '%s' "$result" | sed -n 's/.* dropped=0 complete=true$/yes/p')"
  # One line for the session, one start, one seal, one end, one per deny event and
  # one per other egress request.
  audit="$(grep -c "^AUDIT lines=$((deny + 4 + $(grep -c '^EGRESS ' "$out"))) chain=ok$" "$out")"
  [ -n "$result" ] || problem="no result line"
  [ -n "$problem" ] || [ "$complete" = yes ] || problem="the trace stream lost points or did not end in order"
  [ -n "$problem" ] || [ "$code" = "$want_exit" ] || problem="exit $code, want $want_exit"
  [ -n "$problem" ] || [ "$audit" = 1 ] || problem="the audit log does not hold its chain with one line per event"
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

if [ -n "$EGRESS_RECORD" ]; then
  # The egress profile holds sh and curl and one route: plain HTTP to the name
  # localhost on port 80. The checks need no network.
  RECORD="$EGRESS_RECORD"
  check egress-no-route 7 1 egress "status 403" \
    sh -c "curl -sS -m 10 -o /dev/null -w 'status %{http_code}\\n' http://blocked.example.com/; exit 7"
  check egress-address-literal 7 1 egress "rule=address-literal" \
    sh -c "curl -sS -m 10 -o /dev/null http://169.254.169.254/latest/meta-data/; exit 7"
  check egress-name-with-a-loopback-address 7 1 egress "rule=address" \
    sh -c "curl -sS -m 10 -o /dev/null http://localhost/; exit 7"
  check egress-tunnel-with-no-route 7 1 egress "target=blocked.example.com:443 " \
    sh -c "curl -sS -m 10 -o /dev/null https://blocked.example.com/; exit 7"
  check denied-connect-past-the-proxy 7 1 connect "target=192.0.2.1:80 " \
    sh -c "curl -sS -m 10 --noproxy '*' -o /dev/null http://192.0.2.1/; exit 7"
  check proxy-address-in-the-environment 0 0 - "HTTPS_PROXY=http://127.0.0.1:3128" \
    env
fi

if [ -n "$CAW" ]; then
  D="$W/data"
  PROFILE="$(tr ',' '\n' < "$RECORD" | sed -n 's/^"profile_id":"\(.*\)"$/\1/p' | head -1)"
  mkdir -p "$D/caw-framework/profiles"
  cp "$RECORD" "$D/caw-framework/profiles/$PROFILE.json"
  printf 'allowed_profiles = ["%s"]\nrunsc = "%s"\ninit = "%s"\n' "$PROFILE" "$RUNSC" "$INIT" > "$D/caw-framework/caw.toml"
  # cli <name> <want exit> <want text in output> <arguments of aep-caw...>
  cli() {
    local name="$1" want_exit="$2" want_text="$3"
    shift 3
    local out="$W/cli-$name.txt"
    "$CAW" "$@" > "$out" 2>&1
    local code=$?
    if [ "$code" = "$want_exit" ] && grep -q -F -- "$want_text" "$out"; then
      echo "CHECK $name PASS exit $code"
    else
      FAILED=$((FAILED + 1))
      echo "CHECK $name FAIL exit $code, want $want_exit with: $want_text"
      sed 's/^/    /' "$out" | tail -8
    fi
  }
  cli command-lists-profiles 0 "$PROFILE allowed" profiles list --data "$D"
  cli command-has-no-server-mode 64 "unknown command" serve --data "$D"
  cli command-refuses-a-profile-not-allowed 126 "not in the allowed list" \
    session create --data "$D" --profile other --workspace "$P"
  SESSION="$("$CAW" session create --data "$D" --profile "$PROFILE" --workspace "$P" \
    --var HOME="$W/home" --var AEP_MODEL_GATEWAY_HOST=gateway.example.com 2> "$W/cli-create.txt")"
  if printf '%s' "$SESSION" | grep -q -E '^[0-9a-f]{32}$'; then
    echo "CHECK command-creates-a-session PASS"
    cli command-exec-refuses-without-the-dock 126 "kernel-dock-silent" \
      exec --data "$D" --session "$SESSION" -- sh -c "echo ran > $P/ran-without-dock"
    if [ -e "$P/ran-without-dock" ]; then
      FAILED=$((FAILED + 1))
      echo "CHECK no-command-runs-without-the-dock FAIL the command ran"
    else
      echo "CHECK no-command-runs-without-the-dock PASS the command did not run"
    fi
    LOG="$D/caw-framework/sessions/$SESSION/audit.log"
    if grep -q '"kind":"refused"' "$LOG" && grep -q '"rule":"kernel-dock-silent"' "$LOG"; then
      echo "CHECK refusal-is-in-the-audit-log PASS"
    else
      FAILED=$((FAILED + 1))
      echo "CHECK refusal-is-in-the-audit-log FAIL"
    fi
  else
    FAILED=$((FAILED + 1))
    echo "CHECK command-creates-a-session FAIL"
    sed 's/^/    /' "$W/cli-create.txt" | tail -8
  fi
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "core-acceptance: every check holds"
  exit 0
fi
echo "core-acceptance: $FAILED check or checks do not hold"
exit 1
