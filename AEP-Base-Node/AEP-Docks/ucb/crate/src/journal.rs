//! Hash-chained Extend-Write evidence log.

use aep_ucb_perimeter_v1::{
    chain_append, rollback_named, verify_chain as verify_chained, ChainedDiffRecord, JournalError,
    WireLimits,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use tokio::sync::Mutex;

const JOURNAL_FILE: &str = "ucb-diff-journal.jsonl";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiffRecord {
    pub diff_id: String,
    pub recorded_at: String,
    pub operation: String,
    #[serde(default)]
    pub event_id: Option<i64>,
    #[serde(default)]
    pub frame_digest: Option<String>,
    #[serde(default)]
    pub binding_fingerprint: Option<Value>,
    #[serde(default)]
    pub foreign_protocol: Option<String>,
    #[serde(default)]
    pub session_id: Option<String>,
    #[serde(default)]
    pub snapshot: Option<Value>,
    #[serde(default)]
    pub prev_digest: String,
    #[serde(default)]
    pub record_digest: String,
}

pub struct DiffJournal {
    path: PathBuf,
    lock: Mutex<()>,
    max_bytes: usize,
}

impl DiffJournal {
    pub fn new(data_dir: &Path) -> Self {
        Self::with_max_bytes(data_dir, WireLimits::default().journal_max_bytes)
    }

    pub fn with_max_bytes(data_dir: &Path, max_bytes: usize) -> Self {
        Self {
            path: data_dir.join(JOURNAL_FILE),
            lock: Mutex::new(()),
            max_bytes,
        }
    }

    pub fn path(&self) -> &Path {
        &self.path
    }

    pub async fn with_lock<F, T>(&self, f: F) -> T
    where
        F: FnOnce() -> T,
    {
        let _g = self.lock.lock().await;
        f()
    }

    pub fn append(&self, record: Value) -> std::io::Result<DiffRecord> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent)?;
        }
        self.rotate_if_at_cap()?;
        let entries = read_entries(&self.path);
        let operation = record
            .get("operation")
            .and_then(|v| v.as_str())
            .unwrap_or("extend_write")
            .to_string();
        let diff_id = format!("ucb-diff-{}-{}", now_ms(), rand_suffix());
        let payload = snapshot_from_record(&record);
        let chained = chain_append(last_digest(&entries), &diff_id, &operation, payload)
            .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e.to_string()))?;
        let entry = DiffRecord {
            diff_id: chained.diff_id.clone(),
            recorded_at: rfc3339_now(),
            operation,
            event_id: record.get("event_id").and_then(|v| v.as_i64()),
            frame_digest: record
                .get("frame_digest")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            binding_fingerprint: record.get("binding_fingerprint").cloned(),
            foreign_protocol: record
                .get("foreign_protocol")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            session_id: record
                .get("session_id")
                .and_then(|v| v.as_str())
                .map(str::to_string),
            snapshot: record.get("snapshot").cloned(),
            prev_digest: chained.prev_digest,
            record_digest: chained.record_digest,
        };
        let line = serde_json::to_string(&entry)?;
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?;
        writeln!(file, "{line}")?;
        Ok(entry)
    }

    pub fn list(&self, limit: usize) -> Vec<DiffRecord> {
        read_entries(&self.path)
            .into_iter()
            .rev()
            .take(limit)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect()
    }

    pub fn peek(&self, steps: usize) -> (usize, Vec<DiffRecord>) {
        let entries = read_entries(&self.path);
        let n = steps.min(entries.len());
        let records = entries[entries.len().saturating_sub(n)..].to_vec();
        (n, records)
    }

    pub fn verify_chain(&self) -> Result<(), String> {
        let chained: Vec<ChainedDiffRecord> = read_entries(&self.path).iter().map(to_chained).collect();
        verify_chained(&chained).map_err(|e| e.to_string())
    }

    pub fn check_rollback_named(&self, ids: &[String]) -> Result<(), String> {
        let chained: Vec<ChainedDiffRecord> = read_entries(&self.path).iter().map(to_chained).collect();
        verify_chained(&chained).map_err(|e| e.to_string())?;
        rollback_named(&chained, ids)
            .map(|_| ())
            .map_err(rollback_err)
    }

    pub fn rollback_tail(&self, diff_id: &str) -> Result<DiffRecord, String> {
        let entries = read_entries(&self.path);
        let chained: Vec<ChainedDiffRecord> = entries.iter().map(to_chained).collect();
        verify_chained(&chained).map_err(|e| e.to_string())?;
        rollback_named(&chained, &[diff_id.to_string()]).map_err(rollback_err)?;
        let Some(last) = entries.last().cloned() else {
            return Err("unknown diff id".into());
        };
        let remaining = entries[..entries.len() - 1].to_vec();
        if remaining.is_empty() {
            let _ = fs::remove_file(&self.path);
        } else {
            let text = remaining
                .iter()
                .map(|e| serde_json::to_string(e).unwrap_or_default())
                .collect::<Vec<_>>()
                .join("\n");
            fs::write(&self.path, format!("{text}\n")).ok();
        }
        Ok(last)
    }

    pub fn prior_fingerprints(&self, limit: usize) -> Vec<u32> {
        read_entries(&self.path)
            .into_iter()
            .rev()
            .take(limit)
            .filter_map(|r| parse_fingerprint(r.binding_fingerprint))
            .collect()
    }
}

fn rotate_if_at_cap_path(path: &Path, max_bytes: usize) -> std::io::Result<()> {
    if !path.is_file() {
        return Ok(());
    }
    let len = fs::metadata(path).map(|m| m.len() as usize).unwrap_or(0);
    if len < max_bytes {
        return Ok(());
    }
    let rotated = path.with_file_name(format!("{}-{}", JOURNAL_FILE, now_ms()));
    fs::rename(path, rotated)?;
    Ok(())
}

impl DiffJournal {
    fn rotate_if_at_cap(&self) -> std::io::Result<()> {
        rotate_if_at_cap_path(&self.path, self.max_bytes)
    }
}

pub fn persist_after_admit(admit_ok: bool) -> bool {
    admit_ok
}

pub fn persist_journal_if_admit<T>(admit_ok: bool, persist: impl FnOnce() -> T) -> Option<T> {
    if persist_after_admit(admit_ok) {
        Some(persist())
    } else {
        None
    }
}

fn rollback_err(err: JournalError) -> String {
    match err {
        JournalError::NotTail => String::from("rollback id is not the tail"),
        other => other.to_string(),
    }
}

fn snapshot_from_record(record: &Value) -> Value {
    record.get("snapshot").cloned().unwrap_or(Value::Null)
}

fn snapshot_payload(rec: &DiffRecord) -> Value {
    rec.snapshot.clone().unwrap_or(Value::Null)
}

fn to_chained(rec: &DiffRecord) -> ChainedDiffRecord {
    ChainedDiffRecord {
        diff_id: rec.diff_id.clone(),
        prev_digest: if rec.prev_digest.is_empty() {
            String::from("genesis")
        } else {
            rec.prev_digest.clone()
        },
        record_digest: rec.record_digest.clone(),
        operation: rec.operation.clone(),
        payload: snapshot_payload(rec),
    }
}

fn last_digest(entries: &[DiffRecord]) -> Option<&str> {
    let last = entries.last()?;
    if last.record_digest.is_empty() {
        None
    } else {
        Some(last.record_digest.as_str())
    }
}

fn parse_fingerprint(value: Option<Value>) -> Option<u32> {
    let v = value?;
    if let Some(n) = v.as_u64() {
        return Some(n as u32);
    }
    if let Some(n) = v.as_i64() {
        return Some(n as u32);
    }
    v.as_str()?.parse().ok()
}

fn read_entries(path: &Path) -> Vec<DiffRecord> {
    let text = match fs::read_to_string(path) {
        Ok(t) => t,
        Err(_) => return vec![],
    };
    text.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() {
                return None;
            }
            serde_json::from_str(line).ok()
        })
        .collect()
}

fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn rand_suffix() -> String {
    use rand::RngCore;
    let mut b = [0u8; 8];
    rand::thread_rng().fill_bytes(&mut b);
    hex::encode(b)
}

fn rfc3339_now() -> String {
    format!("{}", now_ms())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample(n: u64) -> Value {
        json!({
            "operation": "extend_write",
            "snapshot": { "n": n }
        })
    }

    #[test]
    fn append_then_verify_hashes_snapshot() {
        let dir = tempfile::tempdir().unwrap();
        let j = DiffJournal::new(dir.path());
        let a = j.append(sample(1)).unwrap();
        let b = j.append(sample(2)).unwrap();
        assert_eq!(a.prev_digest, "genesis");
        assert_eq!(b.prev_digest, a.record_digest);
        j.verify_chain().unwrap();
        let mut rec = j.list(10).pop().unwrap();
        rec.snapshot = Some(json!({"n": 99}));
        let line = serde_json::to_string(&rec).unwrap();
        std::fs::write(j.path(), format!("{}\n{}\n", serde_json::to_string(&j.list(10)[0]).unwrap(), line)).unwrap();
        assert!(j.verify_chain().is_err());
    }

    #[test]
    fn named_tail_rollback_only() {
        let dir = tempfile::tempdir().unwrap();
        let j = DiffJournal::new(dir.path());
        let a = j.append(sample(1)).unwrap();
        let b = j.append(sample(2)).unwrap();
        let c = j.append(sample(3)).unwrap();
        assert!(j.rollback_tail(&b.diff_id).is_err());
        assert!(j.check_rollback_named(&[b.diff_id.clone()]).is_err());
        assert_eq!(j.list(10).len(), 3);
        j.verify_chain().unwrap();
        let popped = j.rollback_tail(&c.diff_id).unwrap();
        assert_eq!(popped.diff_id, c.diff_id);
        assert_eq!(j.list(10).len(), 2);
        assert_eq!(j.list(10)[0].diff_id, a.diff_id);
        j.verify_chain().unwrap();
    }

    #[test]
    fn persist_after_admit_false_skips_journal() {
        let mut wrote = false;
        let skipped = persist_journal_if_admit(false, || {
            wrote = true;
            1u8
        });
        assert!(skipped.is_none());
        assert!(!wrote);
        let wrote_ok = persist_journal_if_admit(true, || {
            wrote = true;
            2u8
        });
        assert_eq!(wrote_ok, Some(2));
        assert!(wrote);
        assert!(persist_after_admit(true));
        assert!(!persist_after_admit(false));
    }

    #[test]
    fn journal_rotates_at_byte_cap() {
        let dir = tempfile::tempdir().unwrap();
        let j = DiffJournal::with_max_bytes(dir.path(), 80);
        let _a = j.append(sample(1)).unwrap();
        let _b = j.append(sample(2)).unwrap();
        let names: Vec<String> = std::fs::read_dir(dir.path())
            .unwrap()
            .filter_map(|e| e.ok().map(|e| e.file_name().to_string_lossy().into_owned()))
            .collect();
        let rotated = names
            .iter()
            .any(|n| n.starts_with(JOURNAL_FILE) && n.as_str() != JOURNAL_FILE);
        assert!(rotated, "{names:?}");
        assert!(dir.path().join(JOURNAL_FILE).is_file());
    }
}
