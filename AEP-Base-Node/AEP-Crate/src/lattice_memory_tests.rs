//! Tests of Lattice Memory in the Base Node.

use super::*;
use aep_lattice_memory::{Counts, HintReader, Match, Receipt, StoredRecord, VerifyReport};
use serde_json::json;
use std::sync::Condvar;

fn lattice() -> LiveEntry {
    LiveEntry::from_yaml(
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n",
    )
    .expect("lattice")
}

fn digests() -> MemoryDigests {
    MemoryDigests::of(&lattice())
}

fn event(note: &str) -> Value {
    json!({
        "type": "PING",
        "action_path": "root:ping",
        "timestamp": 1_000_000,
        "_sequenceNumber": 1,
        "payload": {"note": note, "files": ["a.rs", "b.rs", "c.rs"], "mode": "write", "n": 3},
    })
}

fn note_of<'a>(entry_id: &'a str, accepted: bool, closed: &'a [String]) -> VerdictNote<'a> {
    VerdictNote {
        entry_id,
        agent_id: "agent-a",
        accepted,
        at_unix: 1_795_000_000,
        closed,
    }
}

fn idle(memory: &VerdictMemory) {
    assert!(memory.wait_idle(Duration::from_secs(30)));
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

    fn history(
        &self,
        domain: &str,
        element_id: &str,
        accepted: Option<bool>,
        limit: usize,
    ) -> Result<Vec<StoredRecord>, MemoryError> {
        self.inner.history(domain, element_id, accepted, limit)
    }

    fn export(&self, domain: Option<&str>, limit: usize) -> Result<Vec<StoredRecord>, MemoryError> {
        self.inner.export(domain, limit)
    }

    fn counts(&self) -> Result<Counts, MemoryError> {
        self.inner.counts()
    }

    fn verify(&self) -> Result<VerifyReport, MemoryError> {
        self.inner.verify()
    }

    fn reader(&self) -> HintReader {
        self.inner.reader()
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
    let memory = VerdictMemory::start(Box::new(backend), digests(), queue).unwrap();
    (memory, (hold, refuse))
}

fn release(gate: &Gate) {
    let (lock, wake) = &*gate.0;
    *lock.lock().unwrap() = false;
    wake.notify_all();
}

#[test]
fn a_full_queue_drops_and_counts_and_never_blocks_a_verdict() {
    // The writer is held, so nothing leaves the queue of four.
    let (memory, gate) = gated(4, true, false);
    let started = Instant::now();
    for index in 0..500 {
        let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
        memory.note_verdict(probe, &note_of(&format!("e-{index}"), true, &[]), None);
    }
    // 500 verdicts went by while the memory wrote nothing at all.
    assert!(started.elapsed() < Duration::from_secs(5));
    let counters = memory.counters();
    // Four notes wait in the queue and one is in the hand of the writer.
    assert!(
        counters.enqueued >= 4 && counters.enqueued <= 5,
        "{counters:?}"
    );
    assert_eq!(counters.enqueued + counters.dropped, 500);
    assert_eq!(counters.recorded, 0);
    assert_eq!(counters.failed, 0);
    // Once the writer runs again it writes what the queue held and nothing more.
    release(&gate);
    idle(&memory);
    let counters = memory.counters();
    assert_eq!(counters.recorded, counters.enqueued);
    assert_eq!(memory.records(), counters.enqueued);
}

#[test]
fn memory_failure_falls_back_to_cold() {
    // A store that refuses every write.
    let (memory, _gate) = gated(64, false, true);
    for index in 0..20 {
        let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
        // Nothing was ever recorded, so every hint is cold.
        assert_eq!(probe.route, RouteHint::Cold);
        memory.note_verdict(probe, &note_of(&format!("e-{index}"), true, &[]), None);
    }
    idle(&memory);
    let counters = memory.counters();
    assert_eq!(counters.failed, 20);
    assert_eq!(counters.recorded, 0);
    assert_eq!(counters.cold, 20);
    assert_eq!(counters.hot, 0);

    // A memory whose writer has ended takes a note without waiting and counts it.
    let memory = VerdictMemory::in_memory(digests()).unwrap();
    memory.stop();
    let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
    memory.note_verdict(probe, &note_of("late", true, &[]), None);
    assert_eq!(memory.counters().failed, 1);
    assert_eq!(memory.counters().enqueued, 0);
    memory.stop();

    // A memo whose lock a thread broke answers every lookup with a miss, and the
    // view built on it leaves the rows to be computed.
    let memory = VerdictMemory::in_memory(digests()).unwrap();
    let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
    let trace = PureWallTrace {
        family: "writing",
        input: String::from("some text"),
        rows: vec![AdmitWall::open("writing:no_em_dashes")],
        replayed: false,
    };
    memory.note_verdict(probe, &note_of("e-1", true, &[]), Some(trace));
    assert!(memory.replay("writing", "some text").is_some());
    let broken = memory.clone();
    let _ = std::thread::spawn(move || {
        let _guard = broken.memo.lock().unwrap();
        panic!("break the memo lock");
    })
    .join();
    assert!(memory.memo.is_poisoned());
    assert!(memory.replay("writing", "some text").is_none());
    let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
    let view = memory.view(&probe);
    let rows = aep_admit::pure_walls(&view, "writing", "some text", |_| true, |_| Vec::new());
    assert!(!rows.replayed);
}

#[test]
fn the_hint_turns_hot_after_an_accepted_verdict_and_never_after_a_deny() {
    let memory = VerdictMemory::in_memory(digests()).unwrap();
    let text = "rename the parser module and update every caller in the workspace today";
    let probe = memory.probe(&event(text), "agent-a", "validation_engine", "c-1");
    assert_eq!(probe.route, RouteHint::Cold);
    assert_eq!(probe.domain, "admit.validation_engine");
    // A deny enters the log and forms no attractor.
    let closed = vec![String::from("writing:no_em_dashes")];
    memory.note_verdict(probe, &note_of("e-1", false, &closed), None);
    idle(&memory);
    assert_eq!(memory.attractors(), 0);
    let probe = memory.probe(&event(text), "agent-a", "validation_engine", "c-1");
    assert_eq!(probe.route, RouteHint::Cold);
    // An allow forms one.
    memory.note_verdict(probe, &note_of("e-2", true, &[]), None);
    idle(&memory);
    assert_eq!(memory.attractors(), 1);
    assert_eq!(memory.records(), 2);
    let again = memory.probe(&event(text), "agent-a", "validation_engine", "c-1");
    assert_eq!(again.route, RouteHint::Hot);
    // The stamp and the sequence number are not part of the shape.
    let mut later = event(text);
    later["timestamp"] = json!(2_000_000);
    later["_sequenceNumber"] = json!(99);
    let later = memory.probe(&later, "agent-a", "validation_engine", "c-1");
    assert_eq!(later.route, RouteHint::Hot);
    assert_eq!(later.shape_digest, again.shape_digest);
    // One changed word is near, so the hint is hot and the digest differs.
    let near = memory.probe(
        &event("rename the parser module and update every caller in the workspace tomorrow"),
        "agent-a",
        "validation_engine",
        "c-1",
    );
    assert_eq!(near.route, RouteHint::Hot);
    assert_ne!(near.shape_digest, again.shape_digest);
    // Another agent, another port and another request are cold.
    let other_agent = memory.probe(&event(text), "agent-b", "validation_engine", "c-1");
    assert_ne!(other_agent.shape_digest, again.shape_digest);
    let other_port = memory.probe(&event(text), "agent-a", "inference_engine", "c-1");
    assert_eq!(other_port.route, RouteHint::Cold);
    let unrelated = memory.probe(
        &json!({"type": "STATE_DELTA", "action_path": "billing:refund", "delta": [{"op": "add"}]}),
        "agent-a",
        "validation_engine",
        "c-1",
    );
    assert_eq!(unrelated.route, RouteHint::Cold);
    let counters = memory.counters();
    assert_eq!(counters.hot + counters.cold, 8);
}

#[test]
fn the_memo_replays_only_byte_identical_text_under_the_same_digests() {
    let memory = VerdictMemory::in_memory(digests()).unwrap();
    let rows = vec![
        AdmitWall::open("writing:no_em_dashes"),
        AdmitWall::close("writing:no_oxford_comma", "Oxford comma"),
    ];
    let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
    let trace = PureWallTrace {
        family: "writing",
        input: String::from("red, white, and blue"),
        rows: rows.clone(),
        replayed: false,
    };
    memory.note_verdict(probe, &note_of("e-1", false, &[]), Some(trace));
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
    let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
    let replayed = PureWallTrace {
        family: "writing",
        input: String::from("another text"),
        rows: rows.clone(),
        replayed: true,
    };
    memory.note_verdict(probe, &note_of("e-2", false, &[]), Some(replayed));
    assert_eq!(memory.replay("writing", "another text"), None);
    // Another lattice or another wall set gives another key for the same text.
    let key = memory.memo_key("writing", "red, white, and blue");
    let mut other = digests();
    other.lattice[0] ^= 1;
    let other_lattice = VerdictMemory::in_memory(other).unwrap();
    assert_ne!(
        other_lattice.memo_key("writing", "red, white, and blue"),
        key
    );
    let mut other = digests();
    other.wall_set[31] ^= 1;
    let other_walls = VerdictMemory::in_memory(other).unwrap();
    assert_ne!(other_walls.memo_key("writing", "red, white, and blue"), key);
}

#[test]
fn the_digests_follow_the_lattice_and_the_wall_set() {
    let base = compiled_lattice_digest(&lattice());
    assert_eq!(base, compiled_lattice_digest(&lattice()));
    let mut changed = lattice();
    if let Some(node) = changed.snapshot.lattice_nodes.get_mut("root:ping") {
        node.agent_permission = vec![String::from("agent-a")];
    }
    assert_ne!(compiled_lattice_digest(&changed), base);
    let mut changed = lattice();
    changed.snapshot.max_drift_ms += 1;
    assert_ne!(compiled_lattice_digest(&changed), base);
    // What a proposal changes while the node runs is not part of the compiled lattice.
    let mut running = lattice();
    running
        .snapshot
        .satisfied_actions
        .insert(String::from("root:ping"));
    running.snapshot.event_rate = 7;
    assert_eq!(compiled_lattice_digest(&running), base);
    assert_eq!(wall_set_digest(), wall_set_digest());
    assert_ne!(wall_set_digest(), base);
}

#[test]
fn the_base_node_records_every_verdict_past_2000_without_a_failed_write() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = memory_dir(scratch.path());
    let memory = VerdictMemory::open(&dir, digests()).unwrap();
    let closed = vec![
        String::from("gap.agent_permission"),
        String::from("dag.membership"),
    ];
    for index in 0..2600u64 {
        let text = format!("work item {} of the release train", index % 700);
        let probe = memory.probe(&event(&text), "agent-a", "validation_engine", "c-1");
        let accepted = index % 4 != 0;
        let entry = format!("frame-{index}");
        let walls: &[String] = if accepted { &[] } else { &closed };
        memory.note_verdict(probe, &note_of(&entry, accepted, walls), None);
        if index % 500 == 499 {
            idle(&memory);
        }
    }
    idle(&memory);
    let counters = memory.counters();
    assert_eq!(counters.enqueued, 2600);
    assert_eq!(counters.recorded, 2600);
    assert_eq!(counters.dropped, 0);
    assert_eq!(counters.failed, 0);
    assert_eq!(memory.records(), 2600);
    assert!(memory.attractors() > 0);
    memory.stop();
    // The store on disk holds every verdict, verifies and reads back as recorded.
    let health = offline_health(scratch.path()).unwrap();
    assert!(health.present);
    assert_eq!(health.records, 2600);
    assert_eq!(health.attractors, memory.attractors());
    let mut store = LogBackend::open_read_only(&dir, CoreConfig::default()).unwrap();
    store.open_all().unwrap();
    assert_eq!(store.verify().unwrap().records, 2600);
    let records = store
        .export(Some("admit.validation_engine"), usize::MAX)
        .unwrap();
    assert_eq!(records.len(), 2600);
    for (index, record) in records.iter().enumerate() {
        assert_eq!(record.entry.entry_id, format!("frame-{index}"));
        assert_eq!(record.entry.accepted, index % 4 != 0);
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
    // A second start reads the store and goes on where the first one ended.
    let memory = VerdictMemory::open(&dir, digests()).unwrap();
    assert_eq!(memory.records(), 2600);
    let probe = memory.probe(
        &event("work item 3 of the release train"),
        "agent-a",
        "validation_engine",
        "c-1",
    );
    assert_eq!(probe.route, RouteHint::Hot);
    memory.note_verdict(probe, &note_of("frame-2600", true, &[]), None);
    idle(&memory);
    assert_eq!(memory.records(), 2601);
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
    let memory = VerdictMemory::open(&memory_dir(scratch.path()), digests()).unwrap();
    for index in 0..7 {
        let probe = memory.probe(&event("work"), "agent-a", "validation_engine", "c-1");
        memory.note_verdict(probe, &note_of(&format!("e-{index}"), true, &[]), None);
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
    let before = listing(&memory_dir(scratch.path()));
    let report = MemoryReport::offline(scratch.path());
    assert_eq!(
        (report.status, report.records, report.attractors),
        ("ok", 7, 1)
    );
    assert_eq!(listing(&memory_dir(scratch.path())), before);
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
