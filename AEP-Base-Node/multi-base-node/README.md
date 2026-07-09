# Multi-Base-Node (2.8b)

Federate multiple AEP Base Node kernels from one `nodes.json` v2 registry.

## Architecture

![AEP 2.8b multi-base-node architecture: nodes.json registry, single and multi-kernel federation, optional Agentstream, lattice channels, Rust crate, federation policies](./docs/multi-base-node-28b-architecture.svg)

Source: [`docs/multi-base-node-28b-architecture.svg`](./docs/multi-base-node-28b-architecture.svg)

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