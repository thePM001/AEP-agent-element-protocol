# syntax=docker/dockerfile:1
# AEP 2.9 - containerized modular deploy. No npm in runtime image.
#
# The image runs the Base Node and the CAW as the user aep, which is not root. The
# CAW is off unless CAW=1. With CAW=1 the container needs the run options of
# docker-compose.caw.yml, because runsc creates a user namespace inside it.
#
# Targets: runtime (the default) and caw-proof, which adds the proof programs and a
# Rust toolchain to the runtime and runs the proof scripts of the CAW in the image.

FROM rust:1-bookworm AS rust-builder
WORKDIR /build
RUN apt-get update && apt-get install -y --no-install-recommends \
    pkg-config libssl-dev cmake clang \
    && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY .cargo/ ./.cargo/
# Cargo loads every workspace member before it builds one package, so the
# builder needs every member tree: AEP-Base-Node, AEP-Components, the CAW crates
# and the end to end example. aep-admit embeds AEP-Policy-System/reference/writing.gap
# at compile time.
COPY AEP-Base-Node ./AEP-Base-Node
COPY AEP-Components ./AEP-Components
COPY AEP-Policy-System ./AEP-Policy-System
COPY AEP-CAWs-RustGvisor ./AEP-CAWs-RustGvisor
COPY AEP-User-Experience/examples/end-to-end-run/Cargo.toml ./AEP-User-Experience/examples/end-to-end-run/Cargo.toml
COPY AEP-User-Experience/examples/end-to-end-run/src ./AEP-User-Experience/examples/end-to-end-run/src
RUN cargo build --release -p aep-base-node -p aep-lattice-memory -p aep-ucb -p aep-ucm \
    -p aep-caw -p aep-caw-init

# The proof programs of the CAW. Only the caw-proof target needs them.
FROM rust-builder AS caw-proof-builder
RUN cargo build --release -p aep-caw-runtime -p aep-caw-dock --examples

# The pinned gVisor, installed by the same script and checked against the same pin
# as on a host. The pin covers amd64. An image for another platform builds without
# gVisor and its entrypoint refuses CAW=1.
FROM debian:bookworm-slim AS gvisor
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
COPY AEP-CAWs-RustGvisor/proof/runsc-pin.env AEP-CAWs-RustGvisor/proof/install-runsc.sh /pin/
RUN mkdir -p /out/usr/bin \
    && if [ "${TARGETARCH:-amd64}" = amd64 ]; then \
         bash /pin/install-runsc.sh && cp -a /usr/bin/runsc /usr/bin/gvisor-bin /out/usr/bin/; \
       else \
         echo "the gVisor pin covers amd64 only, this image for ${TARGETARCH} carries no runsc"; \
       fi

FROM debian:bookworm-slim AS node-deps
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates nodejs npm \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /deps
COPY docker/runtime-deps.package.json ./package.json
RUN npm install --omit=dev --no-audit --no-fund && rm -f package.json package-lock.json

FROM debian:bookworm-slim AS runtime
# git and patch complete the program list of the toolset coding-tools, so every
# reference profile of the CAW except ede-draft runs in this image.
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates tini procps nodejs git patch \
    && rm -rf /var/lib/apt/lists/*

# One user that is not root runs the Base Node and the CAW. The CAW signs its ping
# with a key from the key store of the Base Node, so the two are one trust domain.
ARG AEP_UID=10001
ARG AEP_GID=10001
RUN groupadd --system --gid "${AEP_GID}" aep \
    && useradd --system --uid "${AEP_UID}" --gid aep --home-dir /data/aep --no-create-home --shell /usr/sbin/nologin aep

COPY --from=rust-builder /build/rust/target/release/aep-base-node /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-lattice-log /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-lattice-memory /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-ucb /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-ucb-validate /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-ucm /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-caw /usr/local/bin/
COPY --from=rust-builder /build/rust/target/release/aep-caw-init /usr/local/bin/
COPY --from=gvisor /out/ /

WORKDIR /opt/aep
COPY --from=node-deps /deps/node_modules ./node_modules
COPY AEP-Components/ ./AEP-Components/
COPY AEP-Base-Node/AEP-Docks/ ./AEP-Base-Node/AEP-Docks/
COPY AEP-Policy-System/ ./AEP-Policy-System/
COPY AEP-Base-Node/ ./AEP-Base-Node/
COPY AEP-User-Experience/ ./AEP-User-Experience/
COPY AEP-CAWs-RustGvisor/proof/runsc-pin.env ./AEP-CAWs-RustGvisor/proof/runsc-pin.env
COPY docker/entrypoint.sh /usr/local/bin/aep-entrypoint.sh
COPY docker/health-probe.sh /usr/local/bin/aep-health-probe
COPY docker/lattice.default.yaml /opt/aep/lattice.default.yaml
COPY docker/caw-kernel-dock.gap /opt/aep/hub/caw-kernel-dock.gap

# On amd64 the build stops unless the runsc of the image carries the sha512 of the pin.
ARG TARGETARCH
RUN . /opt/aep/AEP-CAWs-RustGvisor/proof/runsc-pin.env \
    && if [ "${TARGETARCH:-amd64}" = amd64 ]; then \
         echo "${RUNSC_BIN_SHA512}  /usr/bin/runsc" | sha512sum --check --strict; \
       fi \
    && chmod +x /usr/local/bin/aep-entrypoint.sh /usr/local/bin/aep-health-probe \
    && mkdir -p /data/aep /run/aep /workspace \
    && chown aep:aep /data/aep /run/aep /workspace \
    && chmod 0750 /data/aep
ENV AEP_DATA=/data/aep \
    AEP_SOCKET_BASE=/data/aep/sockets \
    AEP_TASK_MANIFEST_DIR=/data/aep/ucb/manifests \
    AEP_MANIFEST_RELOAD_INTERVAL_SECS=0 \
    AEP_BASE_NODE_BIN=/usr/local/bin/aep-base-node \
    AEP_LATTICE_LOG_BIN=/usr/local/bin/aep-lattice-log \
    AEP_LATTICE_MEMORY_CLI=/usr/local/bin/aep-lattice-memory \
    AEP_LATTICE_STRICT=1 \
    UCB_PORT=8412 \
    DATA_DOCK_PORT=8413 \
    DATA_DOCK_HOST=127.0.0.1 \
    DATA_DOCK=1 \
    UCB=1 \
    UCM=0 \
    UCM_PORT=8414 \
    CAW=0 \
    AEP_IN_DOCKER=1 \
    AEP_DAEMON_PIDFILE=/run/aep/daemon.pid \
    AEP_TRUST_DOMAIN=aep.protocol.local \
    AEP_COMPONENTS_FETCH=0 \
    NODE_PATH="/opt/aep/node_modules" \
    PATH="/usr/local/bin:${PATH}"

EXPOSE 8412 8413 8414
VOLUME ["/data/aep"]
USER aep

# Healthy while GET /health on the Data Dock answers 200 with a status other
# than error. With DATA_DOCK=0 the probe falls back to aep-base-node --health.
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD ["/usr/local/bin/aep-health-probe"]

ENTRYPOINT ["/usr/bin/tini", "--", "/usr/local/bin/aep-entrypoint.sh"]
CMD []

# The runtime with the proof programs of the CAW, the programs its proof scripts call
# and a Rust toolchain for the pairing proof. aep-caw-proof runs every proof script.
FROM runtime AS caw-proof
USER root
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl netcat-openbsd gcc libc6-dev \
    && rm -rf /var/lib/apt/lists/*
COPY --from=rust-builder /usr/local/rustup/toolchains/ /opt/rust/toolchains/
COPY --from=caw-proof-builder /build/rust/target/release/examples/caw-run-proof /usr/local/lib/aep-caw-proof/
COPY --from=caw-proof-builder /build/rust/target/release/examples/caw-trace-proof /usr/local/lib/aep-caw-proof/
COPY --from=caw-proof-builder /build/rust/target/release/examples/caw-dock-proof /usr/local/lib/aep-caw-proof/
COPY AEP-CAWs-RustGvisor/proof/ ./AEP-CAWs-RustGvisor/proof/
COPY AEP-CAWs-RustGvisor/aep-caw-policy/tests/fixtures/ ./AEP-CAWs-RustGvisor/aep-caw-policy/tests/fixtures/
COPY docker/caw-proof.sh /usr/local/bin/aep-caw-proof
# The CAW refuses a tree source that is a link, so the one toolchain of the Rust image
# moves to a real folder with a fixed name. The toolset rust-draft-tools also mounts
# /usr/libexec/gcc, where Ubuntu keeps the programs of gcc. Debian keeps them in
# /usr/lib/gcc, which the toolset mounts too, so here that folder stays empty. The
# linker scripts of glibc in Debian name /lib/x86_64-linux-gnu, which is the same
# folder as /usr/lib/x86_64-linux-gnu under the merged /usr of the image. The toolset
# mounts the second spelling, as Ubuntu writes it, so the scripts take that spelling.
RUN chmod +x /usr/local/bin/aep-caw-proof \
    && mkdir -p /usr/libexec/gcc \
    && for script in $(grep -l -s "GNU ld script" /usr/lib/x86_64-linux-gnu/*.so); do \
         sed -i 's#\([ (]\)/lib/x86_64-linux-gnu/#\1/usr/lib/x86_64-linux-gnu/#g' "$script"; \
       done \
    && set -- /opt/rust/toolchains/* \
    && if [ "$#" != 1 ] || [ ! -x "$1/bin/cargo" ]; then echo "expected one Rust toolchain, found: $*"; exit 1; fi \
    && mv "$1" /opt/rust/toolchain \
    && rmdir /opt/rust/toolchains
USER aep
