use aep_base_node::{
    bootstrap_contracts_from_lrps, health, now_unix, open_lattice_db, record_lattice_event,
    drain_docking_servers, run_docking_servers, sockets_exist, DockingRuntime, ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV,
    COMPONENT_ID, CORRECTWRITING_EN_PRIORITY,
};
use aep_base_node::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use aep_lattice_channel::{build_frame_for_dock, frame_digest, DockingPort};
use aep_lattice_memory::{AttractorRecord, LatticeMemoryStore};
use clap::Parser;
use rand::RngCore;
use std::path::PathBuf;
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

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter("info")
        .with_writer(std::io::stderr)
        .init();

    // rustls 0.23 requires an explicit process-wide provider when both ring/aws-lc are linked.
    let _ = rustls::crypto::ring::default_provider().install_default();

    let cli = Cli::parse();
    #[cfg(test)] if cli.allow_world_writable_lattice_parent {
        std::env::set_var(ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV, "1");
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
        let data_dir = lattice_db
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(default_aep_data_dir);
        let mut sign_store = AgentSignKeyStore::load(&data_dir);
        let sign = sign_store.provision(agent_id)?;
        sign_store.flush()?;
        println!(
            "provisioned agent_id={agent_id} public_hex={}",
            hex::encode(&sign.public)
        );
        return Ok(());
    }

    if cli.issue_mesh_identity {
        let agent_id = cli.agent_id.as_deref().unwrap_or("").trim();
        let data_dir = lattice_db.parent().map(PathBuf::from).unwrap_or_else(default_aep_data_dir);
        match issue_mesh_identity(&data_dir, agent_id) {
            Ok(()) => return Ok(()),
            Err(text) => return Err(text.into()),
        }
    }
    if cli.daemon {
        std::env::set_var("AEP_LATTICE_STRICT", "1");
        std::env::set_var("AEP_HUB_STRICT", "1");
        let conn = open_lattice_db(&lattice_db)?;
        let data_dir = lattice_db
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(default_aep_data_dir);
        let runtime = DockingRuntime::with_data_dir(
            cfg.socket_base.clone(),
            conn,
            &cfg.lrps,
            &data_dir,
        )?;
        let (runtime, handles) = run_docking_servers(runtime).await?;
        if !sockets_exist(&cfg.socket_base) {
            drain_docking_servers(&runtime, handles).await;
            return Err("daemon failed: docking sockets not present after bind".into());
        }
        info!(
            component = COMPONENT_ID,
            socket_base = %cfg.socket_base,
            ports = handles.len(),
            "AEP Base Node daemon listening on docking ports"
        );
        let mut sigterm = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())?;
        let mut sigint = tokio::signal::unix::signal(tokio::signal::unix::SignalKind::interrupt())?;
        tokio::select! {
            _ = sigterm.recv() => {}
            _ = sigint.recv() => {}
        }
        info!("AEP Base Node daemon shutting down");
        drain_docking_servers(&runtime, handles).await;
        return Ok(());
    }

    let conn = open_lattice_db(&lattice_db)?;
    let mut memory = LatticeMemoryStore::open_default(&lattice_db)?;
    let contracts = bootstrap_contracts_from_lrps(&cfg.lrps);

    if cli.self_test {
        let data_dir = lattice_db
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(default_aep_data_dir);
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
    }

    let events = aep_base_node::event_count(&conn)?;
    let attractors = memory.attractor_count()?;
    let listening = sockets_exist(&cfg.socket_base);
    let data_dir = lattice_db.parent();
    let (mesh_peers, mesh_routes, mesh_load_error) =
        aep_base_node::resolve_mesh_peers(data_dir, cfg.internet_up, cfg.mesh_peers);
    let hub = match AgentControlHub::load_from_gap(&resolve_gap_root()) {
        Ok(h) => h,
        Err(e) => return Err(e.to_string().into()),
    };
    let report = health(
        env!("CARGO_PKG_VERSION"),
        mesh_peers,
        cfg.internet_up,
        &cfg.socket_base,
        events,
        cfg.correctwriting_en_priority,
        hub.is_loaded(),
        hub.sessions.len() as u32,
        hub.mounts.len() as u32,
        hub.permissions.len() as u32,
        mesh_load_error,
        attractors,
        memory.embedding_dim() as u32,
        memory.sqlite_vec_version(),
        listening,
        mesh_routes,
        data_dir,
    );
    println!("{}", serde_json::to_string_pretty(&report)?);
    if !cli.self_test {
        info!(component = COMPONENT_ID, events, listening, "AEP Base Node ready");
    }
    Ok(())
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
