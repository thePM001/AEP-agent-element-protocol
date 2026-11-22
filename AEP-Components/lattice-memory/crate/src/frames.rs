//! The frames of a log file and how its end is read.
//!
//! A log is a header and then frames. A frame is the length of its entry, the entry
//! bytes, the hash of the entry and the length once more.
//!
//! The end of a log is one of three things:
//!
//! - It ends after a whole frame. That is the normal case.
//! - It ends in a cut write: a crash stopped a writer inside one frame. The tail is
//!   then shorter than the frame it declares and holds no whole frame, or it is a run
//!   of zero bytes that a loss of power left where a frame was to be. Only a cut write
//!   is ever cut off, and only by a writer.
//! - Everything else is damage: a length no entry has, a frame whose hash or second
//!   length does not fit and a tail that is too short for its declared frame but still
//!   holds a whole frame. Damage is reported as corrupt and never cut off.

use crate::error::MemoryError;
use aep_lattice_memory_core::{entry_hash, LogEntry, MAX_ENTRY_BYTES};
use std::fs::File;
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::Path;

/// Version of the store format.
pub const FORMAT_VERSION: u32 = 1;

pub(crate) const LOG_MAGIC: &[u8; 8] = b"AEPLML01";
/// Bytes of the header of a log file: the magic and the format version.
pub(crate) const HEADER_BYTES: u64 = 12;
/// Bytes a frame adds around its entry: two lengths and the hash.
pub(crate) const FRAME_OVERHEAD: u64 = 4 + 32 + 4;
/// Fewest bytes of an entry: its fixed fields and four empty framed fields.
pub(crate) const MIN_ENTRY_BYTES: usize = 108 + 16;

/// One frame read from a log.
#[derive(Debug)]
pub(crate) enum Frame {
    Entry {
        /// Offset of the first byte of the frame.
        offset: u64,
        entry: Box<LogEntry>,
        hash: [u8; 32],
    },
    /// The log ends here, after a whole frame.
    End,
    /// The bytes from this offset on are the rest of a write a crash cut short.
    Torn { offset: u64 },
}

/// The bytes of one frame.
pub(crate) fn frame_bytes(entry_bytes: &[u8], hash: &[u8; 32]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(entry_bytes.len() + FRAME_OVERHEAD as usize);
    frame.extend_from_slice(&(entry_bytes.len() as u32).to_le_bytes());
    frame.extend_from_slice(entry_bytes);
    frame.extend_from_slice(hash);
    frame.extend_from_slice(&(entry_bytes.len() as u32).to_le_bytes());
    frame
}

pub(crate) fn header_bytes() -> [u8; HEADER_BYTES as usize] {
    let mut header = [0u8; HEADER_BYTES as usize];
    header[..8].copy_from_slice(LOG_MAGIC);
    header[8..].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
    header
}

fn le_u32(bytes: &[u8], at: usize) -> Option<usize> {
    let raw: [u8; 4] = bytes.get(at..at.checked_add(4)?)?.try_into().ok()?;
    Some(u32::from_le_bytes(raw) as usize)
}

/// True when `tail` holds the whole frame of an entry of `entry_len` bytes from `start` on.
fn whole_frame_at(domain: &str, tail: &[u8], start: usize, entry_len: usize) -> bool {
    if !(MIN_ENTRY_BYTES..=MAX_ENTRY_BYTES).contains(&entry_len) {
        return false;
    }
    let entry_from = start + 4;
    let hash_from = entry_from + entry_len;
    let second_from = hash_from + 32;
    if second_from + 4 > tail.len() || le_u32(tail, second_from) != Some(entry_len) {
        return false;
    }
    entry_hash(domain, &tail[entry_from..hash_from])[..] == tail[hash_from..second_from]
}

/// True when the tail of a log holds a whole frame. `tail` starts where a frame was
/// expected whose first length runs past the end of the log.
///
/// Two places are looked at. A frame may start at the start of the tail under another
/// length than the first length names: then its second length stands at its end. A
/// frame may also start anywhere behind the start of the tail. A cut write holds
/// neither, because it is a part of one frame and nothing follows it.
fn holds_whole_frame(domain: &str, tail: &[u8]) -> bool {
    let least = MIN_ENTRY_BYTES + FRAME_OVERHEAD as usize;
    if tail.len() < least {
        return false;
    }
    for end in least..=tail.len() {
        if let Some(entry_len) = le_u32(tail, end - 4) {
            if entry_len + FRAME_OVERHEAD as usize == end
                && whole_frame_at(domain, tail, 0, entry_len)
            {
                return true;
            }
        }
    }
    for start in 1..=tail.len() - least {
        if let Some(entry_len) = le_u32(tail, start) {
            if whole_frame_at(domain, tail, start, entry_len) {
                return true;
            }
        }
    }
    false
}

/// Reads the frames of one log in order.
pub(crate) struct FrameReader<'a> {
    domain: &'a str,
    reader: BufReader<File>,
    /// Offset of the next byte that is read.
    pub(crate) at: u64,
    len: u64,
}

impl<'a> FrameReader<'a> {
    /// A reader over the bytes of `path` from `from` up to `len`.
    pub(crate) fn open(
        path: &Path,
        domain: &'a str,
        from: u64,
        len: u64,
    ) -> Result<Self, MemoryError> {
        let mut file = File::open(path)?;
        file.seek(SeekFrom::Start(from))?;
        Ok(FrameReader {
            domain,
            reader: BufReader::with_capacity(1 << 16, file),
            at: from,
            len,
        })
    }

    /// The bytes from `offset` to the end of the log.
    fn tail(&mut self, offset: u64) -> Result<Vec<u8>, MemoryError> {
        self.reader.seek(SeekFrom::Start(offset))?;
        self.at = offset;
        let mut tail = vec![0u8; (self.len - offset) as usize];
        self.reader.read_exact(&mut tail)?;
        self.reader.seek(SeekFrom::Start(offset))?;
        Ok(tail)
    }

    /// True when every byte from `offset` to the end is zero. A loss of power can leave
    /// such a tail when the size of a file reached the disk before its bytes.
    fn rest_is_zero(&mut self, offset: u64) -> Result<bool, MemoryError> {
        self.reader.seek(SeekFrom::Start(offset))?;
        self.at = offset;
        let mut left = self.len - offset;
        let mut buffer = [0u8; 8192];
        let mut zero = true;
        while left > 0 && zero {
            let take = left.min(buffer.len() as u64) as usize;
            self.reader.read_exact(&mut buffer[..take])?;
            zero = buffer[..take].iter().all(|b| *b == 0);
            left -= take as u64;
        }
        self.reader.seek(SeekFrom::Start(offset))?;
        Ok(zero)
    }

    fn corrupt(&self, offset: u64, what: &str) -> MemoryError {
        MemoryError::Corrupt(format!(
            "domain {}: the frame at byte {offset} {what}",
            self.domain
        ))
    }

    pub(crate) fn read_frame(&mut self) -> Result<Frame, MemoryError> {
        let offset = self.at;
        let left = self.len - offset;
        if left == 0 {
            return Ok(Frame::End);
        }
        if left < 4 {
            // Less than one length field: a write that was cut inside it.
            return Ok(Frame::Torn { offset });
        }
        let mut raw = [0u8; 4];
        self.reader.read_exact(&mut raw)?;
        let entry_len = u32::from_le_bytes(raw) as usize;
        let frame_len = entry_len as u64 + FRAME_OVERHEAD;
        if !(MIN_ENTRY_BYTES..=MAX_ENTRY_BYTES).contains(&entry_len) {
            // Not the start of a frame. A tail of zero bytes is the rest of a cut write.
            if self.rest_is_zero(offset)? {
                return Ok(Frame::Torn { offset });
            }
            return Err(self.corrupt(offset, "holds a length no entry has"));
        }
        if frame_len > left {
            // The tail is shorter than the frame it declares. That is a cut write
            // unless a whole frame stands in it: then a length field was changed.
            let tail = self.tail(offset)?;
            if holds_whole_frame(self.domain, &tail) {
                return Err(self.corrupt(
                    offset,
                    "names a length that runs past the end of the log while a whole frame stands there",
                ));
            }
            return Ok(Frame::Torn { offset });
        }
        let mut bytes = vec![0u8; entry_len];
        self.reader.read_exact(&mut bytes)?;
        let mut hash = [0u8; 32];
        self.reader.read_exact(&mut hash)?;
        self.reader.read_exact(&mut raw)?;
        if u32::from_le_bytes(raw) as usize != entry_len {
            return Err(self.corrupt(offset, "ends in another length than it starts with"));
        }
        if entry_hash(self.domain, &bytes) != hash {
            return Err(self.corrupt(offset, "does not hash to its stored hash"));
        }
        let entry = LogEntry::decode(&bytes)?;
        self.at = offset + frame_len;
        Ok(Frame::Entry {
            offset,
            entry: Box::new(entry),
            hash,
        })
    }
}
