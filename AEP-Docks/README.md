# AEP-Docks

Canonical dock definitions for AEP 2.8. Socket docks are implemented in `AEP-Base-Node/crate/src/docking.rs`; HTTP/regulated docks live here.

## Base Node socket docks

| Port ID | Socket suffix | Spec |
|---------|---------------|------|
| `inference_engine` | `/inference` | `specs/inference-engine.json` |
| `validation_engine` | `/validation` | `specs/validation-engine.json` |
| `future_features` | `/future` | `specs/future-features.json` |
| `pera` | `/pera` | `specs/pera.json` |
| `regulation_module` | `/regulation` | `specs/regulation-module.json` |

See [`docs/DOCKING-PORTS.md`](docs/DOCKING-PORTS.md) for wire protocol.

## Regulated HTTP docks

| Dock | Path | Port | Role |
|------|------|------|------|
| **UCB** (Universal Connect Bridge) | `ucb/` | 8412 | Foreign ingress + manifest-scoped internet egress |
| **UCD** (Universal Connect Dock) | `universal-connect/` | _(via UCB)_ | Optional external module downloads (HCSE, CCA artifacts) |
| **PERA** (Perceptive Rails) | `pera/` | _(via Base Node `/pera`)_ | Reserved sensor / world-model dock (provisioned 2.8, runtime AEP 3.0+) |

UCD routes all external module egress through UCB. Do not bypass UCB for optional internet-facing modules.
