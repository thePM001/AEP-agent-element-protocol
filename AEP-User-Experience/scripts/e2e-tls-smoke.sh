#!/usr/bin/env bash
# mTLS lattice dock smoke: base node TLS listeners + Node lattice-transport client.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
BIN="$ROOT/rust/target/release"
DATA="$(mktemp -d)"
SOCK="$DATA/sockets"
TLS_DIR="$DATA/agentmesh/tls"
mkdir -p "$SOCK"

cleanup() {
  kill "$DAEMON_PID" 2>/dev/null || true
  rm -rf "$DATA"
}
trap cleanup EXIT

if [ ! -x "$BIN/aep-base-node" ]; then
  (cd "$ROOT" && cargo build --release -p aep-base-node)
fi

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

AEP_DATA="$DATA" \
AEP_LATTICE_TRANSPORT=tls \
AEP_LATTICE_TLS_BIND=127.0.0.1 \
  "$BIN/aep-base-node" --daemon --config "$DATA/base-node.json" &
DAEMON_PID=$!

for i in $(seq 1 40); do
  [ -S "$SOCK/validation" ] && [ -f "$TLS_DIR/ca.pem" ] && break
  sleep 0.25
done
[ -S "$SOCK/validation" ] || { echo "FAIL: unix validation dock missing"; exit 1; }
[ -f "$TLS_DIR/ca.pem" ] || { echo "FAIL: mesh CA not materialized under $TLS_DIR"; exit 1; }
[ -f "$TLS_DIR/dock-server.pem" ] || { echo "FAIL: dock server cert missing"; exit 1; }

for i in $(seq 1 40); do
  if ss -ltn 2>/dev/null | grep -q ':28426 '; then
    break
  fi
  sleep 0.25
done
ss -ltn 2>/dev/null | grep -q ':28426 ' || { echo "FAIL: TLS validation port 28426 not listening"; exit 1; }

# Client identity signed by mesh CA (X.509 v3 required by rustls peer verification).
openssl ecparam -name prime256v1 -genkey -noout -out "$TLS_DIR/client-key.pem" 2>/dev/null
openssl req -new -key "$TLS_DIR/client-key.pem" -out "$TLS_DIR/client.csr" \
  -subj "/CN=AG-TLS-SMOKE/O=AEP AgentMesh" 2>/dev/null
cat > "$TLS_DIR/client.ext" <<'EOF'
[ v3_client ]
basicConstraints = CA:FALSE
keyUsage = digitalSignature
extendedKeyUsage = clientAuth
EOF
openssl x509 -req -in "$TLS_DIR/client.csr" -CA "$TLS_DIR/ca.pem" -CAkey "$TLS_DIR/ca-key.pem" \
  -CAcreateserial -out "$TLS_DIR/client.pem" -days 1 \
  -extensions v3_client -extfile "$TLS_DIR/client.ext" 2>/dev/null

# Handshake probe (mTLS required).
if ! openssl s_client -connect 127.0.0.1:28426 -cert "$TLS_DIR/client.pem" -key "$TLS_DIR/client-key.pem" \
  -CAfile "$TLS_DIR/ca.pem" </dev/null 2>/dev/null | grep -q 'Verification: OK'; then
  echo "FAIL: openssl mTLS handshake to validation dock"
  exit 1
fi

# Lattice transport JSON round-trip over tls://
export AEP_LATTICE_TRANSPORT=tls
export AEP_LATTICE_TLS_HOST=127.0.0.1
export AEP_LATTICE_TLS_SERVERNAME=aep-dock-server
export AEP_LATTICE_TLS_CERT
export AEP_LATTICE_TLS_KEY
export AEP_LATTICE_TLS_CA
AEP_LATTICE_TLS_CERT="$(cat "$TLS_DIR/client.pem")"
AEP_LATTICE_TLS_KEY="$(cat "$TLS_DIR/client-key.pem")"
AEP_LATTICE_TLS_CA="$(cat "$TLS_DIR/ca.pem")"

RESP="$(node --input-type=module -e "
  import { sendLatticeLine, parseLatticeDockLine } from '${ROOT}/AEP-Components/lattice-channels/lib/lattice-transport.mjs';
  const line = sendLatticeLine('tls://127.0.0.1:28426', JSON.stringify({ ping: true }));
  const resp = parseLatticeDockLine(line);
  if (resp.ok !== false) throw new Error('expected ping rejection, got ' + JSON.stringify(resp));
  if (!String(resp.error ?? '').includes('LatticeChannelFrame')) {
    throw new Error('unexpected error: ' + (resp.error ?? line));
  }
  console.log('ok');
")"

[ "$RESP" = "ok" ] || { echo "FAIL: lattice-transport tls ping: $RESP"; exit 1; }

echo "PASS: e2e TLS smoke (mTLS handshake + lattice-transport tls:// validation dock)"