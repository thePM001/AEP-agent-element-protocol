# Potomitan

Mesh fallback for AEP 2.8 when normal internet is unavailable.

## Component layout

| Path | Contents |
|------|----------|
| `crate/` | `aep-potomitan` Rust crate (peer registry, routing, supervisor) |
| `YGGDRASIL-ADAPTATION.md` | Upstream attribution and adaptation notes |

## Adaptation source

- **Upstream:** [yggdrasil-network/yggdrasil-go](https://github.com/yggdrasil-network/yggdrasil-go)
- **License:** MIT / project custom license (see upstream)

Phase 4 provides peer registry, routing table, mesh supervisor and Composer Lite `/api/mesh` management. See `YGGDRASIL-ADAPTATION.md`.

## Integration

Wired into `AEP-Base-Node/crate` via `aep-potomitan` dependency. Health JSON reports mesh mode (`internet`, `potomitan`, `offline`).