//! The JSON a caller of the program `aep-lattice-memory` writes and reads.
//!
//! A caller hands over the shape of a record as JSON. The program computes the shape
//! digest and the fingerprint from it and stores those. The shape itself is not stored.

use crate::error::MemoryError;
use crate::model::{Match, MemoryHealth, NewRecord, StoredRecord, VerifyReport};
use aep_lattice_memory_core::{
    format_unix_iso, parse_timestamp_unix, CoreError, Fingerprint, ProposalShape,
    QuantizedEmbedding, SimHash,
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::BTreeMap;

fn default_limit() -> usize {
    5
}

fn default_history_limit() -> usize {
    1000
}

/// One record as a caller writes it.
#[derive(Debug, Clone, Deserialize)]
pub struct WireRecord {
    pub id: String,
    pub element_id: String,
    pub domain: String,
    /// `accepted` or `rejected`.
    pub result: String,
    /// Unix seconds, unix milliseconds or ISO 8601. Absent means the present time.
    #[serde(default)]
    pub timestamp: Option<Value>,
    /// What the record is a record of. It feeds the digest and the fingerprint.
    pub shape: Value,
    /// An operator embedding in place of the SimHash of the shape.
    #[serde(default)]
    pub embedding: Option<Vec<f32>>,
    #[serde(default)]
    pub labels: BTreeMap<String, String>,
    /// JSON the owner of the domain keeps with the record.
    #[serde(default)]
    pub body: Option<Value>,
}

/// A search as a caller writes it.
#[derive(Debug, Clone, Deserialize)]
pub struct WireSearch {
    pub domain: String,
    #[serde(default)]
    pub shape: Option<Value>,
    #[serde(default)]
    pub embedding: Option<Vec<f32>>,
    #[serde(default = "default_limit")]
    pub limit: usize,
    /// Lowest score a hit may have. Absent means every attractor may be a hit.
    #[serde(default)]
    pub min_score: Option<i32>,
}

/// A history request as a caller writes it.
#[derive(Debug, Clone, Deserialize)]
pub struct WireHistory {
    pub domain: String,
    pub element_id: String,
    /// `accepted` or `rejected` to keep only those records.
    #[serde(default)]
    pub result: Option<String>,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

/// An export request as a caller writes it.
#[derive(Debug, Clone, Deserialize)]
pub struct WireExport {
    #[serde(default)]
    pub domain: Option<String>,
    #[serde(default = "default_history_limit")]
    pub limit: usize,
}

fn invalid(field: &'static str, reason: impl Into<String>) -> MemoryError {
    MemoryError::Core(CoreError::Invalid {
        field,
        reason: reason.into(),
    })
}

/// `accepted` and `rejected` as a flag.
pub fn parse_result(text: &str) -> Result<bool, MemoryError> {
    match text {
        "accepted" => Ok(true),
        "rejected" => Ok(false),
        other => Err(invalid(
            "result",
            format!("is {other}, expected accepted or rejected"),
        )),
    }
}

fn parse_timestamp(value: &Option<Value>, now_unix: i64) -> Result<i64, MemoryError> {
    match value {
        None | Some(Value::Null) => Ok(now_unix),
        Some(Value::String(text)) => Ok(parse_timestamp_unix(text)?),
        Some(Value::Number(number)) => match number.as_i64() {
            Some(unix) => Ok(parse_timestamp_unix(&unix.to_string())?),
            None => Err(invalid("timestamp", "is not a whole number")),
        },
        Some(_) => Err(invalid("timestamp", "is neither text nor a number")),
    }
}

/// The fingerprint of a shape, or of an operator embedding when one is given. The
/// embedding must have the dimension of the store.
pub fn fingerprint_of(
    shape: &ProposalShape,
    embedding: Option<&[f32]>,
    embedding_dim: usize,
) -> Result<Fingerprint, MemoryError> {
    match embedding {
        Some(values) => Ok(Fingerprint::Embedding(QuantizedEmbedding::quantize(
            values,
            embedding_dim,
        )?)),
        None => Ok(Fingerprint::SimHash(SimHash::of_shape(shape))),
    }
}

impl WireRecord {
    /// The record a backend writes. `now_unix` is the time of a record that names none.
    pub fn into_record(
        self,
        embedding_dim: usize,
        now_unix: i64,
    ) -> Result<NewRecord, MemoryError> {
        let accepted = parse_result(&self.result)?;
        let recorded_at_unix = parse_timestamp(&self.timestamp, now_unix)?;
        let shape = ProposalShape::from_value(&self.shape);
        let fingerprint = fingerprint_of(&shape, self.embedding.as_deref(), embedding_dim)?;
        Ok(NewRecord {
            entry_id: self.id,
            domain: self.domain,
            element_id: self.element_id,
            accepted,
            recorded_at_unix,
            shape_digest: shape.digest(),
            fingerprint,
            labels: self.labels,
            body: self.body.map(|value| value.to_string()),
        })
    }
}

/// One stored record as the program prints it.
pub fn record_json(record: &StoredRecord) -> Value {
    let entry = &record.entry;
    let body = entry
        .body
        .as_ref()
        .and_then(|text| serde_json::from_str::<Value>(text).ok());
    json!({
        "key": entry.key,
        "id": entry.entry_id,
        "domain": record.domain,
        "element_id": entry.element_id,
        "result": if entry.accepted { "accepted" } else { "rejected" },
        "timestamp": format_unix_iso(entry.recorded_at_unix),
        "recorded_at_unix": entry.recorded_at_unix,
        "shape_digest": hex::encode(entry.shape_digest),
        "attractor_key": entry.outcome.attractor(),
        "labels": record.labels(),
        "body": body,
        "hash": hex::encode(record.hash),
    })
}

/// One hit of a search as the program prints it.
pub fn match_json(hit: &Match) -> Value {
    json!({
        "score": hit.score,
        "max_score": hit.max_score,
        "similarity": if hit.max_score > 0 {
            f64::from(hit.score) / f64::from(hit.max_score)
        } else {
            0.0
        },
        "attractor": {
            "key": hit.attractor.key,
            "support": hit.attractor.support,
            "formed_at_unix": hit.attractor.formed_at_unix,
            "last_seen_unix": hit.attractor.last_seen_unix,
            "shape_digest": hex::encode(hit.attractor.shape_digest),
            "kind": hit.attractor.fingerprint.kind().name(),
        },
        "entry": hit.latest.as_ref().map(record_json),
    })
}

/// A health answer as the program prints it.
pub fn health_json(health: &MemoryHealth) -> Value {
    json!({
        "present": health.present,
        "format_version": health.format_version,
        "embedding_dim": health.embedding_dim,
        "records": health.records,
        "attractors": health.attractors,
        "domains": health.domains.iter().map(|d| json!({
            "domain": d.domain,
            "records": d.records,
            "attractors": d.attractors,
        })).collect::<Vec<_>>(),
    })
}

/// A verification as the program prints it.
pub fn verify_json(report: &VerifyReport) -> Value {
    json!({
        "ok": true,
        "records": report.records,
        "attractors": report.attractors,
        "domains": report.domains.iter().map(|d| json!({
            "domain": d.domain,
            "records": d.records,
            "attractors": d.attractors,
            "head_hash": hex::encode(d.head_hash),
        })).collect::<Vec<_>>(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wire(extra: &str) -> WireRecord {
        let text = format!(
            r#"{{"id":"ik-1","element_id":"INT-1","domain":"intent","result":"accepted","shape":{{"kind":"intent_knot","statement":"rename the parser"}}{extra}}}"#
        );
        serde_json::from_str(&text).unwrap()
    }

    #[test]
    fn a_record_without_embedding_gets_the_simhash_of_its_shape() {
        let record =
            wire(r#","timestamp":"2026-11-20T19:20:40.123Z","labels":{"phase":"propose"}"#)
                .into_record(0, 5)
                .unwrap();
        assert_eq!(record.recorded_at_unix, 1_795_202_440);
        assert!(record.accepted);
        assert!(matches!(record.fingerprint, Fingerprint::SimHash(_)));
        let shape = ProposalShape::from_value(
            &serde_json::json!({"statement": "rename the parser", "kind": "intent_knot"}),
        );
        assert_eq!(record.shape_digest, shape.digest());
        assert_eq!(
            record.labels.get("phase").map(String::as_str),
            Some("propose")
        );
        assert_eq!(record.body, None);
    }

    #[test]
    fn timestamps_come_as_text_as_numbers_or_not_at_all() {
        assert_eq!(wire("").into_record(0, 77).unwrap().recorded_at_unix, 77);
        assert_eq!(
            wire(r#","timestamp":1795202440"#)
                .into_record(0, 0)
                .unwrap()
                .recorded_at_unix,
            1_795_202_440
        );
        assert_eq!(
            wire(r#","timestamp":1795202440123"#)
                .into_record(0, 0)
                .unwrap()
                .recorded_at_unix,
            1_795_202_440
        );
        assert!(wire(r#","timestamp":"soon""#).into_record(0, 0).is_err());
        assert!(wire(r#","timestamp":1.5"#).into_record(0, 0).is_err());
        assert!(wire(r#","timestamp":[1]"#).into_record(0, 0).is_err());
    }

    #[test]
    fn an_embedding_of_the_wrong_dimension_is_refused() {
        let with = wire(r#","embedding":[1.0,0.0,0.0]"#);
        assert!(matches!(
            with.clone().into_record(128, 0),
            Err(MemoryError::Core(CoreError::DimensionMismatch {
                expected: 128,
                got: 3
            }))
        ));
        assert!(matches!(
            with.clone().into_record(0, 0),
            Err(MemoryError::Core(CoreError::EmbeddingsOff))
        ));
        let record = with.into_record(3, 0).unwrap();
        assert!(matches!(record.fingerprint, Fingerprint::Embedding(_)));
    }

    #[test]
    fn a_result_is_accepted_or_rejected() {
        assert!(parse_result("accepted").unwrap());
        assert!(!parse_result("rejected").unwrap());
        assert!(parse_result("maybe").is_err());
        let mut record = wire("");
        record.result = String::from("allow");
        assert!(record.into_record(0, 0).is_err());
    }

    #[test]
    fn a_body_is_handed_on_as_json_text() {
        let record = wire(r#","body":{"b":1,"a":2}"#).into_record(0, 0).unwrap();
        let body: Value = serde_json::from_str(record.body.as_deref().unwrap()).unwrap();
        assert_eq!(body, serde_json::json!({"a": 2, "b": 1}));
    }
}
