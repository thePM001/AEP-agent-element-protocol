# AEP-Docks

Canonical dock definitions for AEP 2.8. Socket docks are implemented in `AEP-Base-Node/AEP-Crate/src/docking.rs`; HTTP/regulated docks live here.

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
| **UCD** (Universal Connect Dock) | `universal-connect/` | _(via UCB)_ | Optional external module downloads (HCSE, plan artifacts) |
| **Data Dock** (HTTP JSON) | `../AEP-Crate/src/data_dock.rs` | 8413 | Serves already-admitted lattice records as JSON and seals frontend writes on the server before they enter the four existing docks, so it is not a fifth kernel dock. See [`DATA-DOCK.md`](../../AEP-User-Experience/docs/DATA-DOCK.md) |

UCD routes all external module egress through UCB. Do not bypass UCB for optional internet-facing modules.
