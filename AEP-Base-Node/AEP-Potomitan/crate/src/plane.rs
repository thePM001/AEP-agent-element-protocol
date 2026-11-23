//! POTOMITAN mesh packet plane: inject, forward and deliver.

use crate::packet::{hop_limit_allows_forward, MeshPacket, PacketError};
use crate::routing::RoutingTable;
use crate::transport::MeshTransport;
use crate::PlaneProof;
use std::collections::BTreeSet;

pub use crate::transport::PlaneError;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ForwardOutcome {
    DeliveredLocal,
    Forwarded { next_hop: String, endpoint: String },
    DroppedHopLimit,
}

impl From<PacketError> for PlaneError {
    fn from(e: PacketError) -> Self {
        PlaneError::Packet(e.to_string())
    }
}

pub struct MeshPacketPlane<T: MeshTransport> {
    pub local_node_id: String,
    pub routing: RoutingTable,
    pub transport: T,
    next_seq: u64,
    inbox: Vec<MeshPacket>,
    /// Endpoints of known peers whose datagrams this plane accepted.
    proven_senders: BTreeSet<String>,
    /// Datagrams dropped because the sender is not a known peer.
    dropped_unknown_sender: u64,
}

impl<T: MeshTransport> MeshPacketPlane<T> {
    pub fn new(local_node_id: String, transport: T, routing: RoutingTable) -> Self {
        Self {
            local_node_id,
            routing,
            transport,
            next_seq: 1,
            inbox: Vec::new(),
            proven_senders: BTreeSet::new(),
            dropped_unknown_sender: 0,
        }
    }

    /// What this plane proved: it is bound, how many known peers reached it and how
    /// many routes it holds. A peer that left the routing table no longer counts.
    pub fn proof(&self) -> PlaneProof {
        let proven = self
            .proven_senders
            .iter()
            .filter(|endpoint| self.routing.knows_endpoint(endpoint))
            .count();
        PlaneProof {
            bound: true,
            proven_peers: u32::try_from(proven).unwrap_or(u32::MAX),
            routes: self.routing.reachable_destinations(),
        }
    }

    /// Datagrams dropped because the sender is not a known peer.
    pub fn dropped_unknown_sender(&self) -> u64 {
        self.dropped_unknown_sender
    }

    pub fn set_routing(&mut self, routing: RoutingTable) {
        self.routing = routing;
    }

    pub fn send(&mut self, dst: &str, payload: Vec<u8>) -> Result<u64, PlaneError> {
        let mut pkt = MeshPacket::new(self.local_node_id.clone(), dst, payload)?;
        pkt.seq = self.next_seq;
        self.next_seq = self.next_seq.saturating_add(1);
        let seq = pkt.seq;
        if dst == self.local_node_id {
            self.inbox.push(pkt);
            return Ok(seq);
        }
        self.dispatch(pkt)?;
        Ok(seq)
    }

    /// Next packet for this node. A datagram whose sender is not the next hop endpoint
    /// of a known peer is dropped before its bytes are decoded.
    pub fn poll(&mut self) -> Result<Option<MeshPacket>, PlaneError> {
        if !self.inbox.is_empty() {
            return Ok(Some(self.inbox.remove(0)));
        }
        match self.transport.recv_datagram()? {
            None => Ok(None),
            Some((from, bytes)) => {
                if !self.routing.knows_endpoint(&from) {
                    self.dropped_unknown_sender = self.dropped_unknown_sender.saturating_add(1);
                    return Ok(None);
                }
                let pkt = MeshPacket::decode(&bytes)?;
                let outcome = self.ingest(pkt)?;
                self.proven_senders.insert(from);
                match outcome {
                    ForwardOutcome::DeliveredLocal => Ok(self.inbox.pop()),
                    ForwardOutcome::DroppedHopLimit => Ok(None),
                    ForwardOutcome::Forwarded { .. } => Ok(None),
                }
            }
        }
    }

    pub fn recv_local(&mut self) -> Option<MeshPacket> {
        if self.inbox.is_empty() {
            None
        } else {
            Some(self.inbox.remove(0))
        }
    }

    fn ingest(&mut self, pkt: MeshPacket) -> Result<ForwardOutcome, PlaneError> {
        if pkt.dst == self.local_node_id {
            self.inbox.push(pkt);
            return Ok(ForwardOutcome::DeliveredLocal);
        }
        if !hop_limit_allows_forward(pkt.hop_limit) {
            return Ok(ForwardOutcome::DroppedHopLimit);
        }
        let mut fwd = pkt;
        if fwd.decrement_hop().is_err() {
            return Err(PlaneError::HopLimit);
        }
        self.dispatch(fwd)
    }

    fn dispatch(&mut self, pkt: MeshPacket) -> Result<ForwardOutcome, PlaneError> {
        let route = self
            .routing
            .route_to(&pkt.dst)
            .cloned()
            .ok_or(PlaneError::UnknownDestination)?;
        let wire = pkt.encode()?;
        self.transport.send_datagram(&route.via_endpoint, &wire)?;
        Ok(ForwardOutcome::Forwarded {
            next_hop: route.next_hop,
            endpoint: route.via_endpoint,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::peer::MeshPeer;
    use crate::routing::RoutingTable;
    use crate::transport::{MemoryFabric, MemoryTransport, MeshTransport};

    fn peer(id: &str) -> MeshPeer {
        MeshPeer {
            node_id: id.into(),
            endpoint: format!("mem://{id}"),
            public_key_hex: None,
            active: true,
        }
    }

    #[test]
    fn memory_plane_delivers_between_two_nodes() {
        let fabric = MemoryFabric::new();
        let peers_a = vec![peer("b")];
        let peers_b = vec![peer("a")];
        let mut a = MeshPacketPlane::new(
            "a".into(),
            MemoryTransport::bind(fabric.clone(), "a"),
            RoutingTable::rebuild_from_peers(&peers_a),
        );
        let mut b = MeshPacketPlane::new(
            "b".into(),
            MemoryTransport::bind(fabric, "b"),
            RoutingTable::rebuild_from_peers(&peers_b),
        );
        let seq = a.send("b", b"ping".to_vec()).expect("send");
        assert!(seq >= 1);
        let got = b.poll().expect("poll").expect("pkt");
        assert_eq!(got.src, "a");
        assert_eq!(got.dst, "b");
        assert_eq!(got.payload, b"ping");
    }

    #[test]
    fn datagram_from_unknown_sender_is_dropped() {
        let fabric = MemoryFabric::new();
        // b knows a only. x is in nobody's peer list.
        let mut b = MeshPacketPlane::new(
            "b".into(),
            MemoryTransport::bind(fabric.clone(), "b"),
            RoutingTable::rebuild_from_peers(&[peer("a")]),
        );
        let mut x = MemoryTransport::bind(fabric, "x");
        let pkt = MeshPacket::new("x", "b", b"intruder".to_vec()).expect("pkt");
        x.send_datagram("mem://b", &pkt.encode().expect("encode"))
            .expect("send");
        assert!(
            b.poll().expect("poll").is_none(),
            "unknown sender delivered"
        );
        assert!(b.recv_local().is_none(), "unknown sender queued");
        assert_eq!(b.dropped_unknown_sender(), 1);
        assert!(
            !b.proof().authenticated(),
            "unknown sender proved the plane"
        );
    }

    #[test]
    fn known_peer_proves_the_plane_until_it_leaves() {
        let fabric = MemoryFabric::new();
        let mut a = MeshPacketPlane::new(
            "a".into(),
            MemoryTransport::bind(fabric.clone(), "a"),
            RoutingTable::rebuild_from_peers(&[peer("b")]),
        );
        let mut b = MeshPacketPlane::new(
            "b".into(),
            MemoryTransport::bind(fabric, "b"),
            RoutingTable::rebuild_from_peers(&[peer("a")]),
        );
        let before = b.proof();
        assert!(before.bound);
        assert_eq!(before.proven_peers, 0);
        assert_eq!(before.routes, 1);
        a.send("b", b"hello".to_vec()).expect("send");
        b.poll().expect("poll").expect("pkt");
        assert!(b.proof().authenticated());
        assert_eq!(b.proof().proven_peers, 1);
        b.set_routing(RoutingTable::new());
        assert!(!b.proof().authenticated(), "a left the peer list");
    }

    #[test]
    fn unknown_destination_is_error() {
        let fabric = MemoryFabric::new();
        let mut a = MeshPacketPlane::new(
            "a".into(),
            MemoryTransport::bind(fabric, "a"),
            RoutingTable::new(),
        );
        let err = a.send("missing", b"x".to_vec()).expect_err("unknown");
        assert_eq!(err, PlaneError::UnknownDestination);
    }

    #[test]
    fn hop_limit_zero_drops_transit() {
        let fabric = MemoryFabric::new();
        let mut b = MeshPacketPlane::new(
            "b".into(),
            MemoryTransport::bind(fabric.clone(), "b"),
            RoutingTable::rebuild_from_peers(&[peer("c")]),
        );
        let mut pkt = MeshPacket::new("a", "c", b"x".to_vec()).expect("pkt");
        pkt.hop_limit = 0;
        let out = b.ingest(pkt).expect("ingest");
        assert_eq!(out, ForwardOutcome::DroppedHopLimit);
    }

    #[test]
    fn memory_plane_forwards_via_insert() {
        let fabric = MemoryFabric::new();
        let mut table_a = RoutingTable::new();
        table_a.insert(crate::routing::RouteEntry {
            destination: "c".into(),
            next_hop: "b".into(),
            cost: 2,
            via_endpoint: "mem://b".into(),
        });
        let mut table_b = RoutingTable::new();
        table_b.insert(crate::routing::RouteEntry {
            destination: "c".into(),
            next_hop: "c".into(),
            cost: 1,
            via_endpoint: "mem://c".into(),
        });
        // b accepts the transit datagram only because a is a known peer of b.
        table_b.insert(crate::routing::RouteEntry {
            destination: "a".into(),
            next_hop: "a".into(),
            cost: 1,
            via_endpoint: "mem://a".into(),
        });
        let mut a = MeshPacketPlane::new(
            "a".into(),
            MemoryTransport::bind(fabric.clone(), "a"),
            table_a,
        );
        let mut b = MeshPacketPlane::new(
            "b".into(),
            MemoryTransport::bind(fabric.clone(), "b"),
            table_b,
        );
        let mut c = MeshPacketPlane::new(
            "c".into(),
            MemoryTransport::bind(fabric, "c"),
            RoutingTable::rebuild_from_peers(&[peer("b")]),
        );
        a.send("c", b"via-b".to_vec()).expect("send");
        must_none(b.poll().expect("b poll"));
        let got = c.poll().expect("c poll").expect("pkt");
        assert_eq!(got.payload, b"via-b");
        assert_eq!(got.src, "a");
        assert_eq!(got.dst, "c");
    }

    fn must_none(v: Option<MeshPacket>) {
        assert!(v.is_none());
    }

    #[test]
    fn udp_plane_delivers_localhost() {
        use crate::routing::RouteEntry;
        use crate::transport::UdpTransport;
        let ta = UdpTransport::bind("127.0.0.1:0").expect("bind a");
        let tb = UdpTransport::bind("127.0.0.1:0").expect("bind b");
        let ea = ta.local_udp_endpoint().to_string();
        let eb = tb.local_udp_endpoint().to_string();
        let mut ra = RoutingTable::new();
        ra.insert(RouteEntry {
            destination: "b".into(),
            next_hop: "b".into(),
            cost: 1,
            via_endpoint: eb,
        });
        let mut rb = RoutingTable::new();
        rb.insert(RouteEntry {
            destination: "a".into(),
            next_hop: "a".into(),
            cost: 1,
            via_endpoint: ea,
        });
        let mut a = MeshPacketPlane::new("a".into(), ta, ra);
        let mut b = MeshPacketPlane::new("b".into(), tb, rb);
        a.send("b", b"udp-hi".to_vec()).expect("send");
        let mut got = None;
        let mut i = 0u8;
        while i < 40 {
            if let Some(p) = b.poll().expect("poll") {
                got = Some(p);
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(5));
            i = i.saturating_add(1);
        }
        let got = got.expect("udp pkt");
        assert_eq!(got.payload, b"udp-hi");
        assert_eq!(got.src, "a");
    }
}
