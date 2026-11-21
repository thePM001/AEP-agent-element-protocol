//! The record log and its hash chain.
//!
//! A record is one entry of the log of its domain. Its bytes hold the hash of the entry
//! before it, and its own hash covers those bytes and the name of the domain. A reader
//! that walks a log and recomputes each hash finds any entry that was changed, removed,
//! put in another place or moved to another domain.
//!
//! This module turns an entry into bytes and back. It reads and writes no file, so a
//! store on a file and a store in memory share one format.

use crate::error::CoreError;
use crate::shape::sha256;
use std::collections::BTreeMap;

const CHAIN_TAG: &[u8] = b"aep.lattice-memory.chain.v1";

/// Longest record id and element id in bytes.
pub const MAX_ID_LEN: usize = 256;
/// Labels one record holds.
pub const MAX_LABELS: usize = 16;
/// Longest label name in bytes.
pub const MAX_LABEL_NAME_LEN: usize = 64;
/// Longest label value in bytes.
pub const MAX_LABEL_VALUE_LEN: usize = 256;
/// Longest body of one record in bytes.
pub const MAX_BODY_BYTES: usize = 256 * 1024;
/// Longest encoded entry in bytes. A length above it is not an entry.
pub const MAX_ENTRY_BYTES: usize = MAX_BODY_BYTES + 64 * 1024;

/// The hash the first entry of a log names as the hash before it.
pub fn genesis_hash() -> [u8; 32] {
    sha256(CHAIN_TAG)
}

/// What a record did to the attractors of its domain, as the log keeps it. A reader
/// rebuilds the attractors from these outcomes alone and searches nothing again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Outcome {
    /// A rejection: no attractor changed.
    LogOnly,
    /// The support of this attractor rose by one.
    Reinforce { attractor: i64 },
    /// This attractor formed. At capacity the named attractor was evicted with it.
    Form {
        attractor: i64,
        evicted: Option<i64>,
    },
}

impl Outcome {
    /// The attractor the record formed or reinforced.
    pub fn attractor(&self) -> Option<i64> {
        match self {
            Outcome::LogOnly => None,
            Outcome::Reinforce { attractor } | Outcome::Form { attractor, .. } => Some(*attractor),
        }
    }
}

/// One entry of the log of a domain.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LogEntry {
    /// Place of the entry in its log, counted from 1.
    pub key: i64,
    pub entry_id: String,
    pub element_id: String,
    /// True for an accepted proposal, false for a rejection.
    pub accepted: bool,
    pub recorded_at_unix: i64,
    pub shape_digest: [u8; 32],
    /// Stored code of the fingerprint kind.
    pub fingerprint_kind: i64,
    /// Stored bytes of the fingerprint.
    pub fingerprint: Vec<u8>,
    pub outcome: Outcome,
    /// Attractors of the domain after this entry.
    pub attractors_after: u64,
    /// Canonical JSON of the labels.
    pub labels: String,
    /// Canonical JSON the owner of the domain keeps with the record.
    pub body: Option<String>,
    /// Hash of the entry before this one, or the genesis hash.
    pub prev_hash: [u8; 32],
}

fn push_framed(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

/// A cursor over the bytes of an entry. Every read checks the bounds.
struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, len: usize) -> Result<&'a [u8], CoreError> {
        let end = self
            .at
            .checked_add(len)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| CoreError::invalid("log entry", "ends before its fields"))?;
        let slice = &self.bytes[self.at..end];
        self.at = end;
        Ok(slice)
    }

    fn u8(&mut self) -> Result<u8, CoreError> {
        Ok(self.take(1)?[0])
    }

    fn i64(&mut self) -> Result<i64, CoreError> {
        let mut raw = [0u8; 8];
        raw.copy_from_slice(self.take(8)?);
        Ok(i64::from_le_bytes(raw))
    }

    fn u64(&mut self) -> Result<u64, CoreError> {
        let mut raw = [0u8; 8];
        raw.copy_from_slice(self.take(8)?);
        Ok(u64::from_le_bytes(raw))
    }

    fn digest(&mut self) -> Result<[u8; 32], CoreError> {
        let mut raw = [0u8; 32];
        raw.copy_from_slice(self.take(32)?);
        Ok(raw)
    }

    fn framed(&mut self) -> Result<&'a [u8], CoreError> {
        let mut raw = [0u8; 4];
        raw.copy_from_slice(self.take(4)?);
        self.take(u32::from_le_bytes(raw) as usize)
    }

    fn text(&mut self, field: &'static str) -> Result<String, CoreError> {
        match std::str::from_utf8(self.framed()?) {
            Ok(text) => Ok(text.to_string()),
            Err(_) => Err(CoreError::invalid(field, "is not UTF-8")),
        }
    }
}

impl LogEntry {
    /// The bytes of the entry.
    pub fn encode(&self) -> Vec<u8> {
        let body_len = self.body.as_ref().map(String::len).unwrap_or(0);
        let mut out = Vec::with_capacity(
            160 + self.entry_id.len()
                + self.element_id.len()
                + self.fingerprint.len()
                + self.labels.len()
                + body_len,
        );
        out.extend_from_slice(&self.key.to_le_bytes());
        out.extend_from_slice(&self.recorded_at_unix.to_le_bytes());
        out.push(u8::from(self.accepted));
        out.push(self.fingerprint_kind as u8);
        let (code, attractor, evicted) = match self.outcome {
            Outcome::LogOnly => (0u8, 0i64, 0i64),
            Outcome::Reinforce { attractor } => (1, attractor, 0),
            Outcome::Form { attractor, evicted } => (2, attractor, evicted.unwrap_or(0)),
        };
        out.push(code);
        out.push(u8::from(self.body.is_some()));
        out.extend_from_slice(&attractor.to_le_bytes());
        out.extend_from_slice(&evicted.to_le_bytes());
        out.extend_from_slice(&self.attractors_after.to_le_bytes());
        out.extend_from_slice(&self.shape_digest);
        out.extend_from_slice(&self.prev_hash);
        push_framed(&mut out, self.entry_id.as_bytes());
        push_framed(&mut out, self.element_id.as_bytes());
        push_framed(&mut out, &self.fingerprint);
        push_framed(&mut out, self.labels.as_bytes());
        if let Some(body) = &self.body {
            push_framed(&mut out, body.as_bytes());
        }
        out
    }

    /// Read the bytes of an entry. Bytes that are not exactly one entry are refused.
    pub fn decode(bytes: &[u8]) -> Result<Self, CoreError> {
        let mut reader = Reader { bytes, at: 0 };
        let key = reader.i64()?;
        let recorded_at_unix = reader.i64()?;
        let accepted = match reader.u8()? {
            0 => false,
            1 => true,
            _ => return Err(CoreError::invalid("log entry", "accepted is not 0 or 1")),
        };
        let fingerprint_kind = i64::from(reader.u8()?);
        let code = reader.u8()?;
        let has_body = match reader.u8()? {
            0 => false,
            1 => true,
            _ => return Err(CoreError::invalid("log entry", "body flag is not 0 or 1")),
        };
        let attractor = reader.i64()?;
        let evicted = reader.i64()?;
        let attractors_after = reader.u64()?;
        let shape_digest = reader.digest()?;
        let prev_hash = reader.digest()?;
        let entry_id = reader.text("entry_id")?;
        let element_id = reader.text("element_id")?;
        let fingerprint = reader.framed()?.to_vec();
        let labels = reader.text("labels")?;
        let body = if has_body {
            Some(reader.text("body")?)
        } else {
            None
        };
        if reader.at != bytes.len() {
            return Err(CoreError::invalid(
                "log entry",
                "holds bytes after its fields",
            ));
        }
        let outcome = match (code, attractor, evicted) {
            (0, 0, 0) => Outcome::LogOnly,
            (1, a, 0) if a > 0 => Outcome::Reinforce { attractor: a },
            (2, a, e) if a > 0 && e >= 0 => Outcome::Form {
                attractor: a,
                evicted: if e == 0 { None } else { Some(e) },
            },
            _ => {
                return Err(CoreError::invalid(
                    "log entry",
                    "outcome does not hold together",
                ))
            }
        };
        if accepted == matches!(outcome, Outcome::LogOnly) {
            return Err(CoreError::invalid(
                "log entry",
                "an accepted record names an attractor and a rejection names none",
            ));
        }
        Ok(LogEntry {
            key,
            entry_id,
            element_id,
            accepted,
            recorded_at_unix,
            shape_digest,
            fingerprint_kind,
            fingerprint,
            outcome,
            attractors_after,
            labels,
            body,
            prev_hash,
        })
    }

    /// The hash of the entry in the log of `domain`.
    pub fn hash(&self, domain: &str) -> [u8; 32] {
        entry_hash(domain, &self.encode())
    }
}

/// The hash of the bytes of an entry in the log of `domain`: SHA-256 over a tag, the
/// name of the domain framed by its length and the bytes. The bytes hold the hash of
/// the entry before, so each hash covers the whole log up to its entry.
pub fn entry_hash(domain: &str, entry_bytes: &[u8]) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(CHAIN_TAG.len() + 8 + domain.len() + entry_bytes.len());
    bytes.extend_from_slice(CHAIN_TAG);
    bytes.extend_from_slice(&(domain.len() as u64).to_le_bytes());
    bytes.extend_from_slice(domain.as_bytes());
    bytes.extend_from_slice(entry_bytes);
    sha256(&bytes)
}

/// Check an id: not empty, bounded and free of control characters.
pub fn check_id(field: &'static str, value: &str) -> Result<(), CoreError> {
    if value.is_empty() || value.len() > MAX_ID_LEN {
        return Err(CoreError::invalid(
            field,
            format!("must hold 1 to {MAX_ID_LEN} bytes"),
        ));
    }
    if value.chars().any(char::is_control) {
        return Err(CoreError::invalid(
            field,
            "must not hold control characters",
        ));
    }
    Ok(())
}

/// Check the labels of a record and give their canonical JSON. Labels are short
/// names with short values, such as the phase of an intent record. They are never the
/// body of a proposal.
pub fn canonical_labels(labels: &BTreeMap<String, String>) -> Result<String, CoreError> {
    if labels.len() > MAX_LABELS {
        return Err(CoreError::invalid(
            "labels",
            format!("at most {MAX_LABELS} labels"),
        ));
    }
    let mut map = serde_json::Map::new();
    for (name, value) in labels {
        if name.is_empty() || name.len() > MAX_LABEL_NAME_LEN {
            return Err(CoreError::invalid(
                "labels",
                format!("a label name holds 1 to {MAX_LABEL_NAME_LEN} bytes"),
            ));
        }
        if value.len() > MAX_LABEL_VALUE_LEN {
            return Err(CoreError::invalid(
                "labels",
                format!("the value of label {name} exceeds {MAX_LABEL_VALUE_LEN} bytes"),
            ));
        }
        map.insert(name.clone(), serde_json::Value::String(value.clone()));
    }
    Ok(crate::shape::canonical_json(&serde_json::Value::Object(
        map,
    )))
}

/// Read the canonical JSON of labels back into a map.
pub fn parse_labels(text: &str) -> Result<BTreeMap<String, String>, CoreError> {
    let value: serde_json::Value =
        serde_json::from_str(text).map_err(|_| CoreError::invalid("labels", "are not JSON"))?;
    let Some(map) = value.as_object() else {
        return Err(CoreError::invalid("labels", "are not a JSON object"));
    };
    let mut out = BTreeMap::new();
    for (name, item) in map {
        match item.as_str() {
            Some(text) => {
                out.insert(name.clone(), text.to_string());
            }
            None => {
                return Err(CoreError::invalid(
                    "labels",
                    "hold a value that is not text",
                ))
            }
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry() -> LogEntry {
        LogEntry {
            key: 7,
            entry_id: String::from("v-7"),
            element_id: String::from("agent-a"),
            accepted: true,
            recorded_at_unix: 1_795_202_440,
            shape_digest: [3; 32],
            fingerprint_kind: 1,
            fingerprint: vec![9; 32],
            outcome: Outcome::Form {
                attractor: 4,
                evicted: Some(2),
            },
            attractors_after: 12,
            labels: String::from(r#"{"phase":"propose"}"#),
            body: Some(String::from(r#"{"a":1}"#)),
            prev_hash: genesis_hash(),
        }
    }

    #[test]
    fn an_entry_round_trips_through_its_bytes() {
        let full = entry();
        assert_eq!(LogEntry::decode(&full.encode()).unwrap(), full);
        let plain = LogEntry {
            body: None,
            outcome: Outcome::Reinforce { attractor: 4 },
            ..entry()
        };
        assert_eq!(LogEntry::decode(&plain.encode()).unwrap(), plain);
        let rejected = LogEntry {
            accepted: false,
            outcome: Outcome::LogOnly,
            body: None,
            labels: String::from("{}"),
            ..entry()
        };
        assert_eq!(LogEntry::decode(&rejected.encode()).unwrap(), rejected);
        let unevicted = LogEntry {
            outcome: Outcome::Form {
                attractor: 4,
                evicted: None,
            },
            ..entry()
        };
        assert_eq!(LogEntry::decode(&unevicted.encode()).unwrap(), unevicted);
    }

    #[test]
    fn every_field_changes_the_hash() {
        let base = entry();
        let mut seen = vec![base.hash("admit")];
        let mut check = |changed: LogEntry, domain: &str| {
            let hash = changed.hash(domain);
            assert!(!seen.contains(&hash));
            seen.push(hash);
        };
        check(entry(), "intent");
        check(LogEntry { key: 8, ..entry() }, "admit");
        check(
            LogEntry {
                entry_id: String::from("v-8"),
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                element_id: String::from("agent-b"),
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                recorded_at_unix: 1,
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                shape_digest: [4; 32],
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                fingerprint_kind: 2,
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                fingerprint: vec![8; 32],
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                outcome: Outcome::Reinforce { attractor: 4 },
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                outcome: Outcome::Form {
                    attractor: 5,
                    evicted: Some(2),
                },
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                outcome: Outcome::Form {
                    attractor: 4,
                    evicted: None,
                },
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                attractors_after: 13,
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                labels: String::from("{}"),
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                body: None,
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                body: Some(String::from(r#"{"a":2}"#)),
                ..entry()
            },
            "admit",
        );
        check(
            LogEntry {
                prev_hash: [1; 32],
                ..entry()
            },
            "admit",
        );
    }

    #[test]
    fn fields_are_framed_so_text_cannot_move_between_them() {
        let a = LogEntry {
            entry_id: String::from("ab"),
            element_id: String::from("c"),
            ..entry()
        };
        let b = LogEntry {
            entry_id: String::from("a"),
            element_id: String::from("bc"),
            ..entry()
        };
        assert_ne!(a.hash("admit"), b.hash("admit"));
        assert_ne!(entry_hash("ab", b"c"), entry_hash("a", b"bc"));
    }

    #[test]
    fn bytes_that_are_not_one_entry_are_refused() {
        let bytes = entry().encode();
        for cut in [0, 1, 17, bytes.len() / 2, bytes.len() - 1] {
            assert!(LogEntry::decode(&bytes[..cut]).is_err(), "cut at {cut}");
        }
        let mut longer = bytes.clone();
        longer.push(0);
        assert!(LogEntry::decode(&longer).is_err());
        // An accepted entry that names no attractor does not hold together.
        let mut broken = bytes.clone();
        broken[18] = 0;
        assert!(LogEntry::decode(&broken).is_err());
        // A length field that points past the end.
        let mut broken = bytes;
        let at = 8 + 8 + 4 + 8 + 8 + 8 + 32 + 32;
        broken[at..at + 4].copy_from_slice(&u32::MAX.to_le_bytes());
        assert!(LogEntry::decode(&broken).is_err());
    }

    #[test]
    fn the_genesis_hash_is_stable() {
        assert_eq!(genesis_hash(), sha256(b"aep.lattice-memory.chain.v1"));
        assert_ne!(entry().hash("admit"), genesis_hash());
        assert_eq!(entry().hash("admit"), entry().hash("admit"));
    }

    #[test]
    fn ids_and_labels_are_bounded() {
        assert!(check_id("entry_id", "v-1").is_ok());
        assert!(check_id("entry_id", "").is_err());
        assert!(check_id("entry_id", &"x".repeat(257)).is_err());
        assert!(check_id("entry_id", "a\nb").is_err());
        let mut labels = BTreeMap::new();
        labels.insert("phase".to_string(), "propose".to_string());
        labels.insert("kind".to_string(), "intent_knot".to_string());
        let text = canonical_labels(&labels).unwrap();
        assert_eq!(text, r#"{"kind":"intent_knot","phase":"propose"}"#);
        assert_eq!(parse_labels(&text).unwrap(), labels);
        assert_eq!(canonical_labels(&BTreeMap::new()).unwrap(), "{}");
        assert!(parse_labels("[]").is_err());
        assert!(parse_labels(r#"{"a":1}"#).is_err());
        assert!(parse_labels("not json").is_err());
        let mut many = BTreeMap::new();
        for n in 0..17 {
            many.insert(format!("k{n}"), String::new());
        }
        assert!(canonical_labels(&many).is_err());
        let mut long = BTreeMap::new();
        long.insert("k".to_string(), "v".repeat(257));
        assert!(canonical_labels(&long).is_err());
        let mut empty_name = BTreeMap::new();
        empty_name.insert(String::new(), "v".to_string());
        assert!(canonical_labels(&empty_name).is_err());
    }
}
