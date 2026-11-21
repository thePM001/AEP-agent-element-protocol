//! Tests of the log file backend.

use super::*;
use crate::model::is_judged_domain;
use aep_lattice_memory_core::{CoreError, Plan, QuantizedEmbedding, SimHash};
use std::collections::BTreeMap;
use std::io::Write;

const DOMAIN: &str = "admit.validation_engine";

/// A hash far from the hash of every other seed.
fn far(seed: u64) -> SimHash {
    let mut x = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
    let mut words = [0u64; 4];
    for word in words.iter_mut() {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        *word = x;
    }
    SimHash(words)
}

fn digest(seed: u64) -> [u8; 32] {
    let mut out = [0u8; 32];
    out[..8].copy_from_slice(&seed.to_le_bytes());
    out
}

fn record_in(domain: &str, serial: u64, seed: u64, accepted: bool) -> NewRecord {
    NewRecord {
        entry_id: format!("e-{serial}"),
        domain: domain.to_string(),
        element_id: format!("agent-{}", seed % 3),
        accepted,
        recorded_at_unix: 1_795_000_000 + serial as i64,
        shape_digest: digest(seed),
        fingerprint: Fingerprint::SimHash(far(seed)),
        labels: BTreeMap::new(),
        body: None,
    }
}

fn record(serial: u64, seed: u64, accepted: bool) -> NewRecord {
    record_in(DOMAIN, serial, seed, accepted)
}

fn options(capacity: usize) -> OpenOptionsLog {
    OpenOptionsLog::new(CoreConfig {
        capacity_per_domain: capacity,
        ..CoreConfig::default()
    })
}

fn open(dir: &Path) -> LogBackend {
    LogBackend::open(dir, options(1000)).unwrap()
}

fn attractors(backend: &LogBackend, domain: &str) -> Vec<Attractor> {
    let core = backend.core.read().unwrap();
    core.domain(domain)
        .map(|i| i.attractors())
        .unwrap_or_default()
}

/// Every file of a folder with its bytes, in name order.
fn folder(dir: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries {
            let entry = entry.unwrap();
            let name = entry.file_name().to_string_lossy().to_string();
            files.push((name, std::fs::read(entry.path()).unwrap()));
        }
    }
    files.sort();
    files
}

fn modified(dir: &Path) -> Vec<(String, std::time::SystemTime)> {
    let mut files = Vec::new();
    for entry in std::fs::read_dir(dir).unwrap() {
        let entry = entry.unwrap();
        files.push((
            entry.file_name().to_string_lossy().to_string(),
            entry.metadata().unwrap().modified().unwrap(),
        ));
    }
    files.sort();
    files
}

#[test]
fn a_record_is_one_frame_and_its_key_is_its_place() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    let first = backend.record(&record(1, 1, true)).unwrap();
    assert_eq!(first.key, 1);
    assert_eq!(first.plan, Plan::Form { evict: None });
    assert_eq!(first.attractor_key, Some(1));
    let second = backend.record(&record(2, 1, true)).unwrap();
    assert_eq!(second.key, 2);
    assert!(matches!(
        second.plan,
        Plan::Reinforce {
            key: 1,
            exact: true,
            ..
        }
    ));
    let third = backend.record(&record(3, 2, false)).unwrap();
    assert_eq!(third.plan, Plan::LogOnly);
    assert_eq!(third.attractor_key, None);
    let counts = backend.counts().unwrap();
    assert_eq!((counts.records, counts.attractors), (3, 1));
    // Another domain has a log and keys of its own.
    let other = backend.record(&record_in("intent", 4, 9, true)).unwrap();
    assert_eq!(other.key, 1);
    assert!(dir.join("intent.lmlog").is_file());
    assert!(dir.join("admit.validation_engine.lmlog").is_file());
    assert!(dir.join(META_FILE).is_file());
    let report = backend.verify().unwrap();
    assert_eq!(report.records, 4);
    assert_eq!(report.domains.len(), 2);
}

#[test]
fn record_is_atomic_under_injected_failure() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    for serial in 1..=5 {
        backend.record(&record(serial, serial, true)).unwrap();
    }
    let before_attractors = attractors(&backend, DOMAIN);
    let before_counts = backend.counts().unwrap();

    // A failure before the write leaves the log as it was.
    backend.fail_at = Some(FailPoint::BeforeWrite);
    assert!(matches!(
        backend.record(&record(6, 6, true)),
        Err(MemoryError::Injected(_))
    ));
    assert_eq!(backend.counts().unwrap(), before_counts);
    assert_eq!(attractors(&backend, DOMAIN), before_attractors);

    // A failure in the middle of the frame leaves half a frame at the end of the log.
    // The attractors did not move and the store still verifies.
    backend.fail_at = Some(FailPoint::MidFrame);
    assert!(matches!(
        backend.record(&record(6, 6, true)),
        Err(MemoryError::Injected(_))
    ));
    assert_eq!(backend.counts().unwrap(), before_counts);
    assert_eq!(attractors(&backend, DOMAIN), before_attractors);
    backend.verify().unwrap();
    let health = LogBackend::health(&dir).unwrap();
    assert_eq!((health.records, health.attractors), (5, 5));
    // A second process that opens the store now reads five whole records.
    let reader = {
        let mut reader = LogBackend::open_read_only(&dir, CoreConfig::default()).unwrap();
        reader.open_all().unwrap();
        reader
    };
    assert_eq!(reader.counts().unwrap().records, 5);
    reader.verify().unwrap();
    drop(reader);

    // The next write cuts the half frame off and takes its place.
    backend.fail_at = None;
    let receipt = backend.record(&record(6, 6, true)).unwrap();
    assert_eq!(receipt.key, 6);
    assert_eq!(backend.counts().unwrap().records, 6);
    backend.verify().unwrap();
    drop(backend);
    let reopened = {
        let mut reopened = open(&dir);
        reopened.open_all().unwrap();
        reopened
    };
    assert_eq!(reopened.counts().unwrap().records, 6);
    assert_eq!(reopened.verify().unwrap().records, 6);
}

#[test]
fn a_crash_at_any_byte_of_a_write_leaves_the_records_before_it() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    for serial in 1..=4 {
        backend.record(&record(serial, serial, true)).unwrap();
    }
    let log = dir.join(format!("{DOMAIN}{LOG_SUFFIX}"));
    let before = std::fs::metadata(&log).unwrap().len();
    backend.record(&record(5, 5, true)).unwrap();
    let whole = std::fs::read(&log).unwrap();
    drop(backend);
    let snapshot = dir.join(format!("{DOMAIN}{SNAPSHOT_SUFFIX}"));
    // Cut the last frame at every byte, as a crash at that byte of the write leaves it.
    for cut in before..whole.len() as u64 {
        std::fs::write(&log, &whole[..cut as usize]).unwrap();
        // The snapshot of the whole log names an end past the cut and is ignored.
        let mut reopened = open(&dir);
        reopened.open_all().unwrap();
        assert_eq!(reopened.counts().unwrap().records, 4, "cut at byte {cut}");
        assert_eq!(reopened.verify().unwrap().records, 4);
        assert_eq!(std::fs::metadata(&log).unwrap().len(), before);
        let receipt = reopened.record(&record(5, 5, true)).unwrap();
        assert_eq!(receipt.key, 5);
        drop(reopened);
        assert_eq!(std::fs::read(&log).unwrap(), whole, "cut at byte {cut}");
        let _ = std::fs::remove_file(&snapshot);
    }
    // A tail of zero bytes, as a loss of power can leave it, is cut off too.
    let mut zeros = whole[..before as usize].to_vec();
    zeros.extend_from_slice(&[0u8; 300]);
    std::fs::write(&log, &zeros).unwrap();
    let mut reopened = open(&dir);
    reopened.open_all().unwrap();
    assert_eq!(reopened.counts().unwrap().records, 4);
    assert_eq!(std::fs::metadata(&log).unwrap().len(), before);
}

#[test]
fn hash_chain_verifies() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    let mut hashes = Vec::new();
    for serial in 1..=20 {
        hashes.push(
            backend
                .record(&record(serial, serial % 7, serial % 4 != 0))
                .unwrap()
                .hash,
        );
    }
    let report = backend.verify().unwrap();
    assert_eq!(report.records, 20);
    assert_eq!(report.domains[0].head_hash, hashes[19]);
    let records = backend.export(Some(DOMAIN), usize::MAX).unwrap();
    assert_eq!(records.len(), 20);
    assert_eq!(
        records[0].entry.prev_hash,
        aep_lattice_memory_core::genesis_hash()
    );
    for (index, stored) in records.iter().enumerate() {
        assert_eq!(stored.hash, hashes[index]);
        assert_eq!(stored.entry.hash(DOMAIN), stored.hash);
        if index > 0 {
            assert_eq!(stored.entry.prev_hash, hashes[index - 1]);
        }
    }
}

/// A store of twelve records, closed, with the bytes of its log and the offsets of its frames.
fn closed_store(dir: &Path) -> (PathBuf, Vec<u8>, Vec<usize>) {
    let mut backend = open(dir);
    let log = dir.join(format!("{DOMAIN}{LOG_SUFFIX}"));
    let mut offsets = vec![HEADER_BYTES as usize];
    for serial in 1..=12 {
        backend.record(&record(serial, serial, true)).unwrap();
        offsets.push(std::fs::metadata(&log).unwrap().len() as usize);
    }
    drop(backend);
    let _ = std::fs::remove_file(dir.join(format!("{DOMAIN}{SNAPSHOT_SUFFIX}")));
    let bytes = std::fs::read(&log).unwrap();
    (log, bytes, offsets)
}

fn open_fails_as_corrupt(dir: &Path) {
    let mut writer = open(dir);
    assert!(
        matches!(writer.open_all(), Err(MemoryError::Corrupt(_))),
        "writer"
    );
    let mut reader = LogBackend::open_read_only(dir, CoreConfig::default()).unwrap();
    assert!(
        matches!(reader.open_all(), Err(MemoryError::Corrupt(_))),
        "reader"
    );
    let reader = LogBackend::open_read_only(dir, CoreConfig::default()).unwrap();
    assert!(
        matches!(reader.verify(), Err(MemoryError::Corrupt(_))),
        "verify"
    );
}

#[test]
fn a_changed_record_is_found_and_never_cut_off() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let (log, bytes, offsets) = closed_store(&dir);
    // One changed byte in the middle of the log, in each part of a frame.
    for at in [
        offsets[4] + 2,
        offsets[4] + 20,
        offsets[5] - 10,
        offsets[5] - 2,
    ] {
        let mut changed = bytes.clone();
        changed[at] ^= 0x40;
        std::fs::write(&log, &changed).unwrap();
        open_fails_as_corrupt(&dir);
        // The log is as the change left it: nothing was cut off.
        assert_eq!(std::fs::read(&log).unwrap(), changed, "byte {at}");
    }
}

#[test]
fn a_removed_or_moved_record_is_found() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let (log, bytes, offsets) = closed_store(&dir);
    // Frame 5 removed.
    let mut removed = bytes[..offsets[4]].to_vec();
    removed.extend_from_slice(&bytes[offsets[5]..]);
    std::fs::write(&log, &removed).unwrap();
    open_fails_as_corrupt(&dir);
    // Frames 5 and 6 in each other's place.
    let mut swapped = bytes[..offsets[4]].to_vec();
    swapped.extend_from_slice(&bytes[offsets[5]..offsets[6]]);
    swapped.extend_from_slice(&bytes[offsets[4]..offsets[5]]);
    swapped.extend_from_slice(&bytes[offsets[6]..]);
    std::fs::write(&log, &swapped).unwrap();
    open_fails_as_corrupt(&dir);
    // The log of one domain under the name of another.
    std::fs::write(&log, &bytes).unwrap();
    std::fs::copy(&log, dir.join(format!("intent{LOG_SUFFIX}"))).unwrap();
    let reader = LogBackend::open_read_only(&dir, CoreConfig::default()).unwrap();
    assert!(reader.verify().is_err());
}

#[test]
fn the_log_is_opened_in_append_mode() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    for serial in 1..=3 {
        backend.record(&record(serial, serial, true)).unwrap();
    }
    let log = dir.join(format!("{DOMAIN}{LOG_SUFFIX}"));
    let before = std::fs::read(&log).unwrap();
    // A write through the handle of the backend lands at the end of the log, also
    // after a seek to its start. The records that were there keep their bytes.
    {
        let mut file = &backend.domains.get(DOMAIN).unwrap().file;
        file.seek(SeekFrom::Start(HEADER_BYTES)).unwrap();
        file.write_all(b"overwrite").unwrap();
    }
    let after = std::fs::read(&log).unwrap();
    assert_eq!(&after[..before.len()], &before[..]);
    assert_eq!(&after[before.len()..], b"overwrite");
    // The stray bytes are not a frame and not the rest of a write. The store reports
    // them and cuts nothing off.
    assert!(matches!(
        backend.record(&record(4, 4, true)),
        Err(MemoryError::Corrupt(_))
    ));
    assert_eq!(std::fs::read(&log).unwrap(), after);
}

#[test]
fn capacity_never_blocks_record() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = LogBackend::open(&dir, options(50)).unwrap();
    for serial in 1..=2500u64 {
        // Every record is accepted and far from every other, so each needs room.
        let receipt = backend.record(&record(serial, serial, true)).unwrap();
        assert_eq!(receipt.key, serial as i64);
    }
    let counts = backend.counts().unwrap();
    assert_eq!(counts.records, 2500);
    assert_eq!(counts.attractors, 50);
    let report = backend.verify().unwrap();
    assert_eq!((report.records, report.attractors), (2500, 50));
}

/// A run of records that forms, reinforces, rejects and evicts.
fn mixed_run(backend: &mut LogBackend, from: u64, to: u64) {
    for serial in from..=to {
        let seed = match serial % 5 {
            0 => serial % 40,
            1 => serial,
            2 => serial % 13,
            3 => serial / 2,
            _ => serial % 90,
        };
        backend
            .record(&record(serial, seed, serial % 6 != 0))
            .unwrap();
    }
}

#[test]
fn reopen_rebuild_equals_live_index() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let snapshot = dir.join(format!("{DOMAIN}{SNAPSHOT_SUFFIX}"));
    let mut live = LogBackend::open(
        &dir,
        OpenOptionsLog {
            snapshot_every: 700,
            ..options(60)
        },
    )
    .unwrap();
    mixed_run(&mut live, 1, 3000);
    assert!(
        snapshot.is_file(),
        "a snapshot is written while the store runs"
    );
    let expected = attractors(&live, DOMAIN);
    let expected_counts = live.counts().unwrap();
    assert_eq!(expected.len(), 60);
    let probes: Vec<(Fingerprint, [u8; 32])> = (0..200u64)
        .map(|seed| (Fingerprint::SimHash(far(seed)), digest(seed)))
        .collect();
    let hints: Vec<RouteHint> = probes
        .iter()
        .map(|(fp, d)| live.route_hint(DOMAIN, fp, d).unwrap())
        .collect();
    assert!(hints.iter().any(RouteHint::is_hot) && hints.iter().any(|h| !h.is_hot()));
    live.verify().unwrap();
    drop(live);

    let check = |what: &str| {
        let mut reopened = LogBackend::open(&dir, options(60)).unwrap();
        reopened.open_all().unwrap();
        assert_eq!(attractors(&reopened, DOMAIN), expected, "{what}");
        assert_eq!(reopened.counts().unwrap(), expected_counts, "{what}");
        for ((fp, d), hint) in probes.iter().zip(hints.iter()) {
            assert_eq!(&reopened.route_hint(DOMAIN, fp, d).unwrap(), hint, "{what}");
        }
        reopened.verify().unwrap();
    };
    // With the snapshot the close wrote.
    check("snapshot of the close");
    // With a snapshot from the middle of the run: the tail of the log is replayed.
    {
        let scratch_two = tempfile::tempdir().unwrap();
        let dir_two = scratch_two.path().join("store");
        let mut first = LogBackend::open(&dir_two, options(60)).unwrap();
        mixed_run(&mut first, 1, 1700);
        first.checkpoint().unwrap();
        let middle = std::fs::read(dir_two.join(format!("{DOMAIN}{SNAPSHOT_SUFFIX}"))).unwrap();
        std::fs::write(&snapshot, middle).unwrap();
    }
    check("snapshot of the middle");
    // Without a snapshot: the whole log is replayed.
    std::fs::remove_file(&snapshot).unwrap();
    check("no snapshot");
    // With a snapshot that is not whole: it is ignored.
    let good = {
        let mut reopened = LogBackend::open(&dir, options(60)).unwrap();
        reopened.open_all().unwrap();
        reopened.checkpoint().unwrap();
        drop(reopened);
        std::fs::read(&snapshot).unwrap()
    };
    assert!(Snapshot::decode(&good, 0).is_some());
    let mut broken = good.clone();
    let at = broken.len() / 2;
    broken[at] ^= 1;
    assert!(Snapshot::decode(&broken, 0).is_none());
    std::fs::write(&snapshot, &broken).unwrap();
    check("broken snapshot");
    std::fs::write(&snapshot, &good[..good.len() - 7]).unwrap();
    check("short snapshot");
    std::fs::write(&snapshot, b"").unwrap();
    check("empty snapshot");
}

#[test]
fn a_snapshot_of_another_log_is_ignored() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let other = scratch.path().join("other");
    let mut one = open(&dir);
    mixed_run(&mut one, 1, 200);
    let expected = attractors(&one, DOMAIN);
    drop(one);
    // A whole snapshot whose log holds other records at the same place.
    let mut two = open(&other);
    for serial in 1..=200 {
        two.record(&record(serial, serial + 5000, true)).unwrap();
    }
    drop(two);
    std::fs::copy(
        other.join(format!("{DOMAIN}{SNAPSHOT_SUFFIX}")),
        dir.join(format!("{DOMAIN}{SNAPSHOT_SUFFIX}")),
    )
    .unwrap();
    let mut reopened = open(&dir);
    reopened.open_all().unwrap();
    assert_eq!(attractors(&reopened, DOMAIN), expected);
    reopened.verify().unwrap();
}

#[test]
fn health_open_is_read_only() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    // No store: the answer says so and nothing is made.
    let health = LogBackend::health(&dir).unwrap();
    assert!(!health.present);
    assert_eq!((health.records, health.attractors), (0, 0));
    assert!(!dir.exists());
    assert_eq!(folder(scratch.path()).len(), 0);

    let mut writer = open(&dir);
    mixed_run(&mut writer, 1, 300);
    writer.record(&record_in("intent", 1, 1, true)).unwrap();
    let counts = writer.counts().unwrap();
    // While the writer is open, without a snapshot on disk.
    let bytes_before = folder(&dir);
    let times_before = modified(&dir);
    let health = LogBackend::health(&dir).unwrap();
    assert!(health.present);
    assert_eq!(health.format_version, FORMAT_VERSION);
    assert_eq!(health.records, counts.records);
    assert_eq!(health.attractors, counts.attractors);
    assert_eq!(health.domains, counts.domains);
    assert_eq!(folder(&dir), bytes_before);
    assert_eq!(modified(&dir), times_before);
    drop(writer);

    // After the writer closed, many times in a row.
    let bytes_before = folder(&dir);
    let times_before = modified(&dir);
    for _ in 0..25 {
        let again = LogBackend::health(&dir).unwrap();
        assert_eq!(again, health);
    }
    assert_eq!(folder(&dir), bytes_before);
    assert_eq!(modified(&dir), times_before);

    // A reader that opens every domain, searches and verifies changes nothing either,
    // and it cannot write.
    let mut reader = LogBackend::open_read_only(&dir, CoreConfig::default()).unwrap();
    reader.open_all().unwrap();
    assert_eq!(reader.counts().unwrap(), counts);
    reader
        .search(DOMAIN, &Fingerprint::SimHash(far(3)), 5, 0)
        .unwrap();
    reader.history(DOMAIN, "agent-1", None, 10).unwrap();
    reader.verify().unwrap();
    assert!(matches!(
        reader.record(&record(999, 999, true)),
        Err(MemoryError::ReadOnly)
    ));
    assert!(matches!(reader.checkpoint(), Err(MemoryError::ReadOnly)));
    drop(reader);
    assert_eq!(folder(&dir), bytes_before);
    assert_eq!(modified(&dir), times_before);

    // A reader of a store that does not exist makes nothing.
    let nowhere = scratch.path().join("nowhere");
    let mut reader = LogBackend::open_read_only(&nowhere, CoreConfig::default()).unwrap();
    reader.open_all().unwrap();
    assert_eq!(reader.counts().unwrap().records, 0);
    assert!(reader
        .history(DOMAIN, "agent-1", None, 10)
        .unwrap()
        .is_empty());
    drop(reader);
    assert!(!nowhere.exists());
}

#[test]
fn health_reads_a_log_whose_tail_is_cut() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut writer = open(&dir);
    for serial in 1..=9 {
        writer.record(&record(serial, serial, true)).unwrap();
    }
    drop(writer);
    let log = dir.join(format!("{DOMAIN}{LOG_SUFFIX}"));
    // The first bytes of a frame, as a writer leaves them that ends in the middle of
    // a write.
    let whole = std::fs::read(&log).unwrap();
    let mut file = OpenOptions::new().append(true).open(&log).unwrap();
    file.write_all(&whole[HEADER_BYTES as usize..HEADER_BYTES as usize + 21])
        .unwrap();
    drop(file);
    let before = folder(&dir);
    let health = LogBackend::health(&dir).unwrap();
    assert_eq!((health.records, health.attractors), (9, 9));
    assert_eq!(folder(&dir), before);
    // Bytes that are not the start of a frame are not the rest of a write. They are
    // reported and left where they are.
    let mut stray = whole.clone();
    stray.extend_from_slice(&[7u8; 21]);
    std::fs::write(&log, &stray).unwrap();
    let before = folder(&dir);
    assert!(matches!(
        LogBackend::health(&dir),
        Err(MemoryError::Corrupt(_))
    ));
    assert_eq!(folder(&dir), before);
}

#[test]
fn two_writers_on_one_store_never_give_out_one_key_twice() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut one = open(&dir);
    let mut two = open(&dir);
    let mut keys = Vec::new();
    for serial in 1..=300u64 {
        let writer = if serial % 3 == 0 { &mut two } else { &mut one };
        keys.push(
            writer
                .record(&record(serial, serial % 50, true))
                .unwrap()
                .key,
        );
    }
    assert_eq!(keys, (1..=300).collect::<Vec<i64>>());
    // Each writer saw the records of the other before it wrote, so both hold the
    // same attractors once both have read to the end.
    one.refresh().unwrap();
    two.refresh().unwrap();
    assert_eq!(attractors(&one, DOMAIN), attractors(&two, DOMAIN));
    assert_eq!(attractors(&one, DOMAIN).len(), 50);
    assert_eq!(one.verify().unwrap().records, 300);
    assert_eq!(two.verify().unwrap().records, 300);
}

#[test]
fn dimension_mismatch_is_error() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let config = CoreConfig {
        embedding_dim: 4,
        ..CoreConfig::default()
    };
    let mut backend = LogBackend::open(&dir, OpenOptionsLog::new(config)).unwrap();
    let embedded = |serial: u64, values: &[f32]| {
        let mut r = record_in("ops", serial, serial, true);
        r.fingerprint =
            Fingerprint::Embedding(QuantizedEmbedding::quantize(values, values.len()).unwrap());
        r
    };
    // The wrong dimension is refused and nothing is written.
    assert!(matches!(
        backend.record(&embedded(1, &[1.0, 0.0, 0.0])),
        Err(MemoryError::Core(CoreError::DimensionMismatch {
            expected: 4,
            got: 3
        }))
    ));
    assert_eq!(backend.counts().unwrap().records, 0);
    backend.record(&embedded(1, &[1.0, 0.0, 0.0, 0.0])).unwrap();
    let near = backend
        .record(&embedded(2, &[0.99, 0.1, 0.0, 0.0]))
        .unwrap();
    assert!(matches!(
        near.plan,
        Plan::Reinforce {
            key: 1,
            exact: false,
            ..
        }
    ));
    // A SimHash in the domain of embeddings is refused.
    assert!(matches!(
        backend.record(&record_in("ops", 3, 3, true)),
        Err(MemoryError::Core(CoreError::KindMismatch { .. }))
    ));
    assert_eq!(backend.counts().unwrap().records, 2);
    drop(backend);
    // The store keeps its dimension. Another one is refused, none takes the stored one.
    let other = CoreConfig {
        embedding_dim: 8,
        ..CoreConfig::default()
    };
    assert!(matches!(
        LogBackend::open(&dir, OpenOptionsLog::new(other)),
        Err(MemoryError::ConfigMismatch { .. })
    ));
    let mut reopened = open(&dir);
    assert_eq!(reopened.config().embedding_dim, 4);
    reopened.open_all().unwrap();
    assert_eq!(attractors(&reopened, "ops").len(), 1);
    assert_eq!(LogBackend::health(&dir).unwrap().embedding_dim, 4);
    // A store without embeddings refuses every embedding.
    let plain_dir = scratch.path().join("plain");
    let mut plain = open(&plain_dir);
    assert!(matches!(
        plain.record(&embedded(1, &[1.0, 0.0, 0.0, 0.0])),
        Err(MemoryError::Core(CoreError::EmbeddingsOff))
    ));
}

#[test]
fn history_search_and_export_read_the_log() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    let mut labelled = record_in("intent", 1, 1, true);
    labelled.element_id = String::from("INT-1");
    labelled
        .labels
        .insert("phase".to_string(), "propose".to_string());
    labelled.body = Some(String::from(r#"{"statement": "rename the parser"}"#));
    backend.record(&labelled).unwrap();
    let mut second = record_in("intent", 2, 1, true);
    second.element_id = String::from("INT-1");
    second
        .labels
        .insert("phase".to_string(), "solidify".to_string());
    backend.record(&second).unwrap();
    let mut rejected = record_in("intent", 3, 2, false);
    rejected.element_id = String::from("INT-1");
    backend.record(&rejected).unwrap();
    let mut other = record_in("intent", 4, 3, true);
    other.element_id = String::from("INT-2");
    backend.record(&other).unwrap();

    let all = backend.history("intent", "INT-1", None, 100).unwrap();
    assert_eq!(
        all.iter().map(|r| r.entry.key).collect::<Vec<_>>(),
        vec![1, 2, 3]
    );
    assert_eq!(
        all[0].labels().get("phase").map(String::as_str),
        Some("propose")
    );
    assert_eq!(
        all[0].entry.body.as_deref(),
        Some(r#"{"statement":"rename the parser"}"#)
    );
    let accepted = backend.history("intent", "INT-1", Some(true), 100).unwrap();
    assert_eq!(accepted.len(), 2);
    let refused = backend
        .history("intent", "INT-1", Some(false), 100)
        .unwrap();
    assert_eq!(refused.len(), 1);
    assert_eq!(
        backend.history("intent", "INT-1", None, 2).unwrap().len(),
        2
    );
    assert!(backend
        .history("intent", "INT-9", None, 100)
        .unwrap()
        .is_empty());
    assert!(backend
        .history("nothing", "INT-1", None, 100)
        .unwrap()
        .is_empty());

    // The hit carries the last record that touched the attractor.
    let hits = backend
        .search("intent", &Fingerprint::SimHash(far(1)), 5, 200)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].score, 256);
    assert_eq!(hits[0].attractor.support, 2);
    assert_eq!(hits[0].latest.as_ref().map(|r| r.entry.key), Some(2));
    assert_eq!(
        backend
            .search("intent", &Fingerprint::SimHash(far(1)), 5, 0)
            .unwrap()
            .len(),
        2
    );
    assert!(backend
        .search("nothing", &Fingerprint::SimHash(far(1)), 5, 0)
        .unwrap()
        .is_empty());

    backend.record(&record(5, 5, true)).unwrap();
    assert_eq!(backend.export(Some("intent"), 100).unwrap().len(), 4);
    assert_eq!(backend.export(None, 100).unwrap().len(), 5);
    assert_eq!(backend.export(None, 3).unwrap().len(), 3);
    // The judged domain takes no body.
    assert!(is_judged_domain(DOMAIN));
    let mut with_body = record(6, 6, true);
    with_body.body = Some(String::from("{}"));
    assert!(backend.record(&with_body).is_err());
    assert_eq!(backend.counts().unwrap().records, 5);
}

#[test]
fn a_folder_that_is_not_a_store_is_refused() {
    let scratch = tempfile::tempdir().unwrap();
    // Logs without a settings file.
    let stray = scratch.path().join("stray");
    std::fs::create_dir(&stray).unwrap();
    std::fs::write(stray.join(format!("intent{LOG_SUFFIX}")), b"x").unwrap();
    assert!(matches!(
        LogBackend::open(&stray, options(10)),
        Err(MemoryError::Format(_))
    ));
    assert_eq!(
        std::fs::read(stray.join(format!("intent{LOG_SUFFIX}"))).unwrap(),
        b"x"
    );
    // A settings file of another format version.
    let future = scratch.path().join("future");
    std::fs::create_dir(&future).unwrap();
    std::fs::write(
        future.join(META_FILE),
        "format_version=9\nembedding_dim=0\n",
    )
    .unwrap();
    assert!(matches!(
        LogBackend::open(&future, options(10)),
        Err(MemoryError::Format(_))
    ));
    assert!(matches!(
        LogBackend::health(&future),
        Err(MemoryError::Format(_))
    ));
    // A log that does not start with the header of this format.
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    backend.record(&record(1, 1, true)).unwrap();
    drop(backend);
    let log = dir.join(format!("{DOMAIN}{LOG_SUFFIX}"));
    let mut bytes = std::fs::read(&log).unwrap();
    bytes[0] = b'X';
    std::fs::write(&log, &bytes).unwrap();
    let mut reopened = open(&dir);
    assert!(matches!(reopened.open_all(), Err(MemoryError::Format(_))));
    // The folder above a new store must exist.
    assert!(LogBackend::open(&scratch.path().join("a").join("b"), options(10)).is_err());
}

#[test]
fn the_in_memory_backend_gives_the_same_answers() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut on_disk = LogBackend::open(&dir, options(40)).unwrap();
    let mut in_memory = crate::InMemoryBackend::new(options(40).config).unwrap();
    for serial in 1..=900u64 {
        let seed = if serial % 4 == 0 { serial } else { serial % 70 };
        let domain = if serial % 9 == 0 { "intent" } else { DOMAIN };
        let r = record_in(domain, serial, seed, serial % 5 != 0);
        assert_eq!(on_disk.record(&r).unwrap(), in_memory.record(&r).unwrap());
    }
    assert_eq!(on_disk.counts().unwrap(), in_memory.counts().unwrap());
    assert_eq!(on_disk.verify().unwrap(), in_memory.verify().unwrap());
    assert_eq!(
        on_disk.export(None, usize::MAX).unwrap(),
        in_memory.export(None, usize::MAX).unwrap()
    );
    for seed in 0..120u64 {
        let fp = Fingerprint::SimHash(far(seed));
        assert_eq!(
            on_disk.route_hint(DOMAIN, &fp, &digest(seed)).unwrap(),
            in_memory.route_hint(DOMAIN, &fp, &digest(seed)).unwrap()
        );
        assert_eq!(
            on_disk.search(DOMAIN, &fp, 3, 0).unwrap(),
            in_memory.search(DOMAIN, &fp, 3, 0).unwrap()
        );
        assert_eq!(
            on_disk
                .history(DOMAIN, &format!("agent-{}", seed % 3), Some(true), 20)
                .unwrap(),
            in_memory
                .history(DOMAIN, &format!("agent-{}", seed % 3), Some(true), 20)
                .unwrap()
        );
    }
}

#[test]
fn a_hint_reader_follows_the_writer_from_another_thread() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    let reader = backend.reader();
    let fp = Fingerprint::SimHash(far(1));
    assert_eq!(
        reader.route_hint(DOMAIN, &fp, &digest(1)),
        Some(RouteHint::Cold)
    );
    backend.record(&record(1, 1, true)).unwrap();
    let handle = std::thread::spawn(move || {
        let hint = reader.route_hint(DOMAIN, &Fingerprint::SimHash(far(1)), &digest(1));
        (hint, reader.attractor_count())
    });
    let (hint, count) = handle.join().unwrap();
    assert!(matches!(
        hint,
        Some(RouteHint::Hot {
            attractor: 1,
            exact: true,
            ..
        })
    ));
    assert_eq!(count, Some(1));
    // While the attractors are locked for a write the reader does not wait.
    let reader = backend.reader();
    let guard = backend.core.write().unwrap();
    assert_eq!(reader.route_hint(DOMAIN, &fp, &digest(1)), None);
    assert_eq!(reader.attractor_count(), None);
    drop(guard);
    assert!(reader.route_hint(DOMAIN, &fp, &digest(1)).is_some());
}
