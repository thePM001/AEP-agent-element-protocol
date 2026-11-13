# AEP-Docks

This folder belongs to component 02, UCB, which the AEP Base Node (01) hosts. The README of the whole component is `AEP-Base-Node/AEP-Docks/ucb/README.md`.

Canonical dock definitions for AEP 2.9. Socket docks are implemented in `AEP-Base-Node/AEP-Crate/src/docking/`; HTTP/regulated docks live here.

## Base Node socket docks

| Port ID | Socket suffix | Spec |
|---------|---------------|------|
| `inference_engine` | `/inference` | `specs/inference-engine.json` |
| `validation_engine` | `/validation` | `specs/kernel-admit.json` |
| `future_features` | `/future` | `specs/future-features.json` |
| `regulation_module` | `/regulation` | `specs/regulation-module.json` |

See [`docs/DOCKING-PORTS.md`](docs/DOCKING-PORTS.md) for wire protocol.

## Regulated HTTP docks

| Dock | Path | Port | Role |
|------|------|------|------|
| **UCB** (Universal Connect Bridge) | `ucb/` | 8412 | Foreign ingress, named tail rollback, compile-manifest and manifest-scoped internet egress. Default profile perimeter-v1 |
| **UCD** (Universal Connect Dock) | `universal-connect/` | _(via UCB)_ | Optional external module downloads (plan artifacts and future modules) |
| **Data Dock** (HTTP JSON) | `../AEP-Crate/src/data_dock.rs` | 8413 | Serves already-admitted lattice records as JSON and seals frontend writes on the server before they enter the four existing docks, so it is not a fifth kernel dock. Loopback by default with DATA_DOCK_API_KEY required on any other host. See [`DATA-DOCK.md`](../../AEP-User-Experience/docs/DATA-DOCK.md) |

UCD routes all external module egress through UCB. Do not bypass UCB for optional internet-facing modules.

## Layout

| Path | Role |
|------|------|
| `specs/` | One JSON spec per socket dock |
| `docs/DOCKING-PORTS.md` | The wire protocol of the docks |
| `docs/AEP-PORT-POLICY.md` | The port policy |
| `ucb/` | The Universal Connect Bridge, home of component 02 |
| `universal-connect/` | The Universal Connect Dock for optional module downloads through UCB |

## Run and test

The socket docks are tested with the Base Node crate and the bridge with its own crates:

```bash
cargo test -p aep-base-node --lib
cargo test -p aep-ucb -p aep-ucb-perimeter-v1
```
