//! The in-memory backend. Nothing leaves the process and nothing survives it. It is
//! the backend for development and for tests of code that writes to a memory.

use crate::error::MemoryError;
use crate::model::{
    apply_entry, build_entry, check_record, Counts, DomainCounts, DomainHead, DomainVerify,
    HintReader, Match, MemoryBackend, NewRecord, Receipt, StoredRecord, VerifyReport,
};
use aep_lattice_memory_core::{
    genesis_hash, CoreConfig, Fingerprint, LogEntry, MemoryCore, RouteHint,
};
use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, RwLock};

#[derive(Debug)]
struct DomainLog {
    head: DomainHead,
    records: Vec<StoredRecord>,
    /// Attractor key to the key of the last record that touched it.
    last_touch: HashMap<i64, i64>,
}

/// A memory that lives in the process.
#[derive(Debug)]
pub struct InMemoryBackend {
    config: CoreConfig,
    core: Arc<RwLock<MemoryCore>>,
    domains: BTreeMap<String, DomainLog>,
}

impl InMemoryBackend {
    pub fn new(config: CoreConfig) -> Result<Self, MemoryError> {
        let core = MemoryCore::new(config)?;
        Ok(InMemoryBackend {
            config,
            core: Arc::new(RwLock::new(core)),
            domains: BTreeMap::new(),
        })
    }
}

/// Walk the entries of one domain from the genesis hash and rebuild its attractors in
/// a core of its own. Both backends verify through this walk.
pub(crate) fn verify_entries<'a>(
    config: CoreConfig,
    domain: &str,
    entries: impl Iterator<Item = (&'a LogEntry, [u8; 32])>,
) -> Result<(MemoryCore, DomainHead), MemoryError> {
    let mut core = MemoryCore::new(config)?;
    let mut head = DomainHead::empty();
    for (entry, hash) in entries {
        if entry.hash(domain) != hash {
            return Err(MemoryError::Corrupt(format!(
                "domain {domain}: entry {} does not hash to its stored hash",
                entry.key
            )));
        }
        apply_entry(&mut core, &mut head, domain, entry, hash)?;
    }
    Ok((core, head))
}

impl MemoryBackend for InMemoryBackend {
    fn record(&mut self, record: &NewRecord) -> Result<Receipt, MemoryError> {
        let checked = check_record(record)?;
        let mut core = self.core.write().map_err(|_| MemoryError::Poisoned)?;
        let head = self
            .domains
            .get(&record.domain)
            .map(|log| log.head)
            .unwrap_or_else(DomainHead::empty);
        let (entry, plan) = build_entry(&core, &head, &checked)?;
        let hash = entry.hash(&record.domain);
        let mut next = head;
        apply_entry(&mut core, &mut next, &record.domain, &entry, hash)?;
        let log = self
            .domains
            .entry(record.domain.clone())
            .or_insert_with(|| DomainLog {
                head: DomainHead::empty(),
                records: Vec::new(),
                last_touch: HashMap::new(),
            });
        log.head = next;
        let attractor_key = entry.outcome.attractor();
        if let Some(attractor) = attractor_key {
            log.last_touch.insert(attractor, entry.key);
        }
        if let aep_lattice_memory_core::Outcome::Form {
            evicted: Some(evicted),
            ..
        } = entry.outcome
        {
            log.last_touch.remove(&evicted);
        }
        let key = entry.key;
        log.records.push(StoredRecord {
            domain: record.domain.clone(),
            hash,
            entry,
        });
        Ok(Receipt {
            key,
            hash,
            plan,
            attractor_key,
        })
    }

    fn route_hint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        shape_digest: &[u8; 32],
    ) -> Result<RouteHint, MemoryError> {
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        Ok(core.route_hint(domain, fingerprint, shape_digest))
    }

    fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Result<Vec<Match>, MemoryError> {
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        core.check_fingerprint(domain, fingerprint)?;
        let (Some(index), Some(log)) = (core.domain(domain), self.domains.get(domain)) else {
            return Ok(Vec::new());
        };
        let mut matches = Vec::new();
        for hit in index.scan(fingerprint, limit, min_score) {
            let Some(attractor) = index.get(hit.key) else {
                continue;
            };
            let latest = log
                .last_touch
                .get(&hit.key)
                .and_then(|key| log.records.get((*key - 1) as usize))
                .cloned();
            matches.push(Match {
                attractor,
                score: hit.score,
                max_score: fingerprint.kind().max_score(),
                latest,
            });
        }
        Ok(matches)
    }

    fn history(
        &self,
        domain: &str,
        element_id: &str,
        accepted: Option<bool>,
        limit: usize,
    ) -> Result<Vec<StoredRecord>, MemoryError> {
        let Some(log) = self.domains.get(domain) else {
            return Ok(Vec::new());
        };
        Ok(log
            .records
            .iter()
            .filter(|r| r.entry.element_id == element_id)
            .filter(|r| accepted.is_none_or(|want| r.entry.accepted == want))
            .take(limit)
            .cloned()
            .collect())
    }

    fn export(&self, domain: Option<&str>, limit: usize) -> Result<Vec<StoredRecord>, MemoryError> {
        Ok(self
            .domains
            .iter()
            .filter(|(name, _)| domain.is_none_or(|want| want == name.as_str()))
            .flat_map(|(_, log)| log.records.iter())
            .take(limit)
            .cloned()
            .collect())
    }

    fn counts(&self) -> Result<Counts, MemoryError> {
        let core = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        let domains = self
            .domains
            .iter()
            .map(|(name, log)| DomainCounts {
                domain: name.clone(),
                records: log.records.len() as u64,
                attractors: core.domain(name).map(|i| i.len()).unwrap_or(0) as u64,
            })
            .collect();
        Ok(Counts::of(domains))
    }

    fn verify(&self) -> Result<VerifyReport, MemoryError> {
        let live = self.core.read().map_err(|_| MemoryError::Poisoned)?;
        let mut domains = Vec::new();
        for (name, log) in &self.domains {
            let (rebuilt, head) = verify_entries(
                self.config,
                name,
                log.records.iter().map(|r| (&r.entry, r.hash)),
            )?;
            let rebuilt_attractors = rebuilt
                .domain(name)
                .map(|i| i.attractors())
                .unwrap_or_default();
            let live_attractors = live
                .domain(name)
                .map(|i| i.attractors())
                .unwrap_or_default();
            if rebuilt_attractors != live_attractors || head != log.head {
                return Err(MemoryError::Corrupt(format!(
                    "domain {name}: the attractors do not follow from the log"
                )));
            }
            domains.push(DomainVerify {
                domain: name.clone(),
                records: log.records.len() as u64,
                attractors: rebuilt_attractors.len() as u64,
                head_hash: if log.records.is_empty() {
                    genesis_hash()
                } else {
                    head.head_hash
                },
            });
        }
        Ok(VerifyReport::of(domains))
    }

    fn reader(&self) -> HintReader {
        HintReader::new(self.core.clone())
    }

    fn config(&self) -> CoreConfig {
        self.config
    }
}
