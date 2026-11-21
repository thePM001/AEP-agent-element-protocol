//! The log file backend: the store for production.
//!
//! A store is one folder. Each domain has one log file that only grows. A record is
//! one frame at the end of the log of its domain: its length, its entry bytes, its hash
//! and its length once more. The entry bytes hold the hash of the entry before, so the
//! frames of one log form a hash chain.
//!
//! - One write is one frame. A frame is whole or it is not there: a frame that a crash
//!   cut short fails its length or its hash and is cut off by the next writer.
//! - A writer holds the exclusive lock of the log file while it reads what other
//!   processes appended, decides and appends. The key of a record is its place in the
//!   log, so two processes never give out the same key.
//! - The log is opened in append mode. The store has no operation that changes or
//!   removes a record.
//! - The attractors live in memory and follow from the log alone. They are rebuilt at
//!   open. A snapshot file per domain lets a large log open without a full replay. A
//!   snapshot that does not match its log is ignored and the log is replayed.
//! - A health check opens files to read, takes a shared lock and reads the last frame
//!   of each log. It creates nothing and changes nothing.

use crate::error::MemoryError;
use crate::memory::verify_entries;
use crate::model::{
    apply_entry, build_entry, check_record, Counts, DomainCounts, DomainHead, DomainVerify,
    HintReader, Match, MemoryBackend, MemoryHealth, NewRecord, Receipt, StoredRecord, VerifyReport,
};
use aep_lattice_memory_core::{
    check_domain, entry_hash, sha256, Attractor, CoreConfig, Fingerprint, LogEntry, MemoryCore,
    Outcome, RouteHint, MAX_ENTRY_BYTES,
};
use std::collections::{BTreeMap, HashMap};
use std::fs::{File, OpenOptions};
use std::io::{BufReader, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};

/// Version of the store format.
pub const FORMAT_VERSION: u32 = 1;
/// Name of the settings file of a store.
pub const META_FILE: &str = "store.lmmeta";
/// Suffix of a log file.
pub const LOG_SUFFIX: &str = ".lmlog";
/// Suffix of a snapshot file.
pub const SNAPSHOT_SUFFIX: &str = ".lmsnap";
/// Records a writer appends to a domain between two snapshots.
pub const SNAPSHOT_EVERY: u64 = 50_000;

const LOG_MAGIC: &[u8; 8] = b"AEPLML01";
const SNAPSHOT_MAGIC: &[u8; 8] = b"AEPLMS01";
/// Bytes of the header of a log file: the magic and the format version.
const HEADER_BYTES: u64 = 12;
/// Bytes a frame adds around its entry: two lengths and the hash.
const FRAME_OVERHEAD: u64 = 4 + 32 + 4;
/// Fewest bytes of an entry: its fixed fields and four empty framed fields.
const MIN_ENTRY_BYTES: usize = 108 + 16;

/// How a store is opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenOptionsLog {
    pub config: CoreConfig,
    /// True to flush every record to the disk before the write returns. False leaves
    /// the flush to the snapshots and to the operating system: a crash of the process
    /// loses nothing, a loss of power may lose the newest records and never the order.
    pub durable: bool,
    /// Records a writer appends to a domain between two snapshots.
    pub snapshot_every: u64,
}

impl OpenOptionsLog {
    pub fn new(config: CoreConfig) -> Self {
        OpenOptionsLog {
            config,
            durable: false,
            snapshot_every: SNAPSHOT_EVERY,
        }
    }
}

/// One frame read from a log.
#[derive(Debug)]
enum Frame {
    Entry {
        /// Offset of the first byte of the frame.
        offset: u64,
        entry: Box<LogEntry>,
        hash: [u8; 32],
    },
    /// The log ends here.
    End,
    /// The bytes from this offset on are the rest of a write a crash cut short.
    Torn { offset: u64 },
}

/// Reads the frames of one log in order.
struct FrameReader<'a> {
    domain: &'a str,
    reader: BufReader<File>,
    at: u64,
    len: u64,
}

impl<'a> FrameReader<'a> {
    /// A reader over the bytes of `path` from `from` up to `len`.
    fn open(path: &Path, domain: &'a str, from: u64, len: u64) -> Result<Self, MemoryError> {
        let mut file = File::open(path)?;
        file.seek(SeekFrom::Start(from))?;
        Ok(FrameReader {
            domain,
            reader: BufReader::with_capacity(1 << 16, file),
            at: from,
            len,
        })
    }

    /// True when every byte from the present place to the end is zero. A loss of power
    /// can leave such a tail when the size of a file reached the disk before its bytes.
    fn rest_is_zero(&mut self) -> Result<bool, MemoryError> {
        let mut left = self.len - self.at;
        let mut buffer = [0u8; 8192];
        while left > 0 {
            let take = left.min(buffer.len() as u64) as usize;
            self.reader.read_exact(&mut buffer[..take])?;
            if buffer[..take].iter().any(|b| *b != 0) {
                return Ok(false);
            }
            left -= take as u64;
        }
        Ok(true)
    }

    fn corrupt(&self, offset: u64, what: &str) -> MemoryError {
        MemoryError::Corrupt(format!(
            "domain {}: the frame at byte {offset} {what}",
            self.domain
        ))
    }

    fn read_frame(&mut self) -> Result<Frame, MemoryError> {
        let offset = self.at;
        let left = self.len - offset;
        if left == 0 {
            return Ok(Frame::End);
        }
        if left < 4 {
            return Ok(Frame::Torn { offset });
        }
        let mut raw = [0u8; 4];
        self.reader.read_exact(&mut raw)?;
        let entry_len = u32::from_le_bytes(raw) as usize;
        let frame_len = entry_len as u64 + FRAME_OVERHEAD;
        if !(MIN_ENTRY_BYTES..=MAX_ENTRY_BYTES).contains(&entry_len) {
            // Not the start of a frame. A tail of zero bytes is the rest of a cut write.
            self.reader.seek(SeekFrom::Start(offset))?;
            self.at = offset;
            if self.rest_is_zero()? {
                return Ok(Frame::Torn { offset });
            }
            return Err(self.corrupt(offset, "holds a length no entry has"));
        }
        if frame_len > left {
            return Ok(Frame::Torn { offset });
        }
        let mut bytes = vec![0u8; entry_len];
        self.reader.read_exact(&mut bytes)?;
        let mut hash = [0u8; 32];
        self.reader.read_exact(&mut hash)?;
        self.reader.read_exact(&mut raw)?;
        let is_last = frame_len == left;
        if u32::from_le_bytes(raw) as usize != entry_len || entry_hash(self.domain, &bytes) != hash
        {
            if is_last {
                return Ok(Frame::Torn { offset });
            }
            self.reader.seek(SeekFrom::Start(offset))?;
            self.at = offset;
            if self.rest_is_zero()? {
                return Ok(Frame::Torn { offset });
            }
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

/// The bytes of one frame.
fn frame_bytes(entry_bytes: &[u8], hash: &[u8; 32]) -> Vec<u8> {
    let mut frame = Vec::with_capacity(entry_bytes.len() + FRAME_OVERHEAD as usize);
    frame.extend_from_slice(&(entry_bytes.len() as u32).to_le_bytes());
    frame.extend_from_slice(entry_bytes);
    frame.extend_from_slice(hash);
    frame.extend_from_slice(&(entry_bytes.len() as u32).to_le_bytes());
    frame
}

fn header_bytes() -> [u8; HEADER_BYTES as usize] {
    let mut header = [0u8; HEADER_BYTES as usize];
    header[..8].copy_from_slice(LOG_MAGIC);
    header[8..].copy_from_slice(&FORMAT_VERSION.to_le_bytes());
    header
}

/// Holds the lock of a log file and gives it back when it goes out of scope.
struct LockGuard<'a>(&'a File);

impl<'a> LockGuard<'a> {
    fn shared(file: &'a File) -> Result<Self, MemoryError> {
        file.lock_shared()?;
        Ok(LockGuard(file))
    }
}

impl Drop for LockGuard<'_> {
    fn drop(&mut self) {
        let _ = self.0.unlock();
    }
}

/// The settings a store keeps: its format version and its embedding dimension.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StoreMeta {
    format_version: u32,
    embedding_dim: usize,
}

impl StoreMeta {
    fn text(&self) -> String {
        format!(
            "format_version={}\nembedding_dim={}\n",
            self.format_version, self.embedding_dim
        )
    }

    fn parse(text: &str) -> Result<Self, MemoryError> {
        let mut format_version = None;
        let mut embedding_dim = None;
        for line in text.lines() {
            match line.split_once('=') {
                Some(("format_version", value)) => format_version = value.parse::<u32>().ok(),
                Some(("embedding_dim", value)) => embedding_dim = value.parse::<usize>().ok(),
                _ => {}
            }
        }
        match (format_version, embedding_dim) {
            (Some(format_version), Some(embedding_dim)) => Ok(StoreMeta {
                format_version,
                embedding_dim,
            }),
            _ => Err(MemoryError::Format(String::from(
                "the settings file names no format version or no embedding dimension",
            ))),
        }
    }

    fn read(dir: &Path) -> Result<Option<Self>, MemoryError> {
        match std::fs::read_to_string(dir.join(META_FILE)) {
            Ok(text) => {
                let meta = StoreMeta::parse(&text)?;
                if meta.format_version != FORMAT_VERSION {
                    return Err(MemoryError::Format(format!(
                        "the store has format version {}, this program reads version {FORMAT_VERSION}",
                        meta.format_version
                    )));
                }
                Ok(Some(meta))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
            Err(e) => Err(MemoryError::Io(e)),
        }
    }
}

fn log_path(dir: &Path, domain: &str) -> PathBuf {
    dir.join(format!("{domain}{LOG_SUFFIX}"))
}

fn snapshot_path(dir: &Path, domain: &str) -> PathBuf {
    dir.join(format!("{domain}{SNAPSHOT_SUFFIX}"))
}

/// The domains that have a log file in the folder, in name order.
fn domains_on_disk(dir: &Path) -> Result<Vec<String>, MemoryError> {
    let mut names = Vec::new();
    let entries = match std::fs::read_dir(dir) {
        Ok(entries) => entries,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(names),
        Err(e) => return Err(MemoryError::Io(e)),
    };
    for entry in entries {
        let name = entry?.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if let Some(domain) = name.strip_suffix(LOG_SUFFIX) {
            if check_domain(domain).is_ok() {
                names.push(domain.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

/// The log of one domain as an open backend holds it.
#[derive(Debug)]
struct DomainLog {
    path: PathBuf,
    /// The log file. A writer holds it in append mode, a reader in read mode.
    file: File,
    /// Offset after the newest frame the attractors hold.
    end: u64,
    head: DomainHead,
    /// Attractor key to the offset of the frame of the last record that touched it.
    last_touch: HashMap<i64, u64>,
    /// Key of the newest record the snapshot file holds.
    snapshot_key: i64,
}

/// What a snapshot file holds.
struct Snapshot {
    end: u64,
    head: DomainHead,
    attractors: Vec<(Attractor, u64)>,
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

impl Snapshot {
    fn encode(&self) -> Vec<u8> {
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
    fn decode(bytes: &[u8], embedding_dim: usize) -> Option<Self> {
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
}

/// The stored hash of the frame that ends at `end`, read from its place before the
/// second length of the frame.
fn hash_before(path: &Path, end: u64) -> Option<[u8; 32]> {
    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(end.checked_sub(36)?)).ok()?;
    let mut hash = [0u8; 32];
    file.read_exact(&mut hash).ok()?;
    Some(hash)
}

/// Points in a write where a test puts a failure.
#[cfg(test)]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum FailPoint {
    /// Before any byte of the frame is written.
    BeforeWrite,
    /// After half of the frame is written, as a crash in the middle of a write leaves it.
    MidFrame,
}

/// A memory on log files.
#[derive(Debug)]
pub struct LogBackend {
    dir: PathBuf,
    config: CoreConfig,
    durable: bool,
    snapshot_every: u64,
    read_only: bool,
    core: Arc<RwLock<MemoryCore>>,
    domains: BTreeMap<String, DomainLog>,
    #[cfg(test)]
    pub(crate) fail_at: Option<FailPoint>,
}

impl LogBackend {
    /// Open a store to write, making the folder and its settings file when they do
    /// not exist. The folder above the store must exist.
    pub fn open(dir: &Path, options: OpenOptionsLog) -> Result<Self, MemoryError> {
        options.config.check()?;
        match std::fs::create_dir(dir) {
            Ok(()) => {}
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(e) => return Err(MemoryError::Io(e)),
        }
        let meta = match StoreMeta::read(dir)? {
            Some(meta) => meta,
            None => {
                // A folder that holds logs and no settings file is not a store this
                // code made, so nothing is written into it.
                if !domains_on_disk(dir)?.is_empty() {
                    return Err(MemoryError::Format(String::from(
                        "the folder holds logs and no settings file",
                    )));
                }
                let meta = StoreMeta {
                    format_version: FORMAT_VERSION,
                    embedding_dim: options.config.embedding_dim,
                };
                // Two processes may make a new store at once. The settings file is
                // written whole under another name and put in place only when no
                // settings file is there, so both read the same settings afterwards.
                let scratch = dir.join(format!("{META_FILE}.{}.new", std::process::id()));
                std::fs::write(&scratch, meta.text())?;
                let linked = std::fs::hard_link(&scratch, dir.join(META_FILE));
                let _ = std::fs::remove_file(&scratch);
                match linked {
                    Ok(()) => meta,
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
                        StoreMeta::read(dir)?.ok_or_else(|| {
                            MemoryError::Format(String::from("the settings file went away"))
                        })?
                    }
                    Err(e) => return Err(MemoryError::Io(e)),
                }
            }
        };
        Self::with_meta(dir, options, meta, false)
    }

    /// Open a store to read. Nothing is made and nothing is changed. A folder that
    /// does not exist reads as an empty store.
    pub fn open_read_only(dir: &Path, config: CoreConfig) -> Result<Self, MemoryError> {
        config.check()?;
        let meta = StoreMeta::read(dir)?.unwrap_or(StoreMeta {
            format_version: FORMAT_VERSION,
            embedding_dim: config.embedding_dim,
        });
        Self::with_meta(dir, OpenOptionsLog::new(config), meta, true)
    }

    fn with_meta(
        dir: &Path,
        options: OpenOptionsLog,
        meta: StoreMeta,
        read_only: bool,
    ) -> Result<Self, MemoryError> {
        let mut config = options.config;
        if config.embedding_dim == 0 {
            // A caller that names no dimension takes the one of the store.
            config.embedding_dim = meta.embedding_dim;
        } else if config.embedding_dim != meta.embedding_dim {
            return Err(MemoryError::ConfigMismatch {
                name: "embedding_dim",
                stored: meta.embedding_dim.to_string(),
                asked: config.embedding_dim.to_string(),
            });
        }
        Ok(LogBackend {
            dir: dir.to_path_buf(),
            config,
            durable: options.durable,
            snapshot_every: options.snapshot_every.max(1),
            read_only,
            core: Arc::new(RwLock::new(MemoryCore::new(config)?)),
            domains: BTreeMap::new(),
            #[cfg(test)]
            fail_at: None,
        })
    }

    /// The folder of the store.
    pub fn dir(&self) -> &Path {
        &self.dir
    }

    /// Open the log of every domain the folder holds. A long running writer calls this
    /// once at start so its hints cover every domain from the first proposal on.
    pub fn open_all(&mut self) -> Result<(), MemoryError> {
        for domain in domains_on_disk(&self.dir)? {
            self.ensure_domain(&domain)?;
        }
        Ok(())
    }

    /// Open the log of a domain when it is not open yet. Returns false when the store
    /// is read-only and the domain has no log.
    fn ensure_domain(&mut self, domain: &str) -> Result<bool, MemoryError> {
        if self.domains.contains_key(domain) {
            return Ok(true);
        }
        check_domain(domain)?;
        let path = log_path(&self.dir, domain);
        let file = if self.read_only {
            match File::open(&path) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(false),
                Err(e) => return Err(MemoryError::Io(e)),
            }
        } else {
            OpenOptions::new()
                .read(true)
                .append(true)
                .create(true)
                .open(&path)?
        };
        let mut log = DomainLog {
            path,
            file,
            end: HEADER_BYTES,
            head: DomainHead::empty(),
            last_touch: HashMap::new(),
            snapshot_key: 0,
        };
        let read_only = self.read_only;
        let opened = with_lock(&mut log, !read_only, |log| {
            let len = log.file.metadata()?.len();
            if len < HEADER_BYTES {
                // A new log, or one whose header a crash cut short.
                if read_only {
                    return Ok(false);
                }
                if len > 0 {
                    log.file.set_len(0)?;
                }
                (&log.file).write_all(&header_bytes())?;
                log.file.sync_data()?;
            } else {
                let mut header = [0u8; HEADER_BYTES as usize];
                File::open(&log.path)?.read_exact(&mut header)?;
                if header != header_bytes() {
                    return Err(MemoryError::Format(format!(
                        "{} is not a log of format version {FORMAT_VERSION}",
                        log.path.display()
                    )));
                }
            }
            let mut core = self.core.write().map_err(|_| MemoryError::Poisoned)?;
            core.clear_domain(domain);
            let loaded = load_snapshot(&self.dir, domain, log, &mut core, self.config);
            if !loaded {
                core.clear_domain(domain);
                log.end = HEADER_BYTES;
                log.head = DomainHead::empty();
                log.last_touch.clear();
                log.snapshot_key = 0;
            }
            catch_up(domain, log, &mut core, read_only)?;
            Ok(true)
        })?;
        if opened {
            self.domains.insert(domain.to_string(), log);
        }
        Ok(opened)
    }

    /// Read what other processes appended to the open logs since this backend last
    /// looked. A writer does this on every record. A reader that lives long calls it
    /// before it reads.
    pub fn refresh(&mut self) -> Result<(), MemoryError> {
        let mut core = self.core.write().map_err(|_| MemoryError::Poisoned)?;
        for (domain, log) in self.domains.iter_mut() {
            with_lock(log, false, |log| catch_up(domain, log, &mut core, true))?;
        }
        Ok(())
    }

    /// Write the snapshot of every domain that changed since its last snapshot.
    pub fn checkpoint(&mut self) -> Result<(), MemoryError> {
        if self.read_only {
            return Err(MemoryError::ReadOnly);
        }
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        for (domain, log) in self.domains.iter_mut() {
            if log.head.last_key == log.snapshot_key {
                continue;
            }
            with_lock(log, true, |log| {
                if log.file.metadata()?.len() != log.end {
                    // Another process appended. Its records are not in these
                    // attractors, so this backend writes no snapshot now.
                    return Ok(());
                }
                log.file.sync_data()?;
                write_snapshot(&self.dir, domain, log, &core)
            })?;
        }
        Ok(())
    }

    /// The health of the store at `dir`. Files are opened to read, a shared lock is
    /// taken and the last frame of each log is read. Nothing is made and nothing is
    /// changed, also when no store exists.
    pub fn health(dir: &Path) -> Result<MemoryHealth, MemoryError> {
        let Some(meta) = StoreMeta::read(dir)? else {
            return Ok(MemoryHealth::default());
        };
        let mut domains = Vec::new();
        for domain in domains_on_disk(dir)? {
            let path = log_path(dir, &domain);
            let file = File::open(&path)?;
            let _lock = LockGuard::shared(&file)?;
            let len = file.metadata()?.len();
            let (records, attractors) = match last_frame(&path, &domain, len) {
                Some(entry) => (entry.key as u64, entry.attractors_after),
                None => count_forward(&path, &domain, len)?,
            };
            domains.push(DomainCounts {
                domain,
                records,
                attractors,
            });
        }
        let counts = Counts::of(domains);
        Ok(MemoryHealth {
            present: true,
            format_version: meta.format_version,
            embedding_dim: meta.embedding_dim,
            records: counts.records,
            attractors: counts.attractors,
            domains: counts.domains,
        })
    }

    #[cfg(test)]
    fn fail(&self, at: FailPoint) -> Result<(), MemoryError> {
        if self.fail_at == Some(at) {
            return Err(MemoryError::Injected(match at {
                FailPoint::BeforeWrite => "before the write",
                FailPoint::MidFrame => "the middle of the frame",
            }));
        }
        Ok(())
    }

    /// Append one frame. In a test a failure can be put before the write or after its
    /// first half.
    fn append(&self, file: &File, frame: &[u8]) -> Result<(), MemoryError> {
        #[cfg(test)]
        {
            self.fail(FailPoint::BeforeWrite)?;
            if self.fail_at == Some(FailPoint::MidFrame) {
                let mut writer = file;
                writer.write_all(&frame[..frame.len() / 2])?;
                self.fail(FailPoint::MidFrame)?;
            }
        }
        let mut writer = file;
        writer.write_all(frame)?;
        if self.durable {
            file.sync_data()?;
        }
        Ok(())
    }

    /// The record of the frame at `offset` of a domain.
    fn record_at(&self, domain: &str, log: &DomainLog, offset: u64) -> Option<StoredRecord> {
        let mut reader = FrameReader::open(&log.path, domain, offset, log.end).ok()?;
        match reader.read_frame().ok()? {
            Frame::Entry { entry, hash, .. } => Some(StoredRecord {
                domain: domain.to_string(),
                hash,
                entry: *entry,
            }),
            _ => None,
        }
    }

    /// Call `visit` with every record of a domain until it answers false.
    fn each_record(
        &self,
        domain: &str,
        mut visit: impl FnMut(StoredRecord) -> bool,
    ) -> Result<(), MemoryError> {
        let Some(log) = self.domains.get(domain) else {
            return Ok(());
        };
        let mut reader = FrameReader::open(&log.path, domain, HEADER_BYTES, log.end)?;
        loop {
            match reader.read_frame()? {
                Frame::Entry { entry, hash, .. } => {
                    let keep_going = visit(StoredRecord {
                        domain: domain.to_string(),
                        hash,
                        entry: *entry,
                    });
                    if !keep_going {
                        return Ok(());
                    }
                }
                Frame::End | Frame::Torn { .. } => return Ok(()),
            }
        }
    }

    /// The domains this backend reads for a question about every domain: the open
    /// ones and the ones on disk.
    fn all_domains(&self) -> Result<Vec<String>, MemoryError> {
        let mut names: Vec<String> = self.domains.keys().cloned().collect();
        for name in domains_on_disk(&self.dir)? {
            if !names.contains(&name) {
                names.push(name);
            }
        }
        names.sort();
        Ok(names)
    }
}

/// Run `run` while this process holds the lock of the log file: the exclusive lock
/// for a writer, the shared lock for a reader. The lock is given back on every path.
fn with_lock<T>(
    log: &mut DomainLog,
    exclusive: bool,
    run: impl FnOnce(&mut DomainLog) -> Result<T, MemoryError>,
) -> Result<T, MemoryError> {
    if exclusive {
        log.file.lock()?;
    } else {
        log.file.lock_shared()?;
    }
    let out = run(log);
    let _ = log.file.unlock();
    out
}

/// Put a valid snapshot into the attractors. False when no snapshot fits the log.
fn load_snapshot(
    dir: &Path,
    domain: &str,
    log: &mut DomainLog,
    core: &mut MemoryCore,
    config: CoreConfig,
) -> bool {
    let Ok(bytes) = std::fs::read(snapshot_path(dir, domain)) else {
        return false;
    };
    let Some(snapshot) = Snapshot::decode(&bytes, config.embedding_dim) else {
        return false;
    };
    let Ok(len) = log.file.metadata().map(|m| m.len()) else {
        return false;
    };
    // The snapshot must name a frame boundary of this log: the frame that ends there
    // carries the head hash of the snapshot.
    if snapshot.end > len || snapshot.end < HEADER_BYTES {
        return false;
    }
    if snapshot.head.last_key == 0 {
        if snapshot.end != HEADER_BYTES || !snapshot.attractors.is_empty() {
            return false;
        }
    } else if hash_before(&log.path, snapshot.end) != Some(snapshot.head.head_hash) {
        return false;
    }
    for (attractor, touch) in &snapshot.attractors {
        if core.load(domain, attractor.clone()).is_err() {
            return false;
        }
        log.last_touch.insert(attractor.key, *touch);
    }
    log.end = snapshot.end;
    log.head = snapshot.head;
    log.snapshot_key = snapshot.head.last_key;
    true
}

/// Write the snapshot of a domain under another name and put it in place whole.
fn write_snapshot(
    dir: &Path,
    domain: &str,
    log: &mut DomainLog,
    core: &MemoryCore,
) -> Result<(), MemoryError> {
    let attractors = core
        .domain(domain)
        .map(|index| index.attractors())
        .unwrap_or_default()
        .into_iter()
        .map(|attractor| {
            let touch = log.last_touch.get(&attractor.key).copied().unwrap_or(0);
            (attractor, touch)
        })
        .collect();
    let snapshot = Snapshot {
        end: log.end,
        head: log.head,
        attractors,
    };
    let target = snapshot_path(dir, domain);
    let scratch = dir.join(format!(
        "{domain}{SNAPSHOT_SUFFIX}.{}.new",
        std::process::id()
    ));
    {
        let mut file = File::create(&scratch)?;
        file.write_all(&snapshot.encode())?;
        file.sync_data()?;
    }
    std::fs::rename(&scratch, &target)?;
    log.snapshot_key = log.head.last_key;
    Ok(())
}

/// Apply the frames between the known end of a log and its present end. A writer cuts
/// off a torn tail. A reader leaves it and stops before it.
fn catch_up(
    domain: &str,
    log: &mut DomainLog,
    core: &mut MemoryCore,
    read_only: bool,
) -> Result<(), MemoryError> {
    let len = log.file.metadata()?.len();
    if len == log.end {
        return Ok(());
    }
    if len < log.end {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: the log is shorter than it was"
        )));
    }
    let mut reader = FrameReader::open(&log.path, domain, log.end, len)?;
    loop {
        match reader.read_frame()? {
            Frame::End => return Ok(()),
            Frame::Torn { offset } => {
                if !read_only {
                    log.file.set_len(offset)?;
                    log.file.sync_data()?;
                }
                return Ok(());
            }
            Frame::Entry {
                offset,
                entry,
                hash,
            } => {
                apply_entry(core, &mut log.head, domain, &entry, hash)?;
                if let Some(attractor) = entry.outcome.attractor() {
                    log.last_touch.insert(attractor, offset);
                }
                if let Outcome::Form {
                    evicted: Some(evicted),
                    ..
                } = entry.outcome
                {
                    log.last_touch.remove(&evicted);
                }
                log.end = reader.at;
            }
        }
    }
}

/// The entry of the last frame of a log, read from the end. None when the log holds
/// no frame or its tail is not a whole frame.
fn last_frame(path: &Path, domain: &str, len: u64) -> Option<LogEntry> {
    if len < HEADER_BYTES + FRAME_OVERHEAD + MIN_ENTRY_BYTES as u64 {
        return None;
    }
    let mut file = File::open(path).ok()?;
    file.seek(SeekFrom::Start(len - 4)).ok()?;
    let mut raw = [0u8; 4];
    file.read_exact(&mut raw).ok()?;
    let entry_len = u32::from_le_bytes(raw) as u64;
    let start = len.checked_sub(entry_len + FRAME_OVERHEAD)?;
    if start < HEADER_BYTES {
        return None;
    }
    let mut reader = FrameReader::open(path, domain, start, len).ok()?;
    match reader.read_frame().ok()? {
        Frame::Entry { entry, .. } if reader.at == len => Some(*entry),
        _ => None,
    }
}

/// Count the records of a log from its first frame. Used when the tail is not a whole
/// frame, so the last frame cannot be read from the end.
fn count_forward(path: &Path, domain: &str, len: u64) -> Result<(u64, u64), MemoryError> {
    if len <= HEADER_BYTES {
        return Ok((0, 0));
    }
    let mut reader = FrameReader::open(path, domain, HEADER_BYTES, len)?;
    let mut counts = (0, 0);
    loop {
        match reader.read_frame()? {
            Frame::Entry { entry, .. } => counts = (entry.key as u64, entry.attractors_after),
            Frame::End | Frame::Torn { .. } => return Ok(counts),
        }
    }
}

impl MemoryBackend for LogBackend {
    fn record(&mut self, record: &NewRecord) -> Result<Receipt, MemoryError> {
        if self.read_only {
            return Err(MemoryError::ReadOnly);
        }
        let checked = check_record(record)?;
        self.ensure_domain(&record.domain)?;
        let domain = record.domain.as_str();
        let Some(mut log) = self.domains.remove(domain) else {
            return Err(MemoryError::Corrupt(format!(
                "domain {domain}: the log is not open"
            )));
        };
        let written = self.record_locked(domain, &mut log, &checked);
        self.domains.insert(domain.to_string(), log);
        written
    }

    fn route_hint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        shape_digest: &[u8; 32],
    ) -> Result<RouteHint, MemoryError> {
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        Ok(core.route_hint(domain, fingerprint, shape_digest))
    }

    fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Result<Vec<Match>, MemoryError> {
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        core.check_fingerprint(domain, fingerprint)?;
        let (Some(index), Some(log)) = (core.domain(domain), self.domains.get(domain)) else {
            return Ok(Vec::new());
        };
        let mut matches = Vec::new();
        for hit in index.scan(fingerprint, limit, min_score) {
            let Some(attractor) = index.get(hit.key) else {
                continue;
            };
            let latest = log
                .last_touch
                .get(&hit.key)
                .and_then(|offset| self.record_at(domain, log, *offset));
            matches.push(Match {
                attractor,
                score: hit.score,
                max_score: fingerprint.kind().max_score(),
                latest,
            });
        }
        Ok(matches)
    }

    fn history(
        &self,
        domain: &str,
        element_id: &str,
        accepted: Option<bool>,
        limit: usize,
    ) -> Result<Vec<StoredRecord>, MemoryError> {
        let mut found = Vec::new();
        if limit == 0 {
            return Ok(found);
        }
        self.each_record(domain, |record| {
            if record.entry.element_id == element_id
                && accepted.is_none_or(|want| record.entry.accepted == want)
            {
                found.push(record);
            }
            found.len() < limit
        })?;
        Ok(found)
    }

    fn export(&self, domain: Option<&str>, limit: usize) -> Result<Vec<StoredRecord>, MemoryError> {
        let mut found = Vec::new();
        if limit == 0 {
            return Ok(found);
        }
        let names: Vec<String> = match domain {
            Some(name) => vec![name.to_string()],
            None => self.domains.keys().cloned().collect(),
        };
        for name in names {
            self.each_record(&name, |record| {
                found.push(record);
                found.len() < limit
            })?;
            if found.len() >= limit {
                break;
            }
        }
        Ok(found)
    }

    fn counts(&self) -> Result<Counts, MemoryError> {
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        let domains = self
            .domains
            .iter()
            .map(|(name, log)| DomainCounts {
                domain: name.clone(),
                records: log.head.last_key as u64,
                attractors: core.domain(name).map(|i| i.len()).unwrap_or(0) as u64,
            })
            .collect();
        Ok(Counts::of(domains))
    }

    fn verify(&self) -> Result<VerifyReport, MemoryError> {
        let live = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        let mut domains = Vec::new();
        for name in self.all_domains()? {
            let path = log_path(&self.dir, &name);
            let file = File::open(&path)?;
            let _lock = LockGuard::shared(&file)?;
            // An open domain is checked up to the end this backend holds, so its
            // attractors can be compared. Any other domain is checked to its end.
            let open = self.domains.get(&name);
            let len = match open {
                Some(log) => log.end,
                None => file.metadata()?.len(),
            };
            let mut entries: Vec<(LogEntry, [u8; 32])> = Vec::new();
            if len > HEADER_BYTES {
                let mut reader = FrameReader::open(&path, &name, HEADER_BYTES, len)?;
                loop {
                    match reader.read_frame()? {
                        Frame::Entry { entry, hash, .. } => entries.push((*entry, hash)),
                        Frame::End => break,
                        Frame::Torn { offset } => {
                            if open.is_some() {
                                return Err(MemoryError::Corrupt(format!(
                                    "domain {name}: the log is cut short at byte {offset}"
                                )));
                            }
                            break;
                        }
                    }
                }
            }
            let (rebuilt, head) =
                verify_entries(self.config, &name, entries.iter().map(|(e, h)| (e, *h)))?;
            let rebuilt_attractors = rebuilt
                .domain(&name)
                .map(|i| i.attractors())
                .unwrap_or_default();
            if let Some(log) = open {
                let live_attractors = live
                    .domain(&name)
                    .map(|i| i.attractors())
                    .unwrap_or_default();
                if rebuilt_attractors != live_attractors || head != log.head {
                    return Err(MemoryError::Corrupt(format!(
                        "domain {name}: the attractors do not follow from the log"
                    )));
                }
            }
            domains.push(DomainVerify {
                domain: name,
                records: head.last_key as u64,
                attractors: rebuilt_attractors.len() as u64,
                head_hash: head.head_hash,
            });
        }
        Ok(VerifyReport::of(domains))
    }

    fn reader(&self) -> HintReader {
        HintReader::new(self.core.clone())
    }

    fn config(&self) -> CoreConfig {
        self.config
    }
}

impl LogBackend {
    /// The write of one record under the exclusive lock of its log.
    fn record_locked(
        &self,
        domain: &str,
        log: &mut DomainLog,
        checked: &crate::model::CheckedRecord<'_>,
    ) -> Result<Receipt, MemoryError> {
        with_lock(log, true, |log| {
            self.record_under_lock(domain, log, checked)
        })
    }

    /// The write of one record. The caller holds the exclusive lock of the log.
    fn record_under_lock(
        &self,
        domain: &str,
        log: &mut DomainLog,
        checked: &crate::model::CheckedRecord<'_>,
    ) -> Result<Receipt, MemoryError> {
        // What other processes appended comes first, so the key and the hash before
        // are the ones of the true end of the log.
        if log.file.metadata()?.len() != log.end {
            let mut core = self.core.write().map_err(|_| MemoryError::Poisoned)?;
            catch_up(domain, log, &mut core, false)?;
        }
        let (entry, plan) = {
            let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
            build_entry(&core, &log.head, checked)?
        };
        let bytes = entry.encode();
        if bytes.len() > MAX_ENTRY_BYTES {
            return Err(MemoryError::Core(
                aep_lattice_memory_core::CoreError::Invalid {
                    field: "record",
                    reason: format!("exceeds {MAX_ENTRY_BYTES} bytes"),
                },
            ));
        }
        let hash = entry_hash(domain, &bytes);
        let frame = frame_bytes(&bytes, &hash);
        let offset = log.end;
        self.append(&log.file, &frame)?;
        // The frame is in the log. The attractors follow it.
        {
            let mut core = self.core.write().map_err(|_| MemoryError::Poisoned)?;
            apply_entry(&mut core, &mut log.head, domain, &entry, hash)?;
        }
        log.end = offset + frame.len() as u64;
        let attractor_key = entry.outcome.attractor();
        if let Some(attractor) = attractor_key {
            log.last_touch.insert(attractor, offset);
        }
        if let Outcome::Form {
            evicted: Some(evicted),
            ..
        } = entry.outcome
        {
            log.last_touch.remove(&evicted);
        }
        if (log.head.last_key - log.snapshot_key) as u64 >= self.snapshot_every {
            let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
            log.file.sync_data()?;
            write_snapshot(&self.dir, domain, log, &core)?;
        }
        Ok(Receipt {
            key: entry.key,
            hash,
            plan,
            attractor_key,
        })
    }
}

impl Drop for LogBackend {
    fn drop(&mut self) {
        if !self.read_only {
            let _ = self.checkpoint();
        }
    }
}

#[cfg(test)]
#[path = "logstore_tests.rs"]
mod tests;
