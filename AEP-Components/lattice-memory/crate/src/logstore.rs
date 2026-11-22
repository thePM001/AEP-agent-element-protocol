//! The log file backend: the store for production.
//!
//! A store is one folder. Each domain has one log file that only grows. A record is
//! one frame at the end of the log of its domain: its length, its entry bytes, its hash
//! and its length once more. The entry bytes hold the hash of the entry before, so the
//! frames of one log form a hash chain.
//!
//! - One write is one frame. A frame is whole or it is not there. The rest of a write
//!   that a crash cut short is cut off by the next writer. Every other damage is
//!   reported as corrupt and never cut off: see the module `frames`.
//! - A writer holds the exclusive lock of the log file while it reads what other
//!   processes appended, decides and appends. The key of a record is its place in the
//!   log, so two processes never give out the same key.
//! - The log is opened in append mode. The store has no operation that changes or
//!   removes a record.
//! - The attractors live in memory and follow from the log alone. They are rebuilt at
//!   open. A snapshot file per domain lets a large log open without a full replay. A
//!   log that is shorter than its snapshot or holds another record where the snapshot
//!   names one was cut or changed and is reported as corrupt.
//! - A backend opens the log of a domain when a caller first names it. A call on one
//!   domain reads no other domain.
//! - A health check opens files to read, takes a shared lock and reads the last frame
//!   of each log. It creates nothing and changes nothing.

use crate::error::MemoryError;
use crate::frames::{
    frame_bytes, header_bytes, Frame, FrameReader, FORMAT_VERSION, FRAME_OVERHEAD, HEADER_BYTES,
    MIN_ENTRY_BYTES,
};
use crate::model::{
    apply_entry, build_entry, check_record, Counts, Cursor, DomainAnchor, DomainCounts, DomainHead,
    DomainVerify, Match, MemoryBackend, MemoryHealth, NewRecord, Page, Receipt, RecordQuery,
    StoredRecord, VerifyReport,
};
use crate::snapshot::{snapshot_path, Snapshot, SnapshotFile};
use aep_lattice_memory_core::{
    check_domain, entry_hash, Attractor, CoreConfig, Fingerprint, LogEntry, MemoryCore, Outcome,
    RouteHint, MAX_ENTRY_BYTES,
};
use std::collections::{BTreeMap, HashMap};
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};

/// Name of the settings file of a store.
pub const META_FILE: &str = "store.lmmeta";
/// Suffix of a log file.
pub const LOG_SUFFIX: &str = ".lmlog";
/// Records a writer that stays open appends to a domain between two snapshots.
pub const SNAPSHOT_EVERY: u64 = 50_000;
/// A writer that closes writes the snapshot of a domain only when the records behind
/// the last snapshot are at least one part in this many of the records it covers. A
/// caller that adds one record to a large domain therefore writes no snapshot, and the
/// work of all snapshots of a domain stays within a fixed multiple of its log.
pub const SNAPSHOT_SHARE: u64 = 4;

/// How a store is opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct OpenOptionsLog {
    pub config: CoreConfig,
    /// True to flush every record to the disk before the write returns. False leaves
    /// the flush to the snapshots and to the operating system: a crash of the process
    /// loses nothing, a loss of power may lose the newest records and never the order.
    pub durable: bool,
    /// Records a writer that stays open appends to a domain between two snapshots.
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

impl DomainLog {
    /// Follow one applied entry: remember which frame touched which attractor.
    fn touched(&mut self, entry: &LogEntry, offset: u64) {
        note_touch(&mut self.last_touch, entry, offset);
    }
}

fn note_touch(last_touch: &mut HashMap<i64, u64>, entry: &LogEntry, offset: u64) {
    if let Some(attractor) = entry.outcome.attractor() {
        last_touch.insert(attractor, offset);
    }
    if let Outcome::Form {
        evicted: Some(evicted),
        ..
    } = entry.outcome
    {
        last_touch.remove(&evicted);
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
    core: MemoryCore,
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
            core: MemoryCore::new(config)?,
            domains: BTreeMap::new(),
            #[cfg(test)]
            fail_at: None,
        })
    }

    /// The domains that have a log in the store at `dir`, in name order.
    pub fn domains(dir: &Path) -> Result<Vec<String>, MemoryError> {
        domains_on_disk(dir)
    }

    /// Open the log of one domain: read its snapshot and replay the frames behind it.
    /// A writer makes the log when the domain has none. Returns false when the store
    /// is read-only and the domain has no log. A write and a search open the domain
    /// they name by themselves, so a caller needs this only to pay for the open at a
    /// time of its choice.
    pub fn open_domain(&mut self, domain: &str) -> Result<bool, MemoryError> {
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
        let config = self.config;
        let dir = self.dir.clone();
        let core = &mut self.core;
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
            core.clear_domain(domain);
            let loaded = load_snapshot(&dir, domain, log, core, config);
            let caught = loaded.and_then(|_| catch_up(domain, log, core, read_only));
            if caught.is_err() {
                // The domain is not open, so nothing of it stays among the attractors.
                core.clear_domain(domain);
            }
            caught.map(|()| true)
        })?;
        if opened {
            self.domains.insert(domain.to_string(), log);
        }
        Ok(opened)
    }

    /// The domains this backend has open, in name order.
    pub fn open_domains(&self) -> Vec<String> {
        self.domains.keys().cloned().collect()
    }

    /// True when the records behind the last snapshot of a domain are at least one
    /// part in [`SNAPSHOT_SHARE`] of the records that snapshot covers.
    fn snapshot_due(log: &DomainLog) -> bool {
        let behind = (log.head.last_key - log.snapshot_key) as u64;
        behind > 0 && behind.saturating_mul(SNAPSHOT_SHARE) >= log.snapshot_key as u64
    }

    /// Write the snapshot of every open domain whose snapshot is due.
    fn write_due_snapshots(&mut self) -> Result<(), MemoryError> {
        if self.read_only {
            return Ok(());
        }
        let core = &self.core;
        let dir = &self.dir;
        for (domain, log) in self.domains.iter_mut() {
            if !Self::snapshot_due(log) {
                continue;
            }
            with_lock(log, true, |log| {
                if log.file.metadata()?.len() != log.end {
                    // Another process appended. Its records are not in these
                    // attractors, so this backend writes no snapshot now.
                    return Ok(());
                }
                log.file.sync_data()?;
                write_snapshot(dir, domain, log, core)
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
                Some((entry, _)) => (entry.key as u64, entry.attractors_after),
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

    /// Compare the log of a domain in the store at `dir` with an anchor a caller kept
    /// outside the store. The log must hold at least the records the anchor names and
    /// the record with that number must carry the hash of the anchor. A log that is
    /// shorter or holds another record there was cut or replaced. Files are opened to
    /// read and nothing is changed.
    pub fn check_anchor(dir: &Path, anchor: &DomainAnchor) -> Result<(), MemoryError> {
        if anchor.records == 0 {
            return Ok(());
        }
        let domain = anchor.domain.as_str();
        check_domain(domain)?;
        let short = |held: u64| {
            MemoryError::Corrupt(format!(
                "domain {domain}: the log holds {held} records, the anchor outside the store names {}",
                anchor.records
            ))
        };
        let path = log_path(dir, domain);
        let file = match File::open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Err(short(0)),
            Err(e) => return Err(MemoryError::Io(e)),
        };
        let _lock = LockGuard::shared(&file)?;
        let len = file.metadata()?.len();
        let other = || {
            MemoryError::Corrupt(format!(
                "domain {domain}: record {} is not the record the anchor outside the store names",
                anchor.records
            ))
        };
        if let Some((entry, hash)) = last_frame(&path, domain, len) {
            if entry.key as u64 == anchor.records {
                return if hash == anchor.head_hash {
                    Ok(())
                } else {
                    Err(other())
                };
            }
            if (entry.key as u64) < anchor.records {
                return Err(short(entry.key as u64));
            }
        }
        if len <= HEADER_BYTES {
            return Err(short(0));
        }
        let mut reader = FrameReader::open(&path, domain, HEADER_BYTES, len)?;
        let mut held = 0u64;
        loop {
            match reader.read_frame()? {
                Frame::Entry { entry, hash, .. } => {
                    held = entry.key as u64;
                    if held == anchor.records {
                        return if hash == anchor.head_hash {
                            Ok(())
                        } else {
                            Err(other())
                        };
                    }
                }
                Frame::End | Frame::Torn { .. } => return Err(short(held)),
            }
        }
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

    /// The domains a query reads, in name order, from the domain of its cursor on.
    fn query_domains(&self, query: &RecordQuery<'_>) -> Result<Vec<String>, MemoryError> {
        let mut names = match query.domain {
            Some(name) => {
                check_domain(name)?;
                vec![name.to_string()]
            }
            None => self.all_domains()?,
        };
        if let Some(after) = query.after {
            if !names.contains(&after.domain) {
                return Err(bad_cursor());
            }
            names.retain(|name| *name >= after.domain);
        }
        Ok(names)
    }

    /// Call `visit` with every record a query names until it answers false. The
    /// second argument is the place behind the record. Returns true when the walk
    /// reached the end of the last domain.
    fn walk(
        &self,
        query: &RecordQuery<'_>,
        mut visit: impl FnMut(StoredRecord, Cursor, u64) -> bool,
    ) -> Result<bool, MemoryError> {
        for name in self.query_domains(query)? {
            let path = log_path(&self.dir, &name);
            let file = match File::open(&path) {
                Ok(file) => file,
                Err(e) if e.kind() == std::io::ErrorKind::NotFound => continue,
                Err(e) => return Err(MemoryError::Io(e)),
            };
            let _lock = LockGuard::shared(&file)?;
            let len = file.metadata()?.len();
            let from = match query.after {
                Some(after) if after.domain == name => place_of(&path, &name, after, len)?,
                _ => HEADER_BYTES,
            };
            if len <= from {
                continue;
            }
            let mut reader = FrameReader::open(&path, &name, from, len)?;
            // The walk of a log ends at its end or before the rest of a cut write.
            while let Frame::Entry {
                entry,
                hash,
                offset,
            } = reader.read_frame()?
            {
                if !query.keeps(&entry) {
                    continue;
                }
                let place = Cursor {
                    domain: name.clone(),
                    key: entry.key,
                    offset: reader.at,
                };
                let record = StoredRecord {
                    domain: name.clone(),
                    hash,
                    entry: *entry,
                };
                if !visit(record, place, reader.at - offset) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}

fn bad_cursor() -> MemoryError {
    MemoryError::Core(aep_lattice_memory_core::CoreError::Invalid {
        field: "after",
        reason: String::from("is no place of this store"),
    })
}

/// The offset a cursor names in a log, after a check that a record with the key of
/// the cursor ends there.
fn place_of(path: &Path, domain: &str, after: &Cursor, len: u64) -> Result<u64, MemoryError> {
    if after.key == 0 && after.offset == HEADER_BYTES {
        return Ok(HEADER_BYTES);
    }
    if after.offset > len {
        return Err(bad_cursor());
    }
    match last_frame(path, domain, after.offset) {
        Some((entry, _)) if entry.key == after.key => Ok(after.offset),
        _ => Err(bad_cursor()),
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

/// Put the snapshot of a domain into the attractors. A domain without a snapshot and
/// a snapshot file whose bytes are damaged leave the attractors empty, so the log is
/// replayed from its first frame. A whole snapshot that does not fit its log is an
/// error: the log was cut or changed.
fn load_snapshot(
    dir: &Path,
    domain: &str,
    log: &mut DomainLog,
    core: &mut MemoryCore,
    config: CoreConfig,
) -> Result<(), MemoryError> {
    let snapshot = match Snapshot::read(dir, domain, config.embedding_dim)? {
        SnapshotFile::Whole(snapshot) => snapshot,
        SnapshotFile::Absent | SnapshotFile::Damaged => return Ok(()),
    };
    let len = log.file.metadata()?.len();
    check_snapshot_place(domain, &log.path, &snapshot, len)?;
    for (attractor, touch) in &snapshot.attractors {
        core.load(domain, attractor.clone())?;
        log.last_touch.insert(attractor.key, *touch);
    }
    log.end = snapshot.end;
    log.head = snapshot.head;
    log.snapshot_key = snapshot.head.last_key;
    Ok(())
}

/// A snapshot names a frame boundary of its log: the frame that ends there carries
/// the head hash of the snapshot.
fn check_snapshot_place(
    domain: &str,
    path: &Path,
    snapshot: &Snapshot,
    len: u64,
) -> Result<(), MemoryError> {
    if snapshot.end > len {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: the log is shorter than its snapshot: it ends at byte {len}, the snapshot covers {} records up to byte {}",
            snapshot.head.last_key, snapshot.end
        )));
    }
    let fits = if snapshot.head.last_key == 0 {
        snapshot.end == HEADER_BYTES && snapshot.attractors.is_empty()
    } else {
        snapshot.end >= HEADER_BYTES + FRAME_OVERHEAD
            && hash_before(path, snapshot.end) == Some(snapshot.head.head_hash)
    };
    if !fits {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: the log does not hold record {} where its snapshot names it",
            snapshot.head.last_key
        )));
    }
    Ok(())
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
        "{domain}{}.{}.new",
        crate::snapshot::SNAPSHOT_SUFFIX,
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
/// off the rest of a cut write. A reader leaves it and stops before it. Damage is an
/// error for both and nothing is cut.
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
                log.touched(&entry, offset);
                log.end = reader.at;
            }
        }
    }
}

/// The entry and the hash of the last frame of the first `len` bytes of a log, read
/// from the end. None when those bytes hold no frame or do not end in a whole frame.
fn last_frame(path: &Path, domain: &str, len: u64) -> Option<(LogEntry, [u8; 32])> {
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
        Frame::Entry { entry, hash, .. } if reader.at == len => Some((*entry, hash)),
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

/// What the attractors of an open domain are at the end this backend holds.
struct LiveDomain {
    end: u64,
    head: DomainHead,
    attractors: Vec<Attractor>,
}

/// Walk the log of one domain from its first frame to its end: every frame must be
/// whole, every entry must hash to its stored hash and follow the entry before it,
/// and the attractors are rebuilt in a core of their own. The snapshot file of the
/// domain must fit the log at the record it names, and the attractors of an open
/// domain must be the rebuilt ones at the end the backend holds.
fn verify_domain(
    dir: &Path,
    domain: &str,
    config: CoreConfig,
    live: Option<LiveDomain>,
) -> Result<DomainVerify, MemoryError> {
    let path = log_path(dir, domain);
    let file = File::open(&path)?;
    let _lock = LockGuard::shared(&file)?;
    let len = file.metadata()?.len();
    let not_whole = |offset: u64| {
        MemoryError::Corrupt(format!(
            "domain {domain}: the log ends at byte {offset} in a frame that is not whole"
        ))
    };
    if len < HEADER_BYTES {
        return Err(not_whole(0));
    }
    let mut header = [0u8; HEADER_BYTES as usize];
    File::open(&path)?.read_exact(&mut header)?;
    if header != header_bytes() {
        return Err(MemoryError::Format(format!(
            "{} is not a log of format version {FORMAT_VERSION}",
            path.display()
        )));
    }
    let snapshot = match Snapshot::read(dir, domain, config.embedding_dim)? {
        SnapshotFile::Absent => None,
        SnapshotFile::Damaged => {
            return Err(MemoryError::Corrupt(format!(
                "domain {domain}: the snapshot file is damaged"
            )))
        }
        SnapshotFile::Whole(snapshot) => {
            check_snapshot_place(domain, &path, &snapshot, len)?;
            Some(snapshot)
        }
    };

    let mut core = MemoryCore::new(config)?;
    let mut head = DomainHead::empty();
    let mut last_touch: HashMap<i64, u64> = HashMap::new();
    let mut snapshot_seen = false;
    let mut live_seen = false;
    let rebuilt = |core: &MemoryCore| {
        core.domain(domain)
            .map(|index| index.attractors())
            .unwrap_or_default()
    };
    // Compare what the walk rebuilt up to `at` with the snapshot and with the open
    // domain when either stands at that place.
    let mut compare = |core: &MemoryCore,
                       head: &DomainHead,
                       last_touch: &HashMap<i64, u64>,
                       at: u64|
     -> Result<(), MemoryError> {
        if let Some(snapshot) = &snapshot {
            if !snapshot_seen && snapshot.head.last_key == head.last_key {
                let with_touch: Vec<(Attractor, u64)> = rebuilt(core)
                    .into_iter()
                    .map(|attractor| {
                        let touch = last_touch.get(&attractor.key).copied().unwrap_or(0);
                        (attractor, touch)
                    })
                    .collect();
                if snapshot.end != at || snapshot.head != *head || snapshot.attractors != with_touch
                {
                    return Err(MemoryError::Corrupt(format!(
                        "domain {domain}: the snapshot does not hold what the log says at record {}",
                        head.last_key
                    )));
                }
                snapshot_seen = true;
            }
        }
        if let Some(live) = &live {
            if !live_seen && live.end == at {
                if live.head != *head || live.attractors != rebuilt(core) {
                    return Err(MemoryError::Corrupt(format!(
                        "domain {domain}: the attractors do not follow from the log"
                    )));
                }
                live_seen = true;
            }
        }
        Ok(())
    };
    compare(&core, &head, &last_touch, HEADER_BYTES)?;
    let mut reader = FrameReader::open(&path, domain, HEADER_BYTES, len)?;
    loop {
        match reader.read_frame()? {
            Frame::Entry {
                offset,
                entry,
                hash,
            } => {
                if entry.hash(domain) != hash {
                    return Err(MemoryError::Corrupt(format!(
                        "domain {domain}: entry {} does not hash to its stored hash",
                        entry.key
                    )));
                }
                apply_entry(&mut core, &mut head, domain, &entry, hash)?;
                note_touch(&mut last_touch, &entry, offset);
                compare(&core, &head, &last_touch, reader.at)?;
            }
            Frame::End => break,
            Frame::Torn { offset } => return Err(not_whole(offset)),
        }
    }
    if snapshot.is_some() && !snapshot_seen {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: the log holds {} records and not the record its snapshot names",
            head.last_key
        )));
    }
    if live.is_some() && !live_seen {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: the attractors do not follow from the log"
        )));
    }
    Ok(DomainVerify {
        domain: domain.to_string(),
        records: head.last_key as u64,
        attractors: rebuilt(&core).len() as u64,
        head_hash: head.head_hash,
    })
}

impl MemoryBackend for LogBackend {
    fn record(&mut self, record: &NewRecord) -> Result<Receipt, MemoryError> {
        if self.read_only {
            return Err(MemoryError::ReadOnly);
        }
        let checked = check_record(record)?;
        self.open_domain(&record.domain)?;
        let domain = record.domain.as_str();
        let Some(mut log) = self.domains.remove(domain) else {
            return Err(MemoryError::Corrupt(format!(
                "domain {domain}: the log is not open"
            )));
        };
        let written = with_lock(&mut log, true, |log| {
            self.record_under_lock(domain, log, &checked)
        });
        self.domains.insert(domain.to_string(), log);
        written
    }

    fn route_hint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        shape_digest: &[u8; 32],
    ) -> Result<RouteHint, MemoryError> {
        Ok(self.core.route_hint(domain, fingerprint, shape_digest))
    }

    fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Result<Vec<Match>, MemoryError> {
        self.core.check_fingerprint(domain, fingerprint)?;
        let (Some(index), Some(log)) = (self.core.domain(domain), self.domains.get(domain)) else {
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

    fn records(&self, query: &RecordQuery<'_>) -> Result<Page, MemoryError> {
        let mut page = Page::default();
        if query.limit == 0 {
            return Ok(page);
        }
        let mut bytes = 0usize;
        let mut last: Option<Cursor> = None;
        let ended = self.walk(query, |record, place, frame_bytes| {
            // The page is full: this record proves that a next page exists.
            let full = page.records.len() >= query.limit
                || (!page.records.is_empty() && bytes >= query.max_bytes);
            if full {
                return false;
            }
            page.records.push(record);
            bytes = bytes.saturating_add(frame_bytes as usize);
            last = Some(place);
            true
        })?;
        if !ended {
            page.next = last;
        }
        Ok(page)
    }

    fn count(&self, query: &RecordQuery<'_>) -> Result<u64, MemoryError> {
        let mut count = 0u64;
        self.walk(query, |_, _, _| {
            count += 1;
            true
        })?;
        Ok(count)
    }

    fn counts(&self) -> Result<Counts, MemoryError> {
        let domains = self
            .domains
            .iter()
            .map(|(name, log)| DomainCounts {
                domain: name.clone(),
                records: log.head.last_key as u64,
                attractors: self.core.domain(name).map(|i| i.len()).unwrap_or(0) as u64,
            })
            .collect();
        Ok(Counts::of(domains))
    }

    fn anchors(&self) -> Vec<DomainAnchor> {
        self.domains
            .iter()
            .map(|(name, log)| DomainAnchor {
                domain: name.clone(),
                records: log.head.last_key as u64,
                head_hash: log.head.head_hash,
            })
            .collect()
    }

    fn sync(&mut self) -> Result<(), MemoryError> {
        if self.read_only {
            return Ok(());
        }
        for log in self.domains.values() {
            log.file.sync_data()?;
        }
        Ok(())
    }

    fn verify(&self) -> Result<VerifyReport, MemoryError> {
        let mut domains = Vec::new();
        for name in self.all_domains()? {
            let live = self.domains.get(&name).map(|log| LiveDomain {
                end: log.end,
                head: log.head,
                attractors: self
                    .core
                    .domain(&name)
                    .map(|i| i.attractors())
                    .unwrap_or_default(),
            });
            domains.push(verify_domain(&self.dir, &name, self.config, live)?);
        }
        Ok(VerifyReport::of(domains))
    }

    fn config(&self) -> CoreConfig {
        self.config
    }
}

impl LogBackend {
    /// The write of one record. The caller holds the exclusive lock of the log.
    fn record_under_lock(
        &mut self,
        domain: &str,
        log: &mut DomainLog,
        checked: &crate::model::CheckedRecord<'_>,
    ) -> Result<Receipt, MemoryError> {
        // What other processes appended comes first, so the key and the hash before
        // are the ones of the true end of the log.
        if log.file.metadata()?.len() != log.end {
            catch_up(domain, log, &mut self.core, false)?;
        }
        let (entry, plan) = build_entry(&self.core, &log.head, checked)?;
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
        apply_entry(&mut self.core, &mut log.head, domain, &entry, hash)?;
        log.end = offset + frame.len() as u64;
        log.touched(&entry, offset);
        if (log.head.last_key - log.snapshot_key) as u64 >= self.snapshot_every {
            log.file.sync_data()?;
            write_snapshot(&self.dir, domain, log, &self.core)?;
        }
        Ok(Receipt {
            key: entry.key,
            hash,
            plan,
            attractor_key: entry.outcome.attractor(),
        })
    }
}

impl Drop for LogBackend {
    fn drop(&mut self) {
        let _ = self.write_due_snapshots();
    }
}

#[cfg(test)]
#[path = "logstore_tests.rs"]
mod tests;
