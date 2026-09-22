//! Dock listeners plus drain. The earlier law change facade split. The earlier law change drain.

use super::dock_pulse::{collect_applied, pulse_beat, pulse_decay_rate, DockingRuntime};
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
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};
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
        std::fs::set_permissions(socket_base, std::fs::Permissions::from_mode(0o700))?;
        let mode = std::fs::metadata(socket_base)?.permissions().mode() & 0o777;
        if mode != 0o700 { return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, String::from("socket dir mode must be 0700"))); }
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
        std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
        let mode = std::fs::metadata(path)?.permissions().mode() & 0o777;
        if mode != 0o600 { return Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, String::from("socket mode must be 0600"))); }
    }
    Ok(listener)
}

fn is_collect_pending(resp: &DockFrameResponse) -> bool {
    resp.pending == Some(true) && resp.event_id.is_none()
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
    let http_pending = crate::dock_display::looks_like_http(line) && first.pending == Some(true);
    if line_is_collect(line) == false && http_pending == false {
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
                // The line reader reports a clean end of stream and a line past
                // the cap the same way, so probe the stream. Pending bytes mean
                // the line crossed the cap. An empty probe means the peer
                // closed, which is not a side channel anomaly.
                let pending = match tokio::time::timeout(
                    Duration::from_millis(250),
                    reader.fill_buf(),
                )
                .await
                {
                    Ok(Ok(buf)) => buf.is_empty() == false,
                    // A read error or a quiet stream after a full cap is not a
                    // clean close, so the line counts as over the cap.
                    Ok(Err(_)) => true,
                    Err(_) => true,
                };
                if pending == false {
                    break;
                }
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
        let inbound = if port == DockingPort::DisplayApi && crate::dock_display::looks_like_http(&line) {
            match read_http_display_message(&mut reader, &line).await {
                Ok(msg) => msg,
                Err(_) => {
                    let resp = deny_resp(None, String::from("JSON body that skips the sealed frame is refused"));
                    write_display_reply(&mut writer, &line, &resp).await?;
                    break;
                }
            }
        } else {
            line
        };
        let resp = wait_collect_if_needed(&runtime, &port, &inbound).await;
        write_display_reply(&mut writer, &inbound, &resp).await?;
    }
    Ok(())
}

async fn serve_port(
    runtime: Arc<DockingRuntime>,
    port: DockingPort,
    listener: UnixListener,
    listen_path: String,
) -> std::io::Result<()> {
    info!(port = %format!("{port:?}"), path = %listen_path, "docking port listening");
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

pub(crate) fn tls_dock_port(port: DockingPort) -> u16 {
    match port {
        DockingPort::InferenceEngine => 28425,
        DockingPort::ValidationEngine => 28426,
        DockingPort::DisplayApi => 28429,
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
    info!(port = %format!("{port:?}"), addr = %bind_addr, "docking TLS port listening");
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
                Err(_) => { rt.request_stop() },
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
                    pulse_decay_rate(&runtime);
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
        let mut tls_bound = Vec::new();
        for spec in shared.port_specs() {
            let port = spec.port;
            let tcp_port = tls_dock_port(port);
            let bind_addr = format!("{host}:{tcp_port}");
            let listener = TcpListener::bind(&bind_addr).await.map_err(|e| {
                warn!(error = %e, addr = %bind_addr, port = %format!("{port:?}"), "docking TLS bind failed");
                e
            })?;
            tls_bound.push((port, listener, bind_addr));
        }
        for (port, listener, addr) in tls_bound {
            let rt = shared.clone();
            let acceptor = acceptor.clone();
            handles.push(tokio::spawn(async move {
                if let Err(e) = serve_tls_port(rt, port, listener, acceptor, addr).await {
                    warn!(error = %e, port = %format!("{port:?}"), "docking TLS listener exited");
                }
            }));
        }
    }
    let mut unix_bound = Vec::new();
    for spec in shared.port_specs() {
        let listen_path = spec.listen_path.clone();
        let port = spec.port;
        let listener = bind_listener(&listen_path).map_err(|e| {
            warn!(error = %e, path = %listen_path, port = %format!("{port:?}"), "docking port bind failed");
            e
        })?;
            unix_bound.push((port, listener, listen_path));
    }
    for (port, listener, listen_path) in unix_bound {
        let rt = shared.clone();
        handles.push(tokio::spawn(async move {
            if let Err(e) = serve_port(rt, port, listener, listen_path).await {
                warn!(error = %e, port = %format!("{port:?}"), "docking port listener exited");
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
fn http_content_length(raw: &str) -> Option<usize> {
    for line in raw.lines() {
        let lower = line.to_ascii_lowercase();
        if lower.starts_with("content-length:") == false {
            continue;
        }
        let mut parts = line.split(':');
        let _name = parts.next();
        match parts.next() {
            Some(value) => return value.trim().parse().ok(),
            None => return None,
        }
    }
    None
}
async fn read_http_display_message<R>(reader: &mut R, first: &str) -> std::io::Result<String>
where
    R: tokio::io::AsyncBufRead + Unpin,
{
    let mut raw = first.trim_end_matches('\r').to_string();
    loop {
        match read_line_limited(reader, MAX_LINE_BYTES).await {
            Ok(Some(next)) => {
                let trimmed = next.trim_end_matches('\r');
                raw.push('\n');
                raw.push_str(trimmed);
                if trimmed.is_empty() {
                    break;
                }
            }
            Ok(None) => break,
            Err(err) => return Err(err),
        }
    }
    match http_content_length(&raw) {
        Some(n) => {
            let mut body = vec![0u8; n];
            match tokio::io::AsyncReadExt::read_exact(reader, &mut body).await {
                Ok(_) => match String::from_utf8(body) {
                    Ok(text) => {
                        raw.push('\n');
                        raw.push_str(&text);
                    }
                    Err(_) => return Err(std::io::Error::new(std::io::ErrorKind::InvalidData, "http body")),
                },
                Err(err) => return Err(err),
            }
        }
        None => match read_line_limited(reader, MAX_LINE_BYTES).await {
            Ok(Some(next)) => {
                raw.push('\n');
                raw.push_str(next.trim_end_matches('\r'));
            }
            Ok(None) => {}
            Err(err) => return Err(err),
        },
    }
    Ok(raw)
}
async fn write_display_reply(writer: &mut (impl tokio::io::AsyncWrite + Unpin), inbound: &str, resp: &DockFrameResponse) -> std::io::Result<()> {
    if crate::dock_display::looks_like_http(inbound) {
        let json = match serde_json::to_string(resp) {
            Ok(text) => text,
            Err(_) => String::from("{\"ok\":false,\"error\":\"internal response serialization failed\"}"),
        };
        let http = crate::dock_display::http_json_reply(resp.ok, &json);
        return writer.write_all(http.as_bytes()).await;
    }
    write_response_line(writer, resp).await
}
