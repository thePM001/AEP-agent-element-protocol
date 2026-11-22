//! Lattice Memory in the Base Node.
//!
//! Lattice Memory is the record of the verdicts of the Admit Gate. The Base Node is
//! its one writer. After a verdict is written to the Evidence Ledger, the dock hands a
//! note of it to a bounded queue: the bytes of the proposal, who signed it and what
//! was answered. One thread takes the notes. It computes the shape of each proposal,
//! its digest and its fingerprint and writes one record. None of that work is on the
//! path of a verdict. The dock never waits for the memory, so the memory can never
//! hold a verdict back.
//!
//! What is recorded and what can be lost:
//!
//! - The queue takes every verdict it has room for. A verdict that finds the queue
//!   full is dropped and counted.
//! - A write the store refuses is counted as failed, and the health of the memory
//!   reads `failing` until a write succeeds again.
//! - A node that is killed loses the notes its queue held at that instant.
//! - The count of verdict rows of the Evidence Ledger is compared with the count of
//!   records of the memory. The difference is the gap the health answer shows.
//!
//! Admit reads one thing and writes nothing: the exact-match memo. It holds the rows
//! of the writing walls for byte identical text. Those rows follow from the text and
//! from rules that are compiled into the process, so a stored row is the row the same
//! code would compute again. The memo lives in this process only and starts empty at
//! every start. Every wall that reads the clock, a budget, a file or the state of the
//! node is computed on every proposal.
//!
//! The head of each judged domain, its record count and the hash of its newest record,
//! is kept in the Evidence Ledger under a key of the node. At start and in a
//! verification the store is compared with it, so a log that was cut or replaced is
//! found also when no snapshot tells.

use aep_admit::{AdmitWall, MemoryView, PureWallMemo, PureWallTrace};
use aep_lattice_memory::core::{
    hmac_sha256, ExactMemo, MemoKey, WallRow, DEFAULT_MEMO_BYTES, DEFAULT_MEMO_CAPACITY,
};
use aep_lattice_memory::{
    is_judged_domain, CoreConfig, DomainAnchor, Fingerprint, FrameContext, InMemoryBackend,
    LogBackend, MemoryBackend, MemoryError, NewRecord, OpenOptionsLog, ProposalShape, SimHash,
    VerifyReport, JUDGED_DOMAIN,
};
use rusqlite::{params, Connection};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, RecvTimeoutError, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Folder of the memory under the data folder of the node.
pub const MEMORY_DIR: &str = "lattice-memory";
/// File of the memory key of the node in its data folder, outside the store.
pub const KEY_FILE: &str = "lattice-memory.key";
/// Notes the queue between the dock and the writer holds.
pub const QUEUE_CAPACITY: usize = 4096;
/// Bytes of proposals the queue holds. A note that would pass the bound is dropped.
pub const QUEUE_MAX_BYTES: u64 = 64 * 1024 * 1024;
/// Bits of the fingerprint the node records.
pub const FINGERPRINT_BITS: u32 = 256;
/// The name of the store in the health answer.
pub const VECTOR_STORE: &str = "simhash256+log";
/// Environment variable that turns the memory off when its value is `off`.
pub const MEMORY_SWITCH_ENV: &str = "AEP_LATTICE_MEMORY";
/// Environment variable that makes the store flush every record to the disk before the
/// writer goes on, when its value is `on`.
pub const MEMORY_DURABLE_ENV: &str = "AEP_LATTICE_MEMORY_DURABLE";
/// Environment variable for one start after an operator repaired or replaced the
/// store: with the value `1` the node takes the store as it is and writes new heads
/// to the Evidence Ledger in place of comparing the old ones.
pub const MEMORY_ACCEPT_ENV: &str = "AEP_LATTICE_MEMORY_ACCEPT_STORE";
/// Records the writer writes between two writes of the heads while notes keep coming.
pub const ANCHOR_EVERY: u64 = 1024;
/// A writer without a note for this long writes the heads that are behind.
const ANCHOR_IDLE: Duration = Duration::from_millis(500);

/// The folder of the memory of a node whose data folder is `data_dir`.
pub fn memory_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(MEMORY_DIR)
}

/// The domain of the proposals judged on one docking port.
pub fn judged_domain(docking_port: &str) -> String {
    format!("{JUDGED_DOMAIN}.{docking_port}")
}

/// The memory key of a node. The shape digest and the fingerprint of a judged
/// proposal are computed under it, so a reader of the store who guesses a proposal
/// cannot confirm it. The heads in the Evidence Ledger are signed with it.
#[derive(Clone, Copy, PartialEq, Eq)]
pub struct MemoryKey {
    digest: [u8; 32],
    fingerprint: [u8; 32],
    head: [u8; 32],
}

impl std::fmt::Debug for MemoryKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("MemoryKey")
    }
}

impl MemoryKey {
    /// The key that 32 secret bytes give: one derived key for each use.
    pub fn from_secret(secret: &[u8; 32]) -> Self {
        MemoryKey {
            digest: hmac_sha256(secret, b"aep.lattice-memory.key.shape-digest.v1"),
            fingerprint: hmac_sha256(secret, b"aep.lattice-memory.key.fingerprint.v1"),
            head: hmac_sha256(secret, b"aep.lattice-memory.key.head.v1"),
        }
    }

    /// A key that lives as long as this process, for a memory that is not on disk.
    pub fn random() -> Self {
        use rand::RngCore;
        let mut secret = [0u8; 32];
        rand::thread_rng().fill_bytes(&mut secret);
        MemoryKey::from_secret(&secret)
    }

    /// Read the key file of a node, or make it with 32 random bytes when the node has
    /// none. Only the user of the node may read the file. A file of another length is
    /// refused.
    pub fn load_or_create(data_dir: &Path) -> std::io::Result<Self> {
        let path = data_dir.join(KEY_FILE);
        match std::fs::read(&path) {
            Ok(bytes) => {
                let secret: [u8; 32] = bytes.as_slice().try_into().map_err(|_| {
                    std::io::Error::new(
                        std::io::ErrorKind::InvalidData,
                        format!("{} does not hold 32 bytes", path.display()),
                    )
                })?;
                Ok(MemoryKey::from_secret(&secret))
            }
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                use rand::RngCore;
                use std::io::Write;
                let mut secret = [0u8; 32];
                rand::thread_rng().fill_bytes(&mut secret);
                let mut options = std::fs::OpenOptions::new();
                options.write(true).create_new(true);
                #[cfg(unix)]
                {
                    use std::os::unix::fs::OpenOptionsExt;
                    options.mode(0o600);
                }
                let mut file = options.open(&path)?;
                file.write_all(&secret)?;
                file.sync_all()?;
                Ok(MemoryKey::from_secret(&secret))
            }
            Err(e) => Err(e),
        }
    }

    /// The signature of the head of a domain.
    fn head_mac(&self, anchor: &DomainAnchor) -> [u8; 32] {
        let mut message = b"aep.lattice-memory.head.v1\n".to_vec();
        message.extend_from_slice(&(anchor.domain.len() as u64).to_le_bytes());
        message.extend_from_slice(anchor.domain.as_bytes());
        message.extend_from_slice(&anchor.records.to_le_bytes());
        message.extend_from_slice(&anchor.head_hash);
        hmac_sha256(&self.head, &message)
    }
}

/// The rows of the Evidence Ledger that belong to the memory: the head of each judged
/// domain and the marks from which the gap between the ledger and the memory is counted.
pub struct HeadLedger {
    db: Arc<Mutex<Connection>>,
    key: MemoryKey,
}

/// Where the count of the gap stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct GapMarks {
    /// Highest row id of the ledger that is counted.
    ledger_row: i64,
    /// Records the memory held when that row was counted.
    memory_records: i64,
    /// Verdict rows of the ledger minus records of the memory up to the marks.
    gap: i64,
}

/// Verdict rows of the ledger with an id above `after` and up to `upto`: the rows of
/// applied frames and the rows of frames Admit denied.
fn verdict_rows(conn: &Connection, after: i64, upto: i64) -> rusqlite::Result<i64> {
    let kind = serde_json::to_string(
        &crate::side_channel_monitor::SideChannelAnomalyKind::EnvelopeAdmitRejected,
    )
    .unwrap_or_default();
    conn.query_row(
        "SELECT COUNT(*) FROM action_lattice_events
         WHERE id > ?1 AND id <= ?2
           AND (event_type LIKE 'docking!_%' ESCAPE '!'
                OR (event_type = ?3 AND payload_json LIKE ?4))",
        params![
            after,
            upto,
            crate::side_channel_monitor::SIDE_CHANNEL_EVENT_TYPE,
            format!("%\"kind\":{kind}%"),
        ],
        |row| row.get(0),
    )
}

fn highest_row(conn: &Connection) -> rusqlite::Result<i64> {
    conn.query_row(
        "SELECT COALESCE(MAX(id), 0) FROM action_lattice_events",
        [],
        |row| row.get(0),
    )
}

impl HeadLedger {
    /// The rows of the memory in the ledger behind `db`. The two tables are made when
    /// the ledger has none.
    pub fn new(db: Arc<Mutex<Connection>>, key: MemoryKey) -> rusqlite::Result<Self> {
        {
            let conn = db.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
            Self::ensure_tables(&conn)?;
        }
        Ok(HeadLedger { db, key })
    }

    fn ensure_tables(conn: &Connection) -> rusqlite::Result<()> {
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS lattice_memory_heads (
                 domain TEXT PRIMARY KEY,
                 records INTEGER NOT NULL,
                 head_hash TEXT NOT NULL,
                 mac TEXT NOT NULL,
                 updated_unix INTEGER NOT NULL
             );
             CREATE TABLE IF NOT EXISTS lattice_memory_marks (
                 name TEXT PRIMARY KEY,
                 value INTEGER NOT NULL
             );",
        )
    }

    /// The heads the ledger holds. A head whose signature does not fit the key of the
    /// node is an error: the row was changed or the key file was replaced.
    pub fn heads(&self) -> Result<Vec<DomainAnchor>, String> {
        let conn = self.db.lock().unwrap_or_else(|p| p.into_inner());
        read_heads(&conn, &self.key)
    }
}

/// Read the heads of the judged domains from the ledger and check each signature.
fn read_heads(conn: &Connection, key: &MemoryKey) -> Result<Vec<DomainAnchor>, String> {
    let mut statement = conn
        .prepare("SELECT domain, records, head_hash, mac FROM lattice_memory_heads ORDER BY domain")
        .map_err(|e| e.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;
    let mut anchors = Vec::new();
    for row in rows {
        let (domain, records, head_hash, mac) = row.map_err(|e| e.to_string())?;
        let bad = || {
            format!(
                "the head of domain {domain} in the Evidence Ledger is not a head this node signed"
            )
        };
        let head_hash: [u8; 32] = hex::decode(&head_hash)
            .ok()
            .and_then(|bytes| bytes.try_into().ok())
            .ok_or_else(bad)?;
        let anchor = DomainAnchor {
            domain: domain.clone(),
            records: u64::try_from(records).map_err(|_| bad())?,
            head_hash,
        };
        if hex::encode(key.head_mac(&anchor)) != mac {
            return Err(bad());
        }
        anchors.push(anchor);
    }
    Ok(anchors)
}

impl HeadLedger {
    fn write_heads(&self, conn: &Connection, anchors: &[DomainAnchor]) -> rusqlite::Result<()> {
        for anchor in anchors.iter().filter(|a| is_judged_domain(&a.domain)) {
            conn.execute(
                "INSERT INTO lattice_memory_heads (domain, records, head_hash, mac, updated_unix)
                 VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(domain) DO UPDATE SET
                     records = excluded.records,
                     head_hash = excluded.head_hash,
                     mac = excluded.mac,
                     updated_unix = excluded.updated_unix",
                params![
                    anchor.domain,
                    anchor.records as i64,
                    hex::encode(anchor.head_hash),
                    hex::encode(self.key.head_mac(anchor)),
                    crate::now_unix() as i64,
                ],
            )?;
        }
        Ok(())
    }

    fn read_marks(conn: &Connection) -> rusqlite::Result<Option<GapMarks>> {
        let mut statement = conn.prepare("SELECT name, value FROM lattice_memory_marks")?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })?;
        let mut found: BTreeMap<String, i64> = BTreeMap::new();
        for row in rows {
            let (name, value) = row?;
            found.insert(name, value);
        }
        Ok(
            match (
                found.get("ledger_row"),
                found.get("memory_records"),
                found.get("gap"),
            ) {
                (Some(ledger_row), Some(memory_records), Some(gap)) => Some(GapMarks {
                    ledger_row: *ledger_row,
                    memory_records: *memory_records,
                    gap: *gap,
                }),
                _ => None,
            },
        )
    }

    fn write_marks(conn: &Connection, marks: GapMarks) -> rusqlite::Result<()> {
        for (name, value) in [
            ("ledger_row", marks.ledger_row),
            ("memory_records", marks.memory_records),
            ("gap", marks.gap),
        ] {
            conn.execute(
                "INSERT INTO lattice_memory_marks (name, value) VALUES (?1, ?2)
                 ON CONFLICT(name) DO UPDATE SET value = excluded.value",
                params![name, value],
            )?;
        }
        Ok(())
    }

    /// The marks as they stand when the memory holds `memory_records` records: the
    /// verdict rows behind the old mark are counted in.
    fn marks_now(conn: &Connection, memory_records: u64) -> rusqlite::Result<GapMarks> {
        let memory_records = memory_records as i64;
        let top = highest_row(conn)?;
        Ok(match Self::read_marks(conn)? {
            // The first count starts at the present state of both sides.
            None => GapMarks {
                ledger_row: top,
                memory_records,
                gap: 0,
            },
            Some(marks) => GapMarks {
                ledger_row: top,
                memory_records,
                gap: marks.gap + verdict_rows(conn, marks.ledger_row, top)?
                    - (memory_records - marks.memory_records),
            },
        })
    }

    /// Verdict rows of the Evidence Ledger minus records of the memory, counted from
    /// the first start of the memory on. Above zero: verdicts the memory does not
    /// hold, because they wait in the queue, were dropped, failed or were lost with a
    /// killed node. Below zero: verdicts the ledger could not take a row for.
    pub fn gap(&self, memory_records: u64) -> Option<i64> {
        let conn = self.db.lock().unwrap_or_else(|p| p.into_inner());
        Self::marks_now(&conn, memory_records)
            .ok()
            .map(|marks| marks.gap)
    }

    /// Write the heads and move the marks of the gap. With `wait` false the ledger is
    /// left alone when another thread holds it. Returns true when the rows are written.
    fn store(&self, anchors: &[DomainAnchor], memory_records: u64, wait: bool) -> bool {
        let conn = if wait {
            self.db.lock().unwrap_or_else(|p| p.into_inner())
        } else {
            match self.db.try_lock() {
                Ok(conn) => conn,
                Err(std::sync::TryLockError::Poisoned(p)) => p.into_inner(),
                Err(std::sync::TryLockError::WouldBlock) => return false,
            }
        };
        let written = self.write_heads(&conn, anchors).and_then(|()| {
            let marks = Self::marks_now(&conn, memory_records)?;
            Self::write_marks(&conn, marks)
        });
        if let Err(error) = &written {
            tracing::warn!(error = %error, "the heads of lattice memory were not written to the ledger");
        }
        written.is_ok()
    }

    /// Forget every head. The node does this on the one start an operator orders it to
    /// take the store as it is.
    fn forget_heads(&self) -> rusqlite::Result<()> {
        let conn = self.db.lock().unwrap_or_else(|p| p.into_inner());
        conn.execute("DELETE FROM lattice_memory_heads", [])
            .map(|_| ())
    }
}

/// What the memory counted since the node started.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct MemoryCounters {
    /// Notes the dock handed to the queue.
    pub enqueued: u64,
    /// Notes the writer wrote as records.
    pub recorded: u64,
    /// Notes the dock dropped because the queue was full.
    pub dropped: u64,
    /// Notes the writer could not write, and notes handed over after the writer ended.
    pub failed: u64,
    /// Recorded proposals whose shape, or one near it, was accepted before.
    pub hot: u64,
    /// Recorded proposals of a shape that was not accepted before.
    pub cold: u64,
    /// Proposals whose writing rows were replayed from the memo.
    pub memo_replayed: u64,
    /// Row sets the memo took.
    pub memo_stored: u64,
    /// Records the judged domains held when the node opened the store.
    pub records_at_start: u64,
}

#[derive(Debug, Default)]
struct Stats {
    enqueued: AtomicU64,
    recorded: AtomicU64,
    dropped: AtomicU64,
    failed: AtomicU64,
    hot: AtomicU64,
    cold: AtomicU64,
    memo_replayed: AtomicU64,
    memo_stored: AtomicU64,
    records_at_start: AtomicU64,
    /// Attractors of the judged domains after the newest write.
    attractors: AtomicU64,
    /// Bytes of proposals the queue holds.
    queued_bytes: AtomicU64,
    /// True while the newest write of the writer failed.
    failing: AtomicBool,
    /// True once the writer thread ended.
    ended: AtomicBool,
}

/// One verdict as the dock hands it to the memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerdictNote<'a> {
    /// Digest of the frame of the proposal.
    pub entry_id: &'a str,
    /// Signer of the frame.
    pub agent_id: &'a str,
    pub docking_port: &'a str,
    pub contract_id: &'a str,
    /// The opened bytes of the proposal. The writer computes the shape from them.
    pub plaintext: &'a [u8],
    pub accepted: bool,
    pub at_unix: i64,
    /// Ids of the closed walls of a deny.
    pub closed: &'a [String],
}

/// One note in the queue.
struct Queued {
    entry_id: String,
    agent_id: String,
    docking_port: String,
    contract_id: String,
    plaintext: Vec<u8>,
    accepted: bool,
    at_unix: i64,
    closed: String,
}

/// The memory of a running node.
pub struct VerdictMemory {
    memo: Mutex<ExactMemo>,
    sender: Mutex<Option<SyncSender<Queued>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    stats: Arc<Stats>,
    ledger: Option<Arc<HeadLedger>>,
    durable: bool,
}

impl std::fmt::Debug for VerdictMemory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerdictMemory")
            .field("counters", &self.counters())
            .finish()
    }
}

/// The record of one note: the shape of the proposal, its digest and its fingerprint
/// under the key of the node, and the verdict as labels.
fn record_of(note: Queued, key: &MemoryKey) -> NewRecord {
    // Bytes that are no JSON were denied before any wall. Their shape is the frame alone.
    let event: Value = serde_json::from_slice(&note.plaintext).unwrap_or(Value::Null);
    let shape = ProposalShape::from_event(
        &event,
        &FrameContext {
            agent_id: &note.agent_id,
            docking_port: &note.docking_port,
            contract_id: &note.contract_id,
        },
    );
    let mut labels = BTreeMap::new();
    labels.insert(
        String::from("verdict"),
        String::from(if note.accepted { "allow" } else { "deny" }),
    );
    if !note.closed.is_empty() {
        labels.insert(String::from("closed"), note.closed);
    }
    NewRecord {
        entry_id: note.entry_id,
        domain: judged_domain(&note.docking_port),
        element_id: note.agent_id,
        accepted: note.accepted,
        recorded_at_unix: note.at_unix,
        shape_digest: shape.keyed_digest(&key.digest),
        fingerprint: Fingerprint::SimHash(SimHash::of_shape_keyed(&shape, &key.fingerprint)),
        labels,
        body: None,
    }
}

/// Flush the logs to the disk and write the heads to the ledger, so no head names a
/// record a loss of power can still take away. True when the heads are written.
fn write_heads(
    backend: &mut (dyn MemoryBackend + Send),
    ledger: &HeadLedger,
    memory_records: u64,
    wait: bool,
) -> bool {
    match backend.sync() {
        Ok(()) => ledger.store(&backend.anchors(), memory_records, wait),
        Err(error) => {
            tracing::warn!(error = %error, "lattice memory could not flush its logs: the heads are not written");
            false
        }
    }
}

/// The writer: it takes notes until the queue closes.
fn write_loop(
    mut backend: Box<dyn MemoryBackend + Send>,
    notes: Receiver<Queued>,
    stats: &Stats,
    key: MemoryKey,
    ledger: Option<Arc<HeadLedger>>,
) {
    // Records written since the heads were last written to the ledger.
    let mut behind = 0u64;
    let records = |stats: &Stats| {
        stats.records_at_start.load(Ordering::SeqCst) + stats.recorded.load(Ordering::SeqCst)
    };
    loop {
        let note = match notes.recv_timeout(ANCHOR_IDLE) {
            Ok(note) => note,
            Err(RecvTimeoutError::Timeout) => {
                // A quiet moment: the heads that are behind go to the ledger.
                if behind > 0 {
                    if let Some(ledger) = &ledger {
                        if write_heads(backend.as_mut(), ledger, records(stats), false) {
                            behind = 0;
                        }
                    }
                }
                continue;
            }
            Err(RecvTimeoutError::Disconnected) => break,
        };
        stats
            .queued_bytes
            .fetch_sub(note.plaintext.len() as u64, Ordering::SeqCst);
        let record = record_of(note, &key);
        let hot = backend
            .route_hint(&record.domain, &record.fingerprint, &record.shape_digest)
            .is_ok_and(|hint| hint.is_hot());
        match backend.record(&record) {
            Ok(_) => {
                if hot {
                    stats.hot.fetch_add(1, Ordering::Relaxed);
                } else {
                    stats.cold.fetch_add(1, Ordering::Relaxed);
                }
                if let Ok(counts) = backend.counts() {
                    stats.attractors.store(counts.attractors, Ordering::SeqCst);
                }
                stats.failing.store(false, Ordering::SeqCst);
                stats.recorded.fetch_add(1, Ordering::SeqCst);
                behind += 1;
            }
            Err(error) => {
                stats.failing.store(true, Ordering::SeqCst);
                let failed = stats.failed.fetch_add(1, Ordering::SeqCst) + 1;
                // The first failure and every thousandth one are logged. A store that
                // refuses every write must not fill the log of the node.
                if failed == 1 || failed.is_multiple_of(1000) {
                    tracing::warn!(error = %error, failed, "lattice memory write failed");
                }
            }
        }
        if behind >= ANCHOR_EVERY {
            if let Some(ledger) = &ledger {
                if write_heads(backend.as_mut(), ledger, records(stats), false) {
                    behind = 0;
                }
            }
        }
    }
    // The queue is closed. The heads are written, then the store closes.
    if let Some(ledger) = &ledger {
        write_heads(backend.as_mut(), ledger, records(stats), true);
    }
    drop(backend);
    stats.ended.store(true, Ordering::SeqCst);
}

/// How the memory of a node on disk is opened.
pub struct MemoryOptions {
    pub key: MemoryKey,
    /// The rows of the memory in the Evidence Ledger. None for a memory that keeps no
    /// heads outside its store.
    pub ledger: Option<Arc<HeadLedger>>,
    /// True to flush every record to the disk before the writer goes on.
    pub durable: bool,
    /// True to take the store as it is and write new heads to the ledger.
    pub accept_store: bool,
}

impl VerdictMemory {
    /// Start the writer thread on a backend.
    pub fn start(
        backend: Box<dyn MemoryBackend + Send>,
        key: MemoryKey,
        ledger: Option<Arc<HeadLedger>>,
        queue_capacity: usize,
    ) -> Result<Arc<Self>, MemoryError> {
        Self::start_with(backend, key, ledger, queue_capacity, false)
    }

    fn start_with(
        backend: Box<dyn MemoryBackend + Send>,
        key: MemoryKey,
        ledger: Option<Arc<HeadLedger>>,
        queue_capacity: usize,
        durable: bool,
    ) -> Result<Arc<Self>, MemoryError> {
        let stats = Arc::new(Stats::default());
        if let Ok(counts) = backend.counts() {
            stats
                .records_at_start
                .store(counts.records, Ordering::SeqCst);
            stats.attractors.store(counts.attractors, Ordering::SeqCst);
            // The heads of this start are in the ledger before the first verdict.
            if let Some(ledger) = &ledger {
                ledger.store(&backend.anchors(), counts.records, true);
            }
        }
        let (sender, receiver) = sync_channel::<Queued>(queue_capacity.max(1));
        let worker_stats = stats.clone();
        let worker_ledger = ledger.clone();
        let worker = std::thread::Builder::new()
            .name(String::from("aep-lattice-memory"))
            .spawn(move || write_loop(backend, receiver, &worker_stats, key, worker_ledger))?;
        Ok(Arc::new(VerdictMemory {
            memo: Mutex::new(ExactMemo::new(DEFAULT_MEMO_CAPACITY, DEFAULT_MEMO_BYTES)),
            sender: Mutex::new(Some(sender)),
            worker: Mutex::new(Some(worker)),
            stats,
            ledger,
            durable,
        }))
    }

    /// Open the memory of a node on its log files and start the writer. The heads the
    /// Evidence Ledger holds are compared with the store before a writer opens it, so
    /// a log that was cut or replaced is reported and nothing is written to it. Only
    /// the judged domains are opened: the domains of other callers of the store are
    /// not read.
    pub fn open(dir: &Path, options: MemoryOptions) -> Result<Arc<Self>, MemoryError> {
        if let Some(ledger) = &options.ledger {
            if options.accept_store {
                ledger
                    .forget_heads()
                    .map_err(|e| MemoryError::Corrupt(e.to_string()))?;
                tracing::warn!("lattice memory takes its store as it is on operator order: new heads are written");
            } else {
                for anchor in ledger.heads().map_err(MemoryError::Corrupt)? {
                    LogBackend::check_anchor(dir, &anchor)?;
                }
            }
        }
        let mut backend = LogBackend::open(
            dir,
            OpenOptionsLog {
                durable: options.durable,
                ..OpenOptionsLog::new(CoreConfig::default())
            },
        )?;
        for domain in LogBackend::domains(dir)? {
            if is_judged_domain(&domain) {
                backend.open_domain(&domain)?;
            }
        }
        Self::start_with(
            Box::new(backend),
            options.key,
            options.ledger,
            QUEUE_CAPACITY,
            options.durable,
        )
    }

    /// A memory that lives in the process, for development and tests.
    pub fn in_memory() -> Result<Arc<Self>, MemoryError> {
        let backend = InMemoryBackend::new(CoreConfig::default())?;
        Self::start(Box::new(backend), MemoryKey::random(), None, QUEUE_CAPACITY)
    }

    /// What Admit reads for a proposal: the memo.
    pub fn view(&self) -> MemoryView<'_> {
        MemoryView { memo: self }
    }

    /// Take a verdict after it is written: store the computed rows of the pure family
    /// in the memo and hand the note to the writer. This never waits. A full queue
    /// drops the note and counts it.
    pub fn note_verdict(&self, note: &VerdictNote<'_>, trace: Option<PureWallTrace>) {
        if let Some(trace) = trace {
            if !trace.replayed {
                let key = MemoKey::of(trace.family, trace.input.as_bytes());
                let rows = trace
                    .rows
                    .into_iter()
                    .map(|wall| WallRow {
                        id: wall.id,
                        family: wall.family,
                        closed: wall.closed,
                        reason: wall.reason,
                    })
                    .collect();
                if let Ok(mut memo) = self.memo.try_lock() {
                    if memo.insert(key, rows) {
                        self.stats.memo_stored.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
        let size = note.plaintext.len() as u64;
        if self.stats.queued_bytes.load(Ordering::SeqCst) + size > QUEUE_MAX_BYTES {
            self.stats.dropped.fetch_add(1, Ordering::SeqCst);
            return;
        }
        let queued = Queued {
            entry_id: note.entry_id.to_string(),
            agent_id: note.agent_id.to_string(),
            docking_port: note.docking_port.to_string(),
            contract_id: note.contract_id.to_string(),
            plaintext: note.plaintext.to_vec(),
            accepted: note.accepted,
            at_unix: note.at_unix,
            closed: closed_label(note.closed),
        };
        // The bytes are counted before the note is in the queue, so the writer never
        // takes a note whose bytes are not counted yet.
        self.stats.queued_bytes.fetch_add(size, Ordering::SeqCst);
        let sent = match self.sender.lock() {
            Ok(sender) => sender.as_ref().map(|s| s.try_send(queued)),
            Err(_) => None,
        };
        match sent {
            Some(Ok(())) => {
                self.stats.enqueued.fetch_add(1, Ordering::SeqCst);
            }
            Some(Err(TrySendError::Full(_))) => {
                self.stats.queued_bytes.fetch_sub(size, Ordering::SeqCst);
                self.stats.dropped.fetch_add(1, Ordering::SeqCst);
            }
            Some(Err(TrySendError::Disconnected(_))) | None => {
                self.stats.queued_bytes.fetch_sub(size, Ordering::SeqCst);
                self.stats.failed.fetch_add(1, Ordering::SeqCst);
            }
        }
    }

    pub fn counters(&self) -> MemoryCounters {
        MemoryCounters {
            enqueued: self.stats.enqueued.load(Ordering::SeqCst),
            recorded: self.stats.recorded.load(Ordering::SeqCst),
            dropped: self.stats.dropped.load(Ordering::SeqCst),
            failed: self.stats.failed.load(Ordering::SeqCst),
            hot: self.stats.hot.load(Ordering::Relaxed),
            cold: self.stats.cold.load(Ordering::Relaxed),
            memo_replayed: self.stats.memo_replayed.load(Ordering::Relaxed),
            memo_stored: self.stats.memo_stored.load(Ordering::Relaxed),
            records_at_start: self.stats.records_at_start.load(Ordering::SeqCst),
        }
    }

    /// Records of the judged domains: the ones the store held at start and the ones
    /// written since.
    pub fn records(&self) -> u64 {
        let counters = self.counters();
        counters.records_at_start + counters.recorded
    }

    /// Attractors of the judged domains after the newest write.
    pub fn attractors(&self) -> u64 {
        self.stats.attractors.load(Ordering::SeqCst)
    }

    /// Notes that wait in the queue.
    pub fn queue_depth(&self) -> u64 {
        let counters = self.counters();
        counters
            .enqueued
            .saturating_sub(counters.recorded + counters.failed)
    }

    /// True while the newest write failed or once the writer ended: the memory takes
    /// no record now.
    pub fn is_failing(&self) -> bool {
        self.stats.failing.load(Ordering::SeqCst) || self.stats.ended.load(Ordering::SeqCst)
    }

    /// True when the store flushes every record to the disk.
    pub fn is_durable(&self) -> bool {
        self.durable
    }

    /// Verdict rows of the Evidence Ledger minus records of the memory. None for a
    /// memory that keeps no rows in a ledger.
    pub fn ledger_gap(&self) -> Option<i64> {
        self.ledger.as_ref()?.gap(self.records())
    }

    /// Wait until the writer has taken every note the dock handed over, or until
    /// `timeout` has passed. True when the queue is empty.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            if self.queue_depth() == 0 {
                return true;
            }
            if Instant::now() >= deadline {
                return false;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    }

    /// Close the queue and wait for the writer to write what the queue still holds.
    pub fn stop(&self) {
        if let Ok(mut sender) = self.sender.lock() {
            sender.take();
        }
        let worker = match self.worker.lock() {
            Ok(mut worker) => worker.take(),
            Err(_) => None,
        };
        if let Some(worker) = worker {
            let _ = worker.join();
        }
    }
}

impl Drop for VerdictMemory {
    fn drop(&mut self) {
        self.stop();
    }
}

impl PureWallMemo for VerdictMemory {
    fn replay(&self, family: &str, input: &str) -> Option<Vec<AdmitWall>> {
        // A memo that is busy or broken is a miss. The rows are computed then.
        let memo = self.memo.try_lock().ok()?;
        let rows = memo.get(&MemoKey::of(family, input.as_bytes()))?;
        drop(memo);
        self.stats.memo_replayed.fetch_add(1, Ordering::Relaxed);
        Some(
            rows.iter()
                .map(|row| AdmitWall {
                    id: row.id.clone(),
                    family: row.family.clone(),
                    closed: row.closed,
                    reason: row.reason.clone(),
                })
                .collect(),
        )
    }
}

/// The closed wall ids of a deny as one label value, cut at the bound of a label.
fn closed_label(closed: &[String]) -> String {
    const BOUND: usize = 240;
    let mut out = String::new();
    for id in closed {
        let extra = if out.is_empty() {
            id.len()
        } else {
            id.len() + 1
        };
        if out.len() + extra > BOUND || !id.is_ascii() {
            break;
        }
        if !out.is_empty() {
            out.push(',');
        }
        out.push_str(id);
    }
    out
}

/// The memory of a node at start, or why it runs without one.
pub struct MemoryStart {
    pub memory: Option<Arc<VerdictMemory>>,
    /// `ok`, `off` or `error`.
    pub status: &'static str,
    pub error: Option<String>,
}

fn env_is(name: &str, value: &str) -> bool {
    std::env::var(name).is_ok_and(|found| found.trim() == value)
}

/// Start the memory of a node. A node whose memory cannot be opened runs without it:
/// no verdict changes and none is recorded, and the health answer names the error.
pub fn start_for(data_dir: &Path, db: &Arc<Mutex<Connection>>) -> MemoryStart {
    if env_is(MEMORY_SWITCH_ENV, "off") {
        return MemoryStart {
            memory: None,
            status: "off",
            error: None,
        };
    }
    let opened = MemoryKey::load_or_create(data_dir)
        .map_err(MemoryError::Io)
        .and_then(|key| {
            let ledger = HeadLedger::new(db.clone(), key).map_err(|e| {
                MemoryError::Corrupt(format!("the Evidence Ledger takes no head: {e}"))
            })?;
            VerdictMemory::open(
                &memory_dir(data_dir),
                MemoryOptions {
                    key,
                    ledger: Some(Arc::new(ledger)),
                    durable: env_is(MEMORY_DURABLE_ENV, "on"),
                    accept_store: env_is(MEMORY_ACCEPT_ENV, "1"),
                },
            )
        });
    match opened {
        Ok(memory) => MemoryStart {
            memory: Some(memory),
            status: "ok",
            error: None,
        },
        Err(error) => {
            tracing::warn!(error = %error, "lattice memory is not open: the node runs without it");
            MemoryStart {
                memory: None,
                status: "error",
                error: Some(error.to_string()),
            }
        }
    }
}

/// Verify the store of a node that is not running here: every frame of every log, the
/// hash chain, the attractors, each snapshot against its log and each head of the
/// Evidence Ledger against its log. Files are opened to read and nothing is changed.
pub fn verify_store(data_dir: &Path, ledger: &Connection) -> Result<VerifyReport, String> {
    let dir = memory_dir(data_dir);
    let report = LogBackend::open_read_only(&dir, CoreConfig::default())
        .and_then(|backend| backend.verify())
        .map_err(|e| e.to_string())?;
    let has_heads = ledger
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'lattice_memory_heads'",
            [],
            |_| Ok(()),
        )
        .is_ok();
    if !has_heads {
        // A node that never started a memory keeps no heads.
        return Ok(report);
    }
    if !data_dir.join(KEY_FILE).is_file() {
        return Err(format!(
            "the Evidence Ledger holds heads of lattice memory and the key file {KEY_FILE} is gone"
        ));
    }
    let key = MemoryKey::load_or_create(data_dir).map_err(|e| e.to_string())?;
    for anchor in read_heads(ledger, &key)? {
        LogBackend::check_anchor(&dir, &anchor).map_err(|e| e.to_string())?;
    }
    Ok(report)
}

/// Name of the table in which the store before this one kept its rows in the ledger file.
const OLD_ROWS_TABLE: &str = "lattice_memory_meta";
/// Suffix of the index file the store before this one kept beside the ledger file.
const OLD_INDEX_SUFFIX: &str = ".usearch";

/// Remove what the store before this one left behind: its rows in the ledger file,
/// the rows of earlier self-tests among them, and its index file beside the ledger
/// file. No row of the evidence ledger is touched. True when something was removed.
pub fn retire_old_store(ledger: &Connection, lattice_db: &Path) -> bool {
    let had_rows = ledger
        .query_row(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1",
            [OLD_ROWS_TABLE],
            |_| Ok(()),
        )
        .is_ok();
    let rows_removed = had_rows
        && ledger
            .execute_batch("DROP TABLE IF EXISTS lattice_memory_meta")
            .is_ok();
    let index_removed = match lattice_db.file_name() {
        Some(name) => {
            let old =
                lattice_db.with_file_name(format!("{}{OLD_INDEX_SUFFIX}", name.to_string_lossy()));
            old.is_file() && std::fs::remove_file(&old).is_ok()
        }
        None => false,
    };
    rows_removed || index_removed
}

/// Test the memory inside the process: record one accepted probe, read its hint back
/// as hot and verify the log. Nothing is written to any store. Returns the attractors
/// the probe formed.
pub fn self_test() -> Result<u64, MemoryError> {
    let mut backend = InMemoryBackend::new(CoreConfig::default())?;
    let key = MemoryKey::random();
    let probe = |entry_id: &str| {
        record_of(
            Queued {
                entry_id: entry_id.to_string(),
                agent_id: String::from("AG-BOOT"),
                docking_port: String::from("selftest"),
                contract_id: String::from("dynaep-action-lattice"),
                plaintext: br#"{"type":"PING","action_path":"root:ping"}"#.to_vec(),
                accepted: true,
                at_unix: 0,
                closed: String::new(),
            },
            &key,
        )
    };
    let record = probe("selftest");
    let hint = |backend: &InMemoryBackend| {
        backend.route_hint(&record.domain, &record.fingerprint, &record.shape_digest)
    };
    if hint(&backend)?.is_hot() {
        return Err(MemoryError::Corrupt(String::from(
            "self-test: an empty memory gave a hot hint",
        )));
    }
    backend.record(&record)?;
    if !hint(&backend)?.is_hot() {
        return Err(MemoryError::Corrupt(String::from(
            "self-test: a recorded shape gave a cold hint",
        )));
    }
    Ok(backend.verify()?.attractors)
}

/// The memory fields of a health answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryReport {
    pub attractors: u64,
    /// Records of the judged domains.
    pub records: u64,
    pub dropped: u64,
    pub failed: u64,
    /// Notes that wait in the queue.
    pub queue_depth: u64,
    pub hot: u64,
    pub cold: u64,
    pub memo_replayed: u64,
    /// Verdict rows of the Evidence Ledger minus records of the memory. None when
    /// the count cannot be read.
    pub ledger_gap: Option<i64>,
    /// True when the store flushes every record to the disk.
    pub durable: bool,
    /// `ok`, `failing` while writes fail, `off`, `absent` when no store exists yet or
    /// `error` when the store could not be opened.
    pub status: &'static str,
}

impl MemoryReport {
    /// The report of a node that has no store yet.
    pub fn absent() -> Self {
        MemoryReport {
            attractors: 0,
            records: 0,
            dropped: 0,
            failed: 0,
            queue_depth: 0,
            hot: 0,
            cold: 0,
            memo_replayed: 0,
            ledger_gap: None,
            durable: false,
            status: "absent",
        }
    }

    /// The report of a running node from its live memory. No file of the store is opened.
    pub fn of_runtime(record: &crate::dock_parts::DockRecord) -> Self {
        match record.memory.as_deref() {
            Some(memory) => {
                let counters = memory.counters();
                MemoryReport {
                    attractors: memory.attractors(),
                    records: memory.records(),
                    dropped: counters.dropped,
                    failed: counters.failed,
                    queue_depth: memory.queue_depth(),
                    hot: counters.hot,
                    cold: counters.cold,
                    memo_replayed: counters.memo_replayed,
                    ledger_gap: memory.ledger_gap(),
                    durable: memory.is_durable(),
                    status: if memory.is_failing() {
                        "failing"
                    } else {
                        record.memory_status
                    },
                }
            }
            None => MemoryReport {
                status: record.memory_status,
                ..MemoryReport::absent()
            },
        }
    }

    /// The report of a node that is not running here. The store is opened to read
    /// and nothing is made or changed. Only the judged domains are counted.
    pub fn offline(data_dir: &Path) -> Self {
        match LogBackend::health(&memory_dir(data_dir)) {
            Ok(health) if health.present => {
                let judged = health
                    .domains
                    .iter()
                    .filter(|domain| is_judged_domain(&domain.domain));
                MemoryReport {
                    attractors: judged.clone().map(|d| d.attractors).sum(),
                    records: judged.map(|d| d.records).sum(),
                    durable: env_is(MEMORY_DURABLE_ENV, "on"),
                    status: "ok",
                    ..MemoryReport::absent()
                }
            }
            Ok(_) => MemoryReport::absent(),
            Err(_) => MemoryReport {
                status: "error",
                ..MemoryReport::absent()
            },
        }
    }
}

#[cfg(test)]
#[path = "lattice_memory_tests.rs"]
mod tests;
