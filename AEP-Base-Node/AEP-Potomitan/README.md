# Potomitan

This folder belongs to component 01 (AEP Base Node) and the README of the whole component is `AEP-Base-Node/README.md`. On the AEP page it is the fourth tier of the Base Node, the mesh fallback below the node.

Mesh fallback for AEP 2.9 when normal internet is unavailable.

aep-potomitan ships a mesh packet plane. Packets encode to POTM wire bytes, hop_limit governs forward, MemoryTransport and UdpTransport send datagrams and MeshPacketPlane delivers or forwards via the routing table. This crate is not registry-plus-mode.

crate/ holds aep-potomitan (packet plane, peer registry, routing, supervisor).
YGGDRASIL-ADAPTATION.md holds upstream attribution.

Upstream: https://github.com/yggdrasil-network/yggdrasil-go
License: MIT / project custom license (see upstream).

Wired into AEP-Base-Node/AEP-Crate via aep-potomitan. Health reports mesh mode (internet, potomitan, offline) and packet_plane=true.


## What a shipped binary binds

The crate has two transports: a memory transport for tests and a UDP transport. The shipped daemon `aep-base-node` loads the mesh peer file, computes the mesh mode and reports it in its health answer. It opens no mesh socket, so no UDP port is bound by a default deployment. A builder who wants mesh traffic calls `open_udp_plane` of the supervisor with a bind address. Mesh traffic from the daemon is planned.

## Layout

| Path | Role |
|------|------|
| `crate/src/packet.rs` | The mesh packet and its wire bytes |
| `crate/src/plane.rs` | The packet plane with deliver and forward |
| `crate/src/routing.rs` | The routing table |
| `crate/src/peer.rs` | The peer registry and the peer file |
| `crate/src/transport.rs` | The memory transport and the UDP transport |
| `crate/src/supervisor.rs` | The supervisor with the mesh mode |
| `YGGDRASIL-ADAPTATION.md` | The attribution to the upstream project |

## Run and test

```bash
cargo test -p aep-potomitan
```
