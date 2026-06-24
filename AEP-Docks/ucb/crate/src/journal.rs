//! Extend-Write diff journal (JSONL).

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
}

pub struct DiffJournal {
    path: PathBuf,
    lock: Mutex<()>,
}

impl DiffJournal {
    pub fn new(data_dir: &Path) -> Self {
        Self {
            path: data_dir.join(JOURNAL_FILE),
            lock: Mutex::new(()),
        }
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
        let entry = DiffRecord {
            diff_id: format!(
                "ucb-diff-{}-{}",
                now_ms(),
                rand_suffix()
            ),
            recorded_at: rfc3339_now(),
            operation: record
                .get("operation")
                .and_then(|v| v.as_str())
                .unwrap_or("extend_write")
                .to_string(),
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

    pub fn pop(&self, steps: usize) -> (usize, Vec<DiffRecord>) {
        let entries = read_entries(&self.path);
        let n = steps.min(entries.len());
        if n == 0 {
            return (0, vec![]);
        }
        let remaining = entries[..entries.len() - n].to_vec();
        let popped = entries[entries.len() - n..].to_vec();
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
        (n, popped)
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
    format!("{:x}", now_ms() ^ 0xDEAD_BEEF_u64)
}

fn rfc3339_now() -> String {
    format!("{}", now_ms())
}