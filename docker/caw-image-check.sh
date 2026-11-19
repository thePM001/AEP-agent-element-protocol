#!/usr/bin/env bash
# Check of the CAW in the Docker image.
#
# Builds the image and its proof target, runs the image with CAW=1 and proves:
# the Base Node and the CAW run as one user that is not root, the CAW opens a
# session, runs an allowed command in the gVisor sandbox, refuses a read outside
# the workspace with a deny event and asks the kernel dock before each command.
# Then it runs the proof scripts of the CAW inside a container of the proof target.
#
# Usage, from the repository root:
#
#   bash docker/caw-image-check.sh
#
# AEP_CAW_IMAGE and AEP_CAW_PROOF_IMAGE name images that are already built and
# skip the build. The host needs Docker and, when it restricts user namespaces
# through AppArmor, one run of AEP-CAWs-RustGvisor/proof/install-runsc.sh as root.
#
# Prints one line per check: CHECK <name> PASS|FAIL <detail>.
# Exit 0 only when every check holds.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
IMAGE="${AEP_CAW_IMAGE:-}"
PROOF_IMAGE="${AEP_CAW_PROOF_IMAGE:-}"
NAME="aep-caw-check-$$"
PROFILE="${AEP_CAW_CHECK_PROFILE:-restricted}"

FAILED=0
pass() { echo "CHECK $1 PASS $2"; }
fail() {
  FAILED=$((FAILED + 1))
  echo "CHECK $1 FAIL $2"
}

cleanup() {
  docker rm -f "$NAME" > /dev/null 2>&1 || true
}
trap cleanup EXIT

if [ -z "$IMAGE" ]; then
  IMAGE="aep-base-node:caw-check"
  echo "building $IMAGE"
  docker build -t "$IMAGE" "$ROOT" || { fail image-builds "docker build failed"; exit 1; }
fi
if [ -z "$PROOF_IMAGE" ]; then
  PROOF_IMAGE="aep-base-node:caw-proof"
  echo "building $PROOF_IMAGE"
  docker build --target caw-proof -t "$PROOF_IMAGE" "$ROOT" || { fail proof-image-builds "docker build --target caw-proof failed"; exit 1; }
fi

# The run options of a container that runs gVisor. runsc creates a user namespace
# and mounts inside it, which the default seccomp and AppArmor profiles of Docker
# refuse. gVisor filters the system calls of the sandbox itself. Every capability
# is dropped and no process may gain one.
RUN_OPTS=(
  --security-opt seccomp=unconfined
  --security-opt apparmor=unconfined
  --security-opt no-new-privileges
  --cap-drop ALL
)
# A host that restricts user namespaces through AppArmor lets runsc create one only
# under the profile that install-runsc.sh loads. The CAW doctor reads that profile,
# so the container sees the file of the host, read only.
RESTRICT=/proc/sys/kernel/apparmor_restrict_unprivileged_userns
if [ -r "$RESTRICT" ] && [ "$(cat "$RESTRICT")" = 1 ]; then
  if [ ! -f /etc/apparmor.d/runsc ]; then
    fail host-apparmor-profile "this host restricts user namespaces and has no /etc/apparmor.d/runsc: run AEP-CAWs-RustGvisor/proof/install-runsc.sh as root once"
    exit 1
  fi
  RUN_OPTS+=(--mount type=bind,source=/etc/apparmor.d/runsc,target=/etc/apparmor.d/runsc,readonly)
fi

in_box() {
  docker exec "$NAME" "$@"
}

docker run -d --name "$NAME" "${RUN_OPTS[@]}" -e CAW=1 -e UCB=0 "$IMAGE" > /dev/null \
  || { fail container-starts "docker run failed"; exit 1; }

ready=no
for _ in $(seq 1 90); do
  if docker logs "$NAME" 2>&1 | grep -q -F "AEP Base Node ready."; then ready=yes; break; fi
  if [ "$(docker inspect -f '{{.State.Running}}' "$NAME" 2>/dev/null)" != true ]; then break; fi
  sleep 1
done
if [ "$ready" = yes ]; then
  pass container-is-ready "$(docker logs "$NAME" 2>&1 | grep -F "CAW" | tail -1 | cut -c1-120)"
else
  fail container-is-ready "the container did not report ready, end of the log:"
  docker logs "$NAME" 2>&1 | tail -n 20 | sed 's/^/    /'
  exit 1
fi

uid="$(in_box id -u)"
if [ -n "$uid" ] && [ "$uid" != 0 ]; then
  pass container-user-is-not-root "uid $uid"
else
  fail container-user-is-not-root "uid ${uid:-unknown}"
fi

node_uid="$(in_box ps -o uid= -C aep-base-node | head -1 | tr -d ' ')"
if [ -n "$node_uid" ] && [ "$node_uid" = "$uid" ]; then
  pass base-node-runs-as-the-caw-user "uid $node_uid"
else
  fail base-node-runs-as-the-caw-user "Base Node uid ${node_uid:-none}, CAW uid ${uid:-unknown}"
fi

doctor="$(in_box aep-caw doctor --data /data/aep 2>&1)"
if [ $? = 0 ] && printf '%s' "$doctor" | grep -q -F "admits a sealed ping"; then
  pass doctor-is-healthy "$(printf '%s' "$doctor" | grep -c '^ok') checks hold"
else
  fail doctor-is-healthy "aep-caw doctor reports:"
  printf '%s\n' "$doctor" | sed 's/^/    /'
fi

WS=/workspace/caw-check
# Every reference profile masks the secrets below ${HOME}, the home folder of the user
# aep in the image. The profile restricted routes its egress to the model gateway.
VARS=(--var HOME=/data/aep --var AEP_MODEL_GATEWAY_HOST=model-gateway.example.com)
in_box sh -c "mkdir -p $WS && echo inside-the-workspace > $WS/note.txt"
session="$(in_box aep-caw session create --data /data/aep --profile "$PROFILE" --workspace "$WS" "${VARS[@]}" 2> /dev/null)"
if [ -n "$session" ]; then
  pass session-opens "profile $PROFILE session $session"
else
  fail session-opens "aep-caw session create under $PROFILE printed no session id:"
  in_box aep-caw session create --data /data/aep --profile "$PROFILE" --workspace "$WS" "${VARS[@]}" 2>&1 | sed 's/^/    /'
  exit 1
fi

out="$(in_box aep-caw exec --data /data/aep --session "$session" --run cat "$WS/note.txt" 2>&1)"
code=$?
if [ "$code" = 0 ] && printf '%s' "$out" | grep -q -F inside-the-workspace; then
  pass allowed-command-runs-in-the-sandbox "exit 0"
else
  fail allowed-command-runs-in-the-sandbox "exit $code:"
  printf '%s\n' "$out" | sed 's/^/    /' | head -8
fi

out="$(in_box aep-caw exec --data /data/aep --session "$session" --run sh -c 'cat /proc/version' 2>&1)"
if printf '%s' "$out" | grep -q -i gvisor || printf '%s' "$out" | grep -q -F "Linux version 4.4.0"; then
  pass command-runs-on-the-gvisor-kernel "$(printf '%s' "$out" | head -1 | cut -c1-80)"
else
  fail command-runs-on-the-gvisor-kernel "the kernel inside does not look like gVisor:"
  printf '%s\n' "$out" | sed 's/^/    /' | head -4
fi

# The key store of the Base Node lies outside every mount of the sandbox.
out="$(in_box aep-caw exec --data /data/aep --session "$session" --run cat /data/aep/base-node.json 2>&1)"
code=$?
audit="$(in_box cat "/data/aep/caw-framework/sessions/$session/audit.log" 2> /dev/null)"
if [ "$code" != 0 ] && printf '%s\n%s' "$out" "$audit" | grep -q -F "/data/aep/base-node.json"; then
  pass read-outside-the-workspace-is-denied "exit $code with a deny event"
else
  fail read-outside-the-workspace-is-denied "exit $code:"
  printf '%s\n' "$out" | sed 's/^/    /' | head -8
fi

# With the Base Node stopped no command starts.
in_box sh -c 'kill -STOP $(cat /run/aep/daemon.pid)'
out="$(in_box aep-caw exec --data /data/aep --session "$session" --time-limit 20 --run cat "$WS/note.txt" 2>&1)"
code=$?
in_box sh -c 'kill -CONT $(cat /run/aep/daemon.pid)'
if [ "$code" = 126 ] && printf '%s' "$out" | grep -q -F kernel-dock-silent; then
  pass silent-kernel-dock-refuses "exit 126 kernel-dock-silent"
else
  fail silent-kernel-dock-refuses "exit $code:"
  printf '%s\n' "$out" | sed 's/^/    /' | head -6
fi

docker rm -f "$NAME" > /dev/null 2>&1

echo "running the proof scripts of the CAW inside $PROOF_IMAGE"
if docker run --rm "${RUN_OPTS[@]}" "$PROOF_IMAGE" aep-caw-proof; then
  pass proof-scripts-pass-in-the-container "every proof script holds"
else
  fail proof-scripts-pass-in-the-container "a proof script failed, see above"
fi

echo
if [ "$FAILED" = 0 ]; then
  echo "caw-image-check: every check holds"
  exit 0
fi
echo "caw-image-check: $FAILED check or checks do not hold"
exit 1
