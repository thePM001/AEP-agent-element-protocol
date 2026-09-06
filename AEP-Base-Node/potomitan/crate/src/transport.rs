//! POTOMITAN datagram transports: in-process fabric and UDP.

use std::collections::{HashMap, VecDeque};
use std::net::{SocketAddr, UdpSocket};
use std::sync::{Arc, Mutex};
use thiserror::Error;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PlaneError {
    #[error("packet: {0}")]
    Packet(String),
    #[error("unknown destination")]
    UnknownDestination,
    #[error("hop limit exhausted")]
    HopLimit,
    #[error("bad endpoint")]
    BadEndpoint,
    #[error("transport mismatch")]
    TransportMismatch,
    #[error("transport poison")]
    TransportPoison,
    #[error("io: {0}")]
    Io(String),
}

/// Where a peer endpoint should deliver a datagram.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DatagramTarget {
    Memory(String),
    Udp(String),
}

/// Parse Yggdrasil-style peer endpoints onto the packet plane.
/// `mem://id` is in-process. `udp://host:port` and `tls://host:port` use host:port as a UDP target.
pub fn datagram_target(endpoint: &str) -> Result<DatagramTarget, PlaneError> {
    if endpoint.is_empty() {
        return Err(PlaneError::BadEndpoint);
    }
    if let Some(rest) = endpoint.strip_prefix("mem://") {
        if rest.is_empty() {
            return Err(PlaneError::BadEndpoint);
        }
        return Ok(DatagramTarget::Memory(rest.to_string()));
    }
    let rest = endpoint
        .strip_prefix("udp://")
        .or_else(|| endpoint.strip_prefix("tls://"))
        .unwrap_or(endpoint);
    if rest.is_empty() || !rest.contains(':') {
        return Err(PlaneError::BadEndpoint);
    }
    Ok(DatagramTarget::Udp(rest.to_string()))
}

pub trait MeshTransport {
    fn local_endpoint(&self) -> &str;
    fn send_datagram(&mut self, endpoint: &str, bytes: &[u8]) -> Result<(), PlaneError>;
    fn recv_datagram(&mut self) -> Result<Option<(String, Vec<u8>)>, PlaneError>;
}

/// Shared in-process fabric so tests can run a mesh without sockets.
#[derive(Clone, Default)]
pub struct MemoryFabric {
    inner: Arc<Mutex<HashMap<String, VecDeque<(String, Vec<u8>)>>>>,
}

impl MemoryFabric {
    pub fn new() -> Self {
        Self::default()
    }
}

pub struct MemoryTransport {
    fabric: MemoryFabric,
    endpoint: String,
}

impl MemoryTransport {
    pub fn bind(fabric: MemoryFabric, node_id: &str) -> Self {
        let endpoint = format!("mem://{node_id}");
        if let Ok(mut map) = fabric.inner.lock() {
            map.entry(endpoint.clone()).or_default();
        }
        Self { fabric, endpoint }
    }
}

impl MeshTransport for MemoryTransport {
    fn local_endpoint(&self) -> &str {
        &self.endpoint
    }

    fn send_datagram(&mut self, endpoint: &str, bytes: &[u8]) -> Result<(), PlaneError> {
        let target = datagram_target(endpoint)?;
        let key = match target {
            DatagramTarget::Memory(id) => format!("mem://{id}"),
            DatagramTarget::Udp(_) => return Err(PlaneError::TransportMismatch),
        };
        let mut map = self
            .fabric
            .inner
            .lock()
            .map_err(|_| PlaneError::TransportPoison)?;
        let inbox = map.entry(key).or_default();
        inbox.push_back((self.endpoint.clone(), bytes.to_vec()));
        Ok(())
    }

    fn recv_datagram(&mut self) -> Result<Option<(String, Vec<u8>)>, PlaneError> {
        let mut map = self
            .fabric
            .inner
            .lock()
            .map_err(|_| PlaneError::TransportPoison)?;
        let inbox = map.entry(self.endpoint.clone()).or_default();
        Ok(inbox.pop_front())
    }
}

pub struct UdpTransport {
    socket: UdpSocket,
    endpoint: String,
    buf: Vec<u8>,
}

impl UdpTransport {
    pub fn bind(addr: &str) -> Result<Self, PlaneError> {
        let socket = UdpSocket::bind(addr).map_err(|e| PlaneError::Io(e.to_string()))?;
        socket
            .set_nonblocking(true)
            .map_err(|e| PlaneError::Io(e.to_string()))?;
        let local: SocketAddr = socket
            .local_addr()
            .map_err(|e| PlaneError::Io(e.to_string()))?;
        let endpoint = format!("udp://{local}");
        Ok(Self {
            socket,
            endpoint,
            buf: vec![0u8; 65535],
        })
    }

    pub fn local_udp_endpoint(&self) -> &str {
        &self.endpoint
    }
}

impl MeshTransport for UdpTransport {
    fn local_endpoint(&self) -> &str {
        &self.endpoint
    }

    fn send_datagram(&mut self, endpoint: &str, bytes: &[u8]) -> Result<(), PlaneError> {
        let target = datagram_target(endpoint)?;
        let addr = match target {
            DatagramTarget::Udp(a) => a,
            DatagramTarget::Memory(_) => return Err(PlaneError::TransportMismatch),
        };
        self.socket
            .send_to(bytes, addr.as_str())
            .map_err(|e| PlaneError::Io(e.to_string()))?;
        Ok(())
    }

    fn recv_datagram(&mut self) -> Result<Option<(String, Vec<u8>)>, PlaneError> {
        match self.socket.recv_from(&mut self.buf) {
            Ok((n, from)) => {
                let ep = format!("udp://{from}");
                Ok(Some((ep, self.buf[..n].to_vec())))
            }
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock => Ok(None),
            Err(e) => Err(PlaneError::Io(e.to_string())),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_tls_as_udp_target() {
        let t = datagram_target("tls://10.0.0.2:12345").expect("parse");
        assert_eq!(t, DatagramTarget::Udp("10.0.0.2:12345".into()));
    }

    #[test]
    fn parses_mem_target() {
        let t = datagram_target("mem://node-a").expect("parse");
        assert_eq!(t, DatagramTarget::Memory("node-a".into()));
    }

    #[test]
    fn refuse_empty_endpoint() {
        assert!(datagram_target("").is_err());
        assert!(datagram_target("mem://").is_err());
    }
}
