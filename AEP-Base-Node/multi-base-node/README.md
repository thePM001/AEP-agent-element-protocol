# Multi-Base-Node (2.8b)

Federate multiple AEP Base Node kernels from one `nodes.json` v2 registry.

## Component layout

| Path | Contents |
| --- | --- |
| `crate/` | `multi-base-node-core` Rust crate (registry, Merkle sync, failover helpers) |
| `docs/multi-base-node-28b.md` | Feature guide |
| `docs/multi-base-node-28b-architecture.svg` | Architecture diagram |
| `docs/multi-base-node-artifact-manifest.json` | Shipped artifact list |

## Registry files (Base Node kernel)

| Path | Purpose |
| --- | --- |
| `../registry/nodes.json` | Example registry |
| `../registry/schemas/nodes-registry-v2.json` | JSON schema v2 |
| `../registry/profiles/as-single-polar.json` | Single-node default profile |

## Build

```bash
cargo test -p multi-base-node-core
```

Agentstream is optional. Federation uses lattice-channel.v1 transport.