#!/bin/sh
set -eu

AEP_DATA="${AEP_DATA:-/data/aep}"
AEP_SOCKET_BASE="${AEP_SOCKET_BASE:-/data/aep/sockets}"
export AEP_TASK_MANIFEST_DIR="${AEP_TASK_MANIFEST_DIR:-${AEP_DATA}/ucb/manifests}"
CONFIG="${AEP_DATA}/base-node.json"
LATTICE_DB="${AEP_DATA}/action-lattice.db"
UCB_PID=""
UCM_PID=""
DAEMON_PID=""
DAEMON_PIDFILE="/run/aep/daemon.pid"
CAW_DATA="${AEP_DATA}/caw-framework"
HUB_DIR="${AEP_DATA}/gap/policies/reference"
# The reference profiles that run in this image. ede-draft needs a Rust toolchain on
# the host and is left out. CAW_PROFILES narrows or widens the list of a fresh caw.toml.
CAW_DEFAULT_PROFILES="restricted coding-agent compiled-runtime agent-sandbox dev-multi-repo"

# The image runs the Base Node and the CAW as the user aep. The CAW never starts a
# sandbox as root, so CAW=1 refuses a container started with --user 0.
if [ "${CAW:-0}" = "1" ] && [ "$(id -u)" = 0 ]; then
  echo "ERROR: CAW=1 needs a user that is not root. Start the container without --user 0." >&2
  exit 2
fi
# The gVisor pin covers amd64. An image built for another platform carries no runsc.
if [ "${CAW:-0}" = "1" ] && [ ! -x /usr/bin/runsc ]; then
  echo "ERROR: CAW=1 needs gVisor and this image for $(uname -m) carries none: the gVisor pin of the CAW covers amd64 only." >&2
  exit 2
fi

# A data volume written by an earlier image that ran as root belongs to root. The
# user of this image cannot write it, so the container names the one fix and stops.
if [ -d "${AEP_DATA}" ] && [ ! -w "${AEP_DATA}" ]; then
  echo "ERROR: ${AEP_DATA} is not writable by uid $(id -u). A volume of an earlier image belongs to root. Give it to this user once:" >&2
  echo "  docker run --rm --user 0 --entrypoint chown -v <volume>:${AEP_DATA} <image> -R $(id -u):$(id -g) ${AEP_DATA}" >&2
  exit 2
fi

mkdir -p "${AEP_DATA}" "${AEP_SOCKET_BASE}" /run/aep
LATTICE_YAML="${AEP_DATA}/lattice.yaml"
export AEP_LATTICE_YAML="${LATTICE_YAML}"
# The Base Node refuses to start without a lattice. Seed the shipped default on a
# fresh volume and never overwrite a lattice the operator already placed.
if [ ! -f "${LATTICE_YAML}" ] && [ -f /opt/aep/lattice.default.yaml ]; then
  cp /opt/aep/lattice.default.yaml "${LATTICE_YAML}"
  chmod 600 "${LATTICE_YAML}" 2>/dev/null || true
  echo "Seeded default lattice at ${LATTICE_YAML}. Replace it with the lattice of this deployment." >&2
fi
# The Agent Control Hub reads the caw-*.gap files of ${HUB_DIR}. A fresh data folder
# gets the reference sandbox profiles of the image and the hub grant of the CAW kernel
# dock. A hub the operator already placed is never overwritten.
if [ ! -d "${HUB_DIR}" ] && [ -f /opt/aep/hub/caw-kernel-dock.gap ]; then
  mkdir -p "${HUB_DIR}"
  cp /opt/aep/AEP-Components/gap/policies/reference/caw-*.gap "${HUB_DIR}/"
  cp /opt/aep/hub/caw-kernel-dock.gap "${HUB_DIR}/"
  echo "Seeded the hub at ${HUB_DIR} with the reference profiles and the grant of the CAW kernel dock." >&2
fi


if [ "${1:-}" = "ucb" ]; then
  shift
  exec aep-ucb "$@"
fi

if [ "${1:-}" = "ucm" ]; then
  shift
  exec aep-ucm "$@"
fi

if [ "${1:-}" = "aep-base-node" ]; then
  shift
  exec aep-base-node "$@"
fi

if [ "$#" -gt 0 ]; then
  exec "$@"
fi

bootstrap_config() {
  if [ -f "${CONFIG}" ]; then
    return 0
  fi
  SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
  cat > "${CONFIG}" <<EOF
{
  "version": "2.9",
  "base_node": {
    "socket_base": "${AEP_SOCKET_BASE}",
    "lattice_db": "${LATTICE_DB}",
    "binary_path": "/usr/local/bin/aep-base-node",
    "epscom_priority": 255,
    "lrps": [
      "aep-275-eval-chain"
    ],
    "lattice_channel_secret": "${SECRET}",
    "internet_up": true,
    "mesh_peers": 0
  }
}
EOF
  chmod 600 "${CONFIG}" 2>/dev/null || true
}

process_alive() {
  pid="$1"
  [ -n "${pid}" ] && kill -0 "${pid}" 2>/dev/null
}

# A daemon that exits 2 refused its own configuration, for example a Data Dock
# key file that is too short or readable by others. Restarting cannot fix
# that, so the container stops with the same code and the log names the reason.
stop_on_config_error() {
  if process_alive "${DAEMON_PID:-}"; then
    return 0
  fi
  code=0
  wait "${DAEMON_PID}" 2>/dev/null || code=$?
  if [ "${code}" = "2" ]; then
    echo "ERROR: Base Node daemon refused its configuration (exit 2). Check DATA_DOCK_HOST and DATA_DOCK_API_KEY." >&2
    exit 2
  fi
}

wait_for_docks() {
  i=0
  while [ "$i" -lt 30 ]; do
    if [ -S "${AEP_SOCKET_BASE}/validation" ]; then
      return 0
    fi
    stop_on_config_error
    i=$((i + 1))
    sleep 1
  done
  return 1
}

wait_for_ucb() {
  UCB_HEALTH_PATH="/health"
  if [ -n "${UCB_BASE_PATH:-}" ]; then
    UCB_HEALTH_PATH="${UCB_BASE_PATH%/}/health"
  fi
  i=0
  while [ "$i" -lt 30 ]; do
    if node -e "fetch('http://127.0.0.1:${UCB_PORT:-8412}${UCB_HEALTH_PATH}').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

wait_for_data_dock() {
  if [ "${DATA_DOCK:-1}" = "0" ]; then
    return 0
  fi
  i=0
  while [ "$i" -lt 30 ]; do
    # Ready means GET /health answers 200 with a status other than error.
    if /usr/local/bin/aep-health-probe 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}



start_ucb() {
  if [ "${UCB:-1}" = "0" ]; then
    UCB_PID=""
    return 0
  fi
  aep-ucb >&2 &
  UCB_PID=$!
  echo "AEP Universal Connect Bridge (UCB): http://127.0.0.1:${UCB_PORT:-8412}" >&2
  if ! wait_for_ucb; then
    echo "ERROR: UCB failed to start on port ${UCB_PORT:-8412}" >&2
    UCB_PID=""
    return 1
  fi
}


# The Universal Computation Module is off unless UCM=1. Its node key, receipts and
# receipt log live under ${AEP_DATA}/ucm.
wait_for_ucm() {
  i=0
  while [ "$i" -lt 30 ]; do
    if node -e "fetch('http://127.0.0.1:${UCM_PORT:-8414}/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

start_ucm() {
  if [ "${UCM:-0}" != "1" ]; then
    UCM_PID=""
    return 0
  fi
  export AEP_LATTICE_DB="${AEP_LATTICE_DB:-${LATTICE_DB}}"
  aep-ucm serve >&2 &
  UCM_PID=$!
  echo "AEP Universal Computation Module (UCM): http://127.0.0.1:${UCM_PORT:-8414}" >&2
  if ! wait_for_ucm; then
    echo "ERROR: UCM failed to start on port ${UCM_PORT:-8414}" >&2
    UCM_PID=""
    return 1
  fi
}


# With CAW=1 the image prepares the Rust CAW beside the running Base Node: the GAP
# compiler writes the profile records of the image, a fresh caw.toml allows the
# profiles of CAW_PROFILES and the CAW doctor must pass, which includes one sealed
# root:ping that the kernel dock admits. A failed doctor stops the container, because
# CAW=1 promises that agent commands run confined.
write_caw_config() {
  profiles="${CAW_PROFILES:-${CAW_DEFAULT_PROFILES}}"
  list=""
  for id in $(printf '%s' "${profiles}" | tr ',' ' '); do
    case "${id}" in
      *[!a-z0-9-]* | "")
        echo "ERROR: CAW_PROFILES holds the name '${id}'; a profile id is lower case letters, digits and hyphens" >&2
        return 1
        ;;
    esac
    list="${list}${list:+, }\"${id}\""
  done
  if [ -z "${list}" ]; then
    echo "ERROR: CAW_PROFILES names no profile" >&2
    return 1
  fi
  cat > "${CAW_DATA}/caw.toml" <<EOF
allowed_profiles = [${list}]
runsc = "/usr/bin/runsc"
init = "/usr/local/bin/aep-caw-init"
base_node_data = "${AEP_DATA}"
dock_socket = "${AEP_SOCKET_BASE}/validation"
EOF
  chmod 600 "${CAW_DATA}/caw.toml"
  echo "Wrote ${CAW_DATA}/caw.toml with the profiles: ${list}" >&2
}

prepare_caw() {
  if [ "${CAW:-0}" != "1" ]; then
    return 0
  fi
  if ! node /opt/aep/AEP-Components/gap/lib/gap-compile.mjs --materialize "${AEP_DATA}" > /dev/null; then
    echo "ERROR: the GAP compiler could not write the CAW profile records into ${CAW_DATA}/profiles" >&2
    return 1
  fi
  if [ ! -f "${CAW_DATA}/caw.toml" ]; then
    write_caw_config || return 1
  fi
  if ! aep-caw doctor --data "${AEP_DATA}" >&2; then
    echo "ERROR: CAW=1 and the CAW doctor fails. The container needs the run options of docker-compose.caw.yml." >&2
    echo "  A host that restricts user namespaces through AppArmor also needs docker-compose.caw-apparmor.yml." >&2
    echo "  A data folder of an earlier image keeps its lattice and hub: grant root:ping to caw-kernel-dock in ${LATTICE_YAML}" >&2
    echo "  and copy /opt/aep/hub/caw-kernel-dock.gap into ${HUB_DIR}." >&2
    return 1
  fi
  echo "AEP CAW ready: aep-caw session create --data ${AEP_DATA} --profile <id> --workspace <folder> --var HOME=${AEP_DATA} [--var NAME=VALUE]..." >&2
}

# With UCM_LATTICE_RECORD=1 UCM records each receipt digest as agent aep-ucm on the
# lattice action ucm:receipt. The daemon reads agent sign keys at boot, so the key is
# provisioned first. Provisioning returns an existing key unchanged.
provision_ucm_record_key() {
  if [ "${UCM:-0}" = "1" ] && [ "${UCM_LATTICE_RECORD:-0}" = "1" ]; then
    aep-base-node --config "${CONFIG}" --provision-agent-sign-key --agent-id aep-ucm >/dev/null 2>&1 \
      || echo "WARN: could not provision the sign key of agent aep-ucm; UCM lattice records will fail" >&2
  fi
}

start_daemon() {
  bootstrap_config
  provision_ucm_record_key
  aep-base-node --daemon --config "${CONFIG}" &
  DAEMON_PID=$!
  echo "${DAEMON_PID}" > "${DAEMON_PIDFILE}"
}


cleanup() {
  if [ -n "${DAEMON_PID:-}" ]; then
    kill "${DAEMON_PID}" 2>/dev/null || true
  fi
  if [ -n "${UCB_PID}" ]; then
    kill "${UCB_PID}" 2>/dev/null || true
  fi
  if [ -n "${UCM_PID}" ]; then
    kill "${UCM_PID}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM

start_daemon

if ! wait_for_docks; then
  echo "ERROR: Base Node daemon failed to open the validation dock at ${AEP_SOCKET_BASE}" >&2
  exit 1
fi

echo "AEP Data Dock: http://127.0.0.1:${DATA_DOCK_PORT:-8413}" >&2
if ! wait_for_data_dock; then
  echo "ERROR: Data Dock failed to start on port ${DATA_DOCK_PORT:-8413}" >&2
  exit 1
fi
start_ucb || exit 1
start_ucm || exit 1
prepare_caw || exit 1
echo "AEP Base Node ready." >&2
if [ -f "${AEP_DATA}/ucb-api-key.recovery.txt" ]; then
  echo "  UCB API key recovery: docker compose exec aep cat /data/aep/ucb-api-key.recovery.txt" >&2
fi

while true; do
  if ! process_alive "${DAEMON_PID}"; then
    stop_on_config_error
    echo "Base Node daemon exited; restarting with current config..." >&2
    start_daemon
    wait_for_docks || exit 1

    wait_for_data_dock || exit 1
  fi

  if [ "${UCB:-1}" != "0" ] && ! process_alive "${UCB_PID}"; then
    echo "UCB exited; restarting..." >&2
    start_ucb || exit 1
  fi

  if [ "${UCM:-0}" = "1" ] && ! process_alive "${UCM_PID}"; then
    echo "UCM exited; restarting..." >&2
    start_ucm || exit 1
  fi


  sleep 2
done
