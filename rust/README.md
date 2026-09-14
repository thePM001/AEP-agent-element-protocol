# AEP 2.8.6 Rust workspace

This is the Rust workspace note. It is not the product front page. The workspace root is Cargo.toml at the tree root. Component crates live under AEP-Base-Node/crate and AEP-Components.

Build output is directed here via .cargo/config.toml:

    rust/target/release/aep-base-node
    rust/target/release/aep-lattice-log
    rust/target/release/aep-memory
    rust/target/release/aep-wasm-sandbox
    rust/target/release/aep-conformance
    rust/target/release/aep-ucb

From the repository root:

    cargo test --workspace
    cargo build --release -p aep-base-node -p aep-lattice-memory -p aep-wasm-sandbox -p aep-ucb
    ./rust/target/release/aep-base-node --self-test

See each component README for crate-specific docs under AEP-Base-Node, lattice-channels, lattice-crypto, lattice-memory, agentmesh, potomitan, wasm, conformance and ucb.
