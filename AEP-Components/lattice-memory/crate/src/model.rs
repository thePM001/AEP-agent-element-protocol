//! What a caller hands to a backend and what a backend hands back.

use aep_lattice_memory_core::{
    canonical_json, canonical_labels, check_domain, check_id, parse_labels, Attractor, CoreConfig,
    CoreError, Fingerprint, LogEntry, MemoryCore, Observation, Outcome, Plan, RouteHint,
    MAX_BODY_BYTES,
};
use std::collections::BTreeMap;

use crate::error::MemoryError;

/// The domain of the proposals the Admit Gate judged, and the prefix of its sub
/// domains. A record there holds the digest and the fingerprint of a proposal and
/// never its body.
pub const JUDGED_DOMAIN: &str = "admit";

/// True for the domain of judged proposals and for each of its sub domains.
pub fn is_judged_domain(domain: &str) -> bool {
    domain == JUDGED_DOMAIN
        || domain
            .strip_prefix(JUDGED_DOMAIN)
            .is_some_and(|rest| rest.starts_with('.'))
}

/// One record to write.
#[derive(Debug, Clone, PartialEq)]
pub struct NewRecord {
    /// Id the caller gives the record.
    pub entry_id: String,
    pub domain: String,
    /// What the record is about: an agent, an intent or a run.
    pub element_id: String,
    /// True for an accepted proposal, false for a rejection.
    pub accepted: bool,
    pub recorded_at_unix: i64,
    pub shape_digest: [u8; 32],
    pub fingerprint: Fingerprint,
    /// Short names with short values. Never the body of a proposal.
    pub labels: BTreeMap<String, String>,
    /// A JSON text the owner of a domain keeps with the record, such as the
    /// checkpoint of a graph run. The domain of judged proposals refuses a body.
    pub body: Option<String>,
}

/// A record after its checks, with the texts the store writes.
#[derive(Debug, Clone)]
pub(crate) struct CheckedRecord<'a> {
    pub(crate) record: &'a NewRecord,
    pub(crate) labels: String,
    pub(crate) body: Option<String>,
}

fn invalid(field: &'static str, reason: impl Into<String>) -> MemoryError {
    MemoryError::Core(CoreError::Invalid {
        field,
        reason: reason.into(),
    })
}

/// Check every bound of a record before anything is written.
pub(crate) fn check_record(record: &NewRecord) -> Result<CheckedRecord<'_>, MemoryError> {
    check_id("entry_id", &record.entry_id)?;
    check_id("element_id", &record.element_id)?;
    check_domain(&record.domain)?;
    let labels = canonical_labels(&record.labels)?;
    let body = match &record.body {
        None => None,
        Some(text) => {
            if is_judged_domain(&record.domain) {
                return Err(invalid(
                    "body",
                    "the domain of judged proposals holds no proposal body",
                ));
            }
            if text.len() > MAX_BODY_BYTES {
                return Err(invalid("body", format!("exceeds {MAX_BODY_BYTES} bytes")));
            }
            let value: serde_json::Value = serde_json::from_str(text)
                .map_err(|e| invalid("body", format!("is not JSON: {e}")))?;
            let canonical = canonical_json(&value);
            if canonical.len() > MAX_BODY_BYTES {
                return Err(invalid("body", format!("exceeds {MAX_BODY_BYTES} bytes")));
            }
            Some(canonical)
        }
    };
    Ok(CheckedRecord {
        record,
        labels,
        body,
    })
}

/// Where the log of one domain stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct DomainHead {
    /// Key of the newest entry, 0 for an empty log.
    pub(crate) last_key: i64,
    /// Hash of the newest entry, or the genesis hash.
    pub(crate) head_hash: [u8; 32],
    /// Highest attractor key the domain ever gave out.
    pub(crate) last_attractor_key: i64,
}

impl DomainHead {
    pub(crate) fn empty() -> Self {
        DomainHead {
            last_key: 0,
            head_hash: aep_lattice_memory_core::genesis_hash(),
            last_attractor_key: 0,
        }
    }
}

/// Decide what a record does and build its log entry. Nothing changes.
pub(crate) fn build_entry(
    core: &MemoryCore,
    head: &DomainHead,
    checked: &CheckedRecord<'_>,
) -> Result<(LogEntry, Plan), MemoryError> {
    let record = checked.record;
    let plan = core.plan(&Observation {
        domain: &record.domain,
        fingerprint: &record.fingerprint,
        shape_digest: &record.shape_digest,
        accepted: record.accepted,
        at_unix: record.recorded_at_unix,
    })?;
    let held = core
        .domain(&record.domain)
        .map(|index| index.len())
        .unwrap_or(0) as u64;
    let (outcome, attractors_after) = match plan {
        Plan::LogOnly => (Outcome::LogOnly, held),
        Plan::Reinforce { key, .. } => (Outcome::Reinforce { attractor: key }, held),
        Plan::Form { evict } => (
            Outcome::Form {
                attractor: head.last_attractor_key + 1,
                evicted: evict,
            },
            if evict.is_some() { held } else { held + 1 },
        ),
    };
    let entry = LogEntry {
        key: head.last_key + 1,
        entry_id: record.entry_id.clone(),
        element_id: record.element_id.clone(),
        accepted: record.accepted,
        recorded_at_unix: record.recorded_at_unix,
        shape_digest: record.shape_digest,
        fingerprint_kind: record.fingerprint.kind().code(),
        fingerprint: record.fingerprint.to_bytes(),
        outcome,
        attractors_after,
        labels: checked.labels.clone(),
        body: checked.body.clone(),
        prev_hash: head.head_hash,
    };
    Ok((entry, plan))
}

/// Carry out the outcome of a log entry on the attractors and move the head. A write
/// and a replay of the log both come through here, so the attractors a store holds
/// while it runs are the attractors it rebuilds when it opens.
pub(crate) fn apply_entry(
    core: &mut MemoryCore,
    head: &mut DomainHead,
    domain: &str,
    entry: &LogEntry,
    hash: [u8; 32],
) -> Result<(), MemoryError> {
    if entry.key != head.last_key + 1 {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: entry {} follows entry {}",
            entry.key, head.last_key
        )));
    }
    if entry.prev_hash != head.head_hash {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: entry {} does not name the hash of the entry before it",
            entry.key
        )));
    }
    match entry.outcome {
        Outcome::LogOnly => {}
        Outcome::Reinforce { attractor } => {
            if core
                .apply_reinforce(domain, attractor, entry.recorded_at_unix)
                .is_none()
            {
                return Err(MemoryError::Corrupt(format!(
                    "domain {domain}: entry {} reinforces attractor {attractor}, which the domain does not hold",
                    entry.key
                )));
            }
        }
        Outcome::Form { attractor, evicted } => {
            if attractor <= head.last_attractor_key {
                return Err(MemoryError::Corrupt(format!(
                    "domain {domain}: entry {} forms attractor {attractor} after attractor {}",
                    entry.key, head.last_attractor_key
                )));
            }
            let fingerprint = Fingerprint::from_stored(
                entry.fingerprint_kind,
                &entry.fingerprint,
                core.config().embedding_dim,
            )?;
            core.apply_form(
                &Observation {
                    domain,
                    fingerprint: &fingerprint,
                    shape_digest: &entry.shape_digest,
                    accepted: true,
                    at_unix: entry.recorded_at_unix,
                },
                attractor,
                evicted,
            )?;
            head.last_attractor_key = attractor;
        }
    }
    let held = core.domain(domain).map(|index| index.len()).unwrap_or(0) as u64;
    if held != entry.attractors_after {
        return Err(MemoryError::Corrupt(format!(
            "domain {domain}: entry {} names {} attractors, the domain holds {held}",
            entry.key, entry.attractors_after
        )));
    }
    head.last_key = entry.key;
    head.head_hash = hash;
    Ok(())
}

/// What a write did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Receipt {
    /// Place of the record in the log of its domain, counted from 1.
    pub key: i64,
    /// Hash of the record in the chain of its domain.
    pub hash: [u8; 32],
    /// What the record did to the attractors of its domain.
    pub plan: Plan,
    /// The attractor the record formed or reinforced. None for a rejection.
    pub attractor_key: Option<i64>,
}

/// One record as stored.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StoredRecord {
    pub domain: String,
    /// Hash of the record in the chain of its domain.
    pub hash: [u8; 32],
    pub entry: LogEntry,
}

impl StoredRecord {
    /// The labels of the record. Labels that do not parse read as none.
    pub fn labels(&self) -> BTreeMap<String, String> {
        parse_labels(&self.entry.labels).unwrap_or_default()
    }
}

/// One hit of a search: an attractor, its score and the last record that touched it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub attractor: Attractor,
    pub score: i32,
    /// The score of two equal fingerprints of this kind.
    pub max_score: i32,
    pub latest: Option<StoredRecord>,
}

/// Counts of one domain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainCounts {
    pub domain: String,
    pub records: u64,
    pub attractors: u64,
}

/// Counts of a store.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Counts {
    pub records: u64,
    pub attractors: u64,
    /// The domains in name order.
    pub domains: Vec<DomainCounts>,
}

impl Counts {
    pub(crate) fn of(domains: Vec<DomainCounts>) -> Self {
        Counts {
            records: domains.iter().map(|d| d.records).sum(),
            attractors: domains.iter().map(|d| d.attractors).sum(),
            domains,
        }
    }
}

/// What a health check reads. A health check never writes.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct MemoryHealth {
    /// False when no store exists at the path.
    pub present: bool,
    pub format_version: u32,
    pub embedding_dim: usize,
    pub records: u64,
    pub attractors: u64,
    pub domains: Vec<DomainCounts>,
}

/// What a verification found in one domain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainVerify {
    pub domain: String,
    pub records: u64,
    pub attractors: u64,
    /// Hash of the newest record, or the genesis hash of an empty log.
    pub head_hash: [u8; 32],
}

/// What a verification found.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct VerifyReport {
    pub records: u64,
    pub attractors: u64,
    pub domains: Vec<DomainVerify>,
}

impl VerifyReport {
    pub(crate) fn of(domains: Vec<DomainVerify>) -> Self {
        VerifyReport {
            records: domains.iter().map(|d| d.records).sum(),
            attractors: domains.iter().map(|d| d.attractors).sum(),
            domains,
        }
    }
}

/// Where the log of one domain stands: how many records it holds and the hash of the
/// newest one. A caller keeps anchors outside the store, such as the Base Node in its
/// Evidence Ledger, and hands them back to find a log that was cut or replaced.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DomainAnchor {
    pub domain: String,
    pub records: u64,
    /// Hash of record number `records`, or the genesis hash of an empty log.
    pub head_hash: [u8; 32],
}

/// A place in the records of a store: behind record `key` of `domain`. A page of
/// records names the place where the next page starts.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Cursor {
    pub(crate) domain: String,
    pub(crate) key: i64,
    /// Offset behind the frame of the record in a log file. A backend without files
    /// leaves it zero.
    pub(crate) offset: u64,
}

impl std::fmt::Display for Cursor {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}:{}:{}", self.domain, self.key, self.offset)
    }
}

impl std::str::FromStr for Cursor {
    type Err = MemoryError;

    /// Read a cursor as a page printed it. A text that is no cursor is refused.
    fn from_str(text: &str) -> Result<Self, MemoryError> {
        let bad = || invalid("after", "is no place a page named");
        let mut parts = text.rsplitn(3, ':');
        let offset = parts.next().and_then(|t| t.parse::<u64>().ok());
        let key = parts.next().and_then(|t| t.parse::<i64>().ok());
        let domain = parts.next();
        match (domain, key, offset) {
            (Some(domain), Some(key), Some(offset)) if key >= 0 => {
                check_domain(domain).map_err(|_| bad())?;
                Ok(Cursor {
                    domain: domain.to_string(),
                    key,
                    offset,
                })
            }
            _ => Err(bad()),
        }
    }
}

/// Bytes of records one page holds unless the caller names another bound.
pub const DEFAULT_PAGE_BYTES: usize = 4 * 1024 * 1024;

/// Which records a caller asks for. The records come in the order they were written,
/// one domain after the other in name order.
#[derive(Debug, Clone, Copy)]
pub struct RecordQuery<'a> {
    /// One domain, or every domain when absent.
    pub domain: Option<&'a str>,
    /// Keep only the records of this element.
    pub element_id: Option<&'a str>,
    /// Keep only accepted records or only rejections.
    pub accepted: Option<bool>,
    /// Start behind this place. Absent means the first record.
    pub after: Option<&'a Cursor>,
    /// Most records of one page.
    pub limit: usize,
    /// A page ends with the record that brings its stored bytes to this bound, so a
    /// page always holds at least one record when one is left.
    pub max_bytes: usize,
}

impl<'a> RecordQuery<'a> {
    /// Every record of one domain from its first one, in pages of the default size.
    pub fn domain(domain: &'a str) -> Self {
        RecordQuery {
            domain: Some(domain),
            element_id: None,
            accepted: None,
            after: None,
            limit: usize::MAX,
            max_bytes: DEFAULT_PAGE_BYTES,
        }
    }

    pub(crate) fn keeps(&self, entry: &LogEntry) -> bool {
        self.element_id.is_none_or(|want| entry.element_id == want)
            && self.accepted.is_none_or(|want| entry.accepted == want)
    }
}

/// One page of records.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Page {
    pub records: Vec<StoredRecord>,
    /// Where the next page starts. None when the query has no further record.
    pub next: Option<Cursor>,
}

/// The store behind Lattice Memory. Two backends ship: one in memory for development
/// and tests and one on log files for production. Neither has an operation that
/// changes or removes a record.
pub trait MemoryBackend {
    /// Write one record. The record and its change of the attractors are written
    /// together or not at all.
    fn record(&mut self, record: &NewRecord) -> Result<Receipt, MemoryError>;

    /// What the attractors say about a shape: hot when an accepted record of the same
    /// shape or a near one was written, cold otherwise. A hint is a statistic and
    /// never a permission.
    fn route_hint(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        shape_digest: &[u8; 32],
    ) -> Result<RouteHint, MemoryError>;

    /// Exact search in one domain: the `limit` best attractors at or above `min_score`.
    fn search(
        &self,
        domain: &str,
        fingerprint: &Fingerprint,
        limit: usize,
        min_score: i32,
    ) -> Result<Vec<Match>, MemoryError>;

    /// One page of the records a query names.
    fn records(&self, query: &RecordQuery<'_>) -> Result<Page, MemoryError>;

    /// The number of records a query names from its start on. No record is kept in
    /// memory for the count.
    fn count(&self, query: &RecordQuery<'_>) -> Result<u64, MemoryError>;

    /// Counts of the domains this backend has open.
    fn counts(&self) -> Result<Counts, MemoryError>;

    /// Where the log of each open domain stands.
    fn anchors(&self) -> Vec<DomainAnchor>;

    /// Flush every record written so far to the disk. A caller does this before it
    /// keeps anchors outside the store, so no anchor names a record a loss of power
    /// can still take away.
    fn sync(&mut self) -> Result<(), MemoryError>;

    /// Walk the hash chain of every domain and rebuild its attractors from the log.
    fn verify(&self) -> Result<VerifyReport, MemoryError>;

    fn config(&self) -> CoreConfig;
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_lattice_memory_core::SimHash;

    fn record(domain: &str, body: Option<&str>) -> NewRecord {
        NewRecord {
            entry_id: String::from("e-1"),
            domain: String::from(domain),
            element_id: String::from("agent-a"),
            accepted: true,
            recorded_at_unix: 10,
            shape_digest: [1; 32],
            fingerprint: Fingerprint::SimHash(SimHash([1, 2, 3, 4])),
            labels: BTreeMap::new(),
            body: body.map(String::from),
        }
    }

    #[test]
    fn the_judged_domain_holds_no_proposal_body() {
        assert!(is_judged_domain("admit"));
        assert!(is_judged_domain("admit.validation_engine"));
        assert!(!is_judged_domain("admitted"));
        assert!(!is_judged_domain("intent"));
        assert!(check_record(&record("admit", None)).is_ok());
        assert!(check_record(&record("admit", Some("{}"))).is_err());
        assert!(check_record(&record("admit.validation_engine", Some("{}"))).is_err());
        assert!(check_record(&record("graph", Some("{}"))).is_ok());
    }

    #[test]
    fn a_body_is_bounded_json_in_canonical_form() {
        let source = record("graph", Some(r#"{"b": 1, "a": [1, 2]}"#));
        let checked = check_record(&source).unwrap();
        assert_eq!(checked.body.as_deref(), Some(r#"{"a":[1,2],"b":1}"#));
        assert!(check_record(&record("graph", Some("not json"))).is_err());
        let big = format!("\"{}\"", "x".repeat(MAX_BODY_BYTES));
        assert!(check_record(&record("graph", Some(&big))).is_err());
    }

    #[test]
    fn ids_and_domains_are_checked_before_a_write() {
        let mut bad = record("graph", None);
        bad.entry_id = String::new();
        assert!(check_record(&bad).is_err());
        let mut bad = record("graph", None);
        bad.element_id = "x".repeat(300);
        assert!(check_record(&bad).is_err());
        assert!(check_record(&record("Graph", None)).is_err());
    }

    #[test]
    fn an_entry_that_does_not_follow_the_head_is_refused() {
        let mut core = MemoryCore::new(CoreConfig::default()).unwrap();
        let mut head = DomainHead::empty();
        let source = record("graph", None);
        let checked = check_record(&source).unwrap();
        let (entry, _) = build_entry(&core, &head, &checked).unwrap();
        let hash = entry.hash("graph");
        // A wrong key.
        let mut wrong = entry.clone();
        wrong.key = 5;
        assert!(matches!(
            apply_entry(&mut core, &mut head, "graph", &wrong, hash),
            Err(MemoryError::Corrupt(_))
        ));
        // A wrong hash before.
        let mut wrong = entry.clone();
        wrong.prev_hash = [9; 32];
        assert!(matches!(
            apply_entry(&mut core, &mut head, "graph", &wrong, hash),
            Err(MemoryError::Corrupt(_))
        ));
        // A wrong attractor count.
        let mut wrong = entry.clone();
        wrong.attractors_after = 7;
        assert!(apply_entry(&mut core.clone(), &mut head.clone(), "graph", &wrong, hash).is_err());
        assert_eq!(head, DomainHead::empty());
        apply_entry(&mut core, &mut head, "graph", &entry, hash).unwrap();
        assert_eq!(head.last_key, 1);
        assert_eq!(head.head_hash, hash);
        assert_eq!(head.last_attractor_key, 1);
    }
}
