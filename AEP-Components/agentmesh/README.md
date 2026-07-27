# AgentMesh

Zero-trust identity layer for AEP 2.8 Lattice Channels.

## Component layout

| Path | Contents |
|------|----------|
| `crate/` | `aep-agentmesh` Rust crate |

Provides SPIFFE workload IDs, `did:aep` documents, mTLS cert state and trust-tier rotation hooks required before Agent Composer channel integration.