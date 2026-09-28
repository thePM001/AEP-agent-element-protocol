use aep_base_node::{
    bootstrap_contracts_from_lrps, health, now_unix, open_lattice_db, record_lattice_event,
    drain_docking_servers, run_docking_servers, sockets_exist, BaseNodeHealth, DockingRuntime,
    HealthInput, COMPONENT_ID, CORRECTWRITING_EN_PRIORITY,
};
use aep_base_node::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use aep_lattice_channel::{build_frame_for_dock, frame_digest, DockingPort};
use aep_lattice_memory::{AttractorRecord, LatticeMemoryStore};
use clap::Parser;
use rand::RngCore;
use std::path::{Path, PathBuf};
use std::process::ExitCode;
use aep_base_node::dock_event;
use aep_base_node::dock_log::{DockEvent, LogConfig};
use tracing::info;
use aep_agent_control_hub::{AgentControlHub, resolve_gap_root};

#[derive(Debug, serde::Deserialize)]
struct BaseNodeConfigFile {
    version: String,
    base_node: BaseNodeConfigSection,
}

fn default_aep_data_dir() -> PathBuf {
    if let Ok(d) = std::env::var("AEP_DATA") {
        if !d.trim().is_empty() {
            return PathBuf::from(d);
        }
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/var/lib/aep".into());
    PathBuf::from(home).join(".aep")
}

fn default_socket_base() -> String {
    default_aep_data_dir()
        .join("sockets")
        .join("aep-base-node.sock")
        .display()
        .to_string()
}

fn default_lattice_db() -> PathBuf {
    default_aep_data_dir().join("aep-action-lattice.db")
}

#[derive(Debug, serde::Deserialize)]
struct BaseNodeConfigSection {
    socket_base: String,
    lattice_db: String,
    #[serde(default)]
    correctwriting_en_priority: u8,
    #[serde(default)]
    lrps: Vec<String>,
    #[serde(default)]
    internet_up: bool,
    #[serde(default)]
    mesh_peers: u32,
}

#[derive(Debug, Parser)]
#[command(name = "aep-base-node", about = "AEP 2.8 mandatory local governance daemon")]
struct Cli {
    #[arg(long)]
    config: Option<PathBuf>,
    /// Default under $HOME/.aep (or AEP_DATA) - not world-writable /tmp.
    #[arg(long, default_value_t = default_socket_base())]
    socket_base: String,
    /// Default under $HOME/.aep (or AEP_DATA). Not tmp.
    #[arg(long, default_value_os_t = default_lattice_db())]
    lattice_db: PathBuf,
    /// Test flag. Allows a world-writable parent of lattice_db.
    #[arg(long, default_value_t = false)]
    #[cfg(test)] allow_world_writable_lattice_parent: bool,
    #[arg(long, default_value_t = false)]
    internet_up: bool,
    #[arg(long, default_value_t = 0)]
    mesh_peers: u32,
    #[arg(long, default_value_t = false)]
    self_test: bool,
    /// Print BaseNodeHealth JSON without binding any dock. Exit 0 ok, 1 degraded, 2 error.
    #[arg(long, default_value_t = false, conflicts_with_all = ["daemon", "self_test"])]
    health: bool,
    /// Run as daemon with Unix socket docking port listeners (Phase 4).
    #[arg(long, default_value_t = false)]
    daemon: bool,
    /// Operator provision: mint an agent sign key. First-mint is not the issuer.
    #[arg(long, default_value_t = false)]
    provision_agent_sign_key: bool,
    /// Agent id for --provision-agent-sign-key.
    #[arg(long)]
    agent_id: Option<String>,
    /// Issue an AgentMesh client identity for an agent. Missing material DENY on miss.
    #[arg(long, default_value_t = false)]
    issue_mesh_identity: bool,
}

struct ResolvedConfig {
    socket_base: String,
    lattice_db: PathBuf,
    internet_up: bool,
    mesh_peers: u32,
    correctwriting_en_priority: u8,
    lrps: Vec<String>,
}

fn arg_present(flag: &str) -> bool {
    std::env::args().any(|a| a == flag || a.starts_with(&format!("{flag}=")))
}

fn load_config_file(path: &PathBuf) -> Result<BaseNodeConfigFile, Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(path)?;
    let parsed: BaseNodeConfigFile = serde_json::from_str(&raw)?;
    if parsed.version != "2.8.6" {
        return Err(format!("unsupported config version: {}", parsed.version).into());
    }
    Ok(parsed)
}

fn resolve_config(cli: &Cli) -> Result<ResolvedConfig, Box<dyn std::error::Error>> {
    let mut resolved = ResolvedConfig {
        socket_base: cli.socket_base.clone(),
        lattice_db: cli.lattice_db.clone(),
        internet_up: cli.internet_up,
        mesh_peers: cli.mesh_peers,
        correctwriting_en_priority: CORRECTWRITING_EN_PRIORITY,
        lrps: Vec::new(),
    };

    if let Some(path) = &cli.config {
        let file = load_config_file(path)?;
        resolved.socket_base = file.base_node.socket_base;
        resolved.lattice_db = PathBuf::from(file.base_node.lattice_db);
        resolved.internet_up = file.base_node.internet_up;
        resolved.mesh_peers = file.base_node.mesh_peers;
        if file.base_node.correctwriting_en_priority > 0 {
            resolved.correctwriting_en_priority = file.base_node.correctwriting_en_priority;
        }
        resolved.lrps = file.base_node.lrps;
    }

    if arg_present("--socket-base") {
        resolved.socket_base = cli.socket_base.clone();
    }
    if arg_present("--lattice-db") {
        resolved.lattice_db = cli.lattice_db.clone();
    }
    if arg_present("--internet-up") {
        resolved.internet_up = true;
    }
    if arg_present("--mesh-peers") {
        resolved.mesh_peers = cli.mesh_peers;
    }

    Ok(resolved)
}

/// Exit code for a daemon that could not reach a healthy bind.
const EXIT_BOOT_ERROR: u8 = 2;

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(code) => ExitCode::from(code),
        Err(e) => {
            eprintln!("Error: {e}");
            ExitCode::from(1)
        }
    }
}

fn data_dir_for(lattice_db: &Path) -> PathBuf {
    lattice_db
        .parent()
        .map(PathBuf::from)
        .unwrap_or_else(default_aep_data_dir)
}

fn load_hub(data_dir: &Path) -> Option<AgentControlHub> {
    match AgentControlHub::load_from_gap(&data_dir.join("gap")) {
        Ok(h) => Some(h),
        Err(_) => AgentControlHub::load_from_gap(&resolve_gap_root()).ok(),
    }
}

/// Health of a node that is not running here. Nothing binds. A lattice
/// database that cannot be opened reads as a closed ledger.
fn offline_health(cfg: &ResolvedConfig, lattice_db: &Path) -> BaseNodeHealth {
    let data_dir = data_dir_for(lattice_db);
    let (events, mut sqlite_closed) = match open_lattice_db(lattice_db) {
        Ok(conn) => match aep_base_node::event_count(&conn) {
            Ok(n) => (n, false),
            Err(_) => (0, true),
        },
        Err(_) => (0, true),
    };
    let (attractors, dim, vec_version) = match LatticeMemoryStore::open_default(lattice_db) {
        Ok(memory) => match memory.attractor_count() {
            Ok(n) => (n, memory.embedding_dim() as u32, memory.sqlite_vec_version()),
            Err(_) => {
                sqlite_closed = true;
                (0, memory.embedding_dim() as u32, memory.sqlite_vec_version())
            }
        },
        Err(_) => {
            sqlite_closed = true;
            (0, 0, None)
        }
    };
    let (mesh_peers, mesh_routes, mesh_load_error) =
        aep_base_node::resolve_mesh_peers(Some(&data_dir), cfg.internet_up, cfg.mesh_peers);
    let hub = load_hub(&data_dir);
    health(HealthInput {
        version: env!("CARGO_PKG_VERSION"),
        mesh_peers,
        internet_up: cfg.internet_up,
        base_socket: &cfg.socket_base,
        lattice_events: events,
        correctwriting_en_priority: cfg.correctwriting_en_priority,
        hub_loaded: hub.as_ref().map(|h| h.is_loaded()).unwrap_or(false),
        hub_sessions: hub.as_ref().map(|h| h.sessions.len() as u32).unwrap_or(0),
        hub_mounts: hub.as_ref().map(|h| h.mounts.len() as u32).unwrap_or(0),
        hub_permissions: hub.as_ref().map(|h| h.permissions.len() as u32).unwrap_or(0),
        mesh_peers_load_error: mesh_load_error,
        lattice_memory_attractors: attractors,
        lattice_memory_dim: dim,
        sqlite_vec_version: vec_version,
        docking_ports_listening: sockets_exist(&cfg.socket_base),
        mesh_routes,
        data_dir: Some(&data_dir),
        sqlite_closed,
        last_tls_handshake_err: None,
        drain_aborted_tasks: 0,
    })
}

/// Health of the running daemon from its live parts. The same object drives
/// the ready log and the Data Dock health route.
fn daemon_health(
    runtime: &DockingRuntime,
    cfg: &ResolvedConfig,
    data_dir: &Path,
    lattice_db: &Path,
) -> BaseNodeHealth {
    let sqlite_closed = runtime.sqlite_is_closed();
    let events = if sqlite_closed {
        0
    } else {
        match runtime.record.db.lock() {
            Ok(db) => aep_base_node::event_count(&db).unwrap_or(0),
            Err(p) => aep_base_node::event_count(&p.into_inner()).unwrap_or(0),
        }
    };
    let (attractors, dim, vec_version) = match LatticeMemoryStore::open_default(lattice_db) {
        Ok(memory) => (
            memory.attractor_count().unwrap_or(0),
            memory.embedding_dim() as u32,
            memory.sqlite_vec_version(),
        ),
        Err(_) => (0, 0, None),
    };
    let (mesh_peers, mesh_routes, mesh_load_error) =
        aep_base_node::resolve_mesh_peers(Some(data_dir), cfg.internet_up, cfg.mesh_peers);
    let hub = &runtime.admit.hub;
    health(HealthInput {
        version: env!("CARGO_PKG_VERSION"),
        mesh_peers,
        internet_up: cfg.internet_up,
        base_socket: &cfg.socket_base,
        lattice_events: events,
        correctwriting_en_priority: cfg.correctwriting_en_priority,
        hub_loaded: hub.is_loaded(),
        hub_sessions: hub.sessions.len() as u32,
        hub_mounts: hub.mounts.len() as u32,
        hub_permissions: hub.permissions.len() as u32,
        mesh_peers_load_error: mesh_load_error,
        lattice_memory_attractors: attractors,
        lattice_memory_dim: dim,
        sqlite_vec_version: vec_version,
        docking_ports_listening: runtime.docking_ports_listening(),
        mesh_routes,
        data_dir: Some(data_dir),
        sqlite_closed,
        last_tls_handshake_err: runtime.last_tls_handshake_err(),
        drain_aborted_tasks: runtime.drain_aborted_tasks(),
    })
}

async fn run_daemon(cfg: &ResolvedConfig, lattice_db: &Path) -> Result<u8, Box<dyn std::error::Error>> {
    std::env::set_var("AEP_LATTICE_STRICT", "1");
    std::env::set_var("AEP_HUB_STRICT", "1");
    let mut data_dock_cfg = aep_base_node::data_dock::DataDockConfig::from_env();
    if data_dock_cfg.enabled {
        // Off loopback without DATA_DOCK_API_KEY the key file is loaded or minted
        // here, before any dock binds.
        data_dock_cfg = match data_dock_cfg.resolve_key(&data_dir_for(lattice_db)) {
            Ok(c) => c,
            Err(e) => {
                dock_event!(error, DockEvent::BootError, error = %e, "Data Dock key refused");
                return Ok(EXIT_BOOT_ERROR);
            }
        };
        if let Err(e) = data_dock_cfg.check_bind() {
            dock_event!(error, DockEvent::BootError, error = %e, "Data Dock refused to listen");
            return Ok(EXIT_BOOT_ERROR);
        }
    }
    let conn = match open_lattice_db(lattice_db) {
        Ok(c) => c,
        Err(e) => {
            dock_event!(error, DockEvent::BootError, error = %e, "lattice database open failed");
            return Ok(EXIT_BOOT_ERROR);
        }
    };
    let data_dir = data_dir_for(lattice_db);
    let runtime = match DockingRuntime::with_data_dir(cfg.socket_base.clone(), conn, &cfg.lrps, &data_dir) {
        Ok(r) => r,
        Err(e) => {
            dock_event!(error, DockEvent::BootError, error = %e, "docking runtime failed");
            return Ok(EXIT_BOOT_ERROR);
        }
    };
    let (runtime, handles) = match run_docking_servers(runtime).await {
        Ok(v) => v,
        Err(e) => {
            dock_event!(error, DockEvent::BootError, error = %e, "docking bind failed");
            return Ok(EXIT_BOOT_ERROR);
        }
    };
    if !sockets_exist(&cfg.socket_base) {
        dock_event!(error, DockEvent::BootError, socket_base = %cfg.socket_base, "docking sockets not present after bind");
        drain_docking_servers(&runtime, handles).await;
        return Ok(EXIT_BOOT_ERROR);
    }
    info!(
        component = COMPONENT_ID,
        socket_base = %cfg.socket_base,
        ports = handles.len(),
        "AEP Base Node daemon listening on docking ports"
    );
    let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
    let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
    // The CAW kernel dock probe signs its sealed root:ping as caw-kernel-dock.
    if let Err(e) = aep_base_node::caw_kernel_dock::provision_caw_kernel_dock_identity(&runtime, &data_dir) {
        dock_event!(error, DockEvent::BootError, error = %e, "CAW kernel dock identity failed");
        drain_docking_servers(&runtime, handles).await;
        return Ok(EXIT_BOOT_ERROR);
    }
    let mut data_dock_handle = None;
    if data_dock_cfg.enabled {
        if let Err(e) = aep_base_node::data_dock::provision_server_identity(&runtime, &data_dir) {
            dock_event!(error, DockEvent::BootError, error = %e, "Data Dock identity failed");
            drain_docking_servers(&runtime, handles).await;
            return Ok(EXIT_BOOT_ERROR);
        }
        let state = aep_base_node::data_dock::DataDockState::new(
            runtime.clone(),
            &data_dock_cfg,
            data_dir.clone(),
            cfg.internet_up,
        );
        match aep_base_node::data_dock::serve(state, &data_dock_cfg).await {
            Ok((h, addr)) => {
                info!(addr = %addr, "Data Dock HTTP listening");
                data_dock_handle = Some(h);
            }
            Err(e) => {
                dock_event!(error, DockEvent::BootError, error = %e, "Data Dock bind failed");
                drain_docking_servers(&runtime, handles).await;
                return Ok(EXIT_BOOT_ERROR);
            }
        }
    }
    let report = daemon_health(&runtime, cfg, &data_dir, lattice_db);
    match report.status {
        "ok" => dock_event!(info, DockEvent::BootReady, component = COMPONENT_ID, status = report.status, "AEP Base Node ready"),
        "degraded" => dock_event!(
            warn,
            DockEvent::BootDegraded,
            component = COMPONENT_ID,
            status = report.status,
            hub_loaded = report.hub_loaded,
            "AEP Base Node running degraded"
        ),
        _ => {
            dock_event!(error, DockEvent::BootError, component = COMPONENT_ID, status = report.status, "AEP Base Node health is error after bind");
            if let Some(h) = data_dock_handle.take() {
                h.abort();
            }
            drain_docking_servers(&runtime, handles).await;
            return Ok(EXIT_BOOT_ERROR);
        }
    }
    let signal = tokio::select! {
        _ = sigterm.recv() => "SIGTERM",
        _ = sigint.recv() => "SIGINT",
    };
    dock_event!(info, DockEvent::StopSignal, signal, "AEP Base Node daemon shutting down");
    if let Some(h) = data_dock_handle {
        h.abort();
    }
    drain_docking_servers(&runtime, handles).await;
    Ok(0)
}

fn run_self_test(lattice_db: &Path, contracts: &aep_lattice_channel::ContractRegistry) -> Result<(), Box<dyn std::error::Error>> {
    let conn = open_lattice_db(lattice_db)?;
    let mut memory = LatticeMemoryStore::open_default(lattice_db)?;
    let data_dir = data_dir_for(lattice_db);
    let dock_kem = load_or_create_dock_kem(&data_dir);
    let mut sign_store = AgentSignKeyStore::load(&data_dir);
    let sign = sign_store
        .provision("AG-BOOT")
        .map_err(|e| format!("self-test: {e}"))?;
    let frame = build_frame_for_dock(
        "ch-selftest",
        "AG-BOOT",
        "boot-session",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"AEP-Base-Node-self-test",
        &dock_kem.public,
        &sign,
        now_unix(),
    )?;
    let digest = frame_digest(&frame);
    record_lattice_event(
        &conn,
        &frame.agent_id,
        &frame.channel_id,
        &frame.contract_id,
        &digest,
        frame.sent_at_unix,
    )?;
    info!(digest, "self-test lattice frame recorded");
    if !contracts.is_active("dynaep-action-lattice") {
        return Err("self-test failed: dynaep-action-lattice contract inactive".into());
    }

    let mut probe = vec![0.0_f32; memory.embedding_dim()];
    probe[0] = 1.0;
    let mut nonce = [0u8; 4];
    rand::thread_rng().fill_bytes(&mut nonce);
    memory.record(AttractorRecord {
        entry_id: format!("selftest-{}-{}", now_unix(), hex::encode(nonce)),
        element_id: "AG-BOOT".into(),
        domain: "event".into(),
        outcome: "accepted".into(),
        recorded_at_unix: now_unix(),
        embedding: probe,
    })?;
    let hits = memory.search(&[1.0, 0.0, 0.0], 1)?;
    if hits.is_empty() {
        return Err("self-test failed: lattice memory vector search returned no hits".into());
    }
    info!(
        attractors = memory.attractor_count()?,
        sqlite_vec = ?memory.sqlite_vec_version(),
        "self-test lattice memory index ok"
    );
    Ok(())
}

async fn run() -> Result<u8, Box<dyn std::error::Error>> {
    let log_cfg = LogConfig::from_env();
    let log_file = aep_base_node::dock_log::init(&log_cfg)?;
    dock_event!(
        info,
        DockEvent::BootStart,
        version = env!("CARGO_PKG_VERSION"),
        json = log_cfg.json,
        log_file = %log_file.as_ref().map(|p| p.display().to_string()).unwrap_or_default(),
        "aep-base-node start"
    );

    // rustls 0.23 requires an explicit process-wide provider when both ring/aws-lc are linked.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let cli = Cli::parse();
    #[cfg(test)] if cli.allow_world_writable_lattice_parent {
        std::env::set_var(aep_base_node::ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV, "1");
    }
    let cfg = resolve_config(&cli)?;
    let lattice_db = if cli.self_test {
        let tmp = std::env::temp_dir().join(format!("aep-base-node-self-test-{}", std::process::id()));
        let _ = std::fs::create_dir_all(&tmp);
        tmp.join("aep-action-lattice.db")
    } else {
        cfg.lattice_db.clone()
    };

    if cli.provision_agent_sign_key {
        let agent_id = cli.agent_id.as_deref().unwrap_or("").trim();
        if agent_id.is_empty() {
            return Err("provision-agent-sign-key requires --agent-id".into());
        }
        let data_dir = data_dir_for(&lattice_db);
        let sign = aep_base_node::dock_keys::provision_agent_sign_key(&data_dir, agent_id)?;
        println!(
            "provisioned agent_id={agent_id} public_hex={}",
            hex::encode(&sign.public)
        );
        return Ok(0);
    }

    if cli.issue_mesh_identity {
        let agent_id = cli.agent_id.as_deref().unwrap_or("").trim();
        let data_dir = data_dir_for(&lattice_db);
        match issue_mesh_identity(&data_dir, agent_id) {
            Ok(()) => return Ok(0),
            Err(text) => return Err(text.into()),
        }
    }
    if cli.daemon {
        return run_daemon(&cfg, &lattice_db).await;
    }

    if cli.self_test {
        let contracts = bootstrap_contracts_from_lrps(&cfg.lrps);
        run_self_test(&lattice_db, &contracts)?;
    }

    let report = offline_health(&cfg, &lattice_db);
    println!("{}", serde_json::to_string_pretty(&report)?);
    if cli.health {
        dock_event!(info, DockEvent::HealthProbe, component = COMPONENT_ID, status = report.status, "health probe");
        return Ok(report.exit_code());
    }
    if !cli.self_test {
        info!(
            component = COMPONENT_ID,
            events = report.action_lattice_events,
            listening = report.docking_ports_listening,
            "AEP Base Node ready"
        );
    }
    Ok(0)
}


fn issue_mesh_identity(data_dir: &std::path::Path, agent_id: &str) -> Result<(), String> {
    if agent_id.is_empty() {
        return Err(String::from("missing agent id DENY on miss"));
    }
    let (ca_pem, ca_key_pem) = match aep_agentmesh::tls::ensure_mesh_ca(data_dir) {
        Ok(value) => value,
        Err(_) => return Err(String::from("missing mesh ca DENY on miss")),
    };
    let identity = match aep_agentmesh::tls::issue_signed_identity(&ca_pem, &ca_key_pem, agent_id) {
        Ok(value) => value,
        Err(_) => return Err(String::from("missing mesh identity DENY on miss")),
    };
    let dir = data_dir.join("agentmesh").join("clients");
    if std::fs::create_dir_all(&dir).is_err() {
        return Err(String::from("missing mesh identity DENY on miss"));
    }
    let cert_path = dir.join(format!("{agent_id}.cert.pem"));
    let key_path = dir.join(format!("{agent_id}.key.pem"));
    let ca_path = data_dir.join("agentmesh").join("tls").join("ca.pem");
    if std::fs::write(&cert_path, &identity.cert_pem).is_err() {
        return Err(String::from("missing mesh identity DENY on miss"));
    }
    if std::fs::write(&key_path, &identity.key_pem).is_err() {
        return Err(String::from("missing mesh identity DENY on miss"));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).is_err() {
            return Err(String::from("missing mesh identity DENY on miss"));
        }
        if std::fs::set_permissions(&cert_path, std::fs::Permissions::from_mode(0o600)).is_err() {
            return Err(String::from("missing mesh identity DENY on miss"));
        }
        if std::fs::set_permissions(&key_path, std::fs::Permissions::from_mode(0o600)).is_err() {
            return Err(String::from("missing mesh identity DENY on miss"));
        }
    }
    let out = serde_json::json!({
        "agent_id": agent_id,
        "ca_pem": ca_pem,
        "cert_pem": identity.cert_pem,
        "key_pem": identity.key_pem,
        "ca_path": ca_path.to_string_lossy(),
        "cert_path": cert_path.to_string_lossy(),
        "key_path": key_path.to_string_lossy(),
    });
    match serde_json::to_string(&out) {
        Ok(text) => {
            println!("{text}");
            Ok(())
        }
        Err(_) => Err(String::from("missing mesh identity DENY on miss")),
    }
}
