#!/usr/bin/env bash
# E2E smoke: Base Node + Rust UCB secured dock ingest on lattice validation port.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/rust/target/release"
DATA="$(mktemp -d)"
SOCK="$DATA/sockets"
MANIFESTS="$DATA/ucb/manifests"
UCB_KEY="ucb_e2e_smoke_key_$(date +%s)"
mkdir -p "$SOCK" "$MANIFESTS"

cleanup() {
  kill "$DAEMON_PID" "$UCB_PID" 2>/dev/null || true
  rm -rf "$DATA"
}
trap cleanup EXIT

for pkg in aep-base-node aep-ucb; do
  if [ ! -x "$BIN/$pkg" ]; then
    (cd "$ROOT" && cargo build --release -p "$pkg")
  fi
done

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

AEP_TASK_MANIFEST_DIR="$MANIFESTS" \
AEP_DATA="$DATA" \
  "$BIN/aep-base-node" --daemon --config "$DATA/base-node.json" &
DAEMON_PID=$!

for i in $(seq 1 20); do
  [ -S "$SOCK/validation" ] && break
  sleep 0.5
done
[ -S "$SOCK/validation" ] || { echo "FAIL: validation dock missing"; exit 1; }

UCB_PORT="${UCB_SMOKE_PORT:-8429}"

AEP_DATA="$DATA" \
AEP_TASK_MANIFEST_DIR="$MANIFESTS" \
AEP_SOCKET_BASE="$SOCK" \
AEP_LATTICE_LOG_BIN="$BIN/aep-lattice-log" \
AEP_LATTICE_STRICT=1 \
UCB_HOST=127.0.0.1 \
UCB_PORT="$UCB_PORT" \
UCB_API_KEY="$UCB_KEY" \
  "$BIN/aep-ucb" &
UCB_PID=$!

for i in $(seq 1 30); do
  if curl -sf --max-time 2 "http://127.0.0.1:${UCB_PORT}/health" 2>/dev/null | grep -q "ucb-universal-connect-bridge"; then
    break
  fi
  sleep 0.5
done
curl -sf --max-time 2 "http://127.0.0.1:${UCB_PORT}/health" | grep -q "ucb-universal-connect-bridge" || {
  echo "FAIL: UCB health unavailable on port ${UCB_PORT}"
  exit 1
}

CAPS="$(curl -sf --max-time 5 "http://127.0.0.1:${UCB_PORT}/ucb/v1/capabilities")"
echo "$CAPS" | grep -q '"bridge"[[:space:]]*:[[:space:]]*"ucb/2.8.0"' || { echo "FAIL: capabilities"; exit 1; }
echo "$CAPS" | grep -q '"implementation"[[:space:]]*:[[:space:]]*"rust"' || { echo "FAIL: expected rust implementation"; exit 1; }

INGEST_CODE="$(curl -s --max-time 15 -o /tmp/ucb-ingest.json -w "%{http_code}" \
  -H "Authorization: Bearer $UCB_KEY" -H "Content-Type: application/json" \
  -d '{"protocol":"mcp","session_id":"e2e-1","provenance":{"source":"mcp","protocol":"1.0","session_id":"e2e-1"},"payload":{"subject":"E2E","predicate":"validates","object":"UCB"},"task_manifest":{"manifest_version":"1","id":"tm-e2e-1","agent_id":"ucb-foreign-mcp","session_id":"e2e-1","intent":{"summary":"E2E validates UCB","allowed_operations":["ucb.ingest"]},"trust":{"tier":"standard","max_trust_score":500},"provisional":false,"synthesized_by":"provided","created_at_unix":0}}' \
  "http://127.0.0.1:${UCB_PORT}/ucb/v1/ingest")"
INGEST="$(cat /tmp/ucb-ingest.json 2>/dev/null || true)"
rm -f /tmp/ucb-ingest.json
if [ "$INGEST_CODE" != "200" ]; then
  echo "FAIL: ingest HTTP $INGEST_CODE body=$INGEST"
  exit 1
fi
echo "$INGEST" | grep -q '"status"[[:space:]]*:[[:space:]]*"integrated"' || {
  echo "FAIL: ingest body: $INGEST"
  exit 1
}

echo "PASS: e2e UCB smoke (daemon + Rust secured dock ingest)"