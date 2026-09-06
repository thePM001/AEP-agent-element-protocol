# AgentMesh

Local issuance identity layer for AEP 2.8 Lattice Channels.

## Component layout

| Path | Contents |
|------|----------|
| `crate/` | `aep-agentmesh` Rust crate |

Provides locally issued X.509 workload certs, SPIFFE URI SAN strings, `did:aep` documents and mTLS cert state required before Agent Composer channel integration. Local issuance is not mesh attestation. Full SPIFFE Workload API attestation is opt-in via AEP_AGENTMESH_SPIFFE_WORKLOAD_API. Numeric trust_score is isolation telemetry. It is not stored on cert state and does not rotate certs.
