//! Unix socket listeners for AEP 2.8 Base Node docking ports (Phase 4).

use aep_agentmesh::rotate_on_trust_change;
use aep_lattice_channel::{
    frame_digest, ContractRegistry, DockingPort, LatticeChannelFrame, RateLimiter,
};
use aep_lattice_crypto::KemKeypair;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::io::{AsyncRead, AsyncWrite};
use tokio::net::{TcpListener, UnixListener, UnixStream};
use tokio_rustls::TlsAcceptor;
use tokio::sync::Semaphore;
use tokio::task::JoinHandle;
use tracing::{info, warn};

use crate::{
    dock_keys::{
        decode_signer_public_hex, load_or_create_dock_kem, signer_rate_key, AgentSignKeyStore,
    },
    docking_port_specs, enforce_writing_value, frame_digest_exists, record_channel_frame,
    record_side_channel_anomaly, value_has_writing_violations,
    DockingPortSpec, DynAepEventInput, ReplayGuard, SideChannelAnomalyKind,
};

const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;
const MAX_CONNECTIONS: usize = 64;
const MAX_FRAME_AGE_SECS: u64 = 300;
const MAX_FRAME_FUTURE_SKEW_SECS: u64 = 60;
const GLOBAL_RATE_LIMIT: u32 = 600;
const SIGNER_RATE_LIMIT: u32 = 120;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DockFrameResponse {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub event_id: Option<i64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub digest: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pong: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(untagged)]
enum DockRequest {
    Ping {
        #[allow(dead_code)]
        ping: bool,
    },
    Frame {
        frame: LatticeChannelFrame,
        #[serde(default)]
        trust_score: Option<u16>,
        #[serde(default)]
        signer_public_hex: Option<String>,
    },
    Event {
        event: DynAepEventInput,
    },
    RegisterLrp {
        register_lrp: RegisterLrpWire,
    },
}

#[derive(Debug, Deserialize)]
struct RegisterLrpWire {
    lrp_id: String,
}

pub struct DockingRuntime {
    pub socket_base: String,
    pub lrps: Vec<String>,
    pub db: Arc<Mutex<Connection>>,
    pub contracts: Arc<Mutex<ContractRegistry>>,
    pub rate_limiter: Arc<Mutex<RateLimiter>>,
    pub global_rate_limiter: Arc<Mutex<RateLimiter>>,
    pub agent_trust: Arc<Mutex<HashMap<String, u16>>>,
    pub agent_bundles: Arc<Mutex<HashMap<String, aep_agentmesh::AgentMeshBundle>>>,
    pub manifests: Arc<Mutex<crate::task_manifest::ManifestRegistry>>,
    pub dock_kem: Arc<KemKeypair>,
    pub agent_sign_keys: Arc<Mutex<AgentSignKeyStore>>,
    pub replay_guard: Arc<Mutex<ReplayGuard>>,
    connection_limit: Arc<Semaphore>,
}

impl DockingRuntime {
    pub fn new(socket_base: impl Into<String>, conn: Connection, lrps: &[String]) -> Self {
        let data_dir = conn
            .path()
            .and_then(|p| Path::new(p).parent().map(Path::to_path_buf))
            .unwrap_or_else(|| Path::new("/tmp").to_path_buf());
        Self::with_data_dir(socket_base, conn, lrps, &data_dir)
    }

    pub fn with_data_dir(
        socket_base: impl Into<String>,
        conn: Connection,
        lrps: &[String],
        data_dir: &Path,
    ) -> Self {
        Self {
            socket_base: socket_base.into(),
            lrps: lrps.to_vec(),
            db: Arc::new(Mutex::new(conn)),
            contracts: Arc::new(Mutex::new(crate::bootstrap_contracts_from_lrps(lrps))),
            rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                SIGNER_RATE_LIMIT,
                Duration::from_secs(60),
            ))),
            global_rate_limiter: Arc::new(Mutex::new(RateLimiter::new(
                GLOBAL_RATE_LIMIT,
                Duration::from_secs(60),
            ))),
            agent_trust: Arc::new(Mutex::new(HashMap::new())),
            agent_bundles: Arc::new(Mutex::new(HashMap::new())),
            manifests: Arc::new(Mutex::new(crate::task_manifest::ManifestRegistry::from_env())),
            dock_kem: Arc::new(load_or_create_dock_kem(data_dir)),
            agent_sign_keys: Arc::new(Mutex::new(AgentSignKeyStore::load(data_dir))),
            replay_guard: Arc::new(Mutex::new(ReplayGuard::default())),
            connection_limit: Arc::new(Semaphore::new(MAX_CONNECTIONS)),
        }
    }

    pub fn port_specs(&self) -> Vec<DockingPortSpec> {
        docking_port_specs(&self.socket_base)
    }

    pub fn dock_kem_public(&self) -> &[u8] {
        &self.dock_kem.public
    }
}

pub fn port_event_type(port: &DockingPort) -> &'static str {
    match port {
        DockingPort::InferenceEngine => "docking_inference_engine",
        DockingPort::ValidationEngine => "docking_validation_engine",
        DockingPort::FutureFeatures => "docking_future_features",
        DockingPort::Pera => crate::pera::PERA_EVENT_TYPE,
        DockingPort::RegulationModule => "docking_regulation_module",
    }
}

pub fn process_request(
    runtime: &DockingRuntime,
    port: &DockingPort,
    line: &str,
) -> DockFrameResponse {
    let req: DockRequest = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => {
            let db = runtime.db.lock().expect("db lock");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::InvalidJson,
                "unknown",
                port,
                format!("invalid JSON: {e}"),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(format!("invalid JSON: {e}")),
                pong: None,
            };
        }
    };

    match req {
        DockRequest::Frame {
            frame,
            trust_score,
            signer_public_hex,
        } => handle_frame(runtime, port, &frame, trust_score, signer_public_hex),
        DockRequest::Ping { .. } => reject_side_channel(
            runtime,
            port,
            "unknown",
            SideChannelAnomalyKind::PlainPingRejected,
            "plain ping rejected: LatticeChannelFrame required".into(),
        ),
        DockRequest::Event { event } => reject_side_channel(
            runtime,
            port,
            &event.agent_id,
            SideChannelAnomalyKind::PlainEventRejected,
            "plain event rejected: seal payload into LatticeChannelFrame via aep-lattice-log build-frame"
                .into(),
        ),
        DockRequest::RegisterLrp { register_lrp } => reject_side_channel(
            runtime,
            port,
            "unknown",
            SideChannelAnomalyKind::PlainRegisterLrpRejected,
            format!(
                "plain register_lrp rejected for {}: use LatticeChannelFrame on regulation_module dock",
                register_lrp.lrp_id
            ),
        ),
    }
}

fn rate_limit_response(
    runtime: &DockingRuntime,
    port: &DockingPort,
    agent_id: &str,
    detail: String,
) -> DockFrameResponse {
    let db = runtime.db.lock().expect("db lock");
    let _ = record_side_channel_anomaly(
        &db,
        SideChannelAnomalyKind::RateLimited,
        agent_id,
        port,
        detail.clone(),
    );
    DockFrameResponse {
        ok: false,
        event_id: None,
        digest: None,
        error: Some(detail),
        pong: None,
    }
}

fn reject_side_channel(
    runtime: &DockingRuntime,
    port: &DockingPort,
    agent_id: &str,
    kind: SideChannelAnomalyKind,
    detail: String,
) -> DockFrameResponse {
    let db = runtime.db.lock().expect("db lock");
    let _ = record_side_channel_anomaly(&db, kind, agent_id, port, detail.clone());
    DockFrameResponse {
        ok: false,
        event_id: None,
        digest: None,
        error: Some(detail),
        pong: None,
    }
}

fn resolve_signer_public(
    runtime: &DockingRuntime,
    agent_id: &str,
    signer_public_hex: Option<String>,
) -> Option<Vec<u8>> {
    if let Some(hex_str) = signer_public_hex {
        if let Some(bytes) = decode_signer_public_hex(&hex_str) {
            return Some(bytes);
        }
    }
    {
        let manifests = runtime.manifests.lock().expect("manifests lock");
        if let Some(hex_str) = manifests.signer_public_hex(agent_id) {
            if let Some(bytes) = decode_signer_public_hex(&hex_str) {
                return Some(bytes);
            }
        }
    }
    runtime
        .agent_sign_keys
        .lock()
        .expect("agent sign keys lock")
        .public_for(agent_id)
}

fn resolve_agent_bundle(
    runtime: &DockingRuntime,
    agent_id: &str,
    trust_score: Option<u16>,
    sign_public: &[u8],
) -> aep_agentmesh::AgentMeshBundle {
    let score = trust_score.unwrap_or_else(|| {
        runtime
            .agent_trust
            .lock()
            .expect("trust lock")
            .get(agent_id)
            .copied()
            .unwrap_or(500)
    });
    let mut bundles = runtime.agent_bundles.lock().expect("bundles lock");
    let mut trust_map = runtime.agent_trust.lock().expect("trust lock");
    trust_map.insert(agent_id.to_string(), score);
    let entry = bundles
        .entry(agent_id.to_string())
        .or_insert_with(|| crate::agentmesh_bundle_for_frame(agent_id, score, sign_public));
    if entry.trust_score != score {
        rotate_on_trust_change(entry, score, crate::now_unix());
    } else {
        entry.trust_score = score;
    }
    entry.clone()
}

fn enforce_epscom_on_payload(plaintext: &[u8]) -> Result<(), String> {
    let Ok(value) = serde_json::from_slice::<Value>(plaintext) else {
        return Ok(());
    };
    let target = if let Some(payload) = value.get("payload") {
        payload
    } else {
        &value
    };
    let enforced = enforce_writing_value(target);
    if value_has_writing_violations(&enforced) {
        return Err("EPSCOM writing violations remain after enforcement".into());
    }
    Ok(())
}

fn is_lrp_allowlisted(runtime: &DockingRuntime, contract_id: &str) -> bool {
    runtime.lrps.iter().any(|lrp| lrp == contract_id)
}

fn frame_is_fresh(sent_at_unix: u64) -> Result<(), String> {
    let now = crate::now_unix();
    if sent_at_unix + MAX_FRAME_AGE_SECS < now {
        return Err(format!(
            "frame stale: sent_at_unix={sent_at_unix} older than {MAX_FRAME_AGE_SECS}s"
        ));
    }
    if sent_at_unix > now.saturating_add(MAX_FRAME_FUTURE_SKEW_SECS) {
        return Err(format!(
            "frame clock skew: sent_at_unix={sent_at_unix} too far in future"
        ));
    }
    Ok(())
}

async fn write_response_line(
    writer: &mut (impl tokio::io::AsyncWrite + Unpin),
    resp: &DockFrameResponse,
) -> std::io::Result<()> {
    let line = serde_json::to_string(resp).unwrap_or_else(|_| {
        r#"{"ok":false,"error":"internal response serialization failed"}"#.into()
    });
    writer.write_all(format!("{line}\n").as_bytes()).await
}

fn handle_frame(
    runtime: &DockingRuntime,
    expected_port: &DockingPort,
    frame: &LatticeChannelFrame,
    trust_score: Option<u16>,
    signer_public_hex: Option<String>,
) -> DockFrameResponse {
    if &frame.docking_port != expected_port {
        let db = runtime.db.lock().expect("db lock");
        let detail = format!(
            "docking_port mismatch: frame={:?} listener={:?}",
            frame.docking_port, expected_port
        );
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::PortMismatch,
            &frame.agent_id,
            expected_port,
            detail.clone(),
        );
        return DockFrameResponse {
            ok: false,
            event_id: None,
            digest: None,
            error: Some(detail),
            pong: None,
        };
    }

    let signer_public = match resolve_signer_public(runtime, &frame.agent_id, signer_public_hex) {
        Some(pk) => pk,
        None => {
            let db = runtime.db.lock().expect("db lock");
            let detail = format!(
                "signer public key unknown for agent_id={}",
                frame.agent_id
            );
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::CryptoVerificationFailed,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(detail),
                pong: None,
            };
        }
    };

    let rate_key = signer_rate_key(&signer_public);
    if let Err(e) = runtime
        .global_rate_limiter
        .lock()
        .expect("global rate limiter lock")
        .check("global")
    {
        return rate_limit_response(runtime, expected_port, &frame.agent_id, e.to_string());
    }
    if let Err(e) = runtime
        .rate_limiter
        .lock()
        .expect("rate limiter lock")
        .check(&rate_key)
    {
        return rate_limit_response(runtime, expected_port, &frame.agent_id, e.to_string());
    }

    if let Err(detail) = frame_is_fresh(frame.sent_at_unix) {
        let db = runtime.db.lock().expect("db lock");
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::StaleFrameRejected,
            &frame.agent_id,
            expected_port,
            detail.clone(),
        );
        return DockFrameResponse {
            ok: false,
            event_id: None,
            digest: None,
            error: Some(detail),
            pong: None,
        };
    }

    let allow_inactive = expected_port == &DockingPort::RegulationModule;
    let plaintext = if allow_inactive {
        match crate::verify_inbound_dock_frame(
            frame,
            &runtime.dock_kem,
            &signer_public,
            &ContractRegistry::default(),
            true,
        ) {
            Ok(p) => p,
            Err(detail) => {
                let db = runtime.db.lock().expect("db lock");
                let _ = record_side_channel_anomaly(
                    &db,
                    SideChannelAnomalyKind::CryptoVerificationFailed,
                    &frame.agent_id,
                    expected_port,
                    detail.clone(),
                );
                return DockFrameResponse {
                    ok: false,
                    event_id: None,
                    digest: None,
                    error: Some(detail),
                    pong: None,
                };
            }
        }
    } else {
        let contracts = runtime.contracts.lock().expect("contracts lock");
        if !contracts.is_active(&frame.contract_id) {
            let db = runtime.db.lock().expect("db lock");
            let detail = format!("contract inactive: {}", frame.contract_id);
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::ContractInactive,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(detail),
                pong: None,
            };
        }
        match crate::verify_inbound_dock_frame(
            frame,
            &runtime.dock_kem,
            &signer_public,
            &contracts,
            false,
        ) {
            Ok(p) => p,
            Err(detail) => {
                let db = runtime.db.lock().expect("db lock");
                let _ = record_side_channel_anomaly(
                    &db,
                    SideChannelAnomalyKind::CryptoVerificationFailed,
                    &frame.agent_id,
                    expected_port,
                    detail.clone(),
                );
                return DockFrameResponse {
                    ok: false,
                    event_id: None,
                    digest: None,
                    error: Some(detail),
                    pong: None,
                };
            }
        }
    };

    if expected_port == &DockingPort::RegulationModule {
        if let Ok(value) = serde_json::from_slice::<Value>(&plaintext) {
            if value.get("action").and_then(|v| v.as_str()) == Some("register_lrp") {
                if !is_lrp_allowlisted(runtime, &frame.contract_id) {
                    let db = runtime.db.lock().expect("db lock");
                    let detail = format!(
                        "lrp {} not allowlisted in AEP-Base-Node config lrps[]",
                        frame.contract_id
                    );
                    let _ = record_side_channel_anomaly(
                        &db,
                        SideChannelAnomalyKind::LrpNotAllowlisted,
                        &frame.agent_id,
                        expected_port,
                        detail.clone(),
                    );
                    return DockFrameResponse {
                        ok: false,
                        event_id: None,
                        digest: None,
                        error: Some(detail),
                        pong: None,
                    };
                }
                let mut contracts = runtime.contracts.lock().expect("contracts lock");
                contracts.register(&frame.contract_id);
            }
        }
    }

    {
        let contracts = runtime.contracts.lock().expect("contracts lock");
        if !contracts.is_active(&frame.contract_id) {
            let db = runtime.db.lock().expect("db lock");
            let detail = format!("contract inactive: {}", frame.contract_id);
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::ContractInactive,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(detail),
                pong: None,
            };
        }
    }

    if let Err(detail) = enforce_epscom_on_payload(&plaintext) {
        let db = runtime.db.lock().expect("db lock");
        let _ = record_side_channel_anomaly(
            &db,
            SideChannelAnomalyKind::EpscomViolationRejected,
            &frame.agent_id,
            expected_port,
            detail.clone(),
        );
        return DockFrameResponse {
            ok: false,
            event_id: None,
            digest: None,
            error: Some(detail),
            pong: None,
        };
    }

    let digest = frame_digest(frame);
    {
        let db = runtime.db.lock().expect("db lock");
        if frame_digest_exists(&db, &digest).unwrap_or(false) {
            let detail = format!("frame replay rejected: {digest}");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::FrameReplayRejected,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(detail),
                pong: None,
            };
        }
    }
    {
        let mut replay = runtime.replay_guard.lock().expect("replay lock");
        if !replay.check_and_record(&digest, frame.sent_at_unix) {
            let db = runtime.db.lock().expect("db lock");
            let detail = format!("frame replay rejected: {digest}");
            let _ = record_side_channel_anomaly(
                &db,
                SideChannelAnomalyKind::FrameReplayRejected,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(detail),
                pong: None,
            };
        }
    }

    {
        let mut manifests = runtime.manifests.lock().expect("manifests lock");
        manifests.reload_if_stale();
        if let Err(detail) = manifests.validate_agent(&frame.agent_id, trust_score) {
            let kind = if detail.contains("provisional") {
                SideChannelAnomalyKind::ProvisionalManifestRejected
            } else if detail.contains("trust_score") {
                SideChannelAnomalyKind::TrustScoreExceedsManifest
            } else {
                SideChannelAnomalyKind::MissingTaskManifest
            };
            let db = runtime.db.lock().expect("db lock");
            let _ = record_side_channel_anomaly(
                &db,
                kind,
                &frame.agent_id,
                expected_port,
                detail.clone(),
            );
            return DockFrameResponse {
                ok: false,
                event_id: None,
                digest: None,
                error: Some(detail),
                pong: None,
            };
        }
    }

    let event_type = if expected_port == &DockingPort::RegulationModule {
        "docking_regulation_lattice"
    } else {
        port_event_type(expected_port)
    };
    let bundle = resolve_agent_bundle(runtime, &frame.agent_id, trust_score, &signer_public);
    let db = runtime.db.lock().expect("db lock");
    match record_channel_frame(&db, frame, event_type, &bundle, None) {
        Ok(event_id) => DockFrameResponse {
            ok: true,
            event_id: Some(event_id),
            digest: Some(digest),
            error: None,
            pong: None,
        },
        Err(e) => DockFrameResponse {
            ok: false,
            event_id: None,
            digest: None,
            error: Some(e.to_string()),
            pong: None,
        },
    }
}

fn prepare_socket_dir(socket_base: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(socket_base)?;
    Ok(())
}

fn bind_listener(path: &str) -> std::io::Result<UnixListener> {
    let p = Path::new(path);
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    UnixListener::bind(path)
}

async fn read_line_limited(
    reader: &mut (impl tokio::io::AsyncRead + Unpin),
    max_bytes: usize,
) -> std::io::Result<Option<String>> {
    let mut buf = Vec::with_capacity(256);
    let mut byte = [0u8; 1];
    loop {
        let n = reader.read(&mut byte).await?;
        if n == 0 {
            return if buf.is_empty() {
                Ok(None)
            } else {
                Ok(Some(String::from_utf8(buf).map_err(|e| {
                    std::io::Error::new(std::io::ErrorKind::InvalidData, e)
                })?))
            };
        }
        if byte[0] == b'\n' {
            return Ok(Some(String::from_utf8(buf).map_err(|e| {
                std::io::Error::new(std::io::ErrorKind::InvalidData, e)
            })?));
        }
        if buf.len() >= max_bytes {
            return Ok(None);
        }
        buf.push(byte[0]);
    }
}

async fn serve_connection<R, W>(
    runtime: Arc<DockingRuntime>,
    port: DockingPort,
    reader: R,
    mut writer: W,
) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut reader = BufReader::new(reader);
    loop {
        let line = match read_line_limited(&mut reader, MAX_LINE_BYTES).await? {
            Some(l) => l,
            None => {
                {
                    let db = runtime.db.lock().expect("db lock");
                    let _ = record_side_channel_anomaly(
                        &db,
                        SideChannelAnomalyKind::OversizedLine,
                        "unknown",
                        &port,
                        format!("line exceeds {MAX_LINE_BYTES} bytes"),
                    );
                }
                let resp = DockFrameResponse {
                    ok: false,
                    event_id: None,
                    digest: None,
                    error: Some("line exceeds 4MB limit".into()),
                    pong: None,
                };
            write_response_line(&mut writer, &resp).await?;
            break;
            }
        };
        let resp = process_request(&runtime, &port, &line);
        write_response_line(&mut writer, &resp).await?;
    }
    Ok(())
}

async fn serve_port(
    runtime: Arc<DockingRuntime>,
    port: DockingPort,
    listener: UnixListener,
    listen_path: String,
) -> std::io::Result<()> {
    info!(port = ?port, path = %listen_path, "docking port listening");
    loop {
        let permit = runtime
            .connection_limit
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        let (stream, _) = listener.accept().await?;
        let rt = runtime.clone();
        tokio::spawn(async move {
            let _permit = permit;
            let (reader, writer) = stream.into_split();
            if let Err(e) = serve_connection(rt, port, reader, writer).await {
                warn!(error = %e, "docking connection closed with error");
            }
        });
    }
}

fn tls_dock_port(port: DockingPort) -> u16 {
    match port {
        DockingPort::InferenceEngine => 28425,
        DockingPort::ValidationEngine => 28426,
        DockingPort::FutureFeatures => 28427,
        DockingPort::Pera => 28429,
        DockingPort::RegulationModule => 28428,
    }
}

async fn serve_tls_port(
    runtime: Arc<DockingRuntime>,
    port: DockingPort,
    listener: TcpListener,
    acceptor: TlsAcceptor,
    bind_addr: String,
) -> std::io::Result<()> {
    info!(port = ?port, addr = %bind_addr, "docking TLS port listening");
    loop {
        let permit = runtime
            .connection_limit
            .clone()
            .acquire_owned()
            .await
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        let (tcp, _) = listener.accept().await?;
        let acceptor = acceptor.clone();
        let rt = runtime.clone();
        tokio::spawn(async move {
            let _permit = permit;
            match acceptor.accept(tcp).await {
                Ok(tls) => {
                    let (reader, writer) = tokio::io::split(tls);
                    if let Err(e) = serve_connection(rt, port, reader, writer).await {
                        warn!(error = %e, "docking TLS connection closed with error");
                    }
                }
                Err(e) => warn!(error = %e, "docking TLS handshake failed"),
            }
        });
    }
}

pub async fn run_docking_servers(runtime: DockingRuntime) -> std::io::Result<Vec<JoinHandle<()>>> {
    prepare_socket_dir(&runtime.socket_base)?;
    let shared = Arc::new(runtime);
    let mut handles = Vec::new();
    if std::env::var("AEP_LATTICE_TRANSPORT").unwrap_or_default() == "tls" {
        let data_dir = std::env::var("AEP_DATA").unwrap_or_else(|_| "/data/aep".into());
        let (ca_pem, _) = aep_agentmesh::tls::ensure_mesh_ca(std::path::Path::new(&data_dir))
            .map_err(std::io::Error::other)?;
        let server = aep_agentmesh::tls::ensure_dock_server_identity(std::path::Path::new(&data_dir))
            .map_err(std::io::Error::other)?;
        let server_cfg = aep_agentmesh::tls::build_server_config(&ca_pem, &server.cert_pem, &server.key_pem)
            .map_err(std::io::Error::other)?;
        let acceptor = TlsAcceptor::from(server_cfg);
        let host = std::env::var("AEP_LATTICE_TLS_BIND").unwrap_or_else(|_| "127.0.0.1".into());
        for spec in shared.port_specs() {
            let rt = shared.clone();
            let port = spec.port;
            let tcp_port = tls_dock_port(port);
            let bind_addr = format!("{host}:{tcp_port}");
            let listener = TcpListener::bind(&bind_addr).await.map_err(|e| {
                warn!(error = %e, addr = %bind_addr, ?port, "docking TLS bind failed");
                e
            })?;
            let acceptor = acceptor.clone();
            let addr = bind_addr.clone();
            handles.push(tokio::spawn(async move {
                if let Err(e) = serve_tls_port(rt, port, listener, acceptor, addr).await {
                    warn!(error = %e, ?port, "docking TLS listener exited");
                }
            }));
        }
    }
    for spec in shared.port_specs() {
        let rt = shared.clone();
        let listen_path = spec.listen_path.clone();
        let port = spec.port;
        let listener = bind_listener(&listen_path).map_err(|e| {
            warn!(error = %e, path = %listen_path, ?port, "docking port bind failed");
            e
        })?;
        handles.push(tokio::spawn(async move {
            if let Err(e) = serve_port(rt, port, listener, listen_path).await {
                warn!(error = %e, ?port, "docking port listener exited");
            }
        }));
    }
    Ok(handles)
}

pub fn sockets_exist(socket_base: &str) -> bool {
    docking_port_specs(socket_base)
        .iter()
        .all(|spec| Path::new(&spec.listen_path).exists())
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_lattice_channel::build_frame_for_dock;
    use tokio::io::AsyncBufReadExt;
    use crate::open_lattice_db;

    fn build_test_frame(
        runtime: &DockingRuntime,
        channel_id: &str,
        agent_id: &str,
        session_id: &str,
        port: DockingPort,
        contract_id: &str,
        payload: &[u8],
        _seq: u64,
    ) -> (LatticeChannelFrame, String) {
        let mut keys = runtime.agent_sign_keys.lock().expect("keys lock");
        let sign = keys.get_or_create(agent_id);
        let sign_hex = hex::encode(&sign.public);
        keys.flush().ok();
        drop(keys);
        let sent_at = crate::now_unix();
        let frame = build_frame_for_dock(
            channel_id,
            agent_id,
            session_id,
            port,
            contract_id,
            payload,
            runtime.dock_kem_public(),
            &sign,
            sent_at,
        )
        .unwrap();
        let line = serde_json::json!({
            "frame": frame,
            "signer_public_hex": sign_hex,
        })
        .to_string();
        (frame, line)
    }

    fn temp_runtime() -> (tempfile::TempDir, DockingRuntime) {
        let dir = tempfile::tempdir().expect("tempdir");
        std::env::set_var("AEP_DOCK_STRICT_IDENTITY", "0");
        let db_path = dir.path().join("dock.db");
        let conn = open_lattice_db(&db_path).expect("db");
        let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
        let rt = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path());
        (dir, rt)
    }

    #[test]
    fn pera_dock_records_lattice_frame() {
        let (_dir, rt) = temp_runtime();
        let (_frame, line) = build_test_frame(
            &rt,
            "ch-pera-test",
            "pera-ingest",
            "sess-pera",
            DockingPort::Pera,
            crate::pera::PERA_CONTRACT_ID,
            b"perception-frame",
            42,
        );
        let resp = process_request(&rt, &DockingPort::Pera, &line);
        assert!(resp.ok, "pera dock should accept frame: {:?}", resp.error);
        assert!(resp.digest.is_some());
    }

    #[test]
    fn plain_ping_is_rejected() {
        let (_dir, rt) = temp_runtime();
        let resp = process_request(&rt, &DockingPort::ValidationEngine, r#"{"ping":true}"#);
        assert!(!resp.ok);
        assert!(resp.error.unwrap().contains("LatticeChannelFrame"));
    }

    #[test]
    fn frame_records_on_validation_port() {
        let (_dir, rt) = temp_runtime();
        let (_frame, line) = build_test_frame(
            &rt,
            "ch-dock-test",
            "AG-DOCK",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"dock-payload",
            1,
        );
        let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(resp.ok, "{:?}", resp.error);
        assert!(resp.digest.is_some());
        assert!(resp.event_id.is_some());
    }

    #[test]
    fn frame_attaches_agentmesh_bundle() {
        let (_dir, rt) = temp_runtime();
        let (_frame, line) = build_test_frame(
            &rt,
            "ch-dock-test",
            "AG-MESH",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"dock-payload",
            1,
        );
        let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(resp.ok, "{:?}", resp.error);

        let db = rt.db.lock().expect("db lock");
        let exported = crate::export_dynaep_events(&db, Some(1)).expect("export");
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].agentmesh["agent_id"], "AG-MESH");
        assert!(exported[0].agentmesh["spiffe"]["spiffe_id"].as_str().is_some());
    }

    #[test]
    fn rate_limit_records_side_channel_anomaly() {
        let (_dir, rt) = temp_runtime();
        let sign = rt
            .agent_sign_keys
            .lock()
            .expect("keys")
            .get_or_create("AG-BURST");
        let rate_key = signer_rate_key(&sign.public);
        {
            let mut limiter = rt.rate_limiter.lock().expect("lock");
            for _ in 0..SIGNER_RATE_LIMIT {
                limiter.check(&rate_key).unwrap();
            }
        }

        let (_frame, line) = build_test_frame(
            &rt,
            "ch-dock-test",
            "AG-BURST",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"x",
            1,
        );
        let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(!resp.ok);

        let db = rt.db.lock().expect("db lock");
        let exported = crate::export_dynaep_events(&db, Some(10)).expect("export");
        assert!(exported.iter().any(|e| e.event_type == crate::SIDE_CHANNEL_EVENT_TYPE));
    }

    #[test]
    fn regulation_frame_registers_contract_for_validation_frames() {
        let dir = tempfile::tempdir().expect("tempdir");
        std::env::set_var("AEP_DOCK_STRICT_IDENTITY", "0");
        let db_path = dir.path().join("dock.db");
        let conn = open_lattice_db(&db_path).expect("db");
        let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
        let rt = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &["runtime-lrp".to_string()],
            dir.path(),
        );
        let (_reg_frame, reg_line) = build_test_frame(
            &rt,
            "ch-lrp",
            "AG-LRP",
            "sess-reg",
            DockingPort::RegulationModule,
            "runtime-lrp",
            br#"{"action":"register_lrp"}"#,
            1,
        );
        let reg = process_request(&rt, &DockingPort::RegulationModule, &reg_line);
        assert!(reg.ok, "{:?}", reg.error);

        let (_val_frame, line) = build_test_frame(
            &rt,
            "ch-lrp",
            "AG-LRP",
            "sess-1",
            DockingPort::ValidationEngine,
            "runtime-lrp",
            br#"{"event_type":"LRP_BOUND"}"#,
            2,
        );
        let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(resp.ok, "{:?}", resp.error);
        assert!(resp.event_id.is_some());
    }

    #[test]
    fn plain_register_lrp_is_rejected() {
        let (_dir, rt) = temp_runtime();
        let line = r#"{"register_lrp":{"lrp_id":"custom-lrp","contract_id":"custom-lrp"}}"#;
        let resp = process_request(&rt, &DockingPort::RegulationModule, line);
        assert!(!resp.ok);
        assert!(resp.error.unwrap().contains("LatticeChannelFrame"));
    }

    #[test]
    fn frame_trust_score_rotates_agentmesh_tier() {
        let (_dir, rt) = temp_runtime();
        let (_frame, line_high) = build_test_frame(
            &rt,
            "ch-trust",
            "AG-TRUST",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"payload",
            1,
        );
        let mut wire_high = serde_json::from_str::<serde_json::Value>(&line_high).unwrap();
        wire_high["trust_score"] = serde_json::json!(850);
        let resp1 = process_request(&rt, &DockingPort::ValidationEngine, &wire_high.to_string());
        assert!(resp1.ok);
        let fp1 = rt
            .agent_bundles
            .lock()
            .expect("lock")
            .get("AG-TRUST")
            .expect("bundle")
            .mtls
            .cert_fingerprint
            .clone();

        let (_frame2, line_low) = build_test_frame(
            &rt,
            "ch-trust",
            "AG-TRUST",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"payload",
            2,
        );
        let wire_low = serde_json::from_str::<serde_json::Value>(&line_low).unwrap();
        let mut wire_low = wire_low;
        wire_low["trust_score"] = serde_json::json!(450);
        let line_low = wire_low.to_string();
        let resp2 = process_request(&rt, &DockingPort::ValidationEngine, &line_low);
        assert!(resp2.ok);
        let fp2 = rt
            .agent_bundles
            .lock()
            .expect("lock")
            .get("AG-TRUST")
            .expect("bundle")
            .mtls
            .cert_fingerprint
            .clone();
        assert_ne!(fp1, fp2);
    }

    #[test]
    fn rejects_port_mismatch() {
        let (_dir, rt) = temp_runtime();
        let (_frame, line) = build_test_frame(
            &rt,
            "ch-dock-test",
            "AG-DOCK",
            "sess-1",
            DockingPort::InferenceEngine,
            "dynaep-action-lattice",
            b"x",
            1,
        );
        let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(!resp.ok);
    }

    #[test]
    fn rejects_replayed_frame_digest() {
        let (_dir, rt) = temp_runtime();
        let (_frame, line) = build_test_frame(
            &rt,
            "ch-replay",
            "AG-REPLAY",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"once",
            1,
        );
        let resp1 = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(resp1.ok, "{:?}", resp1.error);
        let resp2 = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(!resp2.ok);
        assert!(resp2.error.unwrap().contains("replay"));
    }

    #[tokio::test]
    async fn socket_roundtrip() {
        let (dir, runtime) = temp_runtime();
        let sock_base = runtime.socket_base.clone();
        let shared = Arc::new(runtime);
        let spec = docking_port_specs(&sock_base)
            .into_iter()
            .find(|s| s.port == DockingPort::ValidationEngine)
            .unwrap();
        prepare_socket_dir(&sock_base).unwrap();
        let listener = bind_listener(&spec.listen_path).unwrap();
        let rt = shared.clone();
        tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (reader, writer) = stream.into_split();
            serve_connection(rt, DockingPort::ValidationEngine, reader, writer)
                .await
                .unwrap();
        });

        let mut stream = UnixStream::connect(&spec.listen_path).await.unwrap();
        let (_frame, wire) = build_test_frame(
            &shared,
            "ch-sock",
            "AG-SOCK",
            "sess-sock",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            b"socket-roundtrip",
            1,
        );
        stream.write_all(format!("{wire}\n").as_bytes()).await.unwrap();
        let mut buf = String::new();
        BufReader::new(&mut stream)
            .read_line(&mut buf)
            .await
            .unwrap();
        let resp: DockFrameResponse = serde_json::from_str(buf.trim()).unwrap();
        assert!(resp.ok, "{:?}", resp.error);
        assert!(resp.digest.is_some());
        let _ = dir;
    }
}