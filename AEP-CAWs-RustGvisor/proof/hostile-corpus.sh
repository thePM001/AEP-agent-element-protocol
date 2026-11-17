#!/usr/bin/env bash
# Hostile corpus of the CAW: attempts to leave the sandbox, each of which must fail
# inside it.
# Usage: hostile-corpus.sh <runsc> <caw-run-proof> <profile record> <aep-caw-init>
# Runs as a user that is not root. A root caller is handed over to the user nobody.
# Prints one line per case: CASE <name> PASS|FAIL <detail>. Exit 0 only when every
# case holds.
#
# Two cases of the corpus are not in this script, because they need more than one
# command in one session or a name server:
# - A link put in the place of a mounted folder between two commands. The test
#   a_link_in_the_place_of_a_mount_source_refuses_the_run of aep-caw-runtime holds it.
# - A name that answers with a public and a private address. The test
#   a_name_with_one_private_answer_is_refused_as_a_whole of aep-caw-egress holds it.
set -uo pipefail

RUNSC="${1:?path to runsc}"
PROOF="${2:?path to caw-run-proof}"
RECORD="${3:?profile record}"
INIT="${4:?path to aep-caw-init}"
# A relative path becomes absolute, so a path that lands in caw.toml or in a sandbox
# bundle holds from any folder. A bare program name stays a name for the PATH lookup.
abs() { case "$1" in "" | /*) printf '%s' "$1" ;; */*) printf '%s/%s' "$PWD" "$1" ;; *) printf '%s' "$1" ;; esac; }
RUNSC="$(abs "$RUNSC")"
PROOF="$(abs "$PROOF")"
RECORD="$(abs "$RECORD")"
INIT="$(abs "$INIT")"

if [ "$(id -u)" = 0 ]; then
  W="$(mktemp -d /var/tmp/caw-hostile.XXXXXX)"
  cp "$0" "$W/hostile-corpus.sh"
  cp "$PROOF" "$W/caw-run-proof"
  cp "$RECORD" "$W/record.json"
  cp "$INIT" "$W/aep-caw-init"
  chown -R 65534:65534 "$W"
  setpriv --reuid=65534 --regid=65534 --clear-groups \
    env HOME="$W" CAW_HOSTILE_WORK="$W" PATH="$PATH" \
    bash "$W/hostile-corpus.sh" "$RUNSC" "$W/caw-run-proof" "$W/record.json" "$W/aep-caw-init"
  code=$?
  rm -rf "$W"
  exit "$code"
fi

W="${CAW_HOSTILE_WORK:-$(mktemp -d /var/tmp/caw-hostile.XXXXXX)}"
cleanup() {
  if [ -z "${CAW_HOSTILE_WORK:-}" ]; then rm -rf "$W"; fi
}
trap cleanup EXIT

P="$W/home/project"
mkdir -p "$P" "$W/outside"
echo "outside-secret-text" > "$W/outside/secret"
ln -s "$W/outside/secret" "$P/escape-link"
ln -s "$W/outside" "$P/escape-folder"
HOSTPID="$$"

FAILED=0
N=0
# attack <name> <want deny count> <text that must not appear or -> <text that must appear or -> <command...>
# The command of every case ends with exit 7, so a case that passes shows that the
# shell lived on after the refused step.
attack() {
  local name="$1" want_deny="$2" forbidden="$3" wanted="$4"
  shift 4
  N=$((N + 1))
  local out="$W/out$N.txt"
  CAW_PROOF_HOME="$W/home" CAW_PROOF_INIT="$INIT" \
    AWS_SECRET_ACCESS_KEY="caw-corpus-secret-value" GITHUB_TOKEN="caw-corpus-secret-value" \
    "$PROOF" "$RUNSC" "$RECORD" "$P" "$W/work$N" "$@" > "$out" 2>&1
  local code=$?
  local deny problem=""
  deny="$(grep -c '^DENY ' "$out")"
  grep -q '^RESULT .* dropped=0 complete=true$' "$out" || problem="no complete result"
  [ -n "$problem" ] || [ "$code" = 7 ] || problem="exit $code, want 7"
  [ -n "$problem" ] || [ "$want_deny" = - ] || [ "$deny" = "$want_deny" ] || problem="$deny deny events, want $want_deny"
  [ -n "$problem" ] || [ "$forbidden" = - ] || ! grep -q -F -- "$forbidden" "$out" || problem="the output holds: $forbidden"
  [ -n "$problem" ] || [ "$wanted" = - ] || grep -q -F -- "$wanted" "$out" || problem="the output lacks: $wanted"
  if [ -z "$problem" ]; then
    echo "CASE $name PASS with $deny deny events"
  else
    FAILED=$((FAILED + 1))
    echo "CASE $name FAIL $problem"
    sed 's/^/    /' "$out" | tail -12
  fi
}

attack link-to-a-file-outside-the-workspace - "outside-secret-text" - \
  sh -c "cat $P/escape-link; exit 7"
attack link-to-a-folder-outside-the-workspace - "outside-secret-text" - \
  sh -c "cat $P/escape-folder/secret; ls $P/escape-folder; exit 7"
attack parent-steps-out-of-the-workspace 1 "outside-secret-text" "target=$W/outside/secret " \
  sh -c "(exec < $P/../../outside/secret) 2> /dev/null; exit 7"
# A program that asks with stat before it opens is refused too and leaves no deny
# event: gVisor has no trace point for stat. This case holds that known limit.
attack probe-with-stat-leaves-no-event 0 "outside-secret-text" "No such file" \
  sh -c "ls $P/../../outside/secret; exit 7"
attack absolute-path-outside-the-workspace 1 "outside-secret-text" "kind=file-outside" \
  sh -c "head -c 64 $W/outside/secret; exit 7"
attack host-process-in-the-proc-tree - "host-process-visible" - \
  sh -c "if [ -e /proc/$HOSTPID ]; then echo host-process-visible; fi; ls /proc; exit 7"
attack kernel-setting-through-the-proc-tree - "kernel-setting-written" - \
  sh -c "echo caw-corpus > /proc/sys/kernel/hostname && echo kernel-setting-written; exit 7"
attack device-of-the-host - "host-device-present" - \
  sh -c "for d in /dev/sda /dev/sda1 /dev/vda /dev/nvme0n1 /dev/mem /dev/kmem /dev/kmsg /dev/kvm; do if [ -e \$d ]; then echo host-device-present \$d; fi; done; exit 7"
attack socket-of-the-host - "host-socket-present" - \
  sh -c "for s in /var/run/docker.sock /run/docker.sock /run/containerd/containerd.sock /run/dbus/system_bus_socket; do if [ -e \$s ]; then echo host-socket-present \$s; fi; done; exit 7"
attack secret-in-the-environment-of-the-caller - "caw-corpus-secret-value" "PATH=/usr/bin:/bin" \
  sh -c "env; cat /proc/self/environ; cat /proc/1/environ; exit 7"
attack program-dropped-into-tmp - "dropped-program-ran" "ermission denied" \
  sh -c "cp /usr/bin/cat /tmp/dropped && /tmp/dropped /dev/null && echo dropped-program-ran; exit 7"
attack program-dropped-into-the-workspace 1 "dropped-program-ran" "kind=exec-in-mount" \
  sh -c "cp /usr/bin/cat $P/dropped && $P/dropped /dev/null && echo dropped-program-ran; exit 7"
attack write-into-the-toolset - "toolset-written" - \
  sh -c "echo x > /usr/bin/sh && echo toolset-written; cp /usr/bin/cat /usr/bin/planted && echo toolset-written; rm /usr/bin/cat && echo toolset-written; exit 7"
attack privilege-program - "uid=0(root) gid=0(root) groups=0(root),"  "not found" \
  sh -c "sudo id; su -c id; exit 7"

if [ "$(cat "$W/outside/secret")" = "outside-secret-text" ] && [ ! -e "$W/outside/planted" ]; then
  echo "CASE host-files-outside-are-unchanged PASS"
else
  FAILED=$((FAILED + 1))
  echo "CASE host-files-outside-are-unchanged FAIL"
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "hostile-corpus: every case holds"
  exit 0
fi
echo "hostile-corpus: $FAILED case or cases do not hold"
exit 1
