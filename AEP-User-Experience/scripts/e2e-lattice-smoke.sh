#!/usr/bin/env bash
# Biosecurity e2e smoke: base node + wasm lattice socket + composer lite health.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/rust/target/release"
DATA="$(mktemp -d)"
SOCK="$DATA/sockets"
mkdir -p "$SOCK"

cleanup() {
  kill "$DAEMON_PID" "$WASM_PID" "$COMPOSER_PID" 2>/dev/null || true
  rm -rf "$DATA"
}
trap cleanup EXIT

cat > "$DATA/base-node.json" <<EOF
{
  "version": "2.8.0",
  "base_node": {
    "socket_base": "$SOCK",
    "lattice_db": "$DATA/action-lattice.db",
    "lrps": ["dynaep-action-lattice", "lattice-channel-default"],
    "internet_up": true
  }
}
EOF

"$BIN/aep-base-node" --daemon --config "$DATA/base-node.json" &
DAEMON_PID=$!

for i in $(seq 1 20); do
  [ -S "$SOCK/validation" ] && break
  sleep 0.5
done
[ -S "$SOCK/validation" ] || { echo "FAIL: validation dock missing"; exit 1; }

AEP_DATA="$DATA" AEP_SOCKET_BASE="$SOCK" AEP_LATTICE_DB="$DATA/action-lattice.db" \
  AEP_LATTICE_LOG_BIN="$BIN/aep-lattice-log" AEP_LATTICE_STRICT=1 \
  WASM_SANDBOX_SOCKET="$SOCK/wasm_sandbox" \
  "$BIN/aep-wasm-sandbox" &
WASM_PID=$!

for i in $(seq 1 20); do
  [ -S "$SOCK/wasm_sandbox" ] && break
  sleep 0.5
done
[ -S "$SOCK/wasm_sandbox" ] || { echo "FAIL: wasm_sandbox socket missing"; exit 1; }

HARNESS_NODE="$ROOT/AEP-Components/conformance/harness/node_modules"
if [ ! -d "$HARNESS_NODE/ws" ]; then
  npm install --prefix "$ROOT/AEP-Components/conformance/harness" --no-save 2>/dev/null || true
fi
export NODE_PATH="${HARNESS_NODE}${NODE_PATH:+:$NODE_PATH}"
AEP_DATA="$DATA" AEP_SOCKET_BASE="$SOCK" AEP_LATTICE_LOG_BIN="$BIN/aep-lattice-log" \
  AEP_LATTICE_STRICT=1 COMPOSER_LITE_PORT=8440 \
  node "$ROOT/composer-lite/server.mjs" &
COMPOSER_PID=$!

for i in $(seq 1 20); do
  curl -sf "http://127.0.0.1:8440/api/health" >/dev/null 2>&1 && break
  sleep 0.5
done

HEALTH="$(curl -sf "http://127.0.0.1:8440/api/health")"
echo "$HEALTH" | grep -q '"service":"aep-composer-lite"' || { echo "FAIL: composer health"; exit 1; }

WASM_HEALTH="$(curl -sf "http://127.0.0.1:8440/api/wasm-sandbox/health")"
echo "$WASM_HEALTH" | grep -q '"ok":true' || { echo "FAIL: wasm lattice health: $WASM_HEALTH"; exit 1; }

echo "PASS: e2e lattice smoke (daemon + wasm socket + composer)"