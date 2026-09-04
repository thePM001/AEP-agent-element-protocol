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

## Kernel pulse

After a sealed capsule (the encrypted frame on the wire) is opened, Base Node freezes the clock at seal, waits 1000 ms, then runs every check together and only then carries out the allowed action. Putting a capsule on the dock is not that check. After the wait the client asks for the result by the capsule hash so a deny names the closed walls and an allow returns an event id. Allowed clock drift is 50 ms against the freeze, which is why a 1000 ms hold still meets drift. A capsule held longer than 5000 ms is aged out.

The wait is the compiled constant `PULSE_MS` in `AEP-Components/base-node-pulse/crate`. There is no environment variable and no `pulse_ms` key in `dynaep-config.yaml`. TypeScript dynAEP remains a standalone component and does not own this wait. The 1000 ms figures in dynAEP timekeeping are NTP slew bounds and LARGE_STEP clock-sync caps, not the kernel wait.

### How the wait can be changed in theory

A builder who wants a different wait edits the compiled `PULSE_MS` constant and rebuilds Base Node. Freeze-at-seal must stay so the hold is judged against the freeze rather than a moving clock. Allowed drift must not be set to the wait length: crate tests require `MAX_DRIFT_MS != PULSE_MS` and reject a 1000 ms drift default. Age must stay longer than the wait because if `PULSE_MS` were greater than `MAX_AGE_MS` (5000) capsules would expire before they became ready. Current crate tests also pin `PULSE_MS == 1000` so a theoretical rebuild must update those pins. This is a kernel rebuild, not a yaml or env toggle.

## Build

```bash
cargo build --release -p aep-base-node
# binaries: rust/target/release/aep-base-node, aep-lattice-log
```