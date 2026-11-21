//! Attractors: what the memory keeps of the accepted proposals of a domain.
//!
//! Every judged proposal is one record in the log. Only accepted records touch the
//! attractors. An accepted record at or above the threshold raises the support count
//! of the nearest attractor. Any other accepted record forms a new attractor. A
//! rejection enters the log and forms nothing.
//!
//! The core decides in two steps so a store can keep its transaction whole. `plan`
//! reads and changes nothing. The store writes the plan inside one transaction and
//! calls `apply_reinforce` or `apply_form` only after the transaction is committed.

use crate::error::CoreError;
use crate::fingerprint::{Fingerprint, FingerprintKind, EMBEDDING_MAX_SCORE, SIMHASH_MAX_SCORE};
use crate::index::{Attractor, DomainIndex, Hit};
use std::collections::BTreeMap;

/// Attractors one domain holds before eviction starts.
pub const DEFAULT_CAPACITY_PER_DOMAIN: usize = 100_000;
/// SimHash threshold: 230 of 256 equal bits. Two token sets with a cosine of 0.95
/// differ in 26 bits on average, so this is the 0.95 threshold in integers.
pub const DEFAULT_SIMHASH_MIN_SCORE: i32 = 230;
/// Embedding threshold: 0.95 of the score of two equal unit vectors.
pub const DEFAULT_EMBEDDING_MIN_SCORE: i32 = 15_323;
/// Longest domain name.
pub const MAX_DOMAIN_LEN: usize = 64;

/// The settings of a memory.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CoreConfig {
    /// Attractors one domain holds. At this count a new attractor evicts one.
    pub capacity_per_domain: usize,
    /// Lowest score of two SimHashes that counts as the same attractor.
    pub simhash_min_score: i32,
    /// Dimension of operator embeddings. Zero turns operator embeddings off.
    pub embedding_dim: usize,
    /// Lowest score of two embeddings that counts as the same attractor.
    pub embedding_min_score: i32,
}

impl Default for CoreConfig {
    fn default() -> Self {
        CoreConfig {
            capacity_per_domain: DEFAULT_CAPACITY_PER_DOMAIN,
            simhash_min_score: DEFAULT_SIMHASH_MIN_SCORE,
            embedding_dim: 0,
            embedding_min_score: DEFAULT_EMBEDDING_MIN_SCORE,
        }
    }
}

impl CoreConfig {
    /// Refuse settings no memory can run with.
    pub fn check(&self) -> Result<(), CoreError> {
        if self.capacity_per_domain == 0 {
            return Err(CoreError::invalid(
                "capacity_per_domain",
                "must be at least 1",
            ));
        }
        if !(0..=SIMHASH_MAX_SCORE).contains(&self.simhash_min_score) {
            return Err(CoreError::invalid(
                "simhash_min_score",
                "must lie between 0 and 256",
            ));
        }
        if self.embedding_dim > crate::fingerprint::MAX_EMBEDDING_DIM {
            return Err(CoreError::invalid(
                "embedding_dim",
                format!("must not exceed {}", crate::fingerprint::MAX_EMBEDDING_DIM),
            ));
        }
        if !(0..=EMBEDDING_MAX_SCORE).contains(&self.embedding_min_score) {
            return Err(CoreError::invalid(
                "embedding_min_score",
                format!("must lie between 0 and {EMBEDDING_MAX_SCORE}"),
            ));
        }
        Ok(())
    }

    /// The threshold of a kind of fingerprint.
    pub fn min_score(&self, kind: FingerprintKind) -> i32 {
        match kind {
            FingerprintKind::SimHash => self.simhash_min_score,
            FingerprintKind::Embedding { .. } => self.embedding_min_score,
        }
    }
}

/// A domain name: lower case letters, digits, dot, hyphen and underscore.
pub fn check_domain(domain: &str) -> Result<(), CoreError> {
    if domain.is_empty() || domain.len() > MAX_DOMAIN_LEN {
        return Err(CoreError::invalid(
            "domain",
            format!("must hold 1 to {MAX_DOMAIN_LEN} characters"),
        ));
    }
    let allowed = |c: char| c.is_ascii_lowercase() || c.is_ascii_digit() || "._-".contains(c);
    if !domain.chars().all(allowed) {
        return Err(CoreError::invalid(
            "domain",
            "only lower case letters, digits, dot, hyphen and underscore",
        ));
    }
    Ok(())
}

/// One judged proposal as the core sees it.
#[derive(Debug, Clone, Copy)]
pub struct Observation<'a> {
    pub domain: &'a str,
    pub fingerprint: &'a Fingerprint,
    pub shape_digest: &'a [u8; 32],
    /// True for an accepted proposal, false for a rejection.
    pub accepted: bool,
    pub at_unix: i64,
}

/// What a record does to the attractors of its domain.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Plan {
    /// A rejection: the record enters the log and no attractor changes.
    LogOnly,
    /// An accepted record at or above the threshold: the support of this attractor rises.
    Reinforce {
        key: i64,
        score: i32,
        /// True when the shape digest of the record equals the one of the attractor.
        exact: bool,
    },
    /// An accepted record away from every attractor: a new attractor forms. At
    /// capacity the named attractor is evicted in the same step.
    Form { evict: Option<i64> },
}

/// What the memory says about a proposal before it is judged. A hint schedules work.
/// It never decides a verdict and never skips a wall.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteHint {
    /// No attractor is near. The proposal takes the cold path.
    Cold,
    /// An attractor is at or above the threshold.
    Hot {
        attractor: i64,
        score: i32,
        support: u64,
        /// True when an accepted proposal of exactly this shape was recorded before.
        exact: bool,
    },
}

impl RouteHint {
    pub fn is_hot(&self) -> bool {
        matches!(self, RouteHint::Hot { .. })
    }
}

/// The attractors of every domain. No I/O happens here.
#[derive(Debug, Clone)]
pub struct MemoryCore {
    config: CoreConfig,
    domains: BTreeMap<String, DomainIndex>,
}

impl MemoryCore {
    pub fn new(config: CoreConfig) -> Result<Self, CoreError> {
        config.check()?;
        Ok(MemoryCore {
            config,
            domains: BTreeMap::new(),
        })
    }

    pub fn config(&self) -> &CoreConfig {
        &self.config
    }

    /// Refuse a fingerprint the store cannot hold: an embedding while embeddings are
    /// off, an embedding of the wrong dimension or a kind the domain does not hold.
    pub fn check_fingerprint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
    ) -> Result<(), CoreError> {
        if let Fingerprint::Embedding(embedding) = fingerprint {
            if self.config.embedding_dim == 0 {
                return Err(CoreError::EmbeddingsOff);
            }
            if embedding.dim() != self.config.embedding_dim {
                return Err(CoreError::DimensionMismatch {
                    expected: self.config.embedding_dim,
                    got: embedding.dim(),
                });
            }
        }
        match self.domains.get(domain) {
            Some(index) => index.check_kind(domain, fingerprint),
            None => Ok(()),
        }
    }

    /// Decide what one record does. Nothing changes.
    pub fn plan(&self, observation: &Observation<'_>) -> Result<Plan, CoreError> {
        check_domain(observation.domain)?;
        self.check_fingerprint(observation.domain, observation.fingerprint)?;
        if !observation.accepted {
            return Ok(Plan::LogOnly);
        }
        let Some(index) = self.domains.get(observation.domain) else {
            return Ok(Plan::Form { evict: None });
        };
        if let Some(key) = index.exact(observation.shape_digest) {
            return Ok(Plan::Reinforce {
                key,
                score: observation.fingerprint.kind().max_score(),
                exact: true,
            });
        }
        let min_score = self.config.min_score(observation.fingerprint.kind());
        if let Some(Hit { key, score }) = index.nearest(observation.fingerprint, min_score) {
            return Ok(Plan::Reinforce {
                key,
                score,
                exact: false,
            });
        }
        let evict = if index.len() >= self.config.capacity_per_domain {
            index.eviction_candidate()
        } else {
            None
        };
        Ok(Plan::Form { evict })
    }

    /// Carry out a `Plan::Reinforce` after the store committed it. Returns the new support.
    pub fn apply_reinforce(&mut self, domain: &str, key: i64, at_unix: i64) -> Option<u64> {
        self.domains.get_mut(domain)?.reinforce(key, at_unix)
    }

    /// Carry out a `Plan::Form` after the store committed it. `key` is the key the
    /// store gave the new attractor.
    pub fn apply_form(
        &mut self,
        observation: &Observation<'_>,
        key: i64,
        evict: Option<i64>,
    ) -> Result<(), CoreError> {
        check_domain(observation.domain)?;
        self.check_fingerprint(observation.domain, observation.fingerprint)?;
        let kind = observation.fingerprint.kind();
        let index = self
            .domains
            .entry(observation.domain.to_string())
            .or_insert_with(|| DomainIndex::new(kind));
        let attractor = Attractor {
            key,
            fingerprint: observation.fingerprint.clone(),
            shape_digest: *observation.shape_digest,
            support: 1,
            formed_at_unix: observation.at_unix,
            last_seen_unix: observation.at_unix,
        };
        match evict {
            Some(evicted) => index.replace(evicted, attractor),
            None => index.insert(attractor),
        }
    }

    /// Put a stored attractor into the index. A store calls this for every stored
    /// attractor when it opens.
    pub fn load(&mut self, domain: &str, attractor: Attractor) -> Result<(), CoreError> {
        check_domain(domain)?;
        self.check_fingerprint(domain, &attractor.fingerprint)?;
        let kind = attractor.fingerprint.kind();
        self.domains
            .entry(domain.to_string())
            .or_insert_with(|| DomainIndex::new(kind))
            .insert(attractor)
    }

    /// Forget one domain. A store calls this before it reads the domain again.
    pub fn clear_domain(&mut self, domain: &str) {
        self.domains.remove(domain);
    }

    /// Forget every domain.
    pub fn clear(&mut self) {
        self.domains.clear();
    }

    /// The hint for a proposal that is about to be judged.
    pub fn route_hint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        shape_digest: &[u8; 32],
    ) -> RouteHint {
        let Some(index) = self.domains.get(domain) else {
            return RouteHint::Cold;
        };
        if index.kind() != fingerprint.kind() {
            return RouteHint::Cold;
        }
        if let Some(key) = index.exact(shape_digest) {
            return RouteHint::Hot {
                attractor: key,
                score: fingerprint.kind().max_score(),
                support: index.support(key).unwrap_or(0),
                exact: true,
            };
        }
        let min_score = self.config.min_score(fingerprint.kind());
        match index.nearest(fingerprint, min_score) {
            Some(Hit { key, score }) => RouteHint::Hot {
                attractor: key,
                score,
                support: index.support(key).unwrap_or(0),
                exact: false,
            },
            None => RouteHint::Cold,
        }
    }

    /// Exact search in one domain: the `limit` best attractors at or above `min_score`.
    pub fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Vec<Hit> {
        match self.domains.get(domain) {
            Some(index) => index.scan(fingerprint, limit, min_score),
            None => Vec::new(),
        }
    }

    pub fn domain(&self, domain: &str) -> Option<&DomainIndex> {
        self.domains.get(domain)
    }

    /// The domains in name order with their attractor counts.
    pub fn domain_counts(&self) -> Vec<(String, usize)> {
        self.domains
            .iter()
            .map(|(name, index)| (name.clone(), index.len()))
            .collect()
    }

    /// Attractors of every domain together.
    pub fn attractor_count(&self) -> usize {
        self.domains.values().map(DomainIndex::len).sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::{QuantizedEmbedding, SimHash};

    fn hash(seed: u64) -> Fingerprint {
        // Spread the seed so two seeds give far hashes.
        let mut x = seed.wrapping_mul(0x9e37_79b9_7f4a_7c15) | 1;
        let mut words = [0u64; 4];
        for word in words.iter_mut() {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            *word = x;
        }
        Fingerprint::SimHash(SimHash(words))
    }

    fn digest(seed: u64) -> [u8; 32] {
        let mut out = [0u8; 32];
        out[..8].copy_from_slice(&seed.to_le_bytes());
        out
    }

    /// Record one observation the way a store does: plan, take a key, apply.
    fn record(core: &mut MemoryCore, next_key: &mut i64, obs: &Observation<'_>) -> Plan {
        let plan = core.plan(obs).unwrap();
        match plan {
            Plan::LogOnly => {}
            Plan::Reinforce { key, .. } => {
                core.apply_reinforce(obs.domain, key, obs.at_unix).unwrap();
            }
            Plan::Form { evict } => {
                *next_key += 1;
                core.apply_form(obs, *next_key, evict).unwrap();
            }
        }
        plan
    }

    fn obs<'a>(
        domain: &'a str,
        fingerprint: &'a Fingerprint,
        shape_digest: &'a [u8; 32],
        accepted: bool,
        at_unix: i64,
    ) -> Observation<'a> {
        Observation {
            domain,
            fingerprint,
            shape_digest,
            accepted,
            at_unix,
        }
    }

    #[test]
    fn accepted_merges_into_nearest() {
        let mut core = MemoryCore::new(CoreConfig::default()).unwrap();
        let mut key = 0;
        let base = hash(1);
        let first = record(
            &mut core,
            &mut key,
            &obs("admit", &base, &digest(1), true, 10),
        );
        assert_eq!(first, Plan::Form { evict: None });
        // A hash that differs in three bits is the same attractor.
        let Fingerprint::SimHash(SimHash(mut words)) = base.clone() else {
            panic!("simhash");
        };
        words[0] ^= 0b111;
        let near = Fingerprint::SimHash(SimHash(words));
        let second = record(
            &mut core,
            &mut key,
            &obs("admit", &near, &digest(2), true, 20),
        );
        assert_eq!(
            second,
            Plan::Reinforce {
                key: 1,
                score: 253,
                exact: false
            }
        );
        // The same shape digest again is an exact match.
        let third = record(
            &mut core,
            &mut key,
            &obs("admit", &base, &digest(1), true, 30),
        );
        assert_eq!(
            third,
            Plan::Reinforce {
                key: 1,
                score: 256,
                exact: true
            }
        );
        let index = core.domain("admit").unwrap();
        assert_eq!(index.len(), 1);
        assert_eq!(index.support(1), Some(3));
        assert_eq!(index.get(1).unwrap().last_seen_unix, 30);
        assert_eq!(index.get(1).unwrap().formed_at_unix, 10);
        // A far hash forms its own attractor.
        let far = hash(2);
        let fourth = record(
            &mut core,
            &mut key,
            &obs("admit", &far, &digest(3), true, 40),
        );
        assert_eq!(fourth, Plan::Form { evict: None });
        assert_eq!(core.attractor_count(), 2);
    }

    #[test]
    fn rejected_never_forms_attractor() {
        let mut core = MemoryCore::new(CoreConfig::default()).unwrap();
        let mut key = 0;
        let fp = hash(1);
        for at in 0..50 {
            let plan = record(
                &mut core,
                &mut key,
                &obs("admit", &fp, &digest(1), false, at),
            );
            assert_eq!(plan, Plan::LogOnly);
        }
        assert_eq!(core.attractor_count(), 0);
        assert!(core.domain("admit").is_none());
        assert_eq!(core.route_hint("admit", &fp, &digest(1)), RouteHint::Cold);
        // A rejection next to an attractor does not raise its support.
        record(
            &mut core,
            &mut key,
            &obs("admit", &fp, &digest(1), true, 60),
        );
        record(
            &mut core,
            &mut key,
            &obs("admit", &fp, &digest(1), false, 61),
        );
        assert_eq!(core.domain("admit").unwrap().support(1), Some(1));
    }

    #[test]
    fn eviction_is_deterministic() {
        fn run() -> Vec<(i64, u64)> {
            let config = CoreConfig {
                capacity_per_domain: 4,
                ..CoreConfig::default()
            };
            let mut core = MemoryCore::new(config).unwrap();
            let mut key = 0;
            for seed in 1..=4u64 {
                record(
                    &mut core,
                    &mut key,
                    &obs("admit", &hash(seed), &digest(seed), true, seed as i64),
                );
            }
            // Raise the support of attractors 1 and 3.
            record(
                &mut core,
                &mut key,
                &obs("admit", &hash(1), &digest(1), true, 10),
            );
            record(
                &mut core,
                &mut key,
                &obs("admit", &hash(3), &digest(3), true, 11),
            );
            // Lowest support is shared by 2 and 4. The one seen longer ago goes: 2.
            let plan = record(
                &mut core,
                &mut key,
                &obs("admit", &hash(5), &digest(5), true, 12),
            );
            assert_eq!(plan, Plan::Form { evict: Some(2) });
            // Now 4 and 5 hold the lowest support and 4 was seen longer ago.
            let plan = record(
                &mut core,
                &mut key,
                &obs("admit", &hash(6), &digest(6), true, 13),
            );
            assert_eq!(plan, Plan::Form { evict: Some(4) });
            // 5 and 6 hold support 1 and 5 was seen longer ago, so 5 goes.
            record(
                &mut core,
                &mut key,
                &obs("admit", &hash(7), &digest(7), true, 13),
            );
            let index = core.domain("admit").unwrap();
            assert_eq!(index.len(), 4);
            index
                .attractors()
                .iter()
                .map(|a| (a.key, a.support))
                .collect()
        }
        let first = run();
        assert_eq!(first, vec![(1, 2), (3, 2), (6, 1), (7, 1)]);
        for _ in 0..5 {
            assert_eq!(run(), first);
        }
    }

    #[test]
    fn capacity_never_blocks_record() {
        let config = CoreConfig {
            capacity_per_domain: 8,
            ..CoreConfig::default()
        };
        let mut core = MemoryCore::new(config).unwrap();
        let mut key = 0;
        for seed in 1..=2500u64 {
            // Every record is accepted and far from every other, so each one needs room.
            let plan = record(
                &mut core,
                &mut key,
                &obs("admit", &hash(seed), &digest(seed), true, seed as i64),
            );
            assert!(matches!(plan, Plan::Form { .. }), "record {seed}");
            assert!(core.domain("admit").unwrap().len() <= 8);
        }
        assert_eq!(core.domain("admit").unwrap().len(), 8);
        assert_eq!(key, 2500);
    }

    #[test]
    fn capacity_is_per_domain() {
        let config = CoreConfig {
            capacity_per_domain: 2,
            ..CoreConfig::default()
        };
        let mut core = MemoryCore::new(config).unwrap();
        let mut key = 0;
        for seed in 1..=6u64 {
            let domain = if seed % 2 == 0 { "admit" } else { "intent" };
            record(
                &mut core,
                &mut key,
                &obs(domain, &hash(seed), &digest(seed), true, seed as i64),
            );
        }
        assert_eq!(
            core.domain_counts(),
            vec![("admit".to_string(), 2), ("intent".to_string(), 2)]
        );
        // An attractor of one domain is not a hint in the other.
        assert_eq!(
            core.route_hint("admit", &hash(5), &digest(5)),
            RouteHint::Cold
        );
        assert!(core.route_hint("intent", &hash(5), &digest(5)).is_hot());
    }

    #[test]
    fn route_hint_is_hot_near_an_attractor_and_cold_elsewhere() {
        let mut core = MemoryCore::new(CoreConfig::default()).unwrap();
        let mut key = 0;
        let base = hash(1);
        record(
            &mut core,
            &mut key,
            &obs("admit", &base, &digest(1), true, 10),
        );
        assert_eq!(
            core.route_hint("admit", &base, &digest(1)),
            RouteHint::Hot {
                attractor: 1,
                score: 256,
                support: 1,
                exact: true
            }
        );
        // The same hash under another shape digest is near but not exact.
        assert_eq!(
            core.route_hint("admit", &base, &digest(9)),
            RouteHint::Hot {
                attractor: 1,
                score: 256,
                support: 1,
                exact: false
            }
        );
        assert_eq!(
            core.route_hint("admit", &hash(2), &digest(2)),
            RouteHint::Cold
        );
        assert_eq!(core.route_hint("other", &base, &digest(1)), RouteHint::Cold);
    }

    #[test]
    fn plan_changes_nothing() {
        let mut core = MemoryCore::new(CoreConfig::default()).unwrap();
        let mut key = 0;
        record(
            &mut core,
            &mut key,
            &obs("admit", &hash(1), &digest(1), true, 10),
        );
        let before = core.domain("admit").unwrap().attractors();
        for _ in 0..3 {
            core.plan(&obs("admit", &hash(1), &digest(1), true, 99))
                .unwrap();
            core.plan(&obs("admit", &hash(2), &digest(2), true, 99))
                .unwrap();
        }
        assert_eq!(core.domain("admit").unwrap().attractors(), before);
    }

    #[test]
    fn embeddings_are_checked_against_the_store_and_the_domain() {
        let config = CoreConfig {
            embedding_dim: 4,
            ..CoreConfig::default()
        };
        let mut core = MemoryCore::new(config).unwrap();
        let mut key = 0;
        let good =
            Fingerprint::Embedding(QuantizedEmbedding::quantize(&[1.0, 0.0, 0.0, 0.0], 4).unwrap());
        let wrong =
            Fingerprint::Embedding(QuantizedEmbedding::quantize(&[1.0, 0.0, 0.0], 3).unwrap());
        assert_eq!(
            core.plan(&obs("ops", &wrong, &digest(1), true, 1)),
            Err(CoreError::DimensionMismatch {
                expected: 4,
                got: 3
            })
        );
        record(&mut core, &mut key, &obs("ops", &good, &digest(1), true, 1));
        // The domain now holds embeddings, so a SimHash is refused there.
        assert!(matches!(
            core.plan(&obs("ops", &hash(1), &digest(2), true, 2)),
            Err(CoreError::KindMismatch { .. })
        ));
        // A rejection is checked too, so no record of the wrong kind enters the log.
        assert!(matches!(
            core.plan(&obs("ops", &hash(1), &digest(2), false, 2)),
            Err(CoreError::KindMismatch { .. })
        ));
        let near = Fingerprint::Embedding(
            QuantizedEmbedding::quantize(&[0.99, 0.1, 0.0, 0.0], 4).unwrap(),
        );
        assert!(matches!(
            core.plan(&obs("ops", &near, &digest(3), true, 3)),
            Ok(Plan::Reinforce {
                key: 1,
                exact: false,
                ..
            })
        ));
        let off = MemoryCore::new(CoreConfig::default()).unwrap();
        assert_eq!(
            off.plan(&obs("ops", &good, &digest(1), true, 1)),
            Err(CoreError::EmbeddingsOff)
        );
    }

    #[test]
    fn domain_names_are_checked() {
        assert!(check_domain("admit.validation_engine").is_ok());
        assert!(check_domain("intent-knots_1").is_ok());
        for bad in ["", "Admit", "a b", "a/b", &"x".repeat(65)] {
            assert!(check_domain(bad).is_err(), "{bad}");
        }
    }

    #[test]
    fn settings_out_of_range_are_refused() {
        let mut config = CoreConfig::default();
        assert!(config.check().is_ok());
        config.capacity_per_domain = 0;
        assert!(config.check().is_err());
        config = CoreConfig {
            simhash_min_score: 257,
            ..CoreConfig::default()
        };
        assert!(config.check().is_err());
        config = CoreConfig {
            embedding_dim: 5000,
            ..CoreConfig::default()
        };
        assert!(config.check().is_err());
        config = CoreConfig {
            embedding_min_score: -1,
            ..CoreConfig::default()
        };
        assert!(MemoryCore::new(config).is_err());
    }

    #[test]
    fn load_rebuilds_the_same_index() {
        let mut live = MemoryCore::new(CoreConfig::default()).unwrap();
        let mut key = 0;
        for seed in 1..=40u64 {
            record(
                &mut live,
                &mut key,
                &obs(
                    "admit",
                    &hash(seed % 25),
                    &digest(seed % 25),
                    true,
                    seed as i64,
                ),
            );
        }
        let mut rebuilt = MemoryCore::new(CoreConfig::default()).unwrap();
        for attractor in live.domain("admit").unwrap().attractors() {
            rebuilt.load("admit", attractor).unwrap();
        }
        assert_eq!(
            rebuilt.domain("admit").unwrap().attractors(),
            live.domain("admit").unwrap().attractors()
        );
        for seed in 0..60u64 {
            let fp = hash(seed);
            assert_eq!(
                rebuilt.route_hint("admit", &fp, &digest(seed)),
                live.route_hint("admit", &fp, &digest(seed))
            );
            assert_eq!(
                rebuilt.search("admit", &fp, 5, 0),
                live.search("admit", &fp, 5, 0)
            );
            assert_eq!(
                rebuilt.plan(&obs("admit", &fp, &digest(seed), true, 100)),
                live.plan(&obs("admit", &fp, &digest(seed), true, 100))
            );
        }
    }
}
