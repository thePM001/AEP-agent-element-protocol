//! Receipt store and hash-chained receipt log. Each stored receipt is one JSON file; the log
//! receipts.log holds one line per receipt whose digest chains to the line before it.
//! With UCM_LATTICE_RECORD=1 each receipt digest is also recorded in the Base Node lattice
//! log through aep-lattice-log, the runtime ledger of the node.

use crate::engine::Config;
use aep_ucm_core::canon;
use serde_json::{json, Value as J};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

pub struct Store {
    dir: PathBuf,
    log: PathBuf,
    head: Mutex<(u64, String)>,
}

fn valid_id(id: &str) -> bool {
    id.len() == 37 && id.starts_with("ucmr_") && id[5..].chars().all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
}

fn line_digest(seq: u64, receipt_id: &str, receipt_digest: &str, prev: &str) -> Result<String, String> {
    canon::digest(&json!({ "seq": seq.to_string(), "receipt_id": receipt_id, "receipt_digest": receipt_digest, "prev": prev }))
        .map_err(|e| e.to_string())
}

/// Walk the log and check every link. Returns the number of lines and the head digest.
pub fn verify_log(path: &Path) -> Result<(u64, String), String> {
    let raw = match std::fs::read_to_string(path) {
        Ok(r) => r,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok((0, GENESIS.into())),
        Err(e) => return Err(format!("{}: {e}", path.display())),
    };
    let mut prev = GENESIS.to_string();
    let mut n = 0u64;
    for (i, line) in raw.lines().enumerate() {
        let v: J = serde_json::from_str(line).map_err(|e| format!("line {}: {e}", i + 1))?;
        let g = |k: &str| {
            v.get(k)
                .and_then(|x| x.as_str())
                .map(|x| x.to_string())
                .ok_or_else(|| format!("line {}: missing {k}", i + 1))
        };
        let seq: u64 = g("seq")?.parse().map_err(|_| format!("line {}: bad seq", i + 1))?;
        if seq != n + 1 {
            return Err(format!("line {}: seq {seq} where {} was due", i + 1, n + 1));
        }
        if g("prev")? != prev {
            return Err(format!("line {}: chain broken", i + 1));
        }
        let want = line_digest(seq, &g("receipt_id")?, &g("receipt_digest")?, &prev)?;
        if g("line")? != want {
            return Err(format!("line {}: line digest does not match", i + 1));
        }
        prev = want;
        n = seq;
    }
    Ok((n, prev))
}

impl Store {
    pub fn open(dir: &Path) -> Result<Store, String> {
        let rdir = dir.join("receipts");
        std::fs::create_dir_all(&rdir).map_err(|e| format!("{}: {e}", rdir.display()))?;
        let log = dir.join("receipts.log");
        let head = verify_log(&log)?;
        Ok(Store {
            dir: rdir,
            log,
            head: Mutex::new(head),
        })
    }

    pub fn get(&self, id: &str) -> Option<J> {
        if !valid_id(id) {
            return None;
        }
        let raw = std::fs::read_to_string(self.dir.join(format!("{id}.json"))).ok()?;
        serde_json::from_str(&raw).ok()
    }

    pub fn put(&self, receipt: &J, cfg: &Config) -> Result<J, String> {
        let id = receipt
            .get("receipt_id")
            .and_then(|x| x.as_str())
            .ok_or("receipt has no id")?
            .to_string();
        if !valid_id(&id) {
            return Err("receipt id has the wrong form".into());
        }
        let digest = aep_ucm_receipt::receipt_digest(receipt).map_err(|e| e.to_string())?;
        let path = self.dir.join(format!("{id}.json"));
        let tmp = self.dir.join(format!(".{id}.tmp"));
        std::fs::write(&tmp, serde_json::to_string(receipt).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, &path).map_err(|e| e.to_string())?;
        let (seq, line) = {
            let mut head = self.head.lock().map_err(|_| "receipt log lock poisoned")?;
            let seq = head.0 + 1;
            let line = line_digest(seq, &id, &digest, &head.1)?;
            let row = json!({ "seq": seq.to_string(), "receipt_id": id, "receipt_digest": digest, "prev": head.1, "line": line });
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&self.log)
                .map_err(|e| e.to_string())?;
            writeln!(f, "{row}").map_err(|e| e.to_string())?;
            f.sync_data().map_err(|e| e.to_string())?;
            *head = (seq, line.clone());
            (seq, line)
        };
        let lattice = if cfg.lattice_record {
            record_in_lattice(cfg, receipt, &digest)
        } else {
            "off".to_string()
        };
        Ok(json!({ "log_seq": seq.to_string(), "log_line": line, "receipt_digest": digest, "lattice": lattice }))
    }
}

/// Record the receipt digest as a lattice event. A failure is reported, never fatal: the
/// signed receipt and the local chain already hold the evidence.
fn record_in_lattice(cfg: &Config, receipt: &J, digest: &str) -> String {
    use std::process::{Command, Stdio};
    let event = json!({
        "agent_id": "aep-ucm",
        "channel_id": "ch-ucm-receipt",
        "contract_id": "lattice-channel-default",
        "event_type": "UCM_RECEIPT",
        "session_id": receipt["node_id"],
        "docking_port": "validation_engine",
        "action_path": "",
        "trust_score": 0,
        "payload": {
            "receipt_id": receipt["receipt_id"],
            "receipt_digest": digest,
            "program_hash": receipt["program_hash"],
            "result_digest": receipt["result_digest"],
            "node_id": receipt["node_id"],
        }
    });
    let mut cmd = Command::new(&cfg.lattice_log_bin);
    if let Some(db) = &cfg.lattice_db {
        cmd.arg("--db").arg(db);
    }
    cmd.arg("record")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let child = cmd.spawn();
    let mut child = match child {
        Ok(c) => c,
        Err(e) => return format!("failed: {e}"),
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(event.to_string().as_bytes()) {
            return format!("failed: {e}");
        }
    }
    match child.wait_with_output() {
        Ok(o) if o.status.success() => "recorded".into(),
        Ok(o) => format!(
            "failed: {}",
            String::from_utf8_lossy(&o.stderr).trim().chars().take(200).collect::<String>()
        ),
        Err(e) => format!("failed: {e}"),
    }
}
