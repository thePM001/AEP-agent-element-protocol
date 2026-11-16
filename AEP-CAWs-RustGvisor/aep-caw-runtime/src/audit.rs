//! The audit log of one session: an append only file with a hash chain.
//!
//! Every line is one JSON object in canonical form. It carries its number, the hash
//! of the line before it and its own hash. A line that was changed, removed or put
//! in another place breaks the chain, and [`AuditLog::open`] refuses such a file.
//!
//! [`AuditLog::append`] returns only after the line reached the disk. The gate
//! appends the start event of a command before it starts the sandbox, so no command
//! runs without a stored event.

use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};

use aep_caw_policy::canonical::{canonical_json, sha256_label};
use serde_json::{json, Map, Value};

/// The value of `prev` in the first line of a log.
pub const GENESIS: &str = "sha256:0000000000000000000000000000000000000000000000000000000000000000";

/// Why the audit log cannot be used.
#[derive(Debug, thiserror::Error)]
pub enum AuditError {
    /// The file cannot be opened, written or synced.
    #[error("audit log {path}: {source}")]
    Io {
        /// Path of the log.
        path: PathBuf,
        /// The error of the operating system.
        source: std::io::Error,
    },
    /// A line of the file does not fit the chain.
    #[error("audit log {path}: line {line} breaks the hash chain: {reason}")]
    Chain {
        /// Path of the log.
        path: PathBuf,
        /// Number of the line, from 1.
        line: u64,
        /// What is wrong with the line.
        reason: &'static str,
    },
    /// An event is not a JSON object.
    #[error("an audit event must be a JSON object")]
    NotAnObject,
}

/// An open audit log.
#[derive(Debug)]
pub struct AuditLog {
    path: PathBuf,
    file: File,
    next: u64,
    last_hash: String,
}

fn line_hash(line: &Map<String, Value>) -> String {
    let mut copy = line.clone();
    copy.remove("hash");
    sha256_label(&canonical_json(&Value::Object(copy)))
}

/// Checks the chain of a log. Returns the number of lines and the hash of the last.
pub fn verify(path: &Path) -> Result<(u64, String), AuditError> {
    let io = |source| AuditError::Io {
        path: path.to_path_buf(),
        source,
    };
    let file = File::open(path).map_err(io)?;
    let mut count = 0u64;
    let mut last = GENESIS.to_string();
    for text in BufReader::new(file).lines() {
        let text = text.map_err(io)?;
        let number = count + 1;
        let broken = |reason| AuditError::Chain {
            path: path.to_path_buf(),
            line: number,
            reason,
        };
        let value: Value =
            serde_json::from_str(&text).map_err(|_| broken("the line is not JSON"))?;
        let line = value
            .as_object()
            .ok_or_else(|| broken("the line is not an object"))?;
        if line.get("seq").and_then(Value::as_u64) != Some(number) {
            return Err(broken("the number of the line is wrong"));
        }
        if line.get("prev").and_then(Value::as_str) != Some(last.as_str()) {
            return Err(broken(
                "the line does not name the hash of the line before it",
            ));
        }
        let hash = line_hash(line);
        if line.get("hash").and_then(Value::as_str) != Some(hash.as_str()) {
            return Err(broken("the hash of the line does not match its content"));
        }
        if text != canonical_json(&value) {
            return Err(broken("the line is not in canonical form"));
        }
        last = hash;
        count = number;
    }
    Ok((count, last))
}

impl AuditLog {
    /// Opens the log at `path` for append and checks its chain. A missing file is
    /// created with a mode that lets only its owner read it.
    pub fn open(path: &Path) -> Result<Self, AuditError> {
        let io = |source| AuditError::Io {
            path: path.to_path_buf(),
            source,
        };
        let file = OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .open(path)
            .map_err(io)?;
        let (count, last_hash) = verify(path)?;
        Ok(Self {
            path: path.to_path_buf(),
            file,
            next: count + 1,
            last_hash,
        })
    }

    /// Appends one event and syncs the file. Returns the hash of the new line.
    ///
    /// `time_unix_ms` is the time of the event. The caller gives it, so the log
    /// itself reads no clock.
    pub fn append(&mut self, time_unix_ms: u64, event: &Value) -> Result<String, AuditError> {
        if !event.is_object() {
            return Err(AuditError::NotAnObject);
        }
        let mut line = Map::new();
        line.insert("seq".to_string(), json!(self.next));
        line.insert("prev".to_string(), json!(self.last_hash));
        line.insert("time_unix_ms".to_string(), json!(time_unix_ms));
        line.insert("event".to_string(), event.clone());
        let hash = line_hash(&line);
        line.insert("hash".to_string(), json!(hash));
        let mut text = canonical_json(&Value::Object(line));
        text.push('\n');
        let io = |source| AuditError::Io {
            path: self.path.clone(),
            source,
        };
        self.file.write_all(text.as_bytes()).map_err(io)?;
        self.file.sync_all().map_err(io)?;
        self.next += 1;
        self.last_hash.clone_from(&hash);
        Ok(hash)
    }

    /// Number of lines in the log.
    pub fn len(&self) -> u64 {
        self.next - 1
    }

    /// True when the log has no line.
    pub fn is_empty(&self) -> bool {
        self.next == 1
    }

    /// Hash of the last line, or [`GENESIS`] for an empty log.
    pub fn last_hash(&self) -> &str {
        &self.last_hash
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn temp_log(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("caw-audit-{}-{name}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("temp dir");
        dir.join("audit.log")
    }

    fn filled(name: &str) -> PathBuf {
        let path = temp_log(name);
        let mut log = AuditLog::open(&path).expect("open");
        log.append(
            1000,
            &json!({"kind": "start", "command": ["sh", "-c", "true"]}),
        )
        .expect("append");
        log.append(
            1001,
            &json!({"kind": "deny", "target": "/home/agent/.ssh/id"}),
        )
        .expect("append");
        log.append(
            1002,
            &json!({"kind": "end", "exit_code": 0, "deny_count": 1}),
        )
        .expect("append");
        path
    }

    fn rewrite(path: &Path, change: impl Fn(Vec<String>) -> Vec<String>) {
        let lines: Vec<String> = std::fs::read_to_string(path)
            .expect("read")
            .lines()
            .map(str::to_string)
            .collect();
        let mut text = change(lines).join("\n");
        text.push('\n');
        std::fs::write(path, text).expect("write");
    }

    #[test]
    fn lines_form_a_chain_from_the_genesis_hash() {
        let path = temp_log("chain");
        let mut log = AuditLog::open(&path).expect("open");
        assert!(log.is_empty());
        assert_eq!(log.last_hash(), GENESIS);
        let first = log.append(1000, &json!({"kind": "start"})).expect("append");
        let second = log.append(1001, &json!({"kind": "end"})).expect("append");
        assert_ne!(first, second);
        assert_eq!(log.len(), 2);
        assert_eq!(log.last_hash(), second);
        let text = std::fs::read_to_string(&path).expect("read");
        let lines: Vec<Value> = text
            .lines()
            .map(|l| serde_json::from_str(l).expect("json"))
            .collect();
        assert_eq!(lines[0]["seq"], 1);
        assert_eq!(lines[0]["prev"], GENESIS);
        assert_eq!(lines[0]["hash"], first.as_str());
        assert_eq!(lines[1]["prev"], first.as_str());
        assert_eq!(lines[1]["event"]["kind"], "end");
        assert_eq!(verify(&path).expect("verify"), (2, second));
    }

    #[test]
    fn the_file_is_readable_by_its_owner_only() {
        let path = filled("mode");
        let mode = std::fs::metadata(&path)
            .expect("metadata")
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn a_reopened_log_continues_the_chain() {
        let path = filled("reopen");
        let mut log = AuditLog::open(&path).expect("open");
        assert_eq!(log.len(), 3);
        log.append(2000, &json!({"kind": "start"})).expect("append");
        assert_eq!(verify(&path).expect("verify").0, 4);
    }

    #[test]
    fn a_changed_line_breaks_the_chain() {
        let path = filled("changed");
        rewrite(&path, |mut lines| {
            lines[1] = lines[1].replace("/home/agent/.ssh/id", "/home/agent/notes");
            lines
        });
        assert!(matches!(
            verify(&path),
            Err(AuditError::Chain { line: 2, .. })
        ));
        assert!(matches!(
            AuditLog::open(&path),
            Err(AuditError::Chain { line: 2, .. })
        ));
    }

    #[test]
    fn a_removed_line_breaks_the_chain() {
        let path = filled("removed");
        rewrite(&path, |mut lines| {
            lines.remove(1);
            lines
        });
        assert!(matches!(
            verify(&path),
            Err(AuditError::Chain { line: 2, .. })
        ));
        let first_gone = filled("removed-first");
        rewrite(&first_gone, |mut lines| {
            lines.remove(0);
            lines
        });
        assert!(matches!(
            verify(&first_gone),
            Err(AuditError::Chain { line: 1, .. })
        ));
    }

    #[test]
    fn swapped_lines_and_a_line_that_is_not_json_break_the_chain() {
        let path = filled("swapped");
        rewrite(&path, |mut lines| {
            lines.swap(1, 2);
            lines
        });
        assert!(matches!(
            verify(&path),
            Err(AuditError::Chain { line: 2, .. })
        ));
        let junk = filled("junk");
        rewrite(&junk, |mut lines| {
            lines.push("not json".to_string());
            lines
        });
        assert!(matches!(
            verify(&junk),
            Err(AuditError::Chain { line: 4, .. })
        ));
    }

    #[test]
    fn a_line_with_other_spacing_is_refused() {
        let path = filled("spacing");
        rewrite(&path, |mut lines| {
            lines[0] = lines[0].replacen("\"seq\":1", "\"seq\": 1", 1);
            lines
        });
        assert!(matches!(
            verify(&path),
            Err(AuditError::Chain { line: 1, .. })
        ));
    }

    #[test]
    fn an_event_must_be_an_object_and_a_missing_folder_is_an_error() {
        let path = temp_log("object");
        let mut log = AuditLog::open(&path).expect("open");
        assert!(matches!(
            log.append(1, &json!("text")),
            Err(AuditError::NotAnObject)
        ));
        assert!(log.is_empty());
        let absent = path.with_file_name("absent").join("audit.log");
        assert!(matches!(
            AuditLog::open(&absent),
            Err(AuditError::Io { .. })
        ));
    }
}
