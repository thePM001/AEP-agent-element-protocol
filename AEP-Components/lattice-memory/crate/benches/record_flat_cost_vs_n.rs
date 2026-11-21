//! Cost of one record at 2000 and at 100000 attractors in one domain.
//!
//! Each size gets a store of its own in a scratch folder. The domain is filled with
//! that many attractors, so it is at capacity and each new attractor evicts one. Then
//! these costs are measured in microseconds:
//!
//! - `reject`: a rejection. It enters the log and asks the index nothing, so this is
//!   the cost of the write alone.
//! - `hint`: the route hint alone, which is the lookup of the nearest attractor.
//! - `form` and `reinforce`: a record written after its hint, as the Base Node writes
//!   every record. The record that forms an attractor evicts one. The write reuses
//!   the answer of the hint.
//! - `cold form` and `cold reinforce`: the same records without a hint before them,
//!   as a caller of the program writes them. The write does the lookup itself.
//!
//! The host of a bench run is shared with other work, so each cost is measured in
//! batches. Two figures are printed: the mean of the least disturbed batch and the
//! median batch.
//!
//! Run with `cargo bench -p aep-lattice-memory`. The run fails when the write alone or
//! a record after its hint costs more than twice as much at 100000 attractors as at
//! 2000, measured on the least disturbed batch. The hint and the cold records are
//! printed with their ratios and do not fail the run: their lookup reads memory in
//! many places, and what that costs depends on the cache of the host.

use aep_lattice_memory::{
    CoreConfig, Fingerprint, LogBackend, MemoryBackend, NewRecord, OpenOptionsLog, SimHash,
};
use std::collections::BTreeMap;
use std::time::{Duration, Instant};

struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self
            .0
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let mut x = self.0;
        x ^= x >> 33;
        x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
        x ^= x >> 33;
        x
    }

    fn hash(&mut self) -> SimHash {
        SimHash([self.next(), self.next(), self.next(), self.next()])
    }
}

const DOMAIN: &str = "admit.bench";

fn digest(serial: u64) -> [u8; 32] {
    let mut digest = [0u8; 32];
    digest[..8].copy_from_slice(&serial.to_le_bytes());
    digest
}

fn record(serial: u64, hash: SimHash, accepted: bool) -> NewRecord {
    NewRecord {
        entry_id: format!("bench-{serial}"),
        domain: String::from(DOMAIN),
        element_id: String::from("agent-bench"),
        accepted,
        recorded_at_unix: 1_795_000_000 + serial as i64,
        shape_digest: digest(serial),
        fingerprint: Fingerprint::SimHash(hash),
        labels: BTreeMap::new(),
        body: None,
    }
}

fn fail(text: &str) -> ! {
    eprintln!("record_flat_cost_vs_n: {text}");
    std::process::exit(1);
}

/// Batches of one measurement.
const BATCHES: usize = 20;
/// Calls of one batch.
const PER_BATCH: usize = 200;

/// Mean microseconds of one call: of the least disturbed batch and of the median one.
#[derive(Clone, Copy)]
struct Cost {
    quiet: f64,
    median: f64,
}

/// Measure `call` in batches. `call` answers with the time of its measured part, so
/// what it does before that part is not counted.
fn batches_us(mut call: impl FnMut() -> Duration) -> Cost {
    let mut means = Vec::with_capacity(BATCHES);
    for _ in 0..BATCHES {
        let mut total = Duration::ZERO;
        for _ in 0..PER_BATCH {
            total += call();
        }
        means.push(total.as_secs_f64() * 1e6 / PER_BATCH as f64);
    }
    means.sort_by(|a, b| a.total_cmp(b));
    Cost {
        quiet: means[0],
        median: means[means.len() / 2],
    }
}

/// The costs at one size, in the order of [`KINDS`].
type Costs = [Cost; 6];

const KINDS: [&str; 6] = [
    "reject",
    "hint",
    "form",
    "reinforce",
    "cold form",
    "cold reinforce",
];
/// The kinds whose ratio fails the run above a factor of two.
const GATED: [bool; 6] = [true, false, true, true, false, false];

fn timed_write(backend: &mut LogBackend, new: &NewRecord, what: &str) -> Duration {
    let start = Instant::now();
    if let Err(e) = backend.record(new) {
        fail(&format!("{what}: {e}"));
    }
    start.elapsed()
}

fn timed_hint(backend: &LogBackend, new: &NewRecord) -> Duration {
    let start = Instant::now();
    if let Err(e) = backend.route_hint(DOMAIN, &new.fingerprint, &new.shape_digest) {
        fail(&format!("hint: {e}"));
    }
    start.elapsed()
}

/// A hash three bits away from one of the newest attractors. It is new each time, so
/// no earlier lookup of it is remembered.
fn near_newest(rng: &mut Lcg, newest: &[SimHash]) -> SimHash {
    let pick = (rng.next() % 2000.min(newest.len() as u64)) as usize;
    let mut hash = newest[newest.len() - 1 - pick];
    for _ in 0..3 {
        let bit = rng.next() % 256;
        hash.0[(bit / 64) as usize] ^= 1u64 << (bit % 64);
    }
    hash
}

fn measure(size: usize) -> Costs {
    let scratch = match tempfile::tempdir() {
        Ok(dir) => dir,
        Err(e) => fail(&format!("no scratch folder: {e}")),
    };
    let config = CoreConfig {
        capacity_per_domain: size,
        ..CoreConfig::default()
    };
    let opened = LogBackend::open(&scratch.path().join("store"), OpenOptionsLog::new(config));
    let mut backend = match opened {
        Ok(backend) => backend,
        Err(e) => fail(&format!("open: {e}")),
    };
    let mut rng = Lcg(size as u64);
    let mut serial = 0u64;
    // The hashes of the attractors in the order they formed. Records near the newest
    // ones reinforce.
    let mut newest: Vec<SimHash> = Vec::new();
    for _ in 0..size {
        let hash = rng.hash();
        serial += 1;
        if let Err(e) = backend.record(&record(serial, hash, true)) {
            fail(&format!("fill: {e}"));
        }
        newest.push(hash);
    }

    let reject = batches_us(|| {
        serial += 1;
        let new = record(serial, rng.hash(), false);
        timed_write(&mut backend, &new, "reject")
    });
    let hint_alone = batches_us(|| {
        let new = record(0, rng.hash(), true);
        timed_hint(&backend, &new)
    });
    let form = batches_us(|| {
        serial += 1;
        let hash = rng.hash();
        let new = record(serial, hash, true);
        timed_hint(&backend, &new);
        let spent = timed_write(&mut backend, &new, "form");
        newest.push(hash);
        spent
    });
    let reinforce = batches_us(|| {
        serial += 1;
        let new = record(serial, near_newest(&mut rng, &newest), true);
        timed_hint(&backend, &new);
        timed_write(&mut backend, &new, "reinforce")
    });
    let cold_form = batches_us(|| {
        serial += 1;
        let hash = rng.hash();
        let new = record(serial, hash, true);
        let spent = timed_write(&mut backend, &new, "cold form");
        newest.push(hash);
        spent
    });
    let cold_reinforce = batches_us(|| {
        serial += 1;
        let new = record(serial, near_newest(&mut rng, &newest), true);
        timed_write(&mut backend, &new, "cold reinforce")
    });

    let counts = match backend.counts() {
        Ok(counts) => counts,
        Err(e) => fail(&format!("counts: {e}")),
    };
    if counts.attractors != size as u64 || counts.records != serial {
        fail(&format!(
            "the store holds {} attractors and {} records, expected {size} and {serial}",
            counts.attractors, counts.records
        ));
    }
    [
        reject,
        hint_alone,
        form,
        reinforce,
        cold_form,
        cold_reinforce,
    ]
}

fn main() {
    let small = measure(2_000);
    let large = measure(100_000);
    println!("kind            at 2000 quiet/median   at 100000 quiet/median   ratio quiet/median");
    let mut failed = Vec::new();
    for (index, kind) in KINDS.iter().enumerate() {
        let (a, b) = (small[index], large[index]);
        let ratio = b.quiet / a.quiet;
        println!(
            "{kind:<15} {:>8.1} {:>8.1}        {:>8.1} {:>8.1}         {:>5.2} {:>5.2}{}",
            a.quiet,
            a.median,
            b.quiet,
            b.median,
            ratio,
            b.median / a.median,
            if GATED[index] { "" } else { "   not gated" }
        );
        if GATED[index] && ratio > 2.0 {
            failed.push(*kind);
        }
    }
    if !failed.is_empty() {
        fail(&format!(
            "at 100000 attractors these cost more than twice their cost at 2000: {}",
            failed.join(", ")
        ));
    }
    println!("record_flat_cost_vs_n ok");
}
