# syntax=docker/dockerfile:1
# AEP 2.8.6 - containerized modular deploy. No npm in runtime image.

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
COPY AEP-Base-Node/AEP-Potomitan/crate ./AEP-Base-Node/AEP-Potomitan/crate
COPY AEP-Components/lattice-memory/crate ./AEP-Components/lattice-memory/crate
COPY AEP-Base-Node/AEP-Crate ./AEP-Base-Node/AEP-Crate
COPY AEP-Base-Node/AEP-Docks/ucb/crate ./AEP-Base-Node/AEP-Docks/ucb/crate
COPY AEP-Base-Node/AEP-Docks/ucb/perimeter-v1 ./AEP-Base-Node/AEP-Docks/ucb/perimeter-v1
COPY AEP-Components/conformance/crate ./AEP-Components/conformance/crate
RUN cargo build --release -p aep-base-node -p aep-lattice-memory -p aep-ucb

FROM debian:bookworm-slim AS node-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY docker/runtime-deps.package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && rm -f package.json package-lock.json

FROM debian:bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini procps nodejs \
    && rm -rf /var/lib/apt/lists/*

COPY --from=rust-builder /build/rust/target/release/aep-base-node /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-lattice-log /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-memory /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-ucb /usr/local/bin/

WORKDIR /opt/aep
COPY --from=node-deps /deps/node_modules ./node_modules
COPY AEP-Components/ ./AEP-Components/
COPY AEP-Base-Node/AEP-Docks/ ./AEP-Base-Node/AEP-Docks/
COPY AEP-Policy-System/ ./AEP-Policy-System/
COPY AEP-Base-Node/ ./AEP-Base-Node/
COPY AEP-User-Experience/ ./AEP-User-Experience/
COPY docker/entrypoint.sh /usr/local/bin/aep-entrypoint.sh

RUN chmod +x /opt/aep/AEP-Base-Node/AEP-Docks/ucb/server.mjs && chmod +x /usr/local/bin/aep-entrypoint.sh
ENV AEP_DATA=/data/aep \
    AEP_SOCKET_BASE=/data/aep/sockets \
    AEP_TASK_MANIFEST_DIR=/data/aep/ucb/manifests \
    AEP_MANIFEST_RELOAD_INTERVAL_SECS=0 \
    AEP_BASE_NODE_BIN=/usr/local/bin/aep-base-node \
    AEP_LATTICE_LOG_BIN=/usr/local/bin/aep-lattice-log \
    AEP_MEMORY_BIN=/usr/local/bin/aep-memory \
    AEP_LATTICE_STRICT=1 \
    UCB_PORT=8412 \
    UCB=1 \
    AEP_IN_DOCKER=1 \
    AEP_DAEMON_PIDFILE=/run/aep/daemon.pid \
    AEP_TRUST_DOMAIN=aep.protocol.local \
    AEP_COMPONENTS_FETCH=0 \
    NODE_PATH="/opt/aep/node_modules" \
    PATH="/usr/local/bin:${PATH}"

EXPOSE 8412
VOLUME ["/data/aep"]

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD sh -c 'aep-base-node --config "${AEP_DATA}/base-node.json" 2>/dev/null | grep -q "\"status\": \"ok\"" || aep-base-node --socket-base "${AEP_SOCKET_BASE}" --lattice-db "${AEP_DATA}/action-lattice.db" --internet-up 2>/dev/null | grep -q "\"status\": \"ok\""'

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aep-entrypoint.sh"]
CMD []
