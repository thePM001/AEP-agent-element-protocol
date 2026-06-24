#!/bin/sh
set -eu

AEP_DATA="${AEP_DATA:-/data/aep}"
AEP_SOCKET_BASE="${AEP_SOCKET_BASE:-/data/aep/sockets}"
export AEP_TASK_MANIFEST_DIR="${AEP_TASK_MANIFEST_DIR:-${AEP_DATA}/ucb/manifests}"
CONFIG="${AEP_DATA}/base-node.json"
LATTICE_DB="${AEP_DATA}/action-lattice.db"
COMPOSER_PID=""
UCB_PID=""
WASM_PID=""
DAEMON_PID=""
DAEMON_PIDFILE="/run/aep/daemon.pid"

mkdir -p "${AEP_DATA}" "${AEP_SOCKET_BASE}" /run/aep

if [ "${1:-}" = "setup-agent" ]; then
  shift
  exec node /opt/aep/AEP-Components/cca/setup-agent.mjs "$@"
fi

if [ "${1:-}" = "cca" ] || [ "${1:-}" = "aep-cca" ]; then
  shift
  exec node /opt/aep/AEP-Components/cca/cca.mjs "$@"
fi

if [ "${1:-}" = "composer-lite" ] || [ "${1:-}" = "wasm-composer" ]; then
  shift
  exec node /opt/aep/AEP-Composer-Lite/server.mjs "$@"
fi

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
  "version": "2.8.0",
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
  },
  "epscom_signatures": {
    "enabled": true,
    "path": "/opt/aep/AEP-Base-Node/signatures",
    "trust_bundle": "trust-bundle/manifest.json",
    "sync_interval_hours": 24
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

wait_for_composer_lite() {
  i=0
  while [ "$i" -lt 30 ]; do
    if node -e "fetch('http://127.0.0.1:${COMPOSER_LITE_PORT:-8424}/api/health').then(()=>process.exit(0)).catch(()=>process.exit(1))" 2>/dev/null; then
      return 0
    fi
    i=$((i + 1))
    sleep 1
  done
  return 1
}

wait_for_wasm_sandbox() {
  i=0
  while [ "$i" -lt 20 ]; do
    if [ -S "${AEP_SOCKET_BASE}/wasm_sandbox" ]; then
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

start_composer_lite() {
  if [ "${COMPOSER_LITE:-1}" = "0" ]; then
    COMPOSER_PID=""
    return 0
  fi
  cd /opt/aep
  node /opt/aep/AEP-Composer-Lite/server.mjs >&2 &
  COMPOSER_PID=$!
  echo "AEP Composer Lite (WASM canvas): http://127.0.0.1:${COMPOSER_LITE_PORT:-8424}" >&2
  if ! wait_for_composer_lite; then
    echo "ERROR: Composer Lite failed to start on port ${COMPOSER_LITE_PORT:-8424}" >&2
    COMPOSER_PID=""
    return 1
  fi
}

start_daemon() {
  bootstrap_config
  aep-base-node --daemon --config "${CONFIG}" &
  DAEMON_PID=$!
  echo "${DAEMON_PID}" > "${DAEMON_PIDFILE}"
}

start_wasm_sandbox() {
  if [ "${WASM_SANDBOX:-1}" = "0" ]; then
    WASM_PID=""
    return 0
  fi
  if [ ! -x /usr/local/bin/aep-wasm-sandbox ]; then
    echo "ERROR: aep-wasm-sandbox binary missing (WASM_SANDBOX=1 requires lattice WASM sandbox)" >&2
    return 1
  fi
  AEP_SOCKET_BASE="${AEP_SOCKET_BASE}" \
  AEP_LATTICE_DB="${LATTICE_DB}" \
  AEP_DATA="${AEP_DATA}" \
  AEP_LATTICE_STRICT="${AEP_LATTICE_STRICT:-1}" \
  WASM_SANDBOX_SOCKET="${AEP_SOCKET_BASE}/wasm_sandbox" \
    /usr/local/bin/aep-wasm-sandbox >&2 &
  WASM_PID=$!
  echo "AEP WASM sandbox: lattice socket ${AEP_SOCKET_BASE}/wasm_sandbox" >&2
  if ! wait_for_wasm_sandbox; then
    echo "ERROR: WASM sandbox failed to open lattice socket ${AEP_SOCKET_BASE}/wasm_sandbox" >&2
    WASM_PID=""
    return 1
  fi
}

cleanup() {
  if [ -n "${DAEMON_PID:-}" ]; then
    kill "${DAEMON_PID}" 2>/dev/null || true
  fi
  if [ -n "${COMPOSER_PID}" ]; then
    kill "${COMPOSER_PID}" 2>/dev/null || true
  fi
  if [ -n "${UCB_PID}" ]; then
    kill "${UCB_PID}" 2>/dev/null || true
  fi
  if [ -n "${WASM_PID}" ]; then
    kill "${WASM_PID}" 2>/dev/null || true
  fi
}
trap cleanup INT TERM

start_daemon

if ! wait_for_docks; then
  echo "ERROR: Base Node daemon failed to open validation dock at ${AEP_SOCKET_BASE}/validation" >&2
  exit 1
fi

if [ "${AEP_AUTO_SETUP:-}" = "1" ] && [ ! -f "${AEP_DATA}/activation.json" ]; then
  if [ -n "${AEP_CCA_INTENT:-}" ]; then
    node /opt/aep/AEP-Components/cca/setup-agent.mjs --cca --intent "${AEP_CCA_INTENT}" || exit 1
  else
    node /opt/aep/AEP-Components/cca/setup-agent.mjs --non-interactive --skip-if-activated || exit 1
  fi
  if [ -n "${DAEMON_PID}" ]; then
    kill "${DAEMON_PID}" 2>/dev/null || true
    wait "${DAEMON_PID}" 2>/dev/null || true
  fi
  start_daemon
  wait_for_docks || exit 1
fi

start_composer_lite || exit 1
start_ucb || exit 1
start_wasm_sandbox || exit 1

echo "AEP Base Node ready." >&2
echo "  Install wizard: http://127.0.0.1:${COMPOSER_LITE_PORT:-8424}/install" >&2
echo "  Composer canvas: http://127.0.0.1:${COMPOSER_LITE_PORT:-8424}/" >&2
if [ -f "${AEP_DATA}/ucb-api-key.recovery.txt" ]; then
  echo "  UCB API key recovery: docker compose exec aep cat /data/aep/ucb-api-key.recovery.txt" >&2
fi
echo "  CLI setup agent: docker compose exec aep aep-setup-agent --non-interactive" >&2

while true; do
  if ! process_alive "${DAEMON_PID}"; then
    echo "Base Node daemon exited; restarting with current config..." >&2
    start_daemon
    wait_for_docks || exit 1
  fi

  if [ "${COMPOSER_LITE:-1}" != "0" ] && ! process_alive "${COMPOSER_PID}"; then
    echo "Composer Lite exited; restarting..." >&2
    start_composer_lite || exit 1
  fi

  if [ "${UCB:-1}" != "0" ] && ! process_alive "${UCB_PID}"; then
    echo "UCB exited; restarting..." >&2
    start_ucb || exit 1
  fi

  if [ "${WASM_SANDBOX:-1}" != "0" ] && [ -x /usr/local/bin/aep-wasm-sandbox ] && ! process_alive "${WASM_PID}"; then
    echo "WASM sandbox exited; restarting..." >&2
    start_wasm_sandbox || exit 1
  fi

  sleep 2
done