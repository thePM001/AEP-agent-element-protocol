//! POTOMITAN mesh packet wire format (Yggdrasil-inspired switch payload).
//! AEP28-ENV-055: this crate ships a mesh packet plane.

use thiserror::Error;

/// Four-byte magic on every POTOMITAN datagram.
pub const PACKET_MAGIC: [u8; 4] = *b"POTM";
/// Wire version. Unknown versions are refuse.
pub const PACKET_VERSION: u8 = 1;
/// Default hop budget for a newly injected packet.
pub const DEFAULT_HOP_LIMIT: u8 = 16;
/// Max UTF-8 bytes in a node id.
pub const MAX_NODE_ID_LEN: usize = 255;
/// Max payload bytes on the packet plane.
pub const MAX_PAYLOAD_LEN: usize = 65535;

#[derive(Debug, Error, Clone, PartialEq, Eq)]
pub enum PacketError {
    #[error("bad magic")]
    BadMagic,
    #[error("unsupported packet version")]
    Version,
    #[error("truncated packet")]
    Truncated,
    #[error("node id too long")]
    IdTooLong,
    #[error("payload too long")]
    PayloadTooLong,
    #[error("node id is not utf8")]
    IdNotUtf8,
    #[error("empty node id")]
    EmptyId,
}

/// One mesh datagram: src, dst, hop budget, seq and payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MeshPacket {
    pub version: u8,
    pub hop_limit: u8,
    pub seq: u64,
    pub src: String,
    pub dst: String,
    pub payload: Vec<u8>,
}

impl MeshPacket {
    pub fn new(src: impl Into<String>, dst: impl Into<String>, payload: Vec<u8>) -> Result<Self, PacketError> {
        let src = src.into();
        let dst = dst.into();
        Self::check_ids(&src, &dst)?;
        if payload.len() > MAX_PAYLOAD_LEN {
            return Err(PacketError::PayloadTooLong);
        }
        Ok(Self {
            version: PACKET_VERSION,
            hop_limit: DEFAULT_HOP_LIMIT,
            seq: 0,
            src,
            dst,
            payload,
        })
    }

    fn check_ids(src: &str, dst: &str) -> Result<(), PacketError> {
        if src.is_empty() || dst.is_empty() {
            return Err(PacketError::EmptyId);
        }
        if src.len() > MAX_NODE_ID_LEN || dst.len() > MAX_NODE_ID_LEN {
            return Err(PacketError::IdTooLong);
        }
        Ok(())
    }

    pub fn hop_limit_allows_forward(&self) -> bool {
        hop_limit_allows_forward(self.hop_limit)
    }

    pub fn decrement_hop(&mut self) -> Result<(), PacketError> {
        if self.hop_limit == 0 {
            return Err(PacketError::Truncated);
        }
        self.hop_limit -= 1;
        Ok(())
    }

    pub fn encode(&self) -> Result<Vec<u8>, PacketError> {
        if self.version != PACKET_VERSION {
            return Err(PacketError::Version);
        }
        Self::check_ids(&self.src, &self.dst)?;
        if self.payload.len() > MAX_PAYLOAD_LEN {
            return Err(PacketError::PayloadTooLong);
        }
        let src = self.src.as_bytes();
        let dst = self.dst.as_bytes();
        let mut out = Vec::with_capacity(4 + 1 + 1 + 8 + 1 + src.len() + 1 + dst.len() + 2 + self.payload.len());
        out.extend_from_slice(&PACKET_MAGIC);
        out.push(self.version);
        out.push(self.hop_limit);
        out.extend_from_slice(&self.seq.to_be_bytes());
        out.push(src.len() as u8);
        out.extend_from_slice(src);
        out.push(dst.len() as u8);
        out.extend_from_slice(dst);
        let plen = self.payload.len() as u16;
        out.extend_from_slice(&plen.to_be_bytes());
        out.extend_from_slice(&self.payload);
        Ok(out)
    }

    pub fn decode(bytes: &[u8]) -> Result<Self, PacketError> {
        if bytes.len() < 4 + 1 + 1 + 8 + 1 + 1 + 2 {
            return Err(PacketError::Truncated);
        }
        if bytes[0..4] != PACKET_MAGIC {
            return Err(PacketError::BadMagic);
        }
        let version = bytes[4];
        if version != PACKET_VERSION {
            return Err(PacketError::Version);
        }
        let hop_limit = bytes[5];
        let seq = u64::from_be_bytes(
            bytes[6..14]
                .try_into()
                .map_err(|_| PacketError::Truncated)?,
        );
        let mut i = 14usize;
        let src_len = bytes[i] as usize;
        i += 1;
        if bytes.len() < i + src_len + 1 {
            return Err(PacketError::Truncated);
        }
        let src = std::str::from_utf8(&bytes[i..i + src_len]).map_err(|_| PacketError::IdNotUtf8)?;
        i += src_len;
        let dst_len = bytes[i] as usize;
        i += 1;
        if bytes.len() < i + dst_len + 2 {
            return Err(PacketError::Truncated);
        }
        let dst = std::str::from_utf8(&bytes[i..i + dst_len]).map_err(|_| PacketError::IdNotUtf8)?;
        i += dst_len;
        let plen = u16::from_be_bytes(
            bytes[i..i + 2]
                .try_into()
                .map_err(|_| PacketError::Truncated)?,
        ) as usize;
        i += 2;
        if bytes.len() != i + plen {
            return Err(PacketError::Truncated);
        }
        if plen > MAX_PAYLOAD_LEN {
            return Err(PacketError::PayloadTooLong);
        }
        Self::check_ids(src, dst)?;
        Ok(Self {
            version,
            hop_limit,
            seq,
            src: src.to_string(),
            dst: dst.to_string(),
            payload: bytes[i..].to_vec(),
        })
    }
}

pub fn hop_limit_allows_forward(hop_limit: u8) -> bool {
    hop_limit > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_decode_roundtrip() {
        let mut pkt = MeshPacket::new("node-a", "node-b", b"hello-mesh".to_vec()).expect("new");
        pkt.seq = 42;
        pkt.hop_limit = 9;
        let wire = pkt.encode().expect("encode");
        assert_eq!(&wire[0..4], &PACKET_MAGIC);
        let back = MeshPacket::decode(&wire).expect("decode");
        assert_eq!(back, pkt);
    }

    #[test]
    fn refuse_bad_magic() {
        let err = MeshPacket::decode(b"XXXX\x01\x01\x00\x00\x00\x00\x00\x00\x00\x01a\x01b\x00\x00")
            .expect_err("magic");
        assert_eq!(err, PacketError::BadMagic);
    }

    #[test]
    fn hop_limit_zero_does_not_forward() {
        assert!(!hop_limit_allows_forward(0));
        assert!(hop_limit_allows_forward(1));
        let pkt = MeshPacket::new("a", "b", vec![]).expect("new");
        assert!(pkt.hop_limit_allows_forward());
    }

    #[test]
    fn refuse_empty_ids() {
        assert_eq!(
            MeshPacket::new("", "b", vec![]).expect_err("empty"),
            PacketError::EmptyId
        );
    }
}
