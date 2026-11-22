//! Tests of Lattice Memory in the Base Node.

use super::*;
use crate::side_channel_monitor::{record_side_channel_anomaly, SideChannelAnomalyKind};
use aep_lattice_channel::DockingPort;
use aep_lattice_memory::{Counts, Match, Page, Receipt, RecordQuery, StoredRecord};
use serde_json::json;
use std::sync::Condvar;

const DOMAIN: &str = "admit.validation_engine";

fn event(note: &str) -> Vec<u8> {
    json!({
        "type": "PING",
        "action_path": "root:ping",
        "timestamp": 1_000_000,
        "_sequenceNumber": 1,
        "payload": {"note": note, "files": ["a.rs", "b.rs", "c.rs"], "mode": "write", "n": 3},
    })
    .to_string()
    .into_bytes()
}

/// A text of twelve words that no other index shares, so its shape is far from the
/// shape of every other index.
fn far_text(index: u64) -> String {
    (0..12)
        .map(|word| format!("w{}x{}", word, index * 12 + word))
        .collect::<Vec<_>>()
        .join(" ")
}

fn note<'a>(
    entry_id: &'a str,
    plaintext: &'a [u8],
    accepted: bool,
    closed: &'a [String],
) -> VerdictNote<'a> {
    VerdictNote {
        entry_id,
        agent_id: "agent-a",
        docking_port: "validation_engine",
        contract_id: "c-1",
        plaintext,
        accepted,
        at_unix: 1_795_000_000,
        closed,
    }
}

fn idle(memory: &VerdictMemory) {
    assert!(memory.wait_idle(Duration::from_secs(60)));
}

/// A backend that wraps the one in memory and can hold or refuse every write.
struct Gated {
    inner: InMemoryBackend,
    /// While true a write waits.
    hold: Arc<(Mutex<bool>, Condvar)>,
    /// While true a write is refused.
    refuse: Arc<Mutex<bool>>,
}

impl MemoryBackend for Gated {
    fn record(&mut self, record: &NewRecord) -> Result<Receipt, MemoryError> {
        {
            let (lock, wake) = &*self.hold;
            let mut held = lock.lock().unwrap();
            while *held {
                held = wake.wait(held).unwrap();
            }
        }
        if *self.refuse.lock().unwrap() {
            return Err(MemoryError::Corrupt(String::from(
                "the test refuses the write",
            )));
        }
        self.inner.record(record)
    }

    fn route_hint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        shape_digest: &[u8; 32],
    ) -> Result<aep_lattice_memory::RouteHint, MemoryError> {
        self.inner.route_hint(domain, fingerprint, shape_digest)
    }

    fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Result<Vec<Match>, MemoryError> {
        self.inner.search(domain, fingerprint, limit, min_score)
    }

    fn records(&self, query: &RecordQuery<'_>) -> Result<Page, MemoryError> {
        self.inner.records(query)
    }

    fn count(&self, query: &RecordQuery<'_>) -> Result<u64, MemoryError> {
        self.inner.count(query)
    }

    fn counts(&self) -> Result<Counts, MemoryError> {
        self.inner.counts()
    }

    fn anchors(&self) -> Vec<DomainAnchor> {
        self.inner.anchors()
    }

    fn sync(&mut self) -> Result<(), MemoryError> {
        self.inner.sync()
    }

    fn verify(&self) -> Result<VerifyReport, MemoryError> {
        self.inner.verify()
    }

    fn config(&self) -> CoreConfig {
        self.inner.config()
    }
}

type Gate = (Arc<(Mutex<bool>, Condvar)>, Arc<Mutex<bool>>);

fn gated(queue: usize, held: bool, refuse: bool) -> (Arc<VerdictMemory>, Gate) {
    let hold = Arc::new((Mutex::new(held), Condvar::new()));
    let refuse = Arc::new(Mutex::new(refuse));
    let backend = Gated {
        inner: InMemoryBackend::new(CoreConfig::default()).unwrap(),
        hold: hold.clone(),
        refuse: refuse.clone(),
    };
    let memory = VerdictMemory::start(Box::new(backend), MemoryKey::random(), None, queue).unwrap();
    (memory, (hold, refuse))
}

fn release(gate: &Gate) {
    let (lock, wake) = &*gate.0;
    *lock.lock().unwrap() = false;
    wake.notify_all();
}

/// The Evidence Ledger of a node in `dir`.
fn ledger_db(dir: &Path) -> Arc<Mutex<Connection>> {
    let conn = crate::open_lattice_db(&dir.join("aep-action-lattice.db")).unwrap();
    Arc::new(Mutex::new(conn))
}

/// The memory of a node on disk with its heads in the ledger.
fn node_memory(
    dir: &Path,
    db: &Arc<Mutex<Connection>>,
    accept_store: bool,
) -> Result<Arc<VerdictMemory>, MemoryError> {
    let key = MemoryKey::load_or_create(dir).unwrap();
    let ledger = HeadLedger::new(db.clone(), key).unwrap();
    VerdictMemory::open(
        &memory_dir(dir),
        MemoryOptions {
            key,
            ledger: Some(Arc::new(ledger)),
            durable: false,
            accept_store,
        },
    )
}

/// Every record of the judged domain of the store of a node, read from its files.
fn stored(dir: &Path) -> Vec<StoredRecord> {
    let store = LogBackend::open_read_only(&memory_dir(dir), CoreConfig::default()).unwrap();
    store.verify().unwrap();
    let mut found = Vec::new();
    let mut after = None;
    loop {
        let page = store
            .records(&RecordQuery {
                after: after.as_ref(),
                ..RecordQuery::domain(DOMAIN)
            })
            .unwrap();
        found.extend(page.records);
        match page.next {
            Some(next) => after = Some(next),
            None => return found,
        }
    }
}

/// A node record around a memory, as the health answer reads it.
fn dock_record(
    memory: Option<Arc<VerdictMemory>>,
    status: &'static str,
) -> crate::dock_parts::DockRecord {
    crate::dock_parts::DockRecord {
        db: Arc::new(Mutex::new(Connection::open_in_memory().unwrap())),
        pulse: Arc::new(Mutex::new(crate::docking::PulseState::default())),
        sqlite_closed: AtomicBool::new(false),
        memory,
        memory_status: status,
        memory_error: None,
    }
}

#[test]
fn a_full_queue_drops_and_counts_and_never_blocks_a_verdict() {
    // The writer is held, so nothing leaves the queue of four.
    let (memory, gate) = gated(4, true, false);
    // 500 verdicts go by on a thread of their own while the writer stays held. One
    // verdict that waited for the writer would never return, so the thread would not
    // end and the bound below would break.
    let dock = memory.clone();
    let (done, finished) = std::sync::mpsc::channel::<Duration>();
    let handle = std::thread::spawn(move || {
        let bytes = event("work");
        let mut slowest = Duration::ZERO;
        for index in 0..500 {
            let started = Instant::now();
            dock.note_verdict(&note(&format!("e-{index}"), &bytes, true, &[]), None);
            slowest = slowest.max(started.elapsed());
        }
        let _ = done.send(slowest);
    });
    let slowest = finished
        .recv_timeout(Duration::from_secs(20))
        .expect("a verdict waited for the held writer");
    handle.join().unwrap();
    println!("slowest note of 500 while the writer was held: {slowest:?}");
    let counters = memory.counters();
    // Four notes wait in the queue and one is in the hand of the writer.
    assert!(
        counters.enqueued >= 4 && counters.enqueued <= 5,
        "{counters:?}"
    );
    assert_eq!(counters.enqueued + counters.dropped, 500);
    assert_eq!(counters.recorded, 0);
    assert_eq!(counters.failed, 0);
    assert!(memory.queue_depth() >= 4);
    // Once the writer runs again it writes what the queue held and nothing more.
    release(&gate);
    idle(&memory);
    let counters = memory.counters();
    assert_eq!(counters.recorded, counters.enqueued);
    assert_eq!(memory.records(), counters.enqueued);
    assert_eq!(memory.queue_depth(), 0);
}

#[test]
fn the_queue_holds_a_bounded_number_of_bytes() {
    let (memory, gate) = gated(4096, true, false);
    // Each note carries a proposal of 9 MiB. The queue takes them up to its bound of
    // bytes, far below its bound of notes, and drops the rest.
    let large = vec![b' '; 9 * 1024 * 1024];
    for index in 0..12 {
        memory.note_verdict(&note(&format!("e-{index}"), &large, false, &[]), None);
    }
    let counters = memory.counters();
    assert_eq!(counters.enqueued + counters.dropped, 12);
    assert!(counters.dropped >= 4, "{counters:?}");
    assert!(
        counters.enqueued * large.len() as u64 <= QUEUE_MAX_BYTES + large.len() as u64,
        "{counters:?}"
    );
    release(&gate);
    idle(&memory);
    // The bytes are given back as the writer takes the notes.
    assert_eq!(memory.stats.queued_bytes.load(Ordering::SeqCst), 0);
    let small = event("work");
    memory.note_verdict(&note("after", &small, true, &[]), None);
    idle(&memory);
    assert_eq!(memory.counters().recorded, memory.counters().enqueued);
}

#[test]
fn the_health_reads_failing_while_writes_fail() {
    // A store that refuses every write.
    let (memory, gate) = gated(64, false, true);
    let bytes = event("work");
    let report = MemoryReport::of_runtime(&dock_record(Some(memory.clone()), "ok"));
    assert_eq!(report.status, "ok");
    for index in 0..20 {
        memory.note_verdict(&note(&format!("e-{index}"), &bytes, true, &[]), None);
    }
    idle(&memory);
    let counters = memory.counters();
    assert_eq!(counters.failed, 20);
    assert_eq!(counters.recorded, 0);
    assert_eq!(counters.hot + counters.cold, 0);
    assert!(memory.is_failing());
    let record = dock_record(Some(memory.clone()), "ok");
    let report = MemoryReport::of_runtime(&record);
    assert_eq!(report.status, "failing");
    assert_eq!((report.failed, report.records, report.dropped), (20, 0, 0));
    assert_eq!(report.queue_depth, 0);
    // The store takes writes again: the next record clears the status.
    *gate.1.lock().unwrap() = false;
    memory.note_verdict(&note("e-20", &bytes, true, &[]), None);
    idle(&memory);
    assert!(!memory.is_failing());
    let report = MemoryReport::of_runtime(&record);
    assert_eq!(
        (report.status, report.records, report.failed),
        ("ok", 1, 20)
    );

    // A memory whose writer has ended takes a note without waiting, counts it as
    // failed and reads as failing.
    memory.stop();
    memory.note_verdict(&note("late", &bytes, true, &[]), None);
    assert_eq!(memory.counters().failed, 21);
    assert_eq!(memory.counters().enqueued, 21);
    assert!(memory.is_failing());
    assert_eq!(MemoryReport::of_runtime(&record).status, "failing");
    memory.stop();

    // A node without memory reports the status it started with.
    let report = MemoryReport::of_runtime(&dock_record(None, "off"));
    assert_eq!((report.status, report.records), ("off", 0));
}

#[test]
fn a_memo_that_cannot_be_read_is_a_miss() {
    let memory = VerdictMemory::in_memory().unwrap();
    let bytes = event("work");
    let trace = PureWallTrace {
        family: "writing",
        input: String::from("some text"),
        rows: vec![AdmitWall::open("writing:no_em_dashes")],
        replayed: false,
    };
    memory.note_verdict(&note("e-1", &bytes, true, &[]), Some(trace));
    assert!(memory.replay("writing", "some text").is_some());
    // A thread broke the lock of the memo: every lookup is a miss and the view built
    // on it leaves the rows to be computed.
    let broken = memory.clone();
    let _ = std::thread::spawn(move || {
        let _guard = broken.memo.lock().unwrap();
        panic!("break the memo lock");
    })
    .join();
    assert!(memory.memo.is_poisoned());
    assert!(memory.replay("writing", "some text").is_none());
    let rows = aep_admit::pure_walls(
        &memory.view(),
        "writing",
        "some text",
        |_| true,
        |_| Vec::new(),
    );
    assert!(!rows.replayed);
}

#[test]
fn the_writer_counts_a_shape_as_hot_after_an_accepted_verdict_and_never_after_a_deny() {
    let scratch = tempfile::tempdir().unwrap();
    // A fixed key: the keyed fingerprint of a shape depends on the key, so a random
    // key would move the distance between two near shapes from run to run.
    let key = MemoryKey::from_secret(&[7u8; 32]);
    let memory = VerdictMemory::open(
        &memory_dir(scratch.path()),
        MemoryOptions {
            key,
            ledger: None,
            durable: true,
            accept_store: false,
        },
    )
    .unwrap();
    assert!(memory.is_durable());
    let text = "rename the parser module and update every caller in the workspace today";
    let base = event(text);
    let closed = vec![String::from("writing:no_em_dashes")];
    let hot_cold = |memory: &VerdictMemory| {
        idle(memory);
        let counters = memory.counters();
        (counters.hot, counters.cold)
    };
    // A deny enters the log and forms no attractor.
    memory.note_verdict(&note("e-1", &base, false, &closed), None);
    assert_eq!(hot_cold(&memory), (0, 1));
    assert_eq!(memory.attractors(), 0);
    // The first allow is cold and forms one.
    memory.note_verdict(&note("e-2", &base, true, &[]), None);
    assert_eq!(hot_cold(&memory), (0, 2));
    assert_eq!(memory.attractors(), 1);
    // The same proposal again is hot. The stamp and the sequence number are not part
    // of the shape.
    let later = String::from_utf8(base.clone())
        .unwrap()
        .replace("1000000", "2000000")
        .replace("\"_sequenceNumber\":1", "\"_sequenceNumber\":99");
    assert_ne!(later.as_bytes(), base.as_slice());
    memory.note_verdict(&note("e-3", later.as_bytes(), true, &[]), None);
    assert_eq!(hot_cold(&memory), (1, 2));
    // One changed word is near, so it is hot.
    let near = event("rename the parser module and update every caller in the workspace tomorrow");
    memory.note_verdict(&note("e-4", &near, true, &[]), None);
    assert_eq!(hot_cold(&memory), (2, 2));
    assert_eq!(memory.attractors(), 1);
    // The same proposal of another agent differs in the signer alone, which is near.
    let mut other_agent = note("e-5", &base, true, &[]);
    other_agent.agent_id = "agent-b";
    memory.note_verdict(&other_agent, None);
    assert_eq!(hot_cold(&memory), (3, 2));
    assert_eq!(memory.attractors(), 1);
    // Another port is another domain, and another request is far: both are cold.
    let mut other_port = note("e-6", &base, true, &[]);
    other_port.docking_port = "inference_engine";
    memory.note_verdict(&other_port, None);
    assert_eq!(hot_cold(&memory), (3, 3));
    let unrelated =
        json!({"type": "STATE_DELTA", "action_path": "billing:refund", "delta": [{"op": "add"}]})
            .to_string()
            .into_bytes();
    memory.note_verdict(&note("e-7", &unrelated, true, &[]), None);
    assert_eq!(hot_cold(&memory), (3, 4));
    // Bytes that are no JSON are recorded with the shape of their frame alone.
    memory.note_verdict(&note("e-8", b"not-json", false, &closed), None);
    assert_eq!(hot_cold(&memory), (3, 5));
    assert_eq!(memory.records(), 8);
    memory.stop();

    // The store holds the digest and the fingerprint under the key of the node. A
    // reader who guesses the proposal and computes both without the key finds neither.
    let records = stored(scratch.path());
    assert_eq!(records.len(), 7);
    let guessed = ProposalShape::from_event(
        &serde_json::from_slice::<Value>(&base).unwrap(),
        &FrameContext {
            agent_id: "agent-a",
            docking_port: "validation_engine",
            contract_id: "c-1",
        },
    );
    let plain_digest = guessed.digest();
    let plain_hash = SimHash::of_shape(&guessed).to_bytes();
    for record in &records {
        assert_ne!(record.entry.shape_digest, plain_digest);
        assert_ne!(record.entry.fingerprint, plain_hash);
        assert_eq!(record.entry.body, None);
    }
    // With the key the node finds the shape again: three records carry one digest.
    assert_eq!(records[0].entry.shape_digest, records[1].entry.shape_digest);
    assert_eq!(records[1].entry.shape_digest, records[2].entry.shape_digest);
    assert_ne!(records[2].entry.shape_digest, records[3].entry.shape_digest);
    assert_eq!(
        records[1].entry.shape_digest,
        guessed.keyed_digest(&key.digest)
    );
    // A node without a key file makes one. It is outside the store and only its
    // owner reads it.
    let made = MemoryKey::load_or_create(scratch.path()).unwrap();
    assert_ne!(made, key);
    let key_file = scratch.path().join(KEY_FILE);
    assert_eq!(std::fs::read(&key_file).unwrap().len(), 32);
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&key_file).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o600);
    }
    assert_eq!(MemoryKey::load_or_create(scratch.path()).unwrap(), made);
    std::fs::write(&key_file, b"short").unwrap();
    assert!(MemoryKey::load_or_create(scratch.path()).is_err());
}

#[test]
fn the_memo_replays_only_byte_identical_text() {
    let memory = VerdictMemory::in_memory().unwrap();
    let bytes = event("work");
    let rows = vec![
        AdmitWall::open("writing:no_em_dashes"),
        AdmitWall::close("writing:no_oxford_comma", "Oxford comma"),
    ];
    let trace = PureWallTrace {
        family: "writing",
        input: String::from("red, white, and blue"),
        rows: rows.clone(),
        replayed: false,
    };
    memory.note_verdict(&note("e-1", &bytes, false, &[]), Some(trace));
    assert_eq!(
        memory.replay("writing", "red, white, and blue"),
        Some(rows.clone())
    );
    assert_eq!(memory.replay("writing", "red, white, and blue "), None);
    assert_eq!(memory.replay("writing", "red, white and blue"), None);
    assert_eq!(memory.replay("policy", "red, white, and blue"), None);
    let counters = memory.counters();
    assert_eq!((counters.memo_stored, counters.memo_replayed), (1, 1));
    // Rows that were replayed are not stored a second time.
    let replayed = PureWallTrace {
        family: "writing",
        input: String::from("another text"),
        rows: rows.clone(),
        replayed: true,
    };
    memory.note_verdict(&note("e-2", &bytes, false, &[]), Some(replayed));
    assert_eq!(memory.replay("writing", "another text"), None);
    assert_eq!(memory.counters().memo_stored, 1);
    // The view Admit gets asks the memo for every proposal.
    let view = memory.view();
    let hit = aep_admit::pure_walls(
        &view,
        "writing",
        "red, white, and blue",
        |_| true,
        |_| Vec::new(),
    );
    assert!(hit.replayed);
    assert_eq!(hit.rows, rows);
    assert_eq!(memory.counters().memo_replayed, 2);
    // A second memory starts with an empty memo.
    let other = VerdictMemory::in_memory().unwrap();
    assert_eq!(other.replay("writing", "red, white, and blue"), None);
}

#[test]
fn the_base_node_fills_a_domain_past_2048_attractors_without_a_failed_write() {
    let scratch = tempfile::tempdir().unwrap();
    let db = ledger_db(scratch.path());
    let memory = node_memory(scratch.path(), &db, false).unwrap();
    let closed = vec![
        String::from("gap.agent_permission"),
        String::from("dag.membership"),
    ];
    // 2600 accepted proposals of shapes far from each other and 400 denies.
    for index in 0..3000u64 {
        let accepted = index % 15 >= 2;
        let bytes = event(&far_text(index));
        let entry = format!("frame-{index}");
        let walls: &[String] = if accepted { &[] } else { &closed };
        memory.note_verdict(&note(&entry, &bytes, accepted, walls), None);
        if index % 500 == 499 {
            idle(&memory);
        }
    }
    idle(&memory);
    let counters = memory.counters();
    assert_eq!(counters.enqueued, 3000);
    assert_eq!(counters.recorded, 3000);
    assert_eq!(counters.dropped, 0);
    assert_eq!(counters.failed, 0);
    assert_eq!(memory.records(), 3000);
    // Every accepted shape formed an attractor of its own: the domain is past the
    // size from which the lookup table answers.
    assert_eq!(memory.attractors(), 2600);
    assert_eq!((counters.hot, counters.cold), (0, 3000));
    // A shape from the start of the run is found among the 2600: the hint is hot.
    memory.note_verdict(&note("again", &event(&far_text(7)), true, &[]), None);
    idle(&memory);
    assert_eq!(memory.counters().hot, 1);
    assert_eq!(memory.attractors(), 2600);
    memory.stop();
    // The store on disk holds every verdict, verifies and reads back as recorded.
    let records = stored(scratch.path());
    assert_eq!(records.len(), 3001);
    for (index, record) in records.iter().take(3000).enumerate() {
        assert_eq!(record.entry.entry_id, format!("frame-{index}"));
        assert_eq!(record.entry.accepted, index % 15 >= 2);
        assert_eq!(record.entry.element_id, "agent-a");
        // The record holds digests and labels and never the body of the proposal.
        assert_eq!(record.entry.body, None);
        let labels = record.labels();
        if record.entry.accepted {
            assert_eq!(labels.get("verdict").map(String::as_str), Some("allow"));
            assert_eq!(labels.get("closed"), None);
        } else {
            assert_eq!(labels.get("verdict").map(String::as_str), Some("deny"));
            assert_eq!(
                labels.get("closed").map(String::as_str),
                Some("gap.agent_permission,dag.membership")
            );
        }
    }
    let report = MemoryReport::offline(scratch.path());
    assert_eq!(
        (report.status, report.records, report.attractors),
        ("ok", 3001, 2600)
    );
    let conn = db.lock().unwrap();
    assert_eq!(verify_store(scratch.path(), &conn).unwrap().records, 3001);
    drop(conn);
    // A second start reads the store and goes on where the first one ended.
    let memory = node_memory(scratch.path(), &db, false).unwrap();
    assert_eq!(memory.records(), 3001);
    assert_eq!(memory.attractors(), 2600);
    memory.note_verdict(
        &note("frame-3001", &event(&far_text(2999)), true, &[]),
        None,
    );
    idle(&memory);
    assert_eq!(memory.records(), 3002);
    assert_eq!(memory.counters().hot, 1);
}

/// The heads the ledger of a node holds, as rows.
fn head_rows(db: &Arc<Mutex<Connection>>) -> Vec<(String, i64)> {
    let conn = db.lock().unwrap();
    let mut statement = conn
        .prepare("SELECT domain, records FROM lattice_memory_heads ORDER BY domain")
        .unwrap();
    let rows = statement
        .query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
        .unwrap()
        .map(|row| row.unwrap())
        .collect();
    rows
}

#[test]
fn the_heads_in_the_ledger_find_a_cut_log_at_start_and_nothing_is_cut_off() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path();
    let db = ledger_db(dir);
    let memory = node_memory(dir, &db, false).unwrap();
    let mut sizes = Vec::new();
    let log = memory_dir(dir).join(format!("{DOMAIN}.lmlog"));
    for index in 0..12u64 {
        let bytes = event(&far_text(index));
        memory.note_verdict(&note(&format!("e-{index}"), &bytes, true, &[]), None);
        idle(&memory);
        sizes.push(std::fs::metadata(&log).unwrap().len());
    }
    memory.stop();
    drop(memory);
    assert_eq!(head_rows(&db), vec![(String::from(DOMAIN), 12)]);
    // The store of another caller in the same folder is none of the node's business:
    // it has no head in the ledger and the node does not open it.
    {
        let mut other =
            LogBackend::open(&memory_dir(dir), OpenOptionsLog::new(CoreConfig::default())).unwrap();
        other
            .record(&NewRecord {
                entry_id: String::from("knot-1"),
                domain: String::from("intent"),
                element_id: String::from("INT-1"),
                accepted: true,
                recorded_at_unix: 5,
                shape_digest: [1; 32],
                fingerprint: Fingerprint::SimHash(SimHash([1, 2, 3, 4])),
                labels: BTreeMap::new(),
                body: None,
            })
            .unwrap();
    }
    let memory = node_memory(dir, &db, false).unwrap();
    assert_eq!(memory.records(), 12);
    drop(memory);
    assert_eq!(head_rows(&db), vec![(String::from(DOMAIN), 12)]);
    let conn = db.lock().unwrap();
    assert_eq!(verify_store(dir, &conn).unwrap().records, 13);
    drop(conn);

    // The log is cut at a frame boundary and its snapshot is removed. Nothing in the
    // store tells: the store verifies on its own with ten records in that log.
    let whole = std::fs::read(&log).unwrap();
    let snapshot = memory_dir(dir).join(format!("{DOMAIN}.lmsnap"));
    let kept_snapshot = std::fs::read(&snapshot).unwrap();
    std::fs::write(&log, &whole[..sizes[9] as usize]).unwrap();
    std::fs::remove_file(&snapshot).unwrap();
    let alone = LogBackend::open_read_only(&memory_dir(dir), CoreConfig::default()).unwrap();
    assert_eq!(alone.verify().unwrap().records, 11);
    // The head in the ledger tells. The node does not open the store, the log keeps
    // its bytes and the verification of the node reports the cut.
    let refused = node_memory(dir, &db, false).unwrap_err();
    assert!(
        refused.to_string().contains("holds 10 records"),
        "{refused}"
    );
    assert_eq!(std::fs::read(&log).unwrap(), &whole[..sizes[9] as usize]);
    let conn = db.lock().unwrap();
    let found = verify_store(dir, &conn).unwrap_err();
    assert!(found.contains("holds 10 records"), "{found}");
    drop(conn);
    // On the order of an operator the node takes the store as it is and writes new heads.
    let memory = node_memory(dir, &db, true).unwrap();
    assert_eq!(memory.records(), 10);
    drop(memory);
    assert_eq!(head_rows(&db), vec![(String::from(DOMAIN), 10)]);
    drop(node_memory(dir, &db, false).unwrap());

    // The whole log again: it is ahead of the head of ten, which is no fault.
    std::fs::write(&log, &whole).unwrap();
    std::fs::write(&snapshot, &kept_snapshot).unwrap();
    let memory = node_memory(dir, &db, false).unwrap();
    assert_eq!(memory.records(), 12);
    drop(memory);

    // A head row that was changed is no head this node signed.
    db.lock()
        .unwrap()
        .execute("UPDATE lattice_memory_heads SET records = 11", [])
        .unwrap();
    let refused = node_memory(dir, &db, false).unwrap_err();
    assert!(
        refused.to_string().contains("not a head this node signed"),
        "{refused}"
    );
    let conn = db.lock().unwrap();
    assert!(verify_store(dir, &conn).is_err());
    drop(conn);
    // Neither is a head under another key.
    db.lock()
        .unwrap()
        .execute("UPDATE lattice_memory_heads SET records = 12", [])
        .unwrap();
    drop(node_memory(dir, &db, false).unwrap());
    std::fs::remove_file(dir.join(KEY_FILE)).unwrap();
    let conn = db.lock().unwrap();
    assert!(verify_store(dir, &conn).unwrap_err().contains("key file"));
    drop(conn);
    let refused = node_memory(dir, &db, false).unwrap_err();
    assert!(
        refused.to_string().contains("not a head this node signed"),
        "{refused}"
    );
}

#[test]
fn the_gap_between_the_ledger_and_the_memory_is_counted() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path();
    let db = ledger_db(dir);
    // Rows the ledger held before the memory existed are not part of the gap.
    let allow_row = |db: &Arc<Mutex<Connection>>, digest: &str| {
        db.lock()
            .unwrap()
            .execute(
                "INSERT INTO action_lattice_events
                 (agent_id, channel_id, contract_id, frame_digest, recorded_at_unix, event_type, payload_json, agentmesh_json)
                 VALUES ('agent-a', 'ch-1', 'c-1', ?1, 1, 'docking_validation_engine', '{}', '{}')",
                [digest],
            )
            .unwrap();
    };
    let anomaly = |db: &Arc<Mutex<Connection>>, kind: SideChannelAnomalyKind| {
        let conn = db.lock().unwrap();
        record_side_channel_anomaly(&conn, kind, "agent-a", &DockingPort::ValidationEngine, "x")
            .unwrap();
    };
    allow_row(&db, "before-1");
    allow_row(&db, "before-2");
    let memory = node_memory(dir, &db, false).unwrap();
    assert_eq!(memory.ledger_gap(), Some(0));
    let bytes = event("work");
    // Three allows and two denies, each with its row in the ledger and its note.
    for index in 0..5 {
        let accepted = index < 3;
        if accepted {
            allow_row(&db, &format!("frame-{index}"));
        } else {
            anomaly(&db, SideChannelAnomalyKind::EnvelopeAdmitRejected);
        }
        memory.note_verdict(
            &note(&format!("frame-{index}"), &bytes, accepted, &[]),
            None,
        );
    }
    idle(&memory);
    assert_eq!(memory.ledger_gap(), Some(0));
    // A frame the dock refused before Admit is a row of the ledger and no verdict.
    anomaly(&db, SideChannelAnomalyKind::PlainPingRejected);
    assert_eq!(memory.ledger_gap(), Some(0));
    // Two verdicts whose notes never reached the memory.
    allow_row(&db, "lost-1");
    anomaly(&db, SideChannelAnomalyKind::EnvelopeAdmitRejected);
    assert_eq!(memory.ledger_gap(), Some(2));
    let report = MemoryReport::of_runtime(&crate::dock_parts::DockRecord {
        memory: Some(memory.clone()),
        ..dock_record(None, "ok")
    });
    assert_eq!((report.ledger_gap, report.records), (Some(2), 5));
    // A verdict the ledger could not take a row for is in the memory alone.
    memory.note_verdict(&note("no-row", &bytes, false, &[]), None);
    idle(&memory);
    assert_eq!(memory.ledger_gap(), Some(1));
    // The gap survives a restart: the marks are in the ledger.
    memory.stop();
    drop(memory);
    let memory = node_memory(dir, &db, false).unwrap();
    assert_eq!(memory.records(), 6);
    assert_eq!(memory.ledger_gap(), Some(1));
    allow_row(&db, "lost-2");
    assert_eq!(memory.ledger_gap(), Some(2));
    // A memory without a ledger counts no gap.
    assert_eq!(VerdictMemory::in_memory().unwrap().ledger_gap(), None);
}

#[test]
fn the_closed_label_is_bounded() {
    let many: Vec<String> = (0..80).map(|n| format!("wall.number.{n}")).collect();
    let label = closed_label(&many);
    assert!(label.len() <= 240);
    assert!(label.starts_with("wall.number.0,wall.number.1,"));
    assert!(!label.ends_with(','));
    assert_eq!(closed_label(&[]), "");
    assert_eq!(closed_label(&[String::from("a.b")]), "a.b");
}

#[test]
fn the_report_of_a_node_without_a_store_is_absent_and_makes_nothing() {
    let scratch = tempfile::tempdir().unwrap();
    let report = MemoryReport::offline(scratch.path());
    assert_eq!(report, MemoryReport::absent());
    assert_eq!(report.status, "absent");
    assert_eq!(std::fs::read_dir(scratch.path()).unwrap().count(), 0);
    // With a store the report reads its counts and still changes nothing.
    let stores = tempfile::tempdir().unwrap();
    let memory = VerdictMemory::open(
        &memory_dir(stores.path()),
        MemoryOptions {
            key: MemoryKey::random(),
            ledger: None,
            durable: false,
            accept_store: false,
        },
    )
    .unwrap();
    let bytes = event("work");
    for index in 0..7 {
        memory.note_verdict(&note(&format!("e-{index}"), &bytes, true, &[]), None);
    }
    idle(&memory);
    memory.stop();
    let listing = |dir: &Path| {
        let mut files: Vec<(String, Vec<u8>)> = std::fs::read_dir(dir)
            .unwrap()
            .map(|e| e.unwrap())
            .map(|e| {
                (
                    e.file_name().to_string_lossy().to_string(),
                    std::fs::read(e.path()).unwrap(),
                )
            })
            .collect();
        files.sort();
        files
    };
    let before = listing(&memory_dir(stores.path()));
    let report = MemoryReport::offline(stores.path());
    assert_eq!(
        (report.status, report.records, report.attractors),
        ("ok", 7, 1)
    );
    assert_eq!(report.ledger_gap, None);
    assert_eq!(listing(&memory_dir(stores.path())), before);
    // A store that cannot be read reports an error and no counts.
    let broken = tempfile::tempdir().unwrap();
    std::fs::write(broken.path().join(MEMORY_DIR), b"not a folder").unwrap();
    assert_eq!(MemoryReport::offline(broken.path()).status, "error");
}

#[test]
fn the_earlier_store_is_retired_once_and_the_ledger_keeps_its_rows() {
    let scratch = tempfile::tempdir().unwrap();
    let db = scratch.path().join("aep-action-lattice.db");
    let ledger = crate::open_lattice_db(&db).unwrap();
    let ledger_tables = |conn: &rusqlite::Connection| -> Vec<String> {
        let mut statement = conn
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
            .unwrap();
        let names = statement
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .map(|n| n.unwrap())
            .collect();
        names
    };
    let before = ledger_tables(&ledger);
    // Nothing of the earlier store is there: nothing is removed.
    assert!(!retire_old_store(&ledger, &db));
    ledger
        .execute_batch(
            "CREATE TABLE lattice_memory_meta (key INTEGER PRIMARY KEY, entry_id TEXT);
             INSERT INTO lattice_memory_meta (entry_id) VALUES ('selftest-1-abcd');",
        )
        .unwrap();
    let index_file = scratch.path().join("aep-action-lattice.db.usearch");
    std::fs::write(&index_file, b"old index").unwrap();
    assert!(retire_old_store(&ledger, &db));
    assert!(!index_file.exists());
    assert_eq!(ledger_tables(&ledger), before);
    assert!(db.is_file());
    assert!(!retire_old_store(&ledger, &db));
}

#[test]
fn the_self_test_writes_no_record_to_any_store() {
    let scratch = tempfile::tempdir().unwrap();
    let before = std::env::current_dir().unwrap();
    assert_eq!(self_test().unwrap(), 1);
    assert_eq!(std::fs::read_dir(scratch.path()).unwrap().count(), 0);
    assert_eq!(std::env::current_dir().unwrap(), before);
}
