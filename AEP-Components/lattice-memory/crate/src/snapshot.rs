//! The snapshot file of one domain: its attractors at one place of its log.
//!
//! A snapshot lets a large log open without a replay from its first frame. It names
//! the offset where its log stood, the key and the hash of the record that ended there
//! and every attractor of that moment. Its last 32 bytes are the SHA-256 of the rest.
//!
//! A snapshot is a copy of what the log says and never a source of its own. A log only
//! grows, so a snapshot that was true once remains true: the record it names is still
//! at the place it names. A log that is shorter than its snapshot or holds another
//! record at that place was cut or changed, and that is reported as corrupt.

use crate::model::DomainHead;
use aep_lattice_memory_core::{sha256, Attractor, Fingerprint};
use std::path::{Path, PathBuf};

/// Suffix of a snapshot file.
pub const SNAPSHOT_SUFFIX: &str = ".lmsnap";

const SNAPSHOT_MAGIC: &[u8; 8] = b"AEPLMS01";

pub(crate) fn snapshot_path(dir: &Path, domain: &str) -> PathBuf {
    dir.join(format!("{domain}{SNAPSHOT_SUFFIX}"))
}

/// What a snapshot file holds.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Snapshot {
    /// Offset after the frame of the newest record the snapshot covers.
    pub(crate) end: u64,
    pub(crate) head: DomainHead,
    /// Each attractor with the offset of the frame of the last record that touched it.
    pub(crate) attractors: Vec<(Attractor, u64)>,
}

struct ByteReader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> ByteReader<'a> {
    fn take(&mut self, len: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(len)?;
        let slice = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(slice)
    }

    fn u64(&mut self) -> Option<u64> {
        let mut raw = [0u8; 8];
        raw.copy_from_slice(self.take(8)?);
        Some(u64::from_le_bytes(raw))
    }

    fn i64(&mut self) -> Option<i64> {
        self.u64().map(|v| v as i64)
    }

    fn digest(&mut self) -> Option<[u8; 32]> {
        let mut raw = [0u8; 32];
        raw.copy_from_slice(self.take(32)?);
        Some(raw)
    }
}

/// What reading the snapshot file of a domain gave.
pub(crate) enum SnapshotFile {
    /// No snapshot file exists.
    Absent,
    /// A file exists and its bytes are no whole snapshot of this format.
    Damaged,
    Whole(Snapshot),
}

impl Snapshot {
    pub(crate) fn encode(&self) -> Vec<u8> {
        let mut out = Vec::with_capacity(128 + self.attractors.len() * 128);
        out.extend_from_slice(SNAPSHOT_MAGIC);
        out.extend_from_slice(&self.end.to_le_bytes());
        out.extend_from_slice(&self.head.last_key.to_le_bytes());
        out.extend_from_slice(&self.head.head_hash);
        out.extend_from_slice(&self.head.last_attractor_key.to_le_bytes());
        out.extend_from_slice(&(self.attractors.len() as u64).to_le_bytes());
        for (attractor, touch) in &self.attractors {
            let vector = attractor.fingerprint.to_bytes();
            out.extend_from_slice(&attractor.key.to_le_bytes());
            out.extend_from_slice(&attractor.support.to_le_bytes());
            out.extend_from_slice(&attractor.formed_at_unix.to_le_bytes());
            out.extend_from_slice(&attractor.last_seen_unix.to_le_bytes());
            out.extend_from_slice(&touch.to_le_bytes());
            out.extend_from_slice(&attractor.shape_digest);
            out.extend_from_slice(&(attractor.fingerprint.kind().code() as u64).to_le_bytes());
            out.extend_from_slice(&(vector.len() as u64).to_le_bytes());
            out.extend_from_slice(&vector);
        }
        let digest = sha256(&out);
        out.extend_from_slice(&digest);
        out
    }

    /// Read a snapshot. None for bytes that are not a whole snapshot of this format.
    pub(crate) fn decode(bytes: &[u8], embedding_dim: usize) -> Option<Self> {
        let body_len = bytes.len().checked_sub(32)?;
        let (body, digest) = bytes.split_at(body_len);
        if sha256(body) != digest {
            return None;
        }
        let mut reader = ByteReader { bytes: body, at: 0 };
        if reader.take(8)? != SNAPSHOT_MAGIC {
            return None;
        }
        let end = reader.u64()?;
        let last_key = reader.i64()?;
        let head_hash = reader.digest()?;
        let last_attractor_key = reader.i64()?;
        let count = reader.u64()?;
        let mut attractors = Vec::new();
        for _ in 0..count {
            let key = reader.i64()?;
            let support = reader.u64()?;
            let formed_at_unix = reader.i64()?;
            let last_seen_unix = reader.i64()?;
            let touch = reader.u64()?;
            let shape_digest = reader.digest()?;
            let kind = reader.i64()?;
            let vector_len = reader.u64()? as usize;
            let vector = reader.take(vector_len)?;
            let fingerprint = Fingerprint::from_stored(kind, vector, embedding_dim).ok()?;
            attractors.push((
                Attractor {
                    key,
                    fingerprint,
                    shape_digest,
                    support,
                    formed_at_unix,
                    last_seen_unix,
                },
                touch,
            ));
        }
        if reader.at != body.len() {
            return None;
        }
        Some(Snapshot {
            end,
            head: DomainHead {
                last_key,
                head_hash,
                last_attractor_key,
            },
            attractors,
        })
    }

    /// Read the snapshot file of a domain.
    pub(crate) fn read(
        dir: &Path,
        domain: &str,
        embedding_dim: usize,
    ) -> std::io::Result<SnapshotFile> {
        match std::fs::read(snapshot_path(dir, domain)) {
            Ok(bytes) => Ok(match Snapshot::decode(&bytes, embedding_dim) {
                Some(snapshot) => SnapshotFile::Whole(snapshot),
                None => SnapshotFile::Damaged,
            }),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(SnapshotFile::Absent),
            Err(e) => Err(e),
        }
    }
}
