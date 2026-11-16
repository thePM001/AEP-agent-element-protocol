//! Listener for the gVisor `remote` trace sink.
//!
//! The CAW binds one Unix socket of the type `SOCK_SEQPACKET` per sandbox before runsc
//! starts. runsc connects to it at sandbox start, both sides exchange the handshake
//! and the sentry then sends one packet per trace point until the sandbox ends.

use std::path::Path;

use rustix::fd::OwnedFd;
use rustix::net::{
    accept, bind, listen, recv, send, socket, AddressFamily, RecvFlags, SendFlags, SocketAddrUnix,
    SocketType,
};

use crate::trace::{
    decode_handshake, decode_packet, encode_handshake, TraceError, TraceEvent, WIRE_VERSION,
};

/// The sentry reads the handshake into a buffer of this size and refuses a longer one.
const HANDSHAKE_BUFFER: usize = 10240;

/// Largest packet the listener accepts. gVisor's own server uses the same bound.
const PACKET_BUFFER: usize = 1024 * 1024;

fn socket_error(call: &str, err: rustix::io::Errno) -> TraceError {
    TraceError::Socket(format!("{call}: {err}"))
}

/// A bound trace socket that waits for the sentry of one sandbox.
pub struct TraceListener {
    fd: OwnedFd,
}

impl TraceListener {
    /// Binds the socket at `path`. The path must not exist yet.
    pub fn bind(path: &Path) -> Result<Self, TraceError> {
        let fd = socket(AddressFamily::UNIX, SocketType::SEQPACKET, None)
            .map_err(|e| socket_error("socket", e))?;
        let address = SocketAddrUnix::new(path).map_err(|e| socket_error("address", e))?;
        bind(&fd, &address).map_err(|e| socket_error("bind", e))?;
        listen(&fd, 1).map_err(|e| socket_error("listen", e))?;
        Ok(Self { fd })
    }

    /// Waits for the sentry, runs the handshake and returns the connection.
    pub fn accept(&self) -> Result<TraceConnection, TraceError> {
        let fd = accept(&self.fd).map_err(|e| socket_error("accept", e))?;
        let mut hello = vec![0u8; HANDSHAKE_BUFFER];
        let (read, _) = recv(&fd, hello.as_mut_slice(), RecvFlags::empty())
            .map_err(|e| socket_error("recv handshake", e))?;
        let version = decode_handshake(&hello[..read])?;
        if version != WIRE_VERSION {
            return Err(TraceError::Version(version));
        }
        send(&fd, &encode_handshake(WIRE_VERSION), SendFlags::empty())
            .map_err(|e| socket_error("send handshake", e))?;
        Ok(TraceConnection {
            fd,
            buffer: vec![0u8; PACKET_BUFFER],
        })
    }
}

/// The trace stream of one sandbox after the handshake.
pub struct TraceConnection {
    fd: OwnedFd,
    buffer: Vec<u8>,
}

impl TraceConnection {
    /// Reads the next trace point. `None` when the sandbox closed the stream.
    pub fn next_event(&mut self) -> Result<Option<TraceEvent>, TraceError> {
        let (read, _) = recv(&self.fd, self.buffer.as_mut_slice(), RecvFlags::empty())
            .map_err(|e| socket_error("recv", e))?;
        if read == 0 {
            return Ok(None);
        }
        decode_packet(&self.buffer[..read]).map(Some)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::trace::{TraceKind, HEADER_SIZE, MESSAGE_SYSCALL_OPEN};
    use rustix::net::connect;

    fn temp_socket(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("caw-trace-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir.join("trace.sock")
    }

    fn client(path: &Path) -> OwnedFd {
        let fd = socket(AddressFamily::UNIX, SocketType::SEQPACKET, None).expect("socket");
        connect(&fd, &SocketAddrUnix::new(path).expect("address")).expect("connect");
        fd
    }

    #[test]
    fn the_listener_takes_the_handshake_and_one_point_then_the_end() {
        let path = temp_socket("ok");
        let listener = TraceListener::bind(&path).expect("bind");
        let peer_path = path.clone();
        let peer = std::thread::spawn(move || {
            let fd = client(&peer_path);
            send(&fd, &encode_handshake(WIRE_VERSION), SendFlags::empty()).expect("hello");
            let mut answer = [0u8; 16];
            let (read, _) = recv(&fd, answer.as_mut_slice(), RecvFlags::empty()).expect("answer");
            assert_eq!(decode_handshake(&answer[..read]), Ok(WIRE_VERSION));
            let mut packet = Vec::new();
            packet.extend_from_slice(&(HEADER_SIZE as u16).to_le_bytes());
            packet.extend_from_slice(&MESSAGE_SYSCALL_OPEN.to_le_bytes());
            packet.extend_from_slice(&0u32.to_le_bytes());
            packet.extend_from_slice(&[(6 << 3) | 2, 2, b'/', b'x']);
            send(&fd, &packet, SendFlags::empty()).expect("point");
        });
        let mut connection = listener.accept().expect("accept");
        let event = connection.next_event().expect("event").expect("one point");
        assert_eq!(event.kind, TraceKind::Open);
        assert_eq!(event.pathname, "/x");
        peer.join().expect("peer");
        assert_eq!(connection.next_event(), Ok(None));
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn another_wire_version_is_refused() {
        let path = temp_socket("version");
        let listener = TraceListener::bind(&path).expect("bind");
        let peer_path = path.clone();
        let peer = std::thread::spawn(move || {
            let fd = client(&peer_path);
            send(&fd, &encode_handshake(2), SendFlags::empty()).expect("hello");
        });
        assert!(matches!(listener.accept(), Err(TraceError::Version(2))));
        peer.join().expect("peer");
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }

    #[test]
    fn a_taken_path_is_refused() {
        let path = temp_socket("taken");
        let _first = TraceListener::bind(&path).expect("bind");
        assert!(matches!(
            TraceListener::bind(&path),
            Err(TraceError::Socket(_))
        ));
        let _ = std::fs::remove_dir_all(path.parent().expect("parent"));
    }
}
