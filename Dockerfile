# syntax=docker/dockerfile:1
# AEP 2.8 - containerized modular deploy. No npm in runtime image.

FROM rust:1-bookworm AS rust-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev cmake clang \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY .cargo/ ./.cargo/
COPY AEP-Components/lattice-crypto/crate ./AEP-Components/lattice-crypto/crate
COPY AEP-Components/lattice-channels/crate ./AEP-Components/lattice-channels/crate
COPY AEP-Components/agentmesh/crate ./AEP-Components/agentmesh/crate
COPY AEP-Base-Node/potomitan/crate ./AEP-Base-Node/potomitan/crate
COPY AEP-Components/lattice-memory/crate ./AEP-Components/lattice-memory/crate
COPY AEP-Base-Node/crate ./AEP-Base-Node/crate
COPY AEP-Components/wasm/crate ./AEP-Components/wasm/crate
COPY AEP-Docks/ucb/crate ./AEP-Docks/ucb/crate
COPY AEP-Components/conformance/crate ./AEP-Components/conformance/crate
COPY AEP-Subprotocols/ ./AEP-Subprotocols/
RUN cargo build --release -p aep-base-node -p aep-lattice-memory -p aep-wasm-sandbox -p aep-ucb -p aep-subprotocol

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini procps nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /build/rust/target/release/aep-base-node /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-lattice-log /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-memory /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-wasm-sandbox /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-ucb /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-subprotocol /usr/local/bin/

WORKDIR /opt/aep
COPY docker/runtime-deps.package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && rm -f package.json package-lock.json
COPY AEP-Components/ ./AEP-Components/
COPY AEP-Composer-Lite/ ./AEP-Composer-Lite/
COPY AEP-Docks/ ./AEP-Docks/
COPY AEP-Policy-System/ ./AEP-Policy-System/
COPY AEP-Connectors/ ./AEP-Connectors/
COPY AEP-Base-Node/ ./AEP-Base-Node/
COPY AEP-User-Experience/ ./AEP-User-Experience/
COPY AEP-SDKs/ ./AEP-SDKs/
COPY AEP-Subprotocols/ ./AEP-Subprotocols/
COPY docker/entrypoint.sh /usr/local/bin/aep-entrypoint.sh

RUN chmod +x /opt/aep/AEP-Components/cca/cca.mjs \
    && chmod +x /opt/aep/AEP-Components/cca/setup-agent.mjs \
    && chmod +x /opt/aep/AEP-Composer-Lite/server.mjs \
    && chmod +x /opt/aep/AEP-Docks/ucb/server.mjs \
    && chmod +x /usr/local/bin/aep-entrypoint.sh \
    && printf '%s\n' '#!/bin/sh' 'exec node /opt/aep/AEP-Components/cca/setup-agent.mjs "$@"' > /usr/local/bin/aep-setup-agent \
    && chmod +x /usr/local/bin/aep-setup-agent \
    && printf '%s\n' '#!/bin/sh' 'exec node /opt/aep/AEP-Components/cca/cca.mjs "$@"' > /usr/local/bin/aep-cca \
    && chmod +x /usr/local/bin/aep-cca

ENV AEP_DATA=/data/aep \
    AEP_SOCKET_BASE=/data/aep/sockets \
    AEP_TASK_MANIFEST_DIR=/data/aep/ucb/manifests \
    AEP_MANIFEST_RELOAD_INTERVAL_SECS=0 \
    AEP_BASE_NODE_BIN=/usr/local/bin/aep-base-node \
    AEP_LATTICE_LOG_BIN=/usr/local/bin/aep-lattice-log \
    AEP_MEMORY_BIN=/usr/local/bin/aep-memory \
    AEP_LATTICE_STRICT=1 \
    COMPOSER_LITE=1 \
    COMPOSER_LITE_HOST=0.0.0.0 \
    COMPOSER_LITE_PORT=8424 \
    COMPOSER_LITE_TERMINAL=0 \
    COMPOSER_LITE_BASE_PATH= \
    UCB_PORT=8412 \
    UCB=1 \
    WASM_SANDBOX=1 \
    WASM_SANDBOX_SOCKET=/data/aep/sockets/wasm_sandbox \
    AEP_IN_DOCKER=1 \
    AEP_DAEMON_PIDFILE=/run/aep/daemon.pid \
    AEP_TRUST_DOMAIN=aep.protocol.local \
    AEP_COMPONENTS_FETCH=0 \
    NODE_PATH="/opt/aep/node_modules" \
    PATH="/usr/local/bin:${PATH}"

EXPOSE 8424 8412
VOLUME ["/data/aep"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD sh -c 'aep-base-node --config "${AEP_DATA}/base-node.json" 2>/dev/null | grep -q "\"status\": \"ok\"" || aep-base-node --socket-base "${AEP_SOCKET_BASE}" --lattice-db "${AEP_DATA}/action-lattice.db" --internet-up 2>/dev/null | grep -q "\"status\": \"ok\""'

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aep-entrypoint.sh"]
CMD []