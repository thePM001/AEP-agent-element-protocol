//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChainedDiffRecord {
    pub diff_id: String,
    pub prev_digest: String,
    pub record_digest: String,
    pub operation: String,
    pub payload: serde_json::Value,
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum JournalError {
    #[error("chain break at {0}")]
    ChainBreak(String),
    #[error("rollback id is not the tail")]
    NotTail,
    #[error("unknown diff id {0}")]
    UnknownId(String),
}

pub fn chain_append(
    prev: Option<&str>,
    diff_id: &str,
    operation: &str,
    payload: serde_json::Value,
) -> Result<ChainedDiffRecord, JournalError> {
    let prev_digest = prev.unwrap_or("genesis").to_string();
    let record_digest = digest_record(diff_id, &prev_digest, operation, &payload);
    Ok(ChainedDiffRecord {
        diff_id: diff_id.into(),
        prev_digest,
        record_digest,
        operation: operation.into(),
        payload,
    })
}

pub fn verify_chain(records: &[ChainedDiffRecord]) -> Result<(), JournalError> {
    let mut expect_prev = "genesis".to_string();
    for rec in records {
        if rec.prev_digest != expect_prev {
            return Err(JournalError::ChainBreak(rec.diff_id.clone()));
        }
        let got = digest_record(&rec.diff_id, &rec.prev_digest, &rec.operation, &rec.payload);
        if got != rec.record_digest {
            return Err(JournalError::ChainBreak(rec.diff_id.clone()));
        }
        expect_prev = rec.record_digest.clone();
    }
    Ok(())
}

pub fn rollback_named(
    records: &[ChainedDiffRecord],
    ids: &[String],
) -> Result<Vec<ChainedDiffRecord>, JournalError> {
    if ids.len() != 1 {
        return Err(JournalError::NotTail);
    }
    let want = &ids[0];
    let Some(last) = records.last() else {
        return Err(JournalError::UnknownId(want.clone()));
    };
    if &last.diff_id != want {
        return Err(JournalError::NotTail);
    }
    Ok(records[..records.len() - 1].to_vec())
}

fn digest_record(diff_id: &str, prev: &str, operation: &str, payload: &serde_json::Value) -> String {
    let mut h = Sha256::new();
    h.update(diff_id.as_bytes());
    h.update(prev.as_bytes());
    h.update(operation.as_bytes());
    h.update(&serde_json::to_vec(payload).unwrap_or_default());
    hex::encode(h.finalize())
}


#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn digest_includes_snapshot_so_verify_matches_append() {
        let a = chain_append(None, "d1", "ingest", json!({"n": 1})).unwrap();
        let b = chain_append(None, "d1", "ingest", json!({"n": 2})).unwrap();
        assert_ne!(a.record_digest, b.record_digest);
        verify_chain(&[a.clone()]).unwrap();
        let mut broken = a.clone();
        broken.payload = json!({"n": 2});
        assert!(verify_chain(&[broken]).is_err());
    }

    #[test]
    fn rollback_named_refuses_non_tail() {
        let a = chain_append(None, "d1", "ingest", json!({"n": 1})).unwrap();
        let b = chain_append(Some(&a.record_digest), "d2", "ingest", json!({"n": 2})).unwrap();
        let c = chain_append(Some(&b.record_digest), "d3", "ingest", json!({"n": 3})).unwrap();
        verify_chain(&[a.clone(), b.clone(), c.clone()]).unwrap();
        assert_eq!(
            rollback_named(&[a.clone(), b.clone(), c.clone()], &["d2".into()]),
            Err(JournalError::NotTail)
        );
        let kept = rollback_named(&[a, b, c], &["d3".into()]).unwrap();
        assert_eq!(kept.len(), 2);
    }
}
