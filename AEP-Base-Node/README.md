# AEP Base Node

Mandatory local governance **kernel** for every AEP 2.8 installation.

Lives at the **repository root** (`AEP-Base-Node/`), not under `AEP-Components/`. Every other component docks into Base Node; it is not a palette component.

## What lives here

Base Node **is** the local agent control kernel. Governance code, registry, mesh, and agent profiles live under `AEP-Base-Node/`:

| Module | Path | Role |
|--------|------|------|
| Docking servers | `crate/src/docking.rs` | inference / validation / regulation / future Unix sockets |
| Task manifests | `crate/src/task_manifest.rs` | UCB agent contracts (`AEP_TASK_MANIFEST_DIR`) |
| EPSCOM writing kernel | `crate/src/epscom.rs` | writing.gap enforcement (`no_em_dashes`, `no_en_dashes`, `no_dash_substitutes`, `no_minus_as_dash`, `no_double_hyphen`, `no_oxford_comma`) |
| Side-channel monitor | `crate/src/side_channel_monitor.rs` | Anomaly events on validation dock |
| Lattice log | `crate/src/lattice_log.rs` | dynAEP event export + `aep-lattice-log` CLI |

Register new components in **`AEP-Base-Node/registry/catalog.json`** + **`AEP-Base-Node/registry/components/*.json`**. See [`registry/README.md`](registry/README.md) for manifest schema and error categories.

## Component layout

| Path | Contents |
|------|----------|
| `crate/` | `aep-base-node` Rust crate + `aep-lattice-log` CLI binary |
| `registry/` | Component catalog + manifests (`catalog.json`, `components/*.json`) |
| `multi-base-node/` | Multi-base-node (2.8b) mode: federate multiple Base Node kernels |
| `potomitan/` | POTOMITAN mesh peer registry (`aep-potomitan` crate) |
| `agent-control-extreme/` | Agent Control Hub: mount profiles for multi-mount sessions |
| `signatures/` | EPSCOM detection signatures + trust bundle (default wired, CCA accessible) |
| `AEP-Components/dynAEP/NAME-POLICY.md` | Reserved-name policy |

## Docking ports

| Port | Path suffix | Priority |
|------|-------------|----------|
| Inference Engine | `/inference` | High |
| Validation Engine | `/validation` | High |
| Future Features (reserved internal) | `/future` | High |
| Regulation Module (LRPs) | `/regulation` | Medium |

All traffic uses Lattice Channels with PQEncryptedCapsule encryption.

## Build

```bash
cargo build --release -p aep-base-node
# binaries: rust/target/release/aep-base-node, aep-lattice-log
```