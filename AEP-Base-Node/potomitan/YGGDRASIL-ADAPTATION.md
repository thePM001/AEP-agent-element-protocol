# Yggdrasil Adaptation Notes (POTOMITAN)

Upstream: https://github.com/yggdrasil-network/yggdrasil-go
License: MIT / upstream custom license

Node identity maps to MeshPeer.node_id.
Peer endpoint maps to MeshPeer.endpoint (tls://host:port, udp://host:port, mem://id).
Routing table is RoutingTable per active peer plus explicit insert.
Switch packet is MeshPacket POTM wire with hop_limit, seq and payload.
Packet plane is MeshPacketPlane send, poll and forward.
Datagram transports are MemoryTransport and UdpTransport.
Mesh supervisor is MeshSupervisor failover when internet_up=false plus a bound packet plane.

Persistence: AEP_DATA/mesh-peers.json (shared with Composer Lite /api/mesh).

Rust crate: potomitan/crate
