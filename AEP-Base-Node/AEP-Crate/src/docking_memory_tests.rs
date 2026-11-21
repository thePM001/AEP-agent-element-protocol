//! The dock and Lattice Memory: every Admit verdict is recorded after it is written
//! and a node without memory answers the same.

use super::*;
use crate::docking_fixtures::*;
use crate::lattice_memory::{memory_dir, MEMORY_DIR};
use aep_lattice_memory::{CoreConfig, LogBackend, MemoryBackend, StoredRecord};
use std::time::Duration;

const PORT: DockingPort = DockingPort::ValidationEngine;

/// Send one payload of an agent through the dock and the pulse.
fn send(rt: &DockingRuntime, agent: &str, payload: &[u8]) -> (DockFrameResponse, String) {
    install_agent_manifest(rt, agent, "sess-1");
    let (frame, line) = build_test_frame(
        rt,
        "ch-memory",
        agent,
        "sess-1",
        PORT,
        "dynaep-action-lattice",
        payload,
        1,
    );
    let digest = frame_digest(&frame).expect("digest");
    (through_pulse(rt, &PORT, &line), digest)
}

fn payload(note: &str, seq: i64) -> Vec<u8> {
    serde_json::json!({
        "type": "PING",
        "action_path": "root:ping",
        "payload": {"ok": true},
        // The note is outside the payload. The entry check of the dock reads the
        // payload alone, so a writing violation here is judged by the walls of Admit.
        "note": note,
        "timestamp": 1_000_000,
        "target_id": "scene-a",
        "_sequenceNumber": seq,
    })
    .to_string()
    .into_bytes()
}

fn stored(dir: &std::path::Path) -> Vec<StoredRecord> {
    let mut store =
        LogBackend::open_read_only(&memory_dir(dir), CoreConfig::default()).expect("store");
    store.open_all().expect("domains");
    store.verify().expect("verify");
    store.export(None, usize::MAX).expect("export")
}

#[test]
fn the_dock_records_every_admit_verdict_after_it_is_written() {
    let (dir, rt) = temp_runtime();
    let memory = rt
        .record
        .memory
        .clone()
        .expect("a node starts with its memory");
    assert_eq!(rt.record.memory_status, "ok");
    assert!(dir.path().join(MEMORY_DIR).is_dir());

    // An allow, a deny by a writing wall and two denies before the walls compile.
    let (allow, allow_digest) = send(&rt, "AG-DOCK", &payload("read the build log", 1));
    assert!(allow.ok, "{:?}", allow.error);
    let (deny, deny_digest) = send(&rt, "AG-DOCK", &payload("red, white, and blue", 2));
    assert!(!deny.ok);
    let (not_json, not_json_digest) = send(&rt, "AG-NJ", b"not-json");
    assert!(!not_json.ok);
    let (no_path, no_path_digest) = send(&rt, "AG-PING", br#"{"type":"PING"}"#);
    assert!(!no_path.ok);

    assert!(memory.wait_idle(Duration::from_secs(30)));
    let counters = memory.counters();
    assert_eq!(counters.enqueued, 4);
    assert_eq!(counters.recorded, 4);
    assert_eq!(counters.dropped + counters.failed, 0);

    let records = stored(dir.path());
    assert_eq!(records.len(), 4);
    let by_id = |id: &str| {
        records
            .iter()
            .find(|r| r.entry.entry_id == id)
            .unwrap_or_else(|| panic!("no record of frame {id}"))
    };
    // The id of a record is the digest of its frame and its element is the signer.
    let allowed = by_id(&allow_digest);
    assert!(allowed.entry.accepted);
    assert_eq!(allowed.domain, "admit.validation_engine");
    assert_eq!(allowed.entry.element_id, "AG-DOCK");
    assert_eq!(
        allowed.labels().get("verdict").map(String::as_str),
        Some("allow")
    );
    assert_eq!(allowed.entry.body, None);
    assert!(allowed.entry.outcome.attractor().is_some());
    // The verdict was written to the ledger before the memory heard of it.
    let events: i64 = {
        let db = rt.record.db.lock().expect("db");
        db.query_row(
            "SELECT COUNT(*) FROM action_lattice_events WHERE frame_digest = ?1",
            [&allow_digest],
            |row| row.get(0),
        )
        .expect("ledger row")
    };
    assert_eq!(events, 1);

    let denied = by_id(&deny_digest);
    assert!(!denied.entry.accepted);
    assert_eq!(denied.entry.outcome.attractor(), None);
    let labels = denied.labels();
    assert_eq!(labels.get("verdict").map(String::as_str), Some("deny"));
    assert!(labels
        .get("closed")
        .is_some_and(|closed| closed.contains("writing:no_oxford_comma")));
    for (digest, agent) in [(&not_json_digest, "AG-NJ"), (&no_path_digest, "AG-PING")] {
        let record = by_id(digest);
        assert!(!record.entry.accepted);
        assert_eq!(record.entry.element_id, agent);
    }
    // No record holds text of a proposal.
    for record in &records {
        assert!(!record.entry.labels.contains("build log"));
        assert!(!record.entry.labels.contains("white"));
    }
    // Only the allow formed an attractor.
    assert_eq!(memory.attractors(), 1);
    assert_eq!(memory.records(), 4);
}

#[test]
fn a_repeated_proposal_takes_the_hot_route_and_gets_the_same_verdict() {
    let (_dir, rt) = temp_runtime();
    let memory = rt.record.memory.clone().expect("memory");
    let mut answers = Vec::new();
    for seq in 1..=6 {
        let note = if seq % 2 == 0 {
            "red, white, and blue"
        } else {
            "read the build log"
        };
        let (answer, _) = send(&rt, "AG-DOCK", &payload(note, seq));
        answers.push((answer.ok, answer.deny.map(|d| d.closed)));
        assert!(memory.wait_idle(Duration::from_secs(30)));
    }
    // The same text gives the same verdict every time, hot or cold.
    assert!(answers[0].0 && answers[2].0 && answers[4].0);
    assert!(!answers[1].0 && !answers[3].0 && !answers[5].0);
    assert_eq!(answers[1], answers[3]);
    assert_eq!(answers[3], answers[5]);
    let counters = memory.counters();
    assert_eq!(counters.recorded, 6);
    // The first allow was cold. The later ones found its attractor.
    assert!(counters.hot >= 2, "{counters:?}");
    assert!(counters.memo_replayed >= 2, "{counters:?}");
}

#[test]
fn a_node_without_memory_answers_the_same() {
    let (_with_dir, with) = temp_runtime();
    let (without_dir, mut without) = temp_runtime();
    without.record.memory = None;
    without.record.memory_status = "off";
    let payloads: Vec<Vec<u8>> = vec![
        payload("read the build log", 1),
        payload("red, white, and blue", 2),
        payload("read the build log", 3),
        payload("read the build log", 3),
        b"not-json".to_vec(),
        br#"{"type":"PING"}"#.to_vec(),
        payload("first -- second", 4),
        payload("read the build log", 5),
    ];
    for (index, bytes) in payloads.iter().enumerate() {
        let (a, _) = send(&with, "AG-DOCK", bytes);
        let (b, _) = send(&without, "AG-DOCK", bytes);
        if let Some(memory) = with.record.memory.as_deref() {
            assert!(memory.wait_idle(Duration::from_secs(30)));
        }
        // The two nodes hold different keys, so digests and event ids differ. The
        // verdict, the error text and the deny report must not.
        assert_eq!(a.ok, b.ok, "payload {index}");
        assert_eq!(a.error.is_some(), b.error.is_some(), "payload {index}");
        assert_eq!(a.deny, b.deny, "payload {index}");
        assert_eq!(
            a.event_id.is_some(),
            b.event_id.is_some(),
            "payload {index}"
        );
    }
    // The node without memory wrote no record.
    assert!(stored(without_dir.path()).is_empty());
    let report = crate::lattice_memory::MemoryReport::of_runtime(&without.record);
    assert_eq!((report.status, report.records), ("off", 0));
    let report = crate::lattice_memory::MemoryReport::of_runtime(&with.record);
    assert_eq!(
        (report.status, report.records, report.dropped),
        ("ok", 8, 0)
    );
}

#[test]
fn a_node_whose_memory_cannot_open_runs_on_the_cold_path() {
    let dir = tempfile::tempdir().expect("tempdir");
    plant_lattice(dir.path());
    // A file stands where the folder of the memory belongs.
    std::fs::write(dir.path().join(MEMORY_DIR), b"in the way").expect("file");
    let (dir, rt) = runtime_in(dir);
    assert!(rt.record.memory.is_none());
    assert_eq!(rt.record.memory_status, "error");
    assert!(rt.record.memory_error.is_some());
    let (allow, _) = send(&rt, "AG-DOCK", &payload("read the build log", 1));
    assert!(allow.ok, "{:?}", allow.error);
    let (deny, _) = send(&rt, "AG-DOCK", &payload("red, white, and blue", 2));
    assert!(!deny.ok);
    assert_eq!(
        std::fs::read(dir.path().join(MEMORY_DIR)).expect("file"),
        b"in the way"
    );
    let report = crate::lattice_memory::MemoryReport::of_runtime(&rt.record);
    assert_eq!(report.status, "error");
}

#[test]
fn the_drain_writes_what_the_queue_holds() {
    let (dir, rt) = temp_runtime();
    for seq in 1..=5 {
        let (answer, _) = send(&rt, "AG-DOCK", &payload("read the build log", seq));
        assert!(answer.ok, "{:?}", answer.error);
    }
    let memory = rt.record.memory.clone().expect("memory");
    memory.stop();
    assert_eq!(memory.counters().recorded, 5);
    assert_eq!(stored(dir.path()).len(), 5);
    // A verdict after the stop is judged as before and counted as not recorded.
    let (answer, _) = send(&rt, "AG-DOCK", &payload("read the build log", 6));
    assert!(answer.ok, "{:?}", answer.error);
    assert_eq!(memory.counters().failed, 1);
}
