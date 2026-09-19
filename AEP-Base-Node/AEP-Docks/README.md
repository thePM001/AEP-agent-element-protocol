# AEP-Docks

Canonical dock definitions for AEP 2.8. Socket docks are implemented in `AEP-Base-Node/AEP-Crate/src/docking.rs`; HTTP/regulated docks live here.

## Base Node socket docks

| Port ID | Socket suffix | Spec |
|---------|---------------|------|
| `inference_engine` | `/inference` | `specs/inference-engine.json` |
| `future_features` | `/future` | `specs/future-features.json` |
| `regulation_module` | `/regulation` | `specs/regulation-module.json` |

See [`docs/DOCKING-PORTS.md`](docs/DOCKING-PORTS.md) for wire protocol.

## Regulated HTTP docks

| Dock | Path | Port | Role |
|------|------|------|------|
| **UCB** (Universal Connect Bridge) | `ucb/` | 8412 | Foreign ingress, named tail rollback, compile-manifest and manifest-scoped internet egress. Default profile perimeter-v1 |
| **UCD** (Universal Connect Dock) | `universal-connect/` | _(via UCB)_ | Optional external module downloads (HCSE, plan artifacts) |

UCD routes all external module egress through UCB. Do not bypass UCB for optional internet-facing modules.