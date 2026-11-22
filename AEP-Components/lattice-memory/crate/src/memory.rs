//! The in-memory backend. Nothing leaves the process and nothing survives it. It is
//! the backend for development and for tests of code that writes to a memory.

use crate::error::MemoryError;
use crate::model::{
    apply_entry, build_entry, check_record, Counts, Cursor, DomainAnchor, DomainCounts, DomainHead,
    DomainVerify, Match, MemoryBackend, NewRecord, Page, Receipt, RecordQuery, StoredRecord,
    VerifyReport,
};
use aep_lattice_memory_core::{
    check_domain, genesis_hash, CoreConfig, Fingerprint, MemoryCore, RouteHint,
};
use std::collections::{BTreeMap, HashMap};

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
    core: MemoryCore,
    domains: BTreeMap<String, DomainLog>,
}

impl InMemoryBackend {
    pub fn new(config: CoreConfig) -> Result<Self, MemoryError> {
        Ok(InMemoryBackend {
            config,
            core: MemoryCore::new(config)?,
            domains: BTreeMap::new(),
        })
    }

    /// Call `visit` with every record a query names until it answers false. Returns
    /// true when the walk reached the last record.
    fn walk(
        &self,
        query: &RecordQuery<'_>,
        mut visit: impl FnMut(&StoredRecord) -> bool,
    ) -> Result<bool, MemoryError> {
        if let Some(name) = query.domain {
            check_domain(name)?;
        }
        for (name, log) in &self.domains {
            if query.domain.is_some_and(|want| want != name.as_str()) {
                continue;
            }
            let from = match query.after {
                Some(after) if after.domain.as_str() > name.as_str() => continue,
                Some(after) if after.domain == *name => after.key.max(0) as usize,
                _ => 0,
            };
            for record in log.records.iter().skip(from) {
                if query.keeps(&record.entry) && !visit(record) {
                    return Ok(false);
                }
            }
        }
        Ok(true)
    }
}

impl MemoryBackend for InMemoryBackend {
    fn record(&mut self, record: &NewRecord) -> Result<Receipt, MemoryError> {
        let checked = check_record(record)?;
        let head = self
            .domains
            .get(&record.domain)
            .map(|log| log.head)
            .unwrap_or_else(DomainHead::empty);
        let (entry, plan) = build_entry(&self.core, &head, &checked)?;
        let hash = entry.hash(&record.domain);
        let mut next = head;
        apply_entry(&mut self.core, &mut next, &record.domain, &entry, hash)?;
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
        Ok(self.core.route_hint(domain, fingerprint, shape_digest))
    }

    fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Result<Vec<Match>, MemoryError> {
        self.core.check_fingerprint(domain, fingerprint)?;
        let (Some(index), Some(log)) = (self.core.domain(domain), self.domains.get(domain)) else {
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

    fn records(&self, query: &RecordQuery<'_>) -> Result<Page, MemoryError> {
        let mut page = Page::default();
        if query.limit == 0 {
            return Ok(page);
        }
        let mut bytes = 0usize;
        let ended = self.walk(query, |record| {
            // The page is full: this record proves that a next page exists.
            let full = page.records.len() >= query.limit
                || (!page.records.is_empty() && bytes >= query.max_bytes);
            if full {
                return false;
            }
            bytes = bytes.saturating_add(record.entry.encode().len());
            page.records.push(record.clone());
            true
        })?;
        if !ended {
            page.next = page.records.last().map(|record| Cursor {
                domain: record.domain.clone(),
                key: record.entry.key,
                offset: 0,
            });
        }
        Ok(page)
    }

    fn count(&self, query: &RecordQuery<'_>) -> Result<u64, MemoryError> {
        let mut count = 0u64;
        self.walk(query, |_| {
            count += 1;
            true
        })?;
        Ok(count)
    }

    fn counts(&self) -> Result<Counts, MemoryError> {
        let domains = self
            .domains
            .iter()
            .map(|(name, log)| DomainCounts {
                domain: name.clone(),
                records: log.records.len() as u64,
                attractors: self.core.domain(name).map(|i| i.len()).unwrap_or(0) as u64,
            })
            .collect();
        Ok(Counts::of(domains))
    }

    fn anchors(&self) -> Vec<DomainAnchor> {
        self.domains
            .iter()
            .map(|(name, log)| DomainAnchor {
                domain: name.clone(),
                records: log.records.len() as u64,
                head_hash: log.head.head_hash,
            })
            .collect()
    }

    fn sync(&mut self) -> Result<(), MemoryError> {
        // Nothing of this backend is on a disk.
        Ok(())
    }

    fn verify(&self) -> Result<VerifyReport, MemoryError> {
        let mut domains = Vec::new();
        for (name, log) in &self.domains {
            // Walk the entries from the genesis hash and rebuild the attractors in a
            // core of their own.
            let mut rebuilt = MemoryCore::new(self.config)?;
            let mut head = DomainHead::empty();
            for record in &log.records {
                if record.entry.hash(name) != record.hash {
                    return Err(MemoryError::Corrupt(format!(
                        "domain {name}: entry {} does not hash to its stored hash",
                        record.entry.key
                    )));
                }
                apply_entry(&mut rebuilt, &mut head, name, &record.entry, record.hash)?;
            }
            let rebuilt_attractors = rebuilt
                .domain(name)
                .map(|i| i.attractors())
                .unwrap_or_default();
            let live_attractors = self
                .core
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

    fn config(&self) -> CoreConfig {
        self.config
    }
}
