# AEP-Crate

This folder belongs to component 01 (AEP Base Node) and the README of the whole component is `AEP-Base-Node/README.md`.

This is the kernel daemon crate for Base Node: the workspace package is aep-base-node and the binaries are aep-base-node and aep-lattice-log.

This folder is one of the six kernel children under AEP-Base-Node/. The six children are AEP-Crate, AEP-Docks, AEP-Potomitan, AEP-Multi-Base-Node, AEP-Registry and AEP-Agent-Control-Hub.

After admit, CAW at AEP-CAW/ runs the admitted action.

A nested Rust leaf folder named crate/ under a product remains.

## Build

```bash
cargo build --release -p aep-base-node
```

The default build is the single Base Node kernel.

## Layout

| Path | Role |
|------|------|
| `src/main.rs` | The daemon `aep-base-node` |
| `src/bin/aep-lattice-log.rs` | The program for the runtime ledger and the seal of a capsule |
| `src/docking/` | The dock servers with serve, apply, pulse, freshness and rate |
| `src/lattice_log.rs` | The runtime ledger, a SQLite lattice log |
| `src/data_dock.rs` | The Data Dock on port 8413 |
| `tests/` | Integration tests of the crate |

## Run and test

```bash
cargo test -p aep-base-node --lib
cargo test -p aep-base-node
./rust/target/release/aep-base-node --self-test
```
