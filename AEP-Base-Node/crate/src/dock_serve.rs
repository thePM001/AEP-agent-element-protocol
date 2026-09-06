//! Dock listeners plus drain. AEP28-ENV-079 facade split. AEP28-ENV-080 drain.

use super::dock_pulse::{collect_applied, pulse_beat, DockingRuntime};
use super::{
    deny_resp, lock_or_deny, process_request, DockFrameResponse,
};
use aep_base_node_pulse::PULSE_MS;
use aep_dock_line_reader::{read_line_limited, MAX_LINE_BYTES, READ_CHUNK};
use aep_lattice_channel::DockingPort;
use crate::{docking_port_specs, record_side_channel_anomaly, DynAepEventInput, SideChannelAnomalyKind};
use aep_lattice_channel::LatticeChannelFrame;
use serde::Deserialize;
use std::path::Path;
use std::sync::Arc;
use std::time::Duration;
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt, BufReader};
use tokio::net::{TcpListener, UnixListener};
use tokio::task::JoinHandle;
use tokio_rustls::TlsAcceptor;
use tracing::{info, warn};

pub(crate) const MAX_CONNECTIONS: usize = 64;
const DRAIN_JOIN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Deserialize)]
#[serde(untagged)]
pub(crate) enum DockRequest {
    Collect {
        collect: String,
    },
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
pub(crate) struct RegisterLrpWire {
    pub(crate) lrp_id: String,
}

pub(crate) fn prepare_socket_dir(socket_base: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(socket_base)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(socket_base, std::fs::Permissions::from_mode(0o700));
    }
    Ok(())
}

pub(crate) fn bind_listener(path: &str) -> std::io::Result<UnixListener> {
    let p = Path::new(path);
    if p.exists() {
        std::fs::remove_file(p)?;
    }
    let listener = UnixListener::bind(path)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(listener)
}

fn is_collect_pending(resp: &DockFrameResponse) -> bool {
    resp.ok && resp.event_id.is_none() && resp.deny.is_none() && resp.error.is_none() && resp.digest.is_some()
}

fn line_is_collect(line: &str) -> bool {
    matches!(
        serde_json::from_str::<DockRequest>(line),
        Ok(DockRequest::Collect { .. })
    )
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

async fn wait_collect_if_needed(
    runtime: &DockingRuntime,
    port: &DockingPort,
    line: &str,
) -> DockFrameResponse {
    let first = process_request(runtime, port, line);
    if line_is_collect(line) == false {
        return first;
    }
    if is_collect_pending(&first) == false {
        return first;
    }
    let digest = match first.digest.clone() {
        Some(d) => d,
        None => return first,
    };
    let deadline = tokio::time::Instant::now() + Duration::from_millis((3 * PULSE_MS as u64) + 250);
    loop {
        if runtime.is_stopping() {
            return collect_applied(runtime, &digest);
        }
        if tokio::time::Instant::now() >= deadline {
            return collect_applied(runtime, &digest);
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
        let _ = pulse_beat(runtime);
        let resp = collect_applied(runtime, &digest);
        if is_collect_pending(&resp) == false {
            return resp;
        }
    }
}

pub(crate) async fn serve_connection<R, W>(
    runtime: Arc<DockingRuntime>,
    port: DockingPort,
    reader: R,
    mut writer: W,
) -> std::io::Result<()>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let mut reader = BufReader::with_capacity(READ_CHUNK, reader);
    let mut stop_rx = runtime.stop.subscribe();
    loop {
        if runtime.is_stopping() {
            break;
        }
        let read_res = tokio::select! {
            biased;
            _ = async { let _ = stop_rx.wait_for(|v| *v).await; } => {
                None
            }
            res = read_line_limited(&mut reader, MAX_LINE_BYTES) => {
                Some(res?)
            }
        };
        let line = match read_res {
            None => break,
            Some(Some(l)) => l,
            Some(None) => {
                let resp = match lock_or_deny(&runtime.db, "db") {
                    Ok(db) => {
                        let _ = record_side_channel_anomaly(
                            &db,
                            SideChannelAnomalyKind::OversizedLine,
                            "unknown",
                            &port,
                            format!("line exceeds {MAX_LINE_BYTES} bytes"),
                        );
                        deny_resp(None, String::from("line exceeds 4MB limit"))
                    }
                    Err(resp) => resp,
                };
                write_response_line(&mut writer, &resp).await?;
                break;
            }
        };
        let resp = wait_collect_if_needed(&runtime, &port, &line).await;
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
    let mut stop_rx = runtime.stop.subscribe();
    loop {
        if runtime.is_stopping() {
            break;
        }
        let permit = tokio::select! {
            biased;
            _ = async { let _ = stop_rx.wait_for(|v| *v).await; } => {
                break;
            }
            p = runtime.connection_limit.clone().acquire_owned() => {
                p.map_err(|e| std::io::Error::other(e.to_string()))?
            }
        };
        if runtime.is_stopping() {
            break;
        }
        let (stream, _) = tokio::select! {
            biased;
            _ = async { let _ = stop_rx.wait_for(|v| *v).await; } => {
                break;
            }
            accepted = listener.accept() => accepted?,
        };
        let rt = runtime.clone();
        let handle = tokio::spawn(async move {
            let _permit = permit;
            let (reader, writer) = stream.into_split();
            if let Err(e) = serve_connection(rt, port, reader, writer).await {
                warn!(error = %e, "docking connection closed with error");
            }
        });
        runtime.track_task(handle);
    }
    Ok(())
}

fn tls_dock_port(port: DockingPort) -> u16 {
    match port {
        DockingPort::InferenceEngine => 28425,
        DockingPort::ValidationEngine => 28426,
        DockingPort::FutureFeatures => 28427,
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
    let mut stop_rx = runtime.stop.subscribe();
    loop {
        if runtime.is_stopping() {
            break;
        }
        let permit = tokio::select! {
            biased;
            _ = async { let _ = stop_rx.wait_for(|v| *v).await; } => {
                break;
            }
            p = runtime.connection_limit.clone().acquire_owned() => {
                p.map_err(|e| std::io::Error::other(e.to_string()))?
            }
        };
        if runtime.is_stopping() {
            break;
        }
        let (tcp, _) = tokio::select! {
            biased;
            _ = async { let _ = stop_rx.wait_for(|v| *v).await; } => {
                break;
            }
            accepted = listener.accept() => accepted?,
        };
        let acceptor = acceptor.clone();
        let rt = runtime.clone();
        let handle = tokio::spawn(async move {
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
        runtime.track_task(handle);
    }
    Ok(())
}

fn spawn_pulse_task(runtime: Arc<DockingRuntime>) -> JoinHandle<()> {
    let mut stop_rx = runtime.stop.subscribe();
    tokio::spawn(async move {
        loop {
            if runtime.is_stopping() {
                break;
            }
            tokio::select! {
                biased;
                _ = async { let _ = stop_rx.wait_for(|v| *v).await; } => break,
                _ = tokio::time::sleep(Duration::from_millis(PULSE_MS as u64)) => {
                    let _ = pulse_beat(&runtime);
                }
            }
        }
    })
}

pub async fn run_docking_servers(
    runtime: DockingRuntime,
) -> std::io::Result<(Arc<DockingRuntime>, Vec<JoinHandle<()>>)> {
    prepare_socket_dir(&runtime.socket_base)?;
    let shared = Arc::new(runtime);
    let mut handles = Vec::new();
    handles.push(spawn_pulse_task(shared.clone()));
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
    Ok((shared, handles))
}

pub fn sockets_exist(socket_base: &str) -> bool {
    docking_port_specs(socket_base)
        .iter()
        .all(|spec| Path::new(&spec.listen_path).exists())
}

pub fn unlink_sockets(socket_base: &str) {
    for spec in docking_port_specs(socket_base) {
        let p = Path::new(&spec.listen_path);
        if p.exists() {
            if let Err(e) = std::fs::remove_file(p) {
                warn!(error = %e, path = %spec.listen_path, "docking socket unlink failed");
            }
        }
    }
}

async fn join_or_abort(handles: Vec<JoinHandle<()>>) {
    if handles.is_empty() {
        return;
    }
    let wait = async move {
        for handle in handles {
            let _ = handle.await;
        }
    };
    if tokio::time::timeout(DRAIN_JOIN_TIMEOUT, wait).await.is_err() {
        // Remaining JoinHandle values drop with the wait future and abort.
    }
}

pub async fn drain_docking_servers(runtime: &DockingRuntime, handles: Vec<JoinHandle<()>>) {
    info!("docking drain: stop accept, join tasks, unlink sockets, close sqlite");
    runtime.request_stop();
    join_or_abort(handles).await;
    join_or_abort(runtime.take_inflight()).await;
    unlink_sockets(&runtime.socket_base);
    runtime.close_sqlite();
}
