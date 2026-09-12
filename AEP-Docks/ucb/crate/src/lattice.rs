// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Lattice transport via aep-lattice-log CLI + Unix socket docks.

use crate::translator::LatticeEvent;
use aep_ucb_perimeter_v1::WireLimits;
use aep_wall_set_backpressure::DenyReport;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt};
use tokio::net::UnixStream;
use tokio::time::{timeout, Duration};

const DOCK_SUFFIXES: &[(&str, &str)] = &[
    ("inference_engine", "inference"),
    ("validation_engine", "validation"),
    ("future_features", "future"),
    ("regulation_module", "regulation"),
];

#[derive(Debug, Clone)]
pub struct LatticeRuntime {
    pub socket_base: PathBuf,
    pub config_path: Option<PathBuf>,
    pub lattice_db: Option<PathBuf>,
    pub lattice_log_bin: PathBuf,
}

impl LatticeRuntime {
    pub fn from_env(data_dir: &Path) -> Self {
        let socket_base = std::env::var("AEP_SOCKET_BASE")
            .map(PathBuf::from)
            .unwrap_or_else(|_| data_dir.join("sockets"));
        let config_path = data_dir.join("base-node.json");
        let config_path = if config_path.is_file() {
            Some(config_path)
        } else {
            None
        };
        let lattice_db = Some(data_dir.join("action-lattice.db"));
        let lattice_log_bin = std::env::var("AEP_LATTICE_LOG_BIN")
            .map(PathBuf::from)
            .unwrap_or_else(|_| PathBuf::from("aep-lattice-log"));
        Self {
            socket_base,
            config_path,
            lattice_db,
            lattice_log_bin,
        }
    }

    pub fn dock_path(&self, dock_port: &str) -> Result<PathBuf, String> {
        let suffix = DOCK_SUFFIXES
            .iter()
            .find(|(p, _)| *p == dock_port)
            .map(|(_, s)| *s)
            .ok_or_else(|| format!("invalid docking_port: {dock_port}"))?;
        Ok(self.socket_base.join(suffix))
    }

    pub fn dock_status(&self) -> Vec<Value> {
        DOCK_SUFFIXES
            .iter()
            .map(|(port, suffix)| {
                let path = self.socket_base.join(suffix);
                json!({
                    "port": port,
                    "path": path,
                    "listening": path.exists(),
                })
            })
            .collect()
    }

    pub fn build_frame(&self, event: &LatticeEvent) -> Result<BuiltFrame, String> {
        let input = serde_json::to_string(event).map_err(|e| e.to_string())?;
        let args = self.lattice_cli_args("build-frame", false);
        run_lattice_build(&self.lattice_log_bin, &args, &input)
    }

    pub fn seal_and_record(&self, event: &LatticeEvent) -> Result<LatticeRecord, String> {
        let input = serde_json::to_string(event).map_err(|e| e.to_string())?;
        let args = self.lattice_cli_args("record", true);
        run_lattice_log(&self.lattice_log_bin, &args, &input)
    }

    fn lattice_cli_args(&self, subcommand: &str, include_db: bool) -> Vec<String> {
        let mut args = Vec::new();
        if let Some(cfg) = &self.config_path {
            args.push("--config".to_string());
            args.push(cfg.display().to_string());
        } else if include_db {
            if let Some(db) = &self.lattice_db {
                args.push("--db".to_string());
                args.push(db.display().to_string());
            }
        }
        args.push(subcommand.to_string());
        args
    }

    pub async fn send_frame(
        &self,
        socket_path: &Path,
        frame: Value,
        dock_wire_score: u16,
        signer_public_hex: Option<&str>,
    ) -> Result<DockResponse, LatticeDeny> {
        let Some(hex) = signer_public_hex.filter(|s| !s.is_empty()) else {
            return Err(LatticeDeny::msg(
                "signer_public_hex required for lattice dock send (refuse unbound key)",
            ));
        };
        let wire = serde_json::json!({
            "frame": frame,
            "trust_score": dock_wire_score,
            "signer_public_hex": hex,
        });
        let mut payload = serde_json::to_string(&wire).map_err(|e| LatticeDeny::msg(e.to_string()))?;
        if !payload.ends_with('\n') {
            payload.push('\n');
        }
        let mut stream = UnixStream::connect(socket_path)
            .await
            .map_err(|e| LatticeDeny::msg(format!(
                "lattice socket not found: {} ({e})",
                socket_path.display()
            )))?;
        timeout(dock_timeout(), async {
            stream
                .write_all(payload.as_bytes())
                .await
                .map_err(|e| LatticeDeny::msg(e.to_string()))?;
            let mut reader = tokio::io::BufReader::new(stream);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .await
                .map_err(|e| LatticeDeny::msg(e.to_string()))?;
            let mut resp: DockResponse =
                serde_json::from_str(line.trim()).map_err(|e| LatticeDeny::msg(e.to_string()))?;
            loop {
                if admit_deny(&resp) {
                    return Err(LatticeDeny::from_dock(resp, "lattice frame rejected"));
                }
                if admit_allow(&resp) {
                    return Ok(resp);
                }
                let Some(digest) = collect_digest(&resp) else {
                    return Err(LatticeDeny::from_dock(resp, "enqueue is not Admit"));
                };
                let mut collect = serde_json::json!({ "collect": digest }).to_string();
                if collect.ends_with('\n') == false {
                    collect.push('\n');
                }
                reader
                    .get_mut()
                    .write_all(collect.as_bytes())
                    .await
                    .map_err(|e| LatticeDeny::msg(e.to_string()))?;
                line.clear();
                reader
                    .read_line(&mut line)
                    .await
                    .map_err(|e| LatticeDeny::msg(e.to_string()))?;
                resp = serde_json::from_str(line.trim()).map_err(|e| LatticeDeny::msg(e.to_string()))?;
                if resp.ok && resp.deny.is_none() && resp.event_id.is_none() {
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        })
        .await
        .map_err(|_| LatticeDeny::msg("lattice socket timeout"))?
    }

    pub async fn health_ping(&self) -> Result<DockResponse, String> {
        let event = LatticeEvent {
            agent_id: "ucb-bridge".into(),
            channel_id: "ch-lattice-health".into(),
            contract_id: "lattice-channel-default".into(),
            event_type: "LATTICE_HEALTH_PING".into(),
            session_id: "ucb-health".into(),
            docking_port: "validation_engine".into(),
            dock_wire_score: crate::DOCK_WIRE_SCORE,
            payload: serde_json::json!({ "probe": true }),
        };
        let built = self.build_frame(&event)?;
        let socket = self.dock_path("validation_engine")?;
        self.send_frame(
            &socket,
            built.frame,
            event.dock_wire_score,
            built.signer_public_hex.as_deref(),
        )
        .await
        .map_err(String::from)
    }
}

fn dock_timeout() -> Duration {
    Duration::from_millis(WireLimits::default().dock_timeout_ms)
}

pub fn admit_allow(resp: &DockResponse) -> bool {
    resp.ok && resp.deny.is_none() && resp.event_id.is_some()
}

pub fn admit_deny(resp: &DockResponse) -> bool {
    resp.ok == false || resp.deny.is_some()
}

fn collect_digest(resp: &DockResponse) -> Option<String> {
    resp.digest
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| s.is_empty() == false)
        .map(|s| s.to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BuiltFrame {
    pub frame: Value,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub signer_public_hex: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatticeRecord {
    pub ok: bool,
    #[serde(default)]
    pub event_id: Option<i64>,
    #[serde(default)]
    pub frame_digest: Option<String>,
    #[serde(default)]
    pub frame: Option<Value>,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct DockResponse {
    #[serde(default)]
    pub ok: bool,
    #[serde(default)]
    pub event_id: Option<i64>,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub deny: Option<DenyReport>,
    #[serde(default)]
    pub allow: Option<Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct LatticeDeny {
    pub error: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny: Option<DenyReport>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub event_id: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub allow: Option<Value>,
}

impl LatticeDeny {
    pub fn msg(error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            deny: None,
            event_id: None,
            digest: None,
            allow: None,
        }
    }

    pub fn from_dock(resp: DockResponse, fallback: &str) -> Self {
        Self {
            error: resp
                .error
                .clone()
                .unwrap_or_else(|| String::from(fallback)),
            deny: resp.deny,
            event_id: resp.event_id,
            digest: resp.digest,
            allow: resp.allow,
        }
    }
}

impl From<LatticeDeny> for String {
    fn from(d: LatticeDeny) -> String {
        d.error
    }
}

fn run_lattice_build(bin: &Path, args: &[String], input: &str) -> Result<BuiltFrame, String> {
    let text = exec_lattice_log(bin, args, input)?;
    let built: BuiltFrame = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if built.frame.is_null() {
        return Err("aep-lattice-log build-frame missing LatticeChannelFrame".into());
    }
    Ok(built)
}

fn run_lattice_log(bin: &Path, args: &[String], input: &str) -> Result<LatticeRecord, String> {
    let text = exec_lattice_log(bin, args, input)?;
    let parsed: LatticeRecord = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    if !parsed.ok {
        return Err(parsed
            .error
            .unwrap_or_else(|| "aep-lattice-log record failed".into()));
    }
    Ok(parsed)
}

fn exec_lattice_log(bin: &Path, args: &[String], input: &str) -> Result<String, String> {
    let mut cmd = Command::new(bin);
    cmd.args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("spawn {bin:?}: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!("aep-lattice-log failed: {}", stderr.trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dock_timeout_matches_wire_limits() {
        assert_eq!(WireLimits::default().dock_timeout_ms, 5000);
        assert_eq!(dock_timeout(), Duration::from_millis(5000));
    }

    #[test]
    fn enqueue_is_not_admit_allow() {
        let resp = DockResponse {
            ok: true,
            event_id: None,
            digest: Some(String::from("abc")),
            error: None,
            deny: None,
            allow: None,
        };
        assert_eq!(admit_allow(&resp), false);
        assert_eq!(admit_deny(&resp), false);
        assert_eq!(collect_digest(&resp).as_deref(), Some("abc"));
    }

    #[test]
    fn event_id_is_admit_allow() {
        let resp = DockResponse {
            ok: true,
            event_id: Some(7),
            digest: Some(String::from("abc")),
            error: None,
            deny: None,
            allow: None,
        };
        assert!(admit_allow(&resp));
        assert_eq!(admit_deny(&resp), false);
    }

    #[test]
    fn deny_report_is_admit_deny() {
        let resp = DockResponse {
            ok: false,
            event_id: None,
            digest: Some(String::from("abc")),
            error: Some(String::from("closed")),
            deny: Some(DenyReport::from_error("closed")),
            allow: None,
        };
        assert_eq!(admit_allow(&resp), false);
        assert!(admit_deny(&resp));
    }

    #[tokio::test]
    async fn send_frame_collects_enqueue_then_admit_allow() {
        assert_eq!(WireLimits::default().dock_timeout_ms, 5000);
        assert_eq!(dock_timeout(), Duration::from_millis(5000));
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("validation");
        let listener = tokio::net::UnixListener::bind(&sock).expect("bind unix fixture");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            let (reader, mut writer) = stream.into_split();
            let mut reader = tokio::io::BufReader::new(reader);
            let mut line = String::new();
            reader.read_line(&mut line).await.expect("frame line");
            let enqueue = serde_json::json!({
                "ok": true,
                "digest": "abc",
            });
            let mut out = enqueue.to_string();
            out.push('\n');
            writer.write_all(out.as_bytes()).await.expect("enqueue write");
            line.clear();
            reader.read_line(&mut line).await.expect("collect line");
            assert!(line.contains("abc"), "{line}");
            let admit = serde_json::json!({
                "ok": true,
                "event_id": 11,
                "digest": "abc",
            });
            let mut out = admit.to_string();
            out.push('\n');
            writer.write_all(out.as_bytes()).await.expect("admit write");
        });
        let rt = LatticeRuntime {
            socket_base: dir.path().to_path_buf(),
            config_path: None,
            lattice_db: None,
            lattice_log_bin: PathBuf::from("aep-lattice-log"),
        };
        let frame = serde_json::json!({"kind": "fixture"});
        let docked = rt
            .send_frame(&sock, frame, crate::DOCK_WIRE_SCORE, Some("ab"))
            .await
            .expect("admit allow");
        assert!(admit_allow(&docked));
        assert_eq!(docked.event_id, Some(11));
        assert_eq!(docked.digest.as_deref(), Some("abc"));
        assert!(docked.deny.is_none());
        server.await.expect("fixture task");
    }

    #[tokio::test]
    async fn send_frame_collects_enqueue_then_admit_deny() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("validation");
        let listener = tokio::net::UnixListener::bind(&sock).expect("bind unix fixture");
        let server = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.expect("accept");
            let (reader, mut writer) = stream.into_split();
            let mut reader = tokio::io::BufReader::new(reader);
            let mut line = String::new();
            reader.read_line(&mut line).await.expect("frame line");
            let enqueue = serde_json::json!({"ok": true, "digest": "abc"});
            let mut out = enqueue.to_string();
            out.push(10 as char);
            writer.write_all(out.as_bytes()).await.expect("enqueue write");
            line.clear();
            reader.read_line(&mut line).await.expect("collect line");
            assert!(line.contains("abc"), "{line}");
            let deny = DenyReport::from_error("Admit denied");
            let admit = serde_json::json!({"ok": false, "digest": "abc", "error": "Admit denied", "deny": deny});
            let mut out = admit.to_string();
            out.push(10 as char);
            writer.write_all(out.as_bytes()).await.expect("deny write");
        });
        let rt = LatticeRuntime {
            socket_base: dir.path().to_path_buf(),
            config_path: None,
            lattice_db: None,
            lattice_log_bin: PathBuf::from("aep-lattice-log"),
        };
        let frame = serde_json::json!({"kind": "fixture"});
        let err = rt.send_frame(&sock, frame, crate::DOCK_WIRE_SCORE, Some("ab")).await.expect_err("admit deny");
        let resp = DockResponse {
            ok: false,
            event_id: err.event_id,
            digest: err.digest.clone(),
            error: Some(err.error.clone()),
            deny: err.deny.clone(),
            allow: err.allow.clone(),
        };
        assert_eq!(admit_allow(&resp), false);
        assert!(admit_deny(&resp));
        assert!(err.deny.is_some());
        server.await.expect("fixture task");
    }

    #[tokio::test]
    async fn send_frame_silent_dock_times_out() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("validation");
        let listener = tokio::net::UnixListener::bind(&sock).expect("bind unix fixture");
        let server = tokio::spawn(async move {
            let (_stream, _) = listener.accept().await.expect("accept");
            std::future::pending::<()>().await;
        });
        let rt = LatticeRuntime {
            socket_base: dir.path().to_path_buf(),
            config_path: None,
            lattice_db: None,
            lattice_log_bin: PathBuf::from("aep-lattice-log"),
        };
        let started = std::time::Instant::now();
        let frame = serde_json::json!({"kind": "fixture"});
        let err = rt.send_frame(&sock, frame, crate::DOCK_WIRE_SCORE, Some("ab")).await.expect_err("silent dock");
        let elapsed = started.elapsed();
        assert_eq!(err.error, "lattice socket timeout");
        assert!(elapsed >= Duration::from_millis(4000), "{elapsed:?}");
        assert!(elapsed <= Duration::from_millis(9000), "{elapsed:?}");
        server.abort();
    }

    #[tokio::test]
    async fn send_frame_missing_dock_refuses() {
        let dir = tempfile::tempdir().unwrap();
        let sock = dir.path().join("validation");
        let rt = LatticeRuntime {
            socket_base: dir.path().to_path_buf(),
            config_path: None,
            lattice_db: None,
            lattice_log_bin: PathBuf::from("aep-lattice-log"),
        };
        let frame = serde_json::json!({"kind": "fixture"});
        let err = rt.send_frame(&sock, frame, crate::DOCK_WIRE_SCORE, Some("ab")).await.expect_err("missing dock");
        assert!(err.error.contains("lattice socket not found"), "{}", err.error);
    }

}
