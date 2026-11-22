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

fn reader(dir: &Path) -> LogBackend {
    LogBackend::open_read_only(dir, CoreConfig::default()).unwrap()
}

/// Open the log of every domain the folder holds.
fn open_every_domain(backend: &mut LogBackend) -> Result<(), MemoryError> {
    for domain in LogBackend::domains(&backend.dir)? {
        backend.open_domain(&domain)?;
    }
    Ok(())
}

fn attractors(backend: &LogBackend, domain: &str) -> Vec<Attractor> {
    backend
        .core
        .domain(domain)
        .map(|i| i.attractors())
        .unwrap_or_default()
}

/// Write the snapshot of every open domain, due or not.
fn force_snapshots(backend: &mut LogBackend) {
    let core = &backend.core;
    let dir = &backend.dir;
    for (domain, log) in backend.domains.iter_mut() {
        with_lock(log, true, |log| write_snapshot(dir, domain, log, core)).unwrap();
    }
}

/// Every record a query names, read page by page.
fn every_record(backend: &dyn MemoryBackend, query: RecordQuery<'_>) -> Vec<StoredRecord> {
    let mut found = Vec::new();
    let mut after: Option<Cursor> = None;
    loop {
        let page = backend
            .records(&RecordQuery {
                after: after.as_ref(),
                ..query
            })
            .unwrap();
        found.extend(page.records);
        match page.next {
            Some(next) => after = Some(next),
            None => return found,
        }
    }
}

fn all_of(domain: Option<&str>) -> RecordQuery<'_> {
    RecordQuery {
        domain,
        element_id: None,
        accepted: None,
        after: None,
        limit: usize::MAX,
        max_bytes: usize::MAX,
    }
}

fn history<'a>(
    domain: &'a str,
    element_id: &'a str,
    accepted: Option<bool>,
    limit: usize,
) -> RecordQuery<'a> {
    RecordQuery {
        domain: Some(domain),
        element_id: Some(element_id),
        accepted,
        after: None,
        limit,
        max_bytes: usize::MAX,
    }
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

fn log_of(dir: &Path) -> PathBuf {
    dir.join(format!("{DOMAIN}{LOG_SUFFIX}"))
}

fn snapshot_of(dir: &Path) -> PathBuf {
    snapshot_path(dir, DOMAIN)
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
    // The anchors name the head of each open domain.
    let anchors = backend.anchors();
    assert_eq!(anchors.len(), 2);
    assert_eq!(anchors[0].domain, DOMAIN);
    assert_eq!((anchors[0].records, anchors[0].head_hash), (3, third.hash));
    assert_eq!((anchors[1].records, anchors[1].head_hash), (1, other.hash));
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
    backend.verify().unwrap();

    // A failure in the middle of the frame leaves half a frame at the end of the log.
    // The attractors did not move and every whole record is still read.
    backend.fail_at = Some(FailPoint::MidFrame);
    assert!(matches!(
        backend.record(&record(6, 6, true)),
        Err(MemoryError::Injected(_))
    ));
    assert_eq!(backend.counts().unwrap(), before_counts);
    assert_eq!(attractors(&backend, DOMAIN), before_attractors);
    let health = LogBackend::health(&dir).unwrap();
    assert_eq!((health.records, health.attractors), (5, 5));
    // A second process that opens the store now reads five whole records.
    let mut second = reader(&dir);
    open_every_domain(&mut second).unwrap();
    assert_eq!(second.counts().unwrap().records, 5);
    assert_eq!(every_record(&second, all_of(Some(DOMAIN))).len(), 5);
    // A verification names the half frame: the log does not end in a whole frame.
    assert!(matches!(second.verify(), Err(MemoryError::Corrupt(_))));
    assert!(matches!(backend.verify(), Err(MemoryError::Corrupt(_))));
    drop(second);

    // The next write cuts the half frame off and takes its place.
    backend.fail_at = None;
    let receipt = backend.record(&record(6, 6, true)).unwrap();
    assert_eq!(receipt.key, 6);
    assert_eq!(backend.counts().unwrap().records, 6);
    backend.verify().unwrap();
    drop(backend);
    let mut reopened = open(&dir);
    open_every_domain(&mut reopened).unwrap();
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
    let log = log_of(&dir);
    let before = std::fs::metadata(&log).unwrap().len();
    // The snapshot of the four records, as a writer left it before the crash.
    force_snapshots(&mut backend);
    let four = std::fs::read(snapshot_of(&dir)).unwrap();
    backend.record(&record(5, 5, true)).unwrap();
    let whole = std::fs::read(&log).unwrap();
    drop(backend);
    // Cut the last frame at every byte, as a crash at that byte of the write leaves it.
    for cut in before..whole.len() as u64 {
        std::fs::write(&log, &whole[..cut as usize]).unwrap();
        std::fs::write(snapshot_of(&dir), &four).unwrap();
        let mut reopened = open(&dir);
        open_every_domain(&mut reopened).unwrap();
        assert_eq!(reopened.counts().unwrap().records, 4, "cut at byte {cut}");
        assert_eq!(reopened.verify().unwrap().records, 4);
        assert_eq!(std::fs::metadata(&log).unwrap().len(), before);
        let receipt = reopened.record(&record(5, 5, true)).unwrap();
        assert_eq!(receipt.key, 5);
        drop(reopened);
        assert_eq!(std::fs::read(&log).unwrap(), whole, "cut at byte {cut}");
    }
    // A tail of zero bytes, as a loss of power can leave it, is cut off too.
    let mut zeros = whole[..before as usize].to_vec();
    zeros.extend_from_slice(&[0u8; 300]);
    std::fs::write(&log, &zeros).unwrap();
    std::fs::write(snapshot_of(&dir), &four).unwrap();
    let mut reopened = open(&dir);
    open_every_domain(&mut reopened).unwrap();
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
    let records = every_record(&backend, all_of(Some(DOMAIN)));
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

/// A store of twelve records, closed and without a snapshot, with the bytes of its
/// log and the offsets of its frames.
fn closed_store(dir: &Path) -> (PathBuf, Vec<u8>, Vec<usize>) {
    let mut backend = open(dir);
    let log = log_of(dir);
    let mut offsets = vec![HEADER_BYTES as usize];
    for serial in 1..=12 {
        backend.record(&record(serial, serial, true)).unwrap();
        offsets.push(std::fs::metadata(&log).unwrap().len() as usize);
    }
    drop(backend);
    let _ = std::fs::remove_file(snapshot_of(dir));
    let bytes = std::fs::read(&log).unwrap();
    (log, bytes, offsets)
}

/// A writer, a reader and a verification each report the store as corrupt and the
/// files of the store keep every byte.
fn open_fails_as_corrupt(dir: &Path, what: &str) {
    let before = folder(dir);
    let mut writer = open(dir);
    assert!(
        matches!(open_every_domain(&mut writer), Err(MemoryError::Corrupt(_))),
        "writer: {what}"
    );
    assert!(
        matches!(
            writer.record(&record(99, 99, true)),
            Err(MemoryError::Corrupt(_))
        ),
        "write: {what}"
    );
    drop(writer);
    let mut read_only = reader(dir);
    assert!(
        matches!(
            open_every_domain(&mut read_only),
            Err(MemoryError::Corrupt(_))
        ),
        "reader: {what}"
    );
    assert!(
        matches!(reader(dir).verify(), Err(MemoryError::Corrupt(_))),
        "verify: {what}"
    );
    // Nothing was cut off and nothing was written.
    assert_eq!(folder(dir), before, "{what}");
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
        open_fails_as_corrupt(&dir, &format!("byte {at}"));
    }
}

#[test]
fn a_flipped_bit_in_a_length_field_is_found_and_never_cut_off() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let (log, bytes, offsets) = closed_store(&dir);
    // Both length fields of an inner frame and of the last frame, every bit of each.
    // A changed length can name a frame that runs past the end of the log. That is
    // not a write a crash cut short: a whole frame still stands there.
    for (name, frame) in [("inner", 5usize), ("last", 12usize)] {
        let (start, end) = (offsets[frame - 1], offsets[frame]);
        for (field, at) in [("first", start), ("second", end - 4)] {
            for bit in 0..32 {
                let mut changed = bytes.clone();
                changed[at + bit / 8] ^= 1 << (bit % 8);
                std::fs::write(&log, &changed).unwrap();
                open_fails_as_corrupt(&dir, &format!("{name} frame, {field} length, bit {bit}"));
            }
        }
    }
}

#[test]
fn a_changed_byte_in_the_last_frame_is_found_and_never_cut_off() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let (log, bytes, offsets) = closed_store(&dir);
    // The last frame is whole on disk, so no change in it is a cut write.
    for at in offsets[11]..offsets[12] {
        let mut changed = bytes.clone();
        changed[at] ^= 0x10;
        std::fs::write(&log, &changed).unwrap();
        open_fails_as_corrupt(&dir, &format!("byte {at} of the last frame"));
    }
}

#[test]
fn a_log_that_is_shorter_than_its_snapshot_is_found_and_never_cut_off() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let (log, bytes, offsets) = closed_store(&dir);
    // The snapshot of the twelve records.
    std::fs::write(&log, &bytes).unwrap();
    let mut writer = open(&dir);
    writer.open_domain(DOMAIN).unwrap();
    force_snapshots(&mut writer);
    drop(writer);
    let snapshot = std::fs::read(snapshot_of(&dir)).unwrap();
    reader(&dir).verify().unwrap();
    // The log cut at a frame boundary, in the middle of a frame and down to its header.
    for cut in [offsets[10], offsets[11], offsets[11] + 30, offsets[0]] {
        std::fs::write(&log, &bytes[..cut]).unwrap();
        std::fs::write(snapshot_of(&dir), &snapshot).unwrap();
        open_fails_as_corrupt(&dir, &format!("cut at byte {cut}"));
    }
    // Without the snapshot a cut at a frame boundary reads as a shorter log. The
    // anchor a caller kept outside the store finds it.
    std::fs::remove_file(snapshot_of(&dir)).unwrap();
    std::fs::write(&log, &bytes[..offsets[10]]).unwrap();
    assert_eq!(reader(&dir).verify().unwrap().records, 10);
}

#[test]
fn an_anchor_outside_the_store_finds_a_cut_or_replaced_log() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    let mut hashes = Vec::new();
    for serial in 1..=12 {
        hashes.push(backend.record(&record(serial, serial, true)).unwrap().hash);
    }
    let head = backend.anchors().remove(0);
    assert_eq!((head.records, head.head_hash), (12, hashes[11]));
    drop(backend);
    let log = log_of(&dir);
    let bytes = std::fs::read(&log).unwrap();
    let anchor = |records: u64, head_hash: [u8; 32]| DomainAnchor {
        domain: String::from(DOMAIN),
        records,
        head_hash,
    };
    // The head and every earlier record fit: a log may be ahead of its anchor.
    LogBackend::check_anchor(&dir, &head).unwrap();
    LogBackend::check_anchor(&dir, &anchor(7, hashes[6])).unwrap();
    LogBackend::check_anchor(&dir, &anchor(0, [0; 32])).unwrap();
    // Another record at the place the anchor names.
    assert!(matches!(
        LogBackend::check_anchor(&dir, &anchor(7, hashes[5])),
        Err(MemoryError::Corrupt(_))
    ));
    assert!(matches!(
        LogBackend::check_anchor(&dir, &anchor(12, [9; 32])),
        Err(MemoryError::Corrupt(_))
    ));
    // A log cut at a frame boundary holds fewer records than the anchor names. No
    // snapshot is there to tell, and the check changes nothing.
    std::fs::remove_file(snapshot_of(&dir)).unwrap();
    let mut reading = FrameReader::open(&log, DOMAIN, HEADER_BYTES, bytes.len() as u64).unwrap();
    let mut ends = Vec::new();
    while let Frame::Entry { .. } = reading.read_frame().unwrap() {
        ends.push(reading.at as usize);
    }
    std::fs::write(&log, &bytes[..ends[9]]).unwrap();
    let before = folder(&dir);
    let short = LogBackend::check_anchor(&dir, &head).unwrap_err();
    assert!(short.to_string().contains("holds 10 records"), "{short}");
    LogBackend::check_anchor(&dir, &anchor(10, hashes[9])).unwrap();
    assert_eq!(folder(&dir), before);
    // No log at all.
    std::fs::remove_file(&log).unwrap();
    assert!(matches!(
        LogBackend::check_anchor(&dir, &head),
        Err(MemoryError::Corrupt(_))
    ));
}

#[test]
fn a_verification_compares_the_snapshot_with_the_log() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    mixed_run(&mut backend, 1, 200);
    drop(backend);
    let path = snapshot_of(&dir);
    let good = std::fs::read(&path).unwrap();
    reader(&dir).verify().unwrap();
    // A whole snapshot that names the right record and holds another support count.
    let mut wrong = Snapshot::decode(&good, 0).unwrap();
    wrong.attractors[0].0.support += 1;
    std::fs::write(&path, wrong.encode()).unwrap();
    let found = reader(&dir).verify().unwrap_err();
    assert!(found.to_string().contains("snapshot"), "{found}");
    // A snapshot whose bytes are damaged. A writer replays the log in its place, and
    // a verification names it.
    let mut damaged = good.clone();
    let at = damaged.len() / 2;
    damaged[at] ^= 1;
    std::fs::write(&path, &damaged).unwrap();
    assert!(matches!(
        reader(&dir).verify(),
        Err(MemoryError::Corrupt(_))
    ));
    std::fs::write(&path, &good).unwrap();
    reader(&dir).verify().unwrap();
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
    open_fails_as_corrupt(&dir, "frame 5 removed");
    // Frames 5 and 6 in each other's place.
    let mut swapped = bytes[..offsets[4]].to_vec();
    swapped.extend_from_slice(&bytes[offsets[5]..offsets[6]]);
    swapped.extend_from_slice(&bytes[offsets[4]..offsets[5]]);
    swapped.extend_from_slice(&bytes[offsets[6]..]);
    std::fs::write(&log, &swapped).unwrap();
    open_fails_as_corrupt(&dir, "frames 5 and 6 swapped");
    // The log of one domain under the name of another.
    std::fs::write(&log, &bytes).unwrap();
    std::fs::copy(&log, dir.join(format!("intent{LOG_SUFFIX}"))).unwrap();
    assert!(reader(&dir).verify().is_err());
}

#[test]
fn the_log_is_opened_in_append_mode() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    for serial in 1..=3 {
        backend.record(&record(serial, serial, true)).unwrap();
    }
    let log = log_of(&dir);
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
    let snapshot = snapshot_of(&dir);
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

    // A reader that opens the store holds the attractors the writer held.
    let check = |what: &str| {
        let mut reopened = reader(&dir);
        reopened.open_domain(DOMAIN).unwrap();
        assert_eq!(attractors(&reopened, DOMAIN), expected, "{what}");
        assert_eq!(reopened.counts().unwrap(), expected_counts, "{what}");
        for ((fp, d), hint) in probes.iter().zip(hints.iter()) {
            assert_eq!(&reopened.route_hint(DOMAIN, fp, d).unwrap(), hint, "{what}");
        }
        reopened
    };
    // With the snapshot of the run.
    check("snapshot of the run").verify().unwrap();
    // With a snapshot from the middle of the run: the tail of the log is replayed.
    {
        let scratch_two = tempfile::tempdir().unwrap();
        let dir_two = scratch_two.path().join("store");
        let mut first = LogBackend::open(&dir_two, options(60)).unwrap();
        mixed_run(&mut first, 1, 1700);
        force_snapshots(&mut first);
        let middle = std::fs::read(snapshot_of(&dir_two)).unwrap();
        std::fs::write(&snapshot, middle).unwrap();
    }
    check("snapshot of the middle").verify().unwrap();
    // Without a snapshot: the whole log is replayed.
    std::fs::remove_file(&snapshot).unwrap();
    check("no snapshot").verify().unwrap();
    // With a snapshot whose bytes are damaged: the log is replayed in its place.
    let good = {
        let mut reopened = LogBackend::open(&dir, options(60)).unwrap();
        reopened.open_domain(DOMAIN).unwrap();
        force_snapshots(&mut reopened);
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
fn a_snapshot_of_another_log_is_found() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let other = scratch.path().join("other");
    let mut one = open(&dir);
    mixed_run(&mut one, 1, 200);
    drop(one);
    // A whole snapshot whose log holds other records at the same place.
    let mut two = open(&other);
    for serial in 1..=200 {
        two.record(&record(serial, serial + 5000, true)).unwrap();
    }
    drop(two);
    std::fs::copy(snapshot_of(&other), snapshot_of(&dir)).unwrap();
    // The log under the snapshot is not the log the snapshot was made of.
    open_fails_as_corrupt(&dir, "snapshot of another log");
}

#[test]
fn a_writer_that_closes_writes_a_snapshot_only_when_it_is_due() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let covered = |dir: &Path| {
        let bytes = std::fs::read(snapshot_of(dir)).unwrap();
        Snapshot::decode(&bytes, 0).unwrap().head.last_key
    };
    let mut backend = open(&dir);
    for serial in 1..=8 {
        backend.record(&record(serial, serial, true)).unwrap();
    }
    drop(backend);
    assert_eq!(covered(&dir), 8);
    // One record behind a snapshot of eight is less than one part in four: no snapshot.
    let before = (
        std::fs::read(snapshot_of(&dir)).unwrap(),
        std::fs::metadata(snapshot_of(&dir))
            .unwrap()
            .modified()
            .unwrap(),
    );
    let mut backend = open(&dir);
    backend.record(&record(9, 9, true)).unwrap();
    drop(backend);
    assert_eq!(covered(&dir), 8);
    assert_eq!(
        (
            std::fs::read(snapshot_of(&dir)).unwrap(),
            std::fs::metadata(snapshot_of(&dir))
                .unwrap()
                .modified()
                .unwrap(),
        ),
        before
    );
    // Two records behind it are one part in four: the snapshot is written.
    let mut backend = open(&dir);
    backend.record(&record(10, 10, true)).unwrap();
    assert_eq!(backend.counts().unwrap().records, 10);
    drop(backend);
    assert_eq!(covered(&dir), 10);
    // A writer that wrote nothing writes no snapshot.
    let before = std::fs::metadata(snapshot_of(&dir))
        .unwrap()
        .modified()
        .unwrap();
    let mut backend = open(&dir);
    backend.open_domain(DOMAIN).unwrap();
    drop(backend);
    assert_eq!(
        std::fs::metadata(snapshot_of(&dir))
            .unwrap()
            .modified()
            .unwrap(),
        before
    );
    reader(&dir).verify().unwrap();
}

#[test]
fn one_record_added_to_a_domain_of_100000_attractors_writes_no_snapshot() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let big = options(100_000);
    let mut backend = LogBackend::open(&dir, big).unwrap();
    for serial in 1..=100_000u64 {
        backend.record(&record(serial, serial, true)).unwrap();
    }
    assert_eq!(backend.counts().unwrap().attractors, 100_000);
    drop(backend);
    let snapshot = snapshot_of(&dir);
    let before = (
        std::fs::metadata(&snapshot).unwrap().len(),
        std::fs::metadata(&snapshot).unwrap().modified().unwrap(),
    );
    assert!(
        before.0 > 10_000_000,
        "the snapshot holds {} bytes",
        before.0
    );
    let log_before = std::fs::metadata(log_of(&dir)).unwrap().len();
    // A writer that opens the store, adds one record and closes.
    let mut backend = LogBackend::open(&dir, big).unwrap();
    let receipt = backend.record(&record(100_001, 100_001, true)).unwrap();
    assert_eq!(receipt.key, 100_001);
    drop(backend);
    assert_eq!(
        (
            std::fs::metadata(&snapshot).unwrap().len(),
            std::fs::metadata(&snapshot).unwrap().modified().unwrap(),
        ),
        before,
        "the snapshot was written again"
    );
    assert!(std::fs::metadata(log_of(&dir)).unwrap().len() > log_before);
    // No scratch file of a snapshot is left either.
    assert_eq!(folder(&dir).len(), 3);
    // The next writer replays the one record behind the snapshot.
    let mut backend = LogBackend::open(&dir, big).unwrap();
    backend.open_domain(DOMAIN).unwrap();
    let counts = backend.counts().unwrap();
    assert_eq!((counts.records, counts.attractors), (100_001, 100_000));
}

#[test]
fn a_call_on_one_domain_opens_no_other_domain() {
    let scratch = tempfile::tempdir().unwrap();
    let dir = scratch.path().join("store");
    let mut backend = open(&dir);
    for serial in 1..=30 {
        backend.record(&record(serial, serial, true)).unwrap();
        backend
            .record(&record_in("intent", serial, serial, true))
            .unwrap();
        backend
            .record(&record_in("graph", serial, serial, true))
            .unwrap();
    }
    drop(backend);
    // The log of another domain is damaged. A call that opened it would fail.
    let other = dir.join(format!("graph{LOG_SUFFIX}"));
    let mut bytes = std::fs::read(&other).unwrap();
    let at = bytes.len() / 2;
    bytes[at] ^= 0xff;
    std::fs::write(&other, &bytes).unwrap();

    let mut writer = open(&dir);
    assert!(writer.open_domains().is_empty());
    writer.record(&record_in("intent", 31, 31, true)).unwrap();
    assert_eq!(writer.open_domains(), vec![String::from("intent")]);
    assert_eq!(writer.counts().unwrap().records, 31);
    drop(writer);

    let mut read_only = reader(&dir);
    read_only.open_domain("intent").unwrap();
    let hits = read_only
        .search("intent", &Fingerprint::SimHash(far(3)), 5, 200)
        .unwrap();
    assert_eq!(hits.len(), 1);
    assert_eq!(read_only.open_domains(), vec![String::from("intent")]);
    // History, export and count of one domain read its frames and open no attractors.
    let read_only = reader(&dir);
    let page = read_only
        .records(&history("intent", "agent-1", None, 100))
        .unwrap();
    // Ten of the first thirty records and the one the writer added.
    assert_eq!(page.records.len(), 11);
    assert_eq!(read_only.count(&all_of(Some(DOMAIN))).unwrap(), 30);
    assert_eq!(every_record(&read_only, all_of(Some("intent"))).len(), 31);
    assert!(read_only.open_domains().is_empty());
    // A question about every domain meets the damage.
    assert!(read_only.records(&all_of(None)).is_err());
    assert!(read_only.verify().is_err());
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

    // A reader that opens every domain, searches, reads records and verifies changes
    // nothing either, and it cannot write.
    let mut read_only = reader(&dir);
    open_every_domain(&mut read_only).unwrap();
    assert_eq!(read_only.counts().unwrap(), counts);
    read_only
        .search(DOMAIN, &Fingerprint::SimHash(far(3)), 5, 0)
        .unwrap();
    read_only
        .records(&history(DOMAIN, "agent-1", None, 10))
        .unwrap();
    read_only.verify().unwrap();
    assert!(matches!(
        read_only.record(&record(999, 999, true)),
        Err(MemoryError::ReadOnly)
    ));
    drop(read_only);
    assert_eq!(folder(&dir), bytes_before);
    assert_eq!(modified(&dir), times_before);

    // A reader of a store that does not exist makes nothing.
    let nowhere = scratch.path().join("nowhere");
    let mut read_only = reader(&nowhere);
    assert!(!read_only.open_domain(DOMAIN).unwrap());
    assert_eq!(read_only.counts().unwrap().records, 0);
    assert!(read_only
        .records(&history(DOMAIN, "agent-1", None, 10))
        .unwrap()
        .records
        .is_empty());
    assert_eq!(read_only.verify().unwrap().records, 0);
    drop(read_only);
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
    let log = log_of(&dir);
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
    // A verification reads to the end and names the frame that is not whole.
    let found = reader(&dir).verify().unwrap_err();
    assert!(found.to_string().contains("not whole"), "{found}");
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
    // Each writer read the records of the other before it wrote. The writer of the
    // last record holds the attractors that a replay of the whole log gives.
    let mut replayed = reader(&dir);
    replayed.open_domain(DOMAIN).unwrap();
    assert_eq!(attractors(&two, DOMAIN), attractors(&replayed, DOMAIN));
    assert_eq!(attractors(&two, DOMAIN).len(), 50);
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
    reopened.open_domain("ops").unwrap();
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
fn records_and_search_read_the_log() {
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

    let read = |query: RecordQuery<'_>| backend.records(&query).unwrap();
    let all = read(history("intent", "INT-1", None, 100));
    assert_eq!(all.next, None);
    let all = all.records;
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
    assert_eq!(
        read(history("intent", "INT-1", Some(true), 100))
            .records
            .len(),
        2
    );
    assert_eq!(
        read(history("intent", "INT-1", Some(false), 100))
            .records
            .len(),
        1
    );
    assert!(read(history("intent", "INT-9", None, 100))
        .records
        .is_empty());
    assert!(read(history("nothing", "INT-1", None, 100))
        .records
        .is_empty());
    assert!(read(history("intent", "INT-1", None, 0)).records.is_empty());
    assert_eq!(
        backend.count(&history("intent", "INT-1", None, 1)).unwrap(),
        3
    );
    assert_eq!(backend.count(&all_of(Some("intent"))).unwrap(), 4);

    // A page of two records names the place of the next page.
    let first = read(history("intent", "INT-1", None, 2));
    assert_eq!(first.records.len(), 2);
    let next = first.next.clone().expect("a third record is left");
    let rest = read(RecordQuery {
        after: Some(&next),
        ..history("intent", "INT-1", None, 2)
    });
    assert_eq!(
        rest.records.iter().map(|r| r.entry.key).collect::<Vec<_>>(),
        vec![3]
    );
    assert_eq!(rest.next, None);
    // The place survives its text form, as the program prints and reads it.
    let parsed: Cursor = next.to_string().parse().unwrap();
    assert_eq!(parsed, next);
    // A page ends with the record that brings its bytes to the bound.
    let small = read(RecordQuery {
        max_bytes: 1,
        ..all_of(Some("intent"))
    });
    assert_eq!(small.records.len(), 1);
    assert!(small.next.is_some());
    assert_eq!(
        every_record(
            &backend,
            RecordQuery {
                max_bytes: 300,
                ..all_of(Some("intent"))
            }
        )
        .len(),
        4
    );
    // A place that no page named is refused.
    for text in ["intent:2:13", "intent:9:400", "graph:1:200", "intent:1"] {
        let refused = text.parse::<Cursor>().and_then(|cursor| {
            backend.records(&RecordQuery {
                after: Some(&cursor),
                ..all_of(Some("intent"))
            })
        });
        assert!(refused.is_err(), "{text}");
    }

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
    assert_eq!(every_record(&backend, all_of(Some("intent"))).len(), 4);
    // Every domain in name order: the judged domain comes before `intent`.
    let both = every_record(
        &backend,
        RecordQuery {
            limit: 2,
            ..all_of(None)
        },
    );
    assert_eq!(
        both.iter()
            .map(|r| (r.domain.as_str(), r.entry.key))
            .collect::<Vec<_>>(),
        vec![
            (DOMAIN, 1),
            ("intent", 1),
            ("intent", 2),
            ("intent", 3),
            ("intent", 4)
        ]
    );
    assert_eq!(
        backend
            .records(&RecordQuery {
                limit: 3,
                ..all_of(None)
            })
            .unwrap()
            .records
            .len(),
        3
    );
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
    let log = log_of(&dir);
    let mut bytes = std::fs::read(&log).unwrap();
    bytes[0] = b'X';
    std::fs::write(&log, &bytes).unwrap();
    let mut reopened = open(&dir);
    assert!(matches!(
        reopened.open_domain(DOMAIN),
        Err(MemoryError::Format(_))
    ));
    assert!(matches!(reader(&dir).verify(), Err(MemoryError::Format(_))));
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
    assert_eq!(on_disk.anchors(), in_memory.anchors());
    // Whole and in pages of seven records, both give the same records in the same order.
    for limit in [usize::MAX, 7] {
        let query = RecordQuery {
            limit,
            ..all_of(None)
        };
        let from_disk = every_record(&on_disk, query);
        assert_eq!(from_disk.len(), 900);
        assert_eq!(from_disk, every_record(&in_memory, query));
    }
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
        let agent = format!("agent-{}", seed % 3);
        let query = history(DOMAIN, &agent, Some(true), 20);
        assert_eq!(
            on_disk.records(&query).unwrap().records,
            in_memory.records(&query).unwrap().records
        );
        assert_eq!(
            on_disk.count(&query).unwrap(),
            in_memory.count(&query).unwrap()
        );
    }
}
