#!/bin/sh
set -eu

AEP_DATA="${AEP_DATA:-/data/aep}"
AEP_SOCKET_BASE="${AEP_SOCKET_BASE:-/data/aep/sockets}"
export AEP_TASK_MANIFEST_DIR="${AEP_TASK_MANIFEST_DIR:-${AEP_DATA}/ucb/manifests}"
CONFIG="${AEP_DATA}/base-node.json"
LATTICE_DB="${AEP_DATA}/action-lattice.db"
UCB_PID=""
DAEMON_PID=""
DAEMON_PIDFILE="/run/aep/daemon.pid"

mkdir -p "${AEP_DATA}" "${AEP_SOCKET_BASE}" /run/aep


if [ "${1:-}" = "ucb" ]; then
  shift
  exec aep-ucb "$@"
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
  "version": "2.8.6",
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

wait_for_docks() {
  i=0
  while [ "$i" -lt 30 ]; do
    if [ -S "${AEP_SOCKET_BASE}/validation" ]; then
      return 0
    fi
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



# CAW (execution-layer security) is host ELS. The public Docker image may not
# ship aep-caw; coding agents on the host should enable CAW on the host.
# CAW host ELS note: do not claim container-side aep-caw is always running.
if [ "${CAW:-0}" = "1" ] && command -v aep-caw >/dev/null 2>&1; then
  echo "CAW binary present (aep-caw); operator must still wrap workloads explicitly." >&2
elif [ "${CAW:-0}" = "1" ]; then
  echo "WARN: CAW=1 set but aep-caw not on PATH in this image (host ELS expected outside container)." >&2
fi

start_daemon() {
  bootstrap_config
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
}
trap cleanup INT TERM

start_daemon

if ! wait_for_docks; then
  echo "ERROR: Base Node daemon failed to open validation dock at ${AEP_SOCKET_BASE}/validation" >&2
  exit 1
fi


start_ucb || exit 1

echo "AEP Base Node ready." >&2
if [ -f "${AEP_DATA}/ucb-api-key.recovery.txt" ]; then
  echo "  UCB API key recovery: docker compose exec aep cat /data/aep/ucb-api-key.recovery.txt" >&2
fi

while true; do
  if ! process_alive "${DAEMON_PID}"; then
    echo "Base Node daemon exited; restarting with current config..." >&2
    start_daemon
    wait_for_docks || exit 1
  fi


  if [ "${UCB:-1}" != "0" ] && ! process_alive "${UCB_PID}"; then
    echo "UCB exited; restarting..." >&2
    start_ucb || exit 1
  fi


  sleep 2
done
