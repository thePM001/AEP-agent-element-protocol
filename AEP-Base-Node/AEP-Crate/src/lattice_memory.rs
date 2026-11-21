//! Lattice Memory in the Base Node.
//!
//! The Base Node is the one writer of the judged proposals. After a verdict is written
//! to the evidence ledger, the dock hands a note of it to a bounded queue. One thread
//! takes the notes and writes each as one record of the memory. A full queue drops the
//! note and counts it. The dock never waits for the memory, so the memory can never
//! hold a verdict back.
//!
//! Admit reads two things and writes nothing:
//!
//! - The route hint: hot when an accepted proposal of the same shape or a near one was
//!   recorded, cold in every other case and whenever the memory cannot be read.
//! - The exact-match memo: the rows of the pure writing family for byte identical
//!   text under the same compiled lattice and the same wall set. The memo lives in
//!   this process only and starts empty at every boot.
//!
//! Neither changes a verdict. A hint only says whether the memo is asked. A stored row
//! is the row the same code computed before for the same bytes. Every wall that reads
//! the clock, a budget or the state of the node is computed on every proposal.

use aep_admit::{AdmitWall, MemoryView, PureWallMemo, PureWallTrace, RouteHint};
use aep_lattice_memory::core::{
    canonical_json, sha256, ExactMemo, MemoKey, WallRow, DEFAULT_MEMO_CAPACITY,
};
use aep_lattice_memory::{
    CoreConfig, Fingerprint, FrameContext, HintReader, InMemoryBackend, LogBackend, MemoryBackend,
    MemoryError, MemoryHealth, NewRecord, OpenOptionsLog, ProposalShape, SimHash, JUDGED_DOMAIN,
};
use aep_live_entry::LiveEntry;
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{sync_channel, Receiver, SyncSender, TrySendError};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

/// Folder of the memory under the data folder of the node.
pub const MEMORY_DIR: &str = "lattice-memory";
/// Notes the queue between the dock and the writer holds.
pub const QUEUE_CAPACITY: usize = 4096;
/// Bits of the fingerprint the node records.
pub const FINGERPRINT_BITS: u32 = 256;
/// The name of the store in the health answer.
pub const VECTOR_STORE: &str = "simhash256+log";
/// Environment variable that turns the memory off when its value is `off`.
pub const MEMORY_SWITCH_ENV: &str = "AEP_LATTICE_MEMORY";

/// The folder of the memory of a node whose data folder is `data_dir`.
pub fn memory_dir(data_dir: &Path) -> PathBuf {
    data_dir.join(MEMORY_DIR)
}

/// The domain of the proposals judged on one docking port.
pub fn judged_domain(docking_port: &str) -> String {
    format!("{JUDGED_DOMAIN}.{docking_port}")
}

/// The two digests of the node that bind every memo entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MemoryDigests {
    pub lattice: [u8; 32],
    pub wall_set: [u8; 32],
}

impl MemoryDigests {
    pub fn of(live: &LiveEntry) -> Self {
        MemoryDigests {
            lattice: compiled_lattice_digest(live),
            wall_set: wall_set_digest(),
        }
    }
}

/// The digest of the compiled lattice: every node with its parents, its permissions,
/// its category and its wrap, and the time bounds of the lattice.
pub fn compiled_lattice_digest(live: &LiveEntry) -> [u8; 32] {
    let mut nodes = serde_json::Map::new();
    for (path, node) in &live.snapshot.lattice_nodes {
        let mut row = serde_json::Map::new();
        row.insert(
            String::from("action_path"),
            Value::String(node.action_path.clone()),
        );
        row.insert(
            String::from("category"),
            Value::String(node.category.clone()),
        );
        row.insert(String::from("wrap"), Value::String(node.wrap.clone()));
        row.insert(
            String::from("parents"),
            Value::Array(node.parents.iter().cloned().map(Value::String).collect()),
        );
        row.insert(
            String::from("agent_permission"),
            Value::Array(
                node.agent_permission
                    .iter()
                    .cloned()
                    .map(Value::String)
                    .collect(),
            ),
        );
        nodes.insert(path.clone(), Value::Object(row));
    }
    let mut lattice = serde_json::Map::new();
    lattice.insert(String::from("nodes"), Value::Object(nodes));
    lattice.insert(
        String::from("max_drift_ms"),
        Value::from(live.snapshot.max_drift_ms),
    );
    lattice.insert(
        String::from("max_future_ms"),
        Value::from(live.snapshot.max_future_ms),
    );
    lattice.insert(
        String::from("max_age_ms"),
        Value::from(live.snapshot.max_age_ms),
    );
    let mut bytes = b"aep.compiled-lattice.v1\n".to_vec();
    bytes.extend_from_slice(canonical_json(&Value::Object(lattice)).as_bytes());
    sha256(&bytes)
}

/// The digest of the compiled wall set: the writing rule source, the writing rule
/// table, the wall crates of the live pass and the version of this build.
pub fn wall_set_digest() -> [u8; 32] {
    let mut bytes = b"aep.wall-set.v1\n".to_vec();
    bytes.extend_from_slice(env!("CARGO_PKG_VERSION").as_bytes());
    bytes.push(b'\n');
    for name in aep_admit_live_dock::PRODUCT_WALL_CRATES {
        bytes.extend_from_slice(name.as_bytes());
        bytes.push(b'\n');
    }
    for rule in aep_admit::WRITING_RULES {
        bytes.extend_from_slice(rule.id.as_bytes());
        bytes.push(b'\t');
        bytes.extend_from_slice(rule.description.as_bytes());
        bytes.push(b'\n');
    }
    bytes.extend_from_slice(aep_admit::WRITING_GAP_SOURCE.as_bytes());
    sha256(&bytes)
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
    /// Proposals with a hot route hint.
    pub hot: u64,
    /// Proposals with a cold route hint.
    pub cold: u64,
    /// Proposals whose pure rows were replayed from the memo.
    pub memo_replayed: u64,
    /// Row sets the memo took.
    pub memo_stored: u64,
    /// Records the store held when the node opened it.
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
    /// Attractors of every domain after the newest write.
    attractors: AtomicU64,
}

/// What the dock computes of a proposal before Admit: its place in the memory and
/// the route hint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Probe {
    pub domain: String,
    pub shape_digest: [u8; 32],
    pub fingerprint: Fingerprint,
    pub route: RouteHint,
}

/// One verdict as the dock hands it to the memory.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VerdictNote<'a> {
    /// Digest of the frame of the proposal.
    pub entry_id: &'a str,
    /// Signer of the frame.
    pub agent_id: &'a str,
    pub accepted: bool,
    pub at_unix: i64,
    /// Ids of the closed walls of a deny.
    pub closed: &'a [String],
}

/// The memory of a running node.
pub struct VerdictMemory {
    hints: HintReader,
    memo: Mutex<ExactMemo>,
    digests: MemoryDigests,
    sender: Mutex<Option<SyncSender<NewRecord>>>,
    worker: Mutex<Option<JoinHandle<()>>>,
    stats: Arc<Stats>,
}

impl std::fmt::Debug for VerdictMemory {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("VerdictMemory")
            .field("counters", &self.counters())
            .finish()
    }
}

fn write_loop(
    mut backend: Box<dyn MemoryBackend + Send>,
    notes: Receiver<NewRecord>,
    stats: &Stats,
) {
    for note in notes {
        match backend.record(&note) {
            Ok(_) => {
                stats.recorded.fetch_add(1, Ordering::SeqCst);
                if let Ok(counts) = backend.counts() {
                    stats.attractors.store(counts.attractors, Ordering::SeqCst);
                }
            }
            Err(error) => {
                let failed = stats.failed.fetch_add(1, Ordering::SeqCst) + 1;
                // The first failure and every thousandth one are logged. A store that
                // refuses every write must not fill the log of the node.
                if failed == 1 || failed.is_multiple_of(1000) {
                    tracing::warn!(error = %error, failed, "lattice memory write failed");
                }
            }
        }
    }
    // The queue is closed. Dropping the backend writes its snapshots.
    drop(backend);
}

impl VerdictMemory {
    /// Start the writer thread on a backend.
    pub fn start(
        backend: Box<dyn MemoryBackend + Send>,
        digests: MemoryDigests,
        queue_capacity: usize,
    ) -> Result<Arc<Self>, MemoryError> {
        let hints = backend.reader();
        let stats = Arc::new(Stats::default());
        if let Ok(counts) = backend.counts() {
            stats
                .records_at_start
                .store(counts.records, Ordering::SeqCst);
            stats.attractors.store(counts.attractors, Ordering::SeqCst);
        }
        let (sender, receiver) = sync_channel::<NewRecord>(queue_capacity.max(1));
        let worker_stats = stats.clone();
        let worker = std::thread::Builder::new()
            .name(String::from("aep-lattice-memory"))
            .spawn(move || write_loop(backend, receiver, &worker_stats))?;
        Ok(Arc::new(VerdictMemory {
            hints,
            memo: Mutex::new(ExactMemo::new(DEFAULT_MEMO_CAPACITY)),
            digests,
            sender: Mutex::new(Some(sender)),
            worker: Mutex::new(Some(worker)),
            stats,
        }))
    }

    /// Open the memory of a node on its log files and start the writer.
    pub fn open(dir: &Path, digests: MemoryDigests) -> Result<Arc<Self>, MemoryError> {
        let mut backend = LogBackend::open(dir, OpenOptionsLog::new(CoreConfig::default()))?;
        backend.open_all()?;
        Self::start(Box::new(backend), digests, QUEUE_CAPACITY)
    }

    /// A memory that lives in the process, for development and tests.
    pub fn in_memory(digests: MemoryDigests) -> Result<Arc<Self>, MemoryError> {
        let backend = InMemoryBackend::new(CoreConfig::default())?;
        Self::start(Box::new(backend), digests, QUEUE_CAPACITY)
    }

    /// The place of a proposal in the memory and its route hint. The signer of the
    /// frame is the agent of the shape.
    pub fn probe(
        &self,
        event: &Value,
        agent_id: &str,
        docking_port: &str,
        contract_id: &str,
    ) -> Probe {
        let shape = ProposalShape::from_event(
            event,
            &FrameContext {
                agent_id,
                docking_port,
                contract_id,
            },
        );
        let domain = judged_domain(docking_port);
        let shape_digest = shape.digest();
        let fingerprint = Fingerprint::SimHash(SimHash::of_shape(&shape));
        // A memory that cannot be read at this instant gives no hint, which is cold.
        let hot = self
            .hints
            .route_hint(&domain, &fingerprint, &shape_digest)
            .is_some_and(|hint| hint.is_hot());
        let route = if hot {
            self.stats.hot.fetch_add(1, Ordering::Relaxed);
            RouteHint::Hot
        } else {
            self.stats.cold.fetch_add(1, Ordering::Relaxed);
            RouteHint::Cold
        };
        Probe {
            domain,
            shape_digest,
            fingerprint,
            route,
        }
    }

    /// What Admit reads for a proposal: the hint of its probe and the memo.
    pub fn view<'a>(&'a self, probe: &Probe) -> MemoryView<'a> {
        MemoryView {
            route: probe.route,
            memo: self,
        }
    }

    fn memo_key(&self, family: &str, input: &str) -> MemoKey {
        MemoKey::derive(
            family,
            &sha256(input.as_bytes()),
            &self.digests.lattice,
            &self.digests.wall_set,
        )
    }

    /// Take a verdict after it is written: store the computed rows of the pure family
    /// in the memo and hand the note to the writer. This never waits. A full queue
    /// drops the note and counts it.
    pub fn note_verdict(&self, probe: Probe, note: &VerdictNote<'_>, trace: Option<PureWallTrace>) {
        if let Some(trace) = trace {
            if !trace.replayed {
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
                let key = self.memo_key(trace.family, &trace.input);
                if let Ok(mut memo) = self.memo.try_lock() {
                    if memo.insert(key, rows) {
                        self.stats.memo_stored.fetch_add(1, Ordering::Relaxed);
                    }
                }
            }
        }
        let mut labels = BTreeMap::new();
        labels.insert(
            String::from("verdict"),
            String::from(if note.accepted { "allow" } else { "deny" }),
        );
        if !note.closed.is_empty() {
            labels.insert(String::from("closed"), closed_label(note.closed));
        }
        let record = NewRecord {
            entry_id: note.entry_id.to_string(),
            domain: probe.domain,
            element_id: note.agent_id.to_string(),
            accepted: note.accepted,
            recorded_at_unix: note.at_unix,
            shape_digest: probe.shape_digest,
            fingerprint: probe.fingerprint,
            labels,
            body: None,
        };
        let sent = match self.sender.lock() {
            Ok(sender) => sender.as_ref().map(|s| s.try_send(record)),
            Err(_) => None,
        };
        match sent {
            Some(Ok(())) => {
                self.stats.enqueued.fetch_add(1, Ordering::SeqCst);
            }
            Some(Err(TrySendError::Full(_))) => {
                self.stats.dropped.fetch_add(1, Ordering::SeqCst);
            }
            Some(Err(TrySendError::Disconnected(_))) | None => {
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

    /// Records of the store: the ones it held at start and the ones written since.
    pub fn records(&self) -> u64 {
        let counters = self.counters();
        counters.records_at_start + counters.recorded
    }

    /// Attractors of every domain after the newest write.
    pub fn attractors(&self) -> u64 {
        self.stats.attractors.load(Ordering::SeqCst)
    }

    /// Wait until the writer has taken every note the dock handed over, or until
    /// `timeout` has passed. True when the queue is empty.
    pub fn wait_idle(&self, timeout: Duration) -> bool {
        let deadline = Instant::now() + timeout;
        loop {
            let counters = self.counters();
            if counters.recorded + counters.failed >= counters.enqueued {
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
        let rows = memo.get(&self.memo_key(family, input))?;
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

/// Start the memory of a node. A node whose memory cannot be opened runs without it:
/// every proposal takes the cold path and no verdict changes.
pub fn start_for(data_dir: &Path, live: &LiveEntry) -> MemoryStart {
    if std::env::var(MEMORY_SWITCH_ENV).is_ok_and(|value| value.trim() == "off") {
        return MemoryStart {
            memory: None,
            status: "off",
            error: None,
        };
    }
    match VerdictMemory::open(&memory_dir(data_dir), MemoryDigests::of(live)) {
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

/// The health of the memory of a node that is not running here. Files are opened to
/// read and nothing is made or changed.
pub fn offline_health(data_dir: &Path) -> Result<MemoryHealth, MemoryError> {
    LogBackend::health(&memory_dir(data_dir))
}

/// Name of the table in which the store before this one kept its rows in the ledger file.
const OLD_ROWS_TABLE: &str = "lattice_memory_meta";
/// Suffix of the index file the store before this one kept beside the ledger file.
const OLD_INDEX_SUFFIX: &str = ".usearch";

/// Remove what the store before this one left behind: its rows in the ledger file,
/// the rows of earlier self-tests among them, and its index file beside the ledger
/// file. No row of the evidence ledger is touched. True when something was removed.
pub fn retire_old_store(ledger: &rusqlite::Connection, lattice_db: &Path) -> bool {
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
    let shape = ProposalShape::from_event(
        &serde_json::json!({"type": "PING", "action_path": "root:ping"}),
        &FrameContext {
            agent_id: "AG-BOOT",
            docking_port: "validation_engine",
            contract_id: "dynaep-action-lattice",
        },
    );
    let domain = judged_domain("selftest");
    let fingerprint = Fingerprint::SimHash(SimHash::of_shape(&shape));
    let digest = shape.digest();
    if backend.route_hint(&domain, &fingerprint, &digest)?.is_hot() {
        return Err(MemoryError::Corrupt(String::from(
            "self-test: an empty memory gave a hot hint",
        )));
    }
    backend.record(&NewRecord {
        entry_id: String::from("selftest"),
        domain: domain.clone(),
        element_id: String::from("AG-BOOT"),
        accepted: true,
        recorded_at_unix: 0,
        shape_digest: digest,
        fingerprint: fingerprint.clone(),
        labels: BTreeMap::new(),
        body: None,
    })?;
    if !backend.route_hint(&domain, &fingerprint, &digest)?.is_hot() {
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
    pub records: u64,
    pub dropped: u64,
    pub failed: u64,
    /// `ok`, `off`, `absent` when no store exists yet or `error`.
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
            status: "absent",
        }
    }

    /// The report of a running node from its live memory. No file is opened.
    pub fn of_runtime(record: &crate::dock_parts::DockRecord) -> Self {
        match record.memory.as_deref() {
            Some(memory) => {
                let counters = memory.counters();
                MemoryReport {
                    attractors: memory.attractors(),
                    records: memory.records(),
                    dropped: counters.dropped,
                    failed: counters.failed,
                    status: record.memory_status,
                }
            }
            None => MemoryReport {
                status: record.memory_status,
                ..MemoryReport::absent()
            },
        }
    }

    /// The report of a node that is not running here. The store is opened to read
    /// and nothing is made or changed.
    pub fn offline(data_dir: &Path) -> Self {
        match offline_health(data_dir) {
            Ok(health) if health.present => MemoryReport {
                attractors: health.attractors,
                records: health.records,
                dropped: 0,
                failed: 0,
                status: "ok",
            },
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
