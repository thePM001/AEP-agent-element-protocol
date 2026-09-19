//! POTOMITAN mesh packet plane: inject, forward and deliver.

use crate::packet::{hop_limit_allows_forward, MeshPacket, PacketError};
use crate::routing::RoutingTable;
use crate::transport::MeshTransport;

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
}

impl<T: MeshTransport> MeshPacketPlane<T> {
    pub fn new(local_node_id: String, transport: T, routing: RoutingTable) -> Self {
        Self {
            local_node_id,
            routing,
            transport,
            next_seq: 1,
            inbox: Vec::new(),
        }
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

    pub fn poll(&mut self) -> Result<Option<MeshPacket>, PlaneError> {
        if !self.inbox.is_empty() {
            return Ok(Some(self.inbox.remove(0)));
        }
        match self.transport.recv_datagram()? {
            None => Ok(None),
            Some((_from, bytes)) => {
                let pkt = MeshPacket::decode(&bytes)?;
                match self.ingest(pkt)? {
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
        if hop_limit_allows_forward(pkt.hop_limit) == false {
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
    use crate::transport::{MemoryFabric, MemoryTransport};

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
        use crate::transport::UdpTransport;
        use crate::routing::RouteEntry;
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
