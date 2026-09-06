//! Lattice transport via aep-lattice-log CLI + Unix socket docks.

use crate::translator::LatticeEvent;
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
        trust_score: u16,
        signer_public_hex: Option<&str>,
    ) -> Result<DockResponse, LatticeDeny> {
        // HIGH residual: never send dock frames without a bound signer public key
        let Some(hex) = signer_public_hex.filter(|s| !s.is_empty()) else {
            return Err(LatticeDeny {
                error: String::from("signer_public_hex required for lattice dock send (fail-closed unbound key)"),
                deny: None,
            });
        };
        let wire = serde_json::json!({
            "frame": frame,
            "trust_score": trust_score,
            "signer_public_hex": hex,
        });
        let mut payload = serde_json::to_string(&wire).map_err(|e| LatticeDeny {
            error: e.to_string(),
            deny: None,
        })?;
        if !payload.ends_with('\n') {
            payload.push('\n');
        }
        let mut stream = UnixStream::connect(socket_path)
            .await
            .map_err(|e| LatticeDeny {
                error: format!("lattice socket not found: {} ({e})", socket_path.display()),
                deny: None,
            })?;
        timeout(Duration::from_secs(12), async {
            stream
                .write_all(payload.as_bytes())
                .await
                .map_err(|e| LatticeDeny {
                    error: e.to_string(),
                    deny: None,
                })?;
            let mut reader = tokio::io::BufReader::new(stream);
            let mut line = String::new();
            reader
                .read_line(&mut line)
                .await
                .map_err(|e| LatticeDeny {
                    error: e.to_string(),
                    deny: None,
                })?;
            let resp: DockResponse =
                serde_json::from_str(line.trim()).map_err(|e| LatticeDeny {
                    error: e.to_string(),
                    deny: None,
                })?;
            if !resp.ok {
                return Err(LatticeDeny {
                    error: resp
                        .error
                        .clone()
                        .unwrap_or_else(|| String::from("lattice frame rejected")),
                    deny: resp.deny.clone(),
                });
            }
            if resp.event_id.is_some() {
                return Ok(resp);
            }
            let Some(digest) = resp.digest.clone() else {
                return Ok(resp);
            };
            let mut collect = serde_json::json!({ "collect": digest }).to_string();
            if collect.ends_with('\n') == false {
                collect.push('\n');
            }
            reader
                .get_mut()
                .write_all(collect.as_bytes())
                .await
                .map_err(|e| LatticeDeny {
                    error: e.to_string(),
                    deny: None,
                })?;
            line.clear();
            reader
                .read_line(&mut line)
                .await
                .map_err(|e| LatticeDeny {
                    error: e.to_string(),
                    deny: None,
                })?;
            let applied: DockResponse =
                serde_json::from_str(line.trim()).map_err(|e| LatticeDeny {
                    error: e.to_string(),
                    deny: None,
                })?;
            if !applied.ok {
                return Err(LatticeDeny {
                    error: applied
                        .error
                        .clone()
                        .unwrap_or_else(|| String::from("lattice frame rejected")),
                    deny: applied.deny.clone(),
                });
            }
            Ok(applied)
        })
        .await
        .map_err(|_| LatticeDeny {
            error: String::from("lattice socket timeout"),
            deny: None,
        })?
    }

    pub async fn health_ping(&self) -> Result<DockResponse, String> {
        let event = LatticeEvent {
            agent_id: "ucb-bridge".into(),
            channel_id: "ch-lattice-health".into(),
            contract_id: "lattice-channel-default".into(),
            event_type: "LATTICE_HEALTH_PING".into(),
            session_id: "ucb-health".into(),
            docking_port: "validation_engine".into(),
            trust_score: crate::ingress::FOREIGN_TRUST_DEFAULT,
            payload: serde_json::json!({ "probe": true }),
        };
        let built = self.build_frame(&event)?;
        let socket = self.dock_path("validation_engine")?;
        self.send_frame(
            &socket,
            built.frame,
            event.trust_score,
            built.signer_public_hex.as_deref(),
        )
        .await
        .map_err(String::from)
    }
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockResponse {
    pub ok: bool,
    #[serde(default)]
    pub event_id: Option<i64>,
    #[serde(default)]
    pub digest: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub deny: Option<DenyReport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LatticeDeny {
    pub error: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deny: Option<DenyReport>,
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
