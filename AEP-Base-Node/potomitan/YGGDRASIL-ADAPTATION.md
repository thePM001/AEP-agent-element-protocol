# Yggdrasil Adaptation Notes (POTOMITAN)

**Upstream:** https://github.com/yggdrasil-network/yggdrasil-go
**License:** MIT / upstream custom license

## What we adapted for AEP 2.8 Phase 4

| Yggdrasil concept | POTOMITAN implementation |
|-------------------|--------------------------|
| Node identity | `MeshPeer.node_id` |
| Peer endpoint | `MeshPeer.endpoint` (`tls://host:port`) |
| Routing table | `RoutingTable` direct routes per active peer |
| Mesh supervisor | `MeshSupervisor` failover when `internet_up=false` |

## Persistence

`$AEP_DATA/mesh-peers.json` (shared with Composer Lite `/api/mesh`).

## Rust crate

`potomitan/crate`