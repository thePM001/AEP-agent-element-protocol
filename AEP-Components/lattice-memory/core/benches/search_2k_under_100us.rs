//! Cost of the two read paths of the core at several sizes of one domain.
//!
//! `nearest` is what a record and a route hint ask. `scan` is the exact search over the
//! whole array and the last column is the eviction of one attractor with the insert of
//! another, as a record at capacity does it.
//! Run with `cargo bench -p aep-lattice-memory-core`. The run fails when
//! the exact scan of 2000 attractors takes 100 microseconds or more.

use aep_lattice_memory_core::{
    Attractor, DomainIndex, Fingerprint, FingerprintKind, SimHash, DEFAULT_SIMHASH_MIN_SCORE,
};
use std::hint::black_box;
use std::time::Instant;

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

fn build(size: usize, rng: &mut Lcg) -> DomainIndex {
    let mut index = DomainIndex::new(FingerprintKind::SimHash);
    for key in 1..=size as i64 {
        let mut digest = [0u8; 32];
        digest[..8].copy_from_slice(&key.to_le_bytes());
        let inserted = index.insert(Attractor {
            key,
            fingerprint: Fingerprint::SimHash(rng.hash()),
            shape_digest: digest,
            support: 1,
            formed_at_unix: key,
            last_seen_unix: key,
        });
        if inserted.is_err() {
            eprintln!("insert of key {key} failed");
            std::process::exit(1);
        }
    }
    index
}

/// Mean nanoseconds of one call over `rounds` calls.
fn mean_ns(rounds: u32, mut call: impl FnMut()) -> f64 {
    let start = Instant::now();
    for _ in 0..rounds {
        call();
    }
    start.elapsed().as_nanos() as f64 / f64::from(rounds)
}

fn main() {
    let mut rng = Lcg(42);
    println!("size      nearest_ns      scan_top5_ns    evict_insert_ns");
    let mut scan_2k_ns = 0.0;
    for size in [2_000usize, 20_000, 100_000] {
        let index = build(size, &mut rng);
        // Every lookup asks with a hash that was never asked before, so no remembered
        // answer is read.
        let nearest = mean_ns(20_000, || {
            let query = Fingerprint::SimHash(rng.hash());
            black_box(index.nearest(black_box(&query), DEFAULT_SIMHASH_MIN_SCORE));
        });
        let scan_rounds = if size > 20_000 { 200 } else { 2_000 };
        let scan = mean_ns(scan_rounds, || {
            let query = Fingerprint::SimHash(rng.hash());
            black_box(index.scan(black_box(&query), 5, 0));
        });
        if size == 2_000 {
            scan_2k_ns = scan;
        }
        // What a record at capacity does to the index: evict one attractor, take a new one.
        let mut index = index;
        let mut next_key = size as i64;
        let replace = mean_ns(20_000, || {
            next_key += 1;
            let mut digest = [0u8; 32];
            digest[..8].copy_from_slice(&next_key.to_le_bytes());
            let attractor = Attractor {
                key: next_key,
                fingerprint: Fingerprint::SimHash(rng.hash()),
                shape_digest: digest,
                support: 1,
                formed_at_unix: next_key,
                last_seen_unix: next_key,
            };
            let replaced = match index.eviction_candidate() {
                Some(evicted) => index.replace(evicted, attractor),
                None => index.insert(attractor),
            };
            black_box(replaced.is_ok());
        });
        println!("{size:<9} {nearest:<15.0} {scan:<15.0} {replace:<15.0}");
    }
    if scan_2k_ns >= 100_000.0 {
        eprintln!("search_2k_under_100us failed: {scan_2k_ns:.0} ns");
        std::process::exit(1);
    }
    println!("search_2k_under_100us ok: {scan_2k_ns:.0} ns");
}
