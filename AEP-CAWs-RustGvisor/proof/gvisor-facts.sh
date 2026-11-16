#!/usr/bin/env bash
# Proof of the gVisor facts the CAW of AEP 2.9 rests on.
# Usage: gvisor-facts.sh <path to runsc>
# Runs one sandbox as a user that is not root, on the systrap platform, with cgroups
# ignored and no network device. Prints one line per fact: FACT <name> PASS|FAIL <detail>.
# Exit 0 only when every fact holds.
set -uo pipefail

RUNSC="${1:-runsc}"
PORT=47611

# A root caller hands over to the user nobody: the proof is about a run without root.
if [ "$(id -u)" = 0 ]; then
  W="$(mktemp -d /var/tmp/caw-proof.XXXXXX)"
  cp "$0" "$W/gvisor-facts.sh"
  chown -R 65534:65534 "$W"
  setpriv --reuid=65534 --regid=65534 --clear-groups \
    env HOME="$W" CAW_PROOF_WORK="$W" PATH="$PATH" bash "$W/gvisor-facts.sh" "$RUNSC"
  code=$?
  rm -rf "$W"
  exit "$code"
fi

W="${CAW_PROOF_WORK:-$(mktemp -d /var/tmp/caw-proof.XXXXXX)}"
PIDS=""
stop_listeners() {
  for p in $PIDS; do kill "$p" 2>/dev/null; done
  PIDS=""
}
cleanup() {
  stop_listeners
  if [ -z "${CAW_PROOF_WORK:-}" ]; then rm -rf "$W"; fi
}
trap cleanup EXIT

echo "== host"
echo "user: $(id -u):$(id -g)"
echo "kernel: $(cat /proc/sys/kernel/osrelease)"
echo "runsc: $("$RUNSC" --version 2>&1 | head -1)"
echo "kvm device: $([ -e /dev/kvm ] && echo present || echo absent)"
for k in kernel/unprivileged_userns_clone kernel/apparmor_restrict_unprivileged_userns user/max_user_namespaces kernel/yama/ptrace_scope; do
  if [ -r "/proc/sys/$k" ]; then echo "sysctl $k: $(cat "/proc/sys/$k")"; else echo "sysctl $k: absent"; fi
done

B="$W/bundle"
mkdir -p "$B/rootfs" "$W/work" "$W/sock" "$W/proof" "$W/outside"
for d in proc usr tmp work proof dev run/caw; do mkdir -p "$B/rootfs/$d"; done
echo "caw-proof-secret" > "$W/outside/secret"
cp /usr/bin/true "$W/outside/tool"
chmod 0755 "$W/outside/tool"

# The root holds the host programs read only. A merged /usr keeps its links.
EXTRA_MOUNTS=""
for d in bin sbin lib lib64 lib32 libx32; do
  if [ -L "/$d" ]; then
    ln -s "$(readlink "/$d")" "$B/rootfs/$d"
  elif [ -d "/$d" ]; then
    mkdir -p "$B/rootfs/$d"
    EXTRA_MOUNTS="$EXTRA_MOUNTS,{\"destination\":\"/$d\",\"type\":\"bind\",\"source\":\"/$d\",\"options\":[\"ro\",\"bind\"]}"
  fi
done

NC="$(readlink -f "$(command -v nc)" 2>/dev/null)"
echo "nc resolves to: $NC"
ADDR="$(hostname -I 2>/dev/null | awk '{print $1}')"

cat > "$W/proof/inside.sh" <<INSIDE
#!/bin/sh
pass() { echo "FACT \$1 PASS \$2"; }
fail() { echo "FACT \$1 FAIL \$2"; }
if dmesg 2>/dev/null | grep -qi gvisor; then pass kernel-is-gvisor "the kernel log names gVisor"; else fail kernel-is-gvisor "the kernel log does not name gVisor"; fi
devs=\$(sed 1,2d /proc/net/dev 2>/dev/null | cut -d: -f1 | tr -d ' ' | grep -v '^lo\$' | tr '\n' ' ')
if [ -r /proc/net/dev ] && [ -z "\$devs" ]; then pass no-network-device "only lo or nothing"; else fail no-network-device "found: \$devs"; fi
if cat "$W/outside/secret" >/dev/null 2>&1; then fail denied-file-read "a host file outside the mounts was read"; else pass denied-file-read "a host file outside the mounts is absent"; fi
if touch /caw-root-write 2>/dev/null; then fail read-only-root "the root took a write"; else pass read-only-root "the root refused a write"; fi
if touch /work/ok 2>/dev/null && [ -f /work/ok ]; then pass allowed-file-write "the workspace took a write"; else fail allowed-file-write "the workspace refused a write"; fi
if "$W/outside/tool" 2>/dev/null; then fail denied-exec "a program outside the root ran"; else pass denied-exec "a program outside the root did not run"; fi
if /usr/bin/true; then pass allowed-exec "a program inside the root ran"; else fail allowed-exec "a program inside the root did not run"; fi
if [ -x "$NC" ]; then pass test-tool-present "$NC runs in the sandbox"; else fail test-tool-present "$NC is absent in the sandbox, the socket and connect facts prove nothing"; fi
out=\$(echo caw-proof-socket | "$NC" -N -w 3 -U /run/caw/egress.sock 2>&1)
echo "socket client exit \$?: \$out"
ls -la /run/caw 2>&1
if [ -n "$ADDR" ]; then
  cerr=\$("$NC" -w 2 "$ADDR" $PORT </dev/null 2>&1 >/dev/null); crc=\$?
  echo "connect client exit \$crc: \$cerr"
  if [ \$crc -eq 0 ]; then fail denied-connect "a TCP connect to the host address worked"; elif [ \$crc -eq 127 ]; then fail denied-connect "the client program did not run"; else pass denied-connect "a TCP connect to the host address failed"; fi
else
  echo "SKIP denied-connect the host has no address to connect to, the fact no-network-device carries the claim"
fi
echo "inside user: \$(id -u)"
INSIDE

write_config() {
  # $1 is the JSON array of the process arguments
  cat > "$B/config.json" <<CONFIG
{
  "ociVersion": "1.0.0",
  "process": {
    "terminal": false,
    "user": {"uid": 0, "gid": 0},
    "args": $1,
    "env": ["PATH=/usr/bin:/bin"],
    "cwd": "/"
  },
  "root": {"path": "rootfs", "readonly": true},
  "hostname": "caw-proof",
  "mounts": [
    {"destination": "/proc", "type": "proc", "source": "proc"},
    {"destination": "/tmp", "type": "tmpfs", "source": "tmpfs"},
    {"destination": "/usr", "type": "bind", "source": "/usr", "options": ["ro", "bind"]},
    {"destination": "/proof", "type": "bind", "source": "$W/proof", "options": ["ro", "bind"]},
    {"destination": "/work", "type": "bind", "source": "$W/work", "options": ["rw", "bind"]},
    {"destination": "/run/caw", "type": "bind", "source": "$W/sock", "options": ["rw", "bind"]}$EXTRA_MOUNTS
  ],
  "linux": {
    "namespaces": [{"type": "pid"}, {"type": "network"}, {"type": "ipc"}, {"type": "uts"}, {"type": "mount"}]
  }
}
CONFIG
}

N=0
RUN=""
run_sandbox() {
  # $1 is extra runsc flags, the output of the sandbox goes to stdout
  N=$((N + 1))
  # shellcheck disable=SC2086
  "$RUNSC" --rootless --platform=systrap --network=none --ignore-cgroups \
    --root="$RUN/state" --debug --debug-log="$RUN/log/" $1 \
    run --bundle "$B" "caw-proof-$$-$N"
}

have_nc=no
if command -v nc >/dev/null 2>&1; then have_nc=yes; fi
echo "nc on the host: $have_nc"

FAILED=1
V=0
for flags in "--host-uds=open" "--host-uds=all" "--host-uds=open --directfs=false" "--host-uds=all --directfs=false"; do
  V=$((V + 1))
  RUN="$W/run$V"
  mkdir -p "$RUN/state" "$RUN/log"
  echo
  echo "== sandbox run with extra flags: [${flags}]"
  stop_listeners
  rm -f "$W/sock/egress.sock" "$W/work/ok"
  SOCKOUT="$RUN/sock.txt"
  : > "$SOCKOUT"
  if [ "$have_nc" = yes ]; then
    nc -lkU "$W/sock/egress.sock" > "$SOCKOUT" 2>/dev/null &
    PIDS="$PIDS $!"
    nc -lk "$PORT" >/dev/null 2>&1 &
    PIDS="$PIDS $!"
    sleep 1
    echo control | nc -N -w 2 -U "$W/sock/egress.sock" 2>&1
    sleep 0.3
    if grep -q control "$SOCKOUT"; then echo "control: the host reaches its own Unix socket"; else echo "control: the host does not reach its own Unix socket, host-unix-socket proves nothing"; fi
    if [ -n "$ADDR" ] && nc -w 2 -z "$ADDR" "$PORT" 2>/dev/null; then echo "control: the host reaches its own listener"; else echo "control: the host does not reach its own listener, denied-connect proves nothing"; fi
  fi
  write_config '["/bin/sh", "/proof/inside.sh"]'
  run_sandbox "$flags" > "$RUN/out.txt" 2> "$RUN/err.txt"
  echo "runsc exit: $?"
  cat "$RUN/out.txt"
  if grep -q '^FACT ' "$RUN/out.txt"; then
    sleep 0.3
    {
      if grep -q caw-proof-socket "$SOCKOUT"; then echo "FACT host-unix-socket PASS a line sent in the sandbox reached the host socket"; else echo "FACT host-unix-socket FAIL no line reached the host socket"; fi
      if [ -f "$W/work/ok" ]; then echo "FACT workspace-write-on-host PASS the write reached the host folder"; else echo "FACT workspace-write-on-host FAIL the write did not reach the host folder"; fi
      if [ -e "$B/rootfs/caw-root-write" ]; then echo "FACT root-untouched-on-host FAIL the host root folder changed"; else echo "FACT root-untouched-on-host PASS the host root folder is unchanged"; fi
      echo "FACT platform-systrap-rootless-no-cgroups PASS the sandbox ran with flags [${flags}]"
    } | tee -a "$RUN/out.txt"
    FAILED="$(grep -c '^FACT .* FAIL ' "$RUN/out.txt")"
    if [ "$FAILED" = 0 ]; then
      echo
      echo "== start time of one command, five runs, milliseconds"
      write_config '["/usr/bin/true"]'
      for i in 1 2 3 4 5; do
        t0=$(date +%s%N)
        run_sandbox "$flags" >/dev/null 2>&1
        rc=$?
        t1=$(date +%s%N)
        echo "run $i: $(( (t1 - t0) / 1000000 )) ms, exit $rc"
      done
      break
    fi
    echo "lines of the debug logs that name the socket:"
    grep -h -i -E 'egress.sock|host.uds|hostuds' "$RUN"/log/* 2>/dev/null | grep -v 'config.go' | tail -8 | cut -c1-400
    continue
  fi
  echo "the sandbox printed no fact, standard error and the end of the debug logs follow"
  tail -20 "$RUN/err.txt"
  for f in "$RUN"/log/*; do
    [ -f "$f" ] || continue
    echo "-- $f"
    grep -v 'config.go' "$f" | tail -15
  done
done

echo
echo "== trace points and sinks of this runsc, without the syscall points"
"$RUNSC" trace metadata 2>&1 | grep -v '^Name: syscall/' | head -40

echo
if [ "$FAILED" = 0 ]; then
  echo "gvisor-facts: every fact holds with flags [${flags}]"
  exit 0
fi
echo "gvisor-facts: $FAILED fact or facts do not hold in the last run"
exit 1
