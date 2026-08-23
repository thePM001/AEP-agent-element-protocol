//! AEP 2.8 Rust SDK - lattice-gated transport via `aep-lattice-log`.

use serde_json::{json, Value};
use std::env;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

#[derive(Debug, Clone, Default)]
pub struct GatewayMeta {
    pub agent_id: Option<String>,
    pub channel_id: Option<String>,
    pub contract_id: Option<String>,
    pub event_type: Option<String>,
    pub session_id: Option<String>,
    pub trust_score: Option<i64>,
    pub gateway: Option<String>,
    pub payload_extra: Option<Value>,
}

fn lattice_strict_enabled() -> Result<bool, String> {
    if env::var("AEP_LATTICE_STRICT").unwrap_or_else(|_| "1".into()) == "0" {
        if env::var("AEP_LATTICE_STRICT_DEV").map(|v| v == "1").unwrap_or(false) {
            return Ok(false);
        }
        return Err(
            "AEP_LATTICE_STRICT=0 refused outside AEP_LATTICE_STRICT_DEV=1 (fail-closed)".into(),
        );
    }
    Ok(true)
}

fn resolve_socket_base() -> PathBuf {
    if let Ok(base) = env::var("AEP_SOCKET_BASE") {
        return PathBuf::from(base);
    }
    let data = env::var("AEP_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs_home().join(".aep"));
    data.join("sockets")
}

fn dirs_home() -> PathBuf {
    env::var("HOME").map(PathBuf::from).unwrap_or_else(|_| PathBuf::from("/tmp"))
}

fn resolve_lattice_log_bin() -> String {
    env::var("AEP_LATTICE_LOG_BIN")
        .or_else(|_| env::var("AEP_LATTICE_LOG_CLI"))
        .unwrap_or_else(|_| "aep-lattice-log".into())
}

fn resolve_config_path() -> Option<PathBuf> {
    let data = env::var("AEP_DATA")
        .map(PathBuf::from)
        .unwrap_or_else(|_| dirs_home().join(".aep"));
    let path = data.join("base-node.json");
    if path.exists() {
        Some(path)
    } else {
        None
    }
}

pub fn build_lattice_frame(event: Value) -> Result<Value, String> {
    let mut args = Vec::new();
    if let Some(cfg) = resolve_config_path() {
        args.push("--config".into());
        args.push(cfg.display().to_string());
    }
    args.push("build-frame".into());
    let mut child = Command::new(resolve_lattice_log_bin())
        .args(&args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("spawn aep-lattice-log: {e}"))?;
    if let Some(mut stdin) = child.stdin.take() {
        let payload = serde_json::to_string(&event).map_err(|e| e.to_string())?;
        stdin.write_all(payload.as_bytes()).map_err(|e| e.to_string())?;
    }
    let out = child.wait_with_output().map_err(|e| e.to_string())?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).into_owned());
    }
    let parsed: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
    if parsed.get("frame").is_none() {
        return Err("aep-lattice-log build-frame missing LatticeChannelFrame".into());
    }
    Ok(parsed)
}

fn dock_suffix(dock_port: &str) -> &str {
    match dock_port {
        "inference_engine" => "inference",
        "validation_engine" => "validation",
        "future_features" => "future",
        "regulation_module" => "regulation",
        _ => dock_port,
    }
}

fn send_lattice_line(socket_path: &Path, line: &str) -> Result<String, String> {
    use std::io::Read;
    use std::os::unix::net::UnixStream;
    let mut conn = UnixStream::connect(socket_path)
        .map_err(|e| format!("connect {socket_path:?}: {e}"))?;
    conn.set_read_timeout(Some(Duration::from_secs(8)))
        .map_err(|e| e.to_string())?;
    conn.set_write_timeout(Some(Duration::from_secs(8)))
        .map_err(|e| e.to_string())?;
    conn.write_all(line.as_bytes())
        .and_then(|_| conn.write_all(b"\n"))
        .map_err(|e| e.to_string())?;
    let mut buf = Vec::new();
    conn.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    let text = String::from_utf8_lossy(&buf);
    Ok(text.lines().next().unwrap_or("").trim().to_string())
}

pub fn lattice_dock_request(socket_base: &Path, dock_port: &str, event: Value) -> Result<(), String> {
    let socket_path = socket_base.join(dock_suffix(dock_port));
    let sealed = build_lattice_frame(event)?;
    let wire = json!({ "frame": sealed.get("frame").cloned().unwrap_or(Value::Null) });
    let line = send_lattice_line(&socket_path, &wire.to_string())?;
    let resp: Value = serde_json::from_str(&line).map_err(|e| e.to_string())?;
    if resp.get("ok").and_then(|v| v.as_bool()) != Some(true) {
        return Err(resp
            .get("error")
            .and_then(|v| v.as_str())
            .unwrap_or("lattice frame rejected")
            .into());
    }
    Ok(())
}

fn assert_url_not_ssrf(raw: &str) -> Result<(), String> {
    let lower = raw.to_ascii_lowercase();
    if !(lower.starts_with("http://") || lower.starts_with("https://")) {
        return Err(format!("lattice-gated-fetch: blocked or invalid URL scheme"));
    }
    // crude host extract after scheme
    let rest = raw.splitn(2, "://").nth(1).unwrap_or("");
    let hostport = rest.split('/').next().unwrap_or("").split('@').next_back().unwrap_or("");
    let host = hostport
        .trim_start_matches('[')
        .split(']')
        .next()
        .unwrap_or(hostport)
        .split(':')
        .next()
        .unwrap_or("")
        .to_ascii_lowercase();
    let allow_loop = env::var("AEP_LATTICE_ALLOW_LOOPBACK").map(|v| v == "1").unwrap_or(false);
    let allow_priv = env::var("AEP_LATTICE_ALLOW_PRIVATE").map(|v| v == "1").unwrap_or(false);
    let is_loop = host == "localhost"
        || host == "0.0.0.0"
        || host == "::1"
        || host.starts_with("127.");
    if !allow_loop && is_loop {
        return Err("lattice-gated-fetch: loopback blocked".into());
    }
    let is_priv = host.starts_with("10.")
        || host.starts_with("192.168.")
        || host.starts_with("169.254.")
        || host.ends_with(".internal")
        || host == "metadata.google.internal"
        || host == "metadata"
        || host.ends_with(".local")
        || {
            if let Some(rest) = host.strip_prefix("172.") {
                rest.split('.')
                    .next()
                    .and_then(|s| s.parse::<u8>().ok())
                    .map(|o| (16..=31).contains(&o))
                    .unwrap_or(false)
            } else {
                false
            }
        };
    if !allow_priv && is_priv {
        return Err("lattice-gated-fetch: private/metadata host blocked".into());
    }
    Ok(())
}

pub fn lattice_gated_fetch_url(url: &str, method: &str, meta: GatewayMeta) -> Result<(), String> {
    assert_url_not_ssrf(url)?;
    if !lattice_strict_enabled()? {
        return Ok(());
    }
    let socket_base = resolve_socket_base();
    let mut payload = json!({
        "url": url,
        "method": method,
        "gateway": meta.gateway.clone().unwrap_or_else(|| "http".into()),
    });
    if let Some(extra) = meta.payload_extra {
        if let Some(obj) = payload.as_object_mut() {
            if let Some(extra_obj) = extra.as_object() {
                for (k, v) in extra_obj {
                    obj.insert(k.clone(), v.clone());
                }
            }
        }
    }
    let event = json!({
        "agent_id": meta.agent_id.clone().unwrap_or_else(|| "lattice-gateway".into()),
        "channel_id": meta.channel_id.clone().unwrap_or_else(|| "ch-outbound-gateway".into()),
        "contract_id": meta.contract_id.clone().unwrap_or_else(|| "lattice-channel-default".into()),
        "event_type": meta.event_type.clone().unwrap_or_else(|| "LATTICE_GATEWAY_REQUEST".into()),
        "session_id": meta.session_id.clone().unwrap_or_else(|| "gateway-session".into()),
        "docking_port": "inference_engine",
        "trust_score": meta.trust_score.unwrap_or(0),
        "payload": payload,
    });
    lattice_dock_request(&socket_base, "inference_engine", event)?;
    let inference = socket_base.join("inference");
    if !inference.exists() {
        return Err(format!(
            "inference_engine dock required for lattice-gated fetch: {}",
            inference.display()
        ));
    }
    Ok(())
}


