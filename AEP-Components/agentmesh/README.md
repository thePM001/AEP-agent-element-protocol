# 13 / AgentMesh

Status: normative. Stability: evolving. Local issuance is tested and the workload attestation interface is an opt-in.

## What it is

AgentMesh is the identity layer for agents. It issues an X.509 certificate, a decentralized identifier (DID) and mTLS credentials for each agent on the local node. The Base Node uses these identities to know which agent signed a sealed capsule. Issuance is strictly local: no external certificate authority, no attestation by other nodes and no consensus network takes part.

## Place among the 18

The AEP Base Node (01) asks AgentMesh for identities when it registers agents and docks. The Lattice Channels (08) use the mTLS settings for TCP endpoints and UCB (02) uses the identities for external agents. The Admit Gate (04) judges the signer AgentMesh identified.

## What ships in 2.9

- The crate `aep-agentmesh`: a local certificate authority in the data folder, workload certificates, SPIFFE style URI names and `did:aep` documents.
- mTLS server and client settings for Lattice Channel endpoints over TCP.
- Local issuance is no mesh attestation. A source check in `AEP-Components/agentmesh-local-issuance/` fails when a document claims otherwise.
- Attestation through a SPIFFE Workload API is an opt-in with `AEP_AGENTMESH_SPIFFE_WORKLOAD_API`.
- The TypeScript identity manager with Ed25519 keys in `AEP-Components/identity/`.

## Layout

| Path | Role |
|------|------|
| `crate/src/lib.rs` | Identity bundle, SPIFFE names and DID documents |
| `crate/src/tls.rs` | Local certificate authority and mTLS settings |
| `AEP-Components/agentmesh-local-issuance/` | Source check on the wording local issuance |
| `AEP-Components/identity/` | Agent identity manager in TypeScript |

## Interfaces

- Functions: `create_bundle`, `create_spiffe`, `create_did`, `create_mtls`, `ensure_mesh_ca`, `issue_workload_identity`, `build_server_config` and `build_client_config`.
- Environment: `AEP_DATA` for the data folder, `AEP_AGENTMESH_SPIFFE_WORKLOAD_API` and `AEP_MESH_CA_FORCE_REGEN`.
- Files: the certificate authority and the certificates under the data folder.

## Limits

- A local certificate proves which local key signed. It does not prove the state of a remote machine.
- AgentMesh grants nothing. Who may do what is the agent permission in GAP (06), judged by the Admit Gate (04).
- The mesh in the name is the identity mesh. The network fallback is the Potomitan crate of the AEP Base Node (01).

## Run and test

```bash
cargo test -p aep-agentmesh -p aep-agentmesh-local-issuance
npx vitest run AEP-Components/identity
```

## Related documents

- `AEP-Components/identity/README.md` for the TypeScript manager
- `AEP-Components/lattice-channels/README.md` for the transport
- `AEP-User-Experience/docs/AEP-2.9-SECURE-DEPLOYMENT-GUIDE.md` for key handling in a deployment
