# AEP 2.8 Rust workspace

The AEP 2.8 Rust workspace root is the **repository** `Cargo.toml`. Component crates live in their own folders (`AEP-Base-Node/crate`, `AEP-Components/*/crate`, etc.).

Build output is directed here via `.cargo/config.toml`:

```
rust/target/release/aep-base-node
rust/target/release/aep-lattice-log
rust/target/release/aep-memory
rust/target/release/aep-wasm-sandbox
rust/target/release/aep-conformance
rust/target/release/aep-ucb
rust/target/release/aep-subprotocol
```

## Subprotocol crates (`AEP-Subprotocols/`)

See [AEP-Subprotocols/README.md](../AEP-Subprotocols/README.md) and [AEP-User-Experience/docs/SUBPROTOCOLS.md](../AEP-User-Experience/docs/SUBPROTOCOLS.md).

The `aep-subprotocol` binary is the unified CLI for all domain subprotocol validators.

## Build

```bash
# from repository root
cargo test --workspace
cargo build --release -p aep-base-node -p aep-lattice-memory -p aep-wasm-sandbox -p aep-ucb -p aep-subprotocol
./rust/target/release/aep-base-node --self-test
```

See each component README for crate-specific docs: `AEP-Base-Node/`, `lattice-channel/`, `lattice-crypto/`, `lattice-memory/`, `agentmesh/`, `potomitan/`, `wasm/`, `conformance/`, `ucb/`.