# Potomitan

Mesh fallback for AEP 2.8 when normal internet is unavailable.

AEP28-ENV-055: aep-potomitan ships a mesh packet plane. Packets encode to POTM wire bytes, hop_limit governs forward, MemoryTransport and UdpTransport send datagrams, and MeshPacketPlane delivers or forwards via the routing table. This crate is not registry-plus-mode.

crate/ holds aep-potomitan (packet plane, peer registry, routing, supervisor).
YGGDRASIL-ADAPTATION.md holds upstream attribution.

Upstream: https://github.com/yggdrasil-network/yggdrasil-go
License: MIT / project custom license (see upstream).

Wired into AEP-Base-Node/crate via aep-potomitan. Health reports mesh mode (internet, potomitan, offline) and packet_plane=true.
