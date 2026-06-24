//! AEP WASM sandbox - Lattice Channel socket only (no plain HTTP bypass when strict).

use aep_lattice_channel::{frame_digest, DockingPort, LatticeChannelFrame};
use aep_wasm_sandbox::{SandboxLimits, WasmSandbox, POLICY_WAT_TEMPLATE};
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::path::Path;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

#[derive(Debug, Deserialize)]
struct LatticeWire {
    frame: LatticeChannelFrame,
}

#[derive(Debug, Serialize)]
struct LatticeResponse {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    result: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    status: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    service: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    digest: Option<String>,
}

fn lattice_strict() -> bool {
    std::env::var("AEP_LATTICE_STRICT").unwrap_or_else(|_| "1".into()) != "0"
}

fn resolve_socket_path() -> String {
    if let Ok(path) = std::env::var("WASM_SANDBOX_SOCKET") {
        return path;
    }
    let base = std::env::var("AEP_SOCKET_BASE").unwrap_or_else(|_| "/data/aep/sockets".into());
    format!("{base}/wasm_sandbox")
}

fn resolve_lattice_db() -> String {
    if let Ok(db) = std::env::var("AEP_LATTICE_DB") {
        return db;
    }
    let data = std::env::var("AEP_DATA").unwrap_or_else(|_| "/data/aep".into());
    format!("{data}/action-lattice.db")
}

fn lookup_payload_for_digest(db_path: &str, digest: &str) -> Result<serde_json::Value, String> {
    if !Path::new(db_path).exists() {
        return Err(format!("lattice db not found: {db_path}"));
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT payload_json FROM action_lattice_events
             WHERE frame_digest = ?1 AND event_type = 'WASM_EVALUATE'
             ORDER BY id DESC LIMIT 1",
        )
        .map_err(|e| e.to_string())?;
    let payload_raw: String = stmt
        .query_row([digest], |row| row.get(0))
        .map_err(|_| format!("no WASM_EVALUATE payload for digest {digest}"))?;
    serde_json::from_str(&payload_raw).map_err(|e| e.to_string())
}

fn validate_frame(frame: &LatticeChannelFrame) -> Result<(), String> {
    if frame.docking_port != DockingPort::FutureFeatures {
        return Err(format!(
            "wasm sandbox requires docking_port future_features, got {:?}",
            frame.docking_port
        ));
    }
    if frame.channel_id.is_empty() || frame.agent_id.is_empty() {
        return Err("frame missing channel_id or agent_id".into());
    }
    if frame.contract_id.is_empty() {
        return Err("frame missing contract_id".into());
    }
    Ok(())
}

async fn handle_lattice_line(
    line: &str,
    sandbox: &WasmSandbox,
) -> LatticeResponse {
    let wire: LatticeWire = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            return LatticeResponse {
                ok: false,
                result: None,
                status: None,
                service: Some("aep-wasm-sandbox".into()),
                error: Some(format!("invalid lattice wire JSON: {e}")),
                digest: None,
            };
        }
    };

    if let Err(e) = validate_frame(&wire.frame) {
        return LatticeResponse {
            ok: false,
            result: None,
            status: None,
            service: Some("aep-wasm-sandbox".into()),
            error: Some(e),
            digest: None,
        };
    }

    let digest = frame_digest(&wire.frame);

    if wire.frame.channel_id == "ch-wasm-health" {
        return LatticeResponse {
            ok: true,
            result: None,
            status: Some("ok".into()),
            service: Some("aep-wasm-sandbox".into()),
            error: None,
            digest: Some(digest),
        };
    }

    let db_path = resolve_lattice_db();
    let payload = match lookup_payload_for_digest(&db_path, &digest) {
        Ok(p) => p,
        Err(e) => {
            return LatticeResponse {
                ok: false,
                result: None,
                status: None,
                service: Some("aep-wasm-sandbox".into()),
                error: Some(e),
                digest: Some(digest),
            };
        }
    };

    if payload.get("wat").and_then(|v| v.as_str()).is_some() {
        return LatticeResponse {
            ok: false,
            result: None,
            status: None,
            service: Some("aep-wasm-sandbox".into()),
            error: Some(
                "caller-supplied WAT rejected; sandbox evaluates registered policy template only"
                    .into(),
            ),
            digest: Some(digest),
        };
    }

    let input = payload.get("input").and_then(|v| v.as_i64()).unwrap_or(0) as i32;

    match sandbox.evaluate_wat(POLICY_WAT_TEMPLATE, input) {
        Ok(result) => LatticeResponse {
            ok: true,
            result: Some(result.output),
            status: Some("ok".into()),
            service: Some("aep-wasm-sandbox".into()),
            error: None,
            digest: Some(digest),
        },
        Err(err) => LatticeResponse {
            ok: false,
            result: None,
            status: None,
            service: Some("aep-wasm-sandbox".into()),
            error: Some(err.to_string()),
            digest: Some(digest),
        },
    }
}

async fn serve_connection(
    stream: UnixStream,
    sandbox: std::sync::Arc<WasmSandbox>,
) -> Result<(), Box<dyn std::error::Error>> {
    let (reader, mut writer) = stream.into_split();
    let mut lines = BufReader::new(reader).lines();
    while let Some(line) = lines.next_line().await? {
        if line.is_empty() {
            continue;
        }
        let resp = handle_lattice_line(&line, &sandbox).await;
        let payload = serde_json::to_string(&resp)?;
        writer.write_all(payload.as_bytes()).await?;
        writer.write_all(b"\n").await?;
    }
    Ok(())
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_writer(std::io::stderr)
        .init();

    if !lattice_strict() {
        tracing::warn!(
            "AEP_LATTICE_STRICT=0: plain HTTP bypass is DEPRECATED and will be removed"
        );
    }

    let socket_path = resolve_socket_path();
    let parent = Path::new(&socket_path)
        .parent()
        .unwrap_or_else(|| Path::new("/tmp"));
    std::fs::create_dir_all(parent)?;

    if Path::new(&socket_path).exists() {
        std::fs::remove_file(&socket_path)?;
    }

    let sandbox = std::sync::Arc::new(WasmSandbox::new(SandboxLimits::default())?);
    let listener = UnixListener::bind(&socket_path)?;
    tracing::info!(
        socket = %socket_path,
        strict = lattice_strict(),
        "AEP WASM sandbox listening on lattice channel socket"
    );

    loop {
        let (stream, _) = listener.accept().await?;
        let sandbox = sandbox.clone();
        tokio::spawn(async move {
            if let Err(e) = serve_connection(stream, sandbox).await {
                tracing::warn!(error = %e, "wasm sandbox lattice connection error");
            }
        });
    }
}