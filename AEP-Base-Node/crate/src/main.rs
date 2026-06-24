use aep_base_node::{
    bootstrap_contracts_from_lrps, health, now_unix, open_lattice_db, record_lattice_event,
    run_docking_servers, sockets_exist, DockingRuntime, COMPONENT_ID, EPSCOM_PRIORITY,
};
use aep_base_node::dock_keys::{load_or_create_dock_kem, AgentSignKeyStore};
use aep_lattice_channel::{build_frame_for_dock, frame_digest, DockingPort};
use aep_lattice_memory::{AttractorRecord, LatticeMemoryStore};
use clap::Parser;
use rand::RngCore;
use std::path::PathBuf;
use tracing::info;

#[derive(Debug, serde::Deserialize)]
struct BaseNodeConfigFile {
    version: String,
    base_node: BaseNodeConfigSection,
}

#[derive(Debug, serde::Deserialize)]
struct EpscomSignaturesSection {
    #[serde(default = "default_true")]
    enabled: bool,
    #[serde(default)]
    path: Option<String>,
}

fn default_true() -> bool {
    true
}

#[derive(Debug, serde::Deserialize)]
struct BaseNodeConfigSection {
    socket_base: String,
    lattice_db: String,
    #[serde(default)]
    epscom_priority: u8,
    #[serde(default)]
    epscom_signatures: Option<EpscomSignaturesSection>,
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
    #[arg(long, default_value = "/tmp/aep-base-node.sock")]
    socket_base: String,
    #[arg(long, default_value = "/tmp/aep-action-lattice.db")]
    lattice_db: PathBuf,
    #[arg(long, default_value_t = false)]
    internet_up: bool,
    #[arg(long, default_value_t = 0)]
    mesh_peers: u32,
    #[arg(long, default_value_t = false)]
    self_test: bool,
    /// Run as daemon with Unix socket docking port listeners (Phase 4).
    #[arg(long, default_value_t = false)]
    daemon: bool,
}

struct ResolvedConfig {
    socket_base: String,
    lattice_db: PathBuf,
    internet_up: bool,
    mesh_peers: u32,
    epscom_priority: u8,
    epscom_signatures_enabled: bool,
    epscom_signatures_count: Option<u32>,
    epscom_signatures_path: Option<PathBuf>,
    lrps: Vec<String>,
}

fn arg_present(flag: &str) -> bool {
    std::env::args().any(|a| a == flag || a.starts_with(&format!("{flag}=")))
}

fn load_config_file(path: &PathBuf) -> Result<BaseNodeConfigFile, Box<dyn std::error::Error>> {
    let raw = std::fs::read_to_string(path)?;
    let parsed: BaseNodeConfigFile = serde_json::from_str(&raw)?;
    if parsed.version != "2.8.0" {
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
        epscom_priority: EPSCOM_PRIORITY,
        epscom_signatures_enabled: true,
        epscom_signatures_count: None,
        epscom_signatures_path: None,
        lrps: Vec::new(),
    };

    if let Some(path) = &cli.config {
        let file = load_config_file(path)?;
        resolved.socket_base = file.base_node.socket_base;
        resolved.lattice_db = PathBuf::from(file.base_node.lattice_db);
        resolved.internet_up = file.base_node.internet_up;
        resolved.mesh_peers = file.base_node.mesh_peers;
        if file.base_node.epscom_priority > 0 {
            resolved.epscom_priority = file.base_node.epscom_priority;
        }
        if let Some(sig) = &file.base_node.epscom_signatures {
            resolved.epscom_signatures_enabled = sig.enabled;
            if let Some(path) = &sig.path {
                resolved.epscom_signatures_path = Some(PathBuf::from(path));
            }
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
    let cfg = resolve_config(&cli)?;

    if cli.daemon {
        let conn = open_lattice_db(&cfg.lattice_db)?;
        let data_dir = cfg
            .lattice_db
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"));
        let runtime = DockingRuntime::with_data_dir(
            cfg.socket_base.clone(),
            conn,
            &cfg.lrps,
            &data_dir,
        );
        let handles = run_docking_servers(runtime).await?;
        if !sockets_exist(&cfg.socket_base) {
            return Err("daemon failed: docking sockets not present after bind".into());
        }
        info!(
            component = COMPONENT_ID,
            socket_base = %cfg.socket_base,
            ports = handles.len(),
            "AEP Base Node daemon listening on docking ports"
        );
        tokio::signal::ctrl_c().await?;
        info!("AEP Base Node daemon shutting down");
        return Ok(());
    }

    let conn = open_lattice_db(&cfg.lattice_db)?;
    let mut memory = LatticeMemoryStore::open_default(&cfg.lattice_db)?;
    let contracts = bootstrap_contracts_from_lrps(&cfg.lrps);

    if cli.self_test {
        let data_dir = cfg
            .lattice_db
            .parent()
            .map(PathBuf::from)
            .unwrap_or_else(|| PathBuf::from("/tmp"));
        let dock_kem = load_or_create_dock_kem(&data_dir);
        let mut sign_store = AgentSignKeyStore::load(&data_dir);
        let sign = sign_store.get_or_create("AG-BOOT");
        sign_store.flush()?;
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
    let data_dir = cfg.lattice_db.parent();
    let (mesh_peers, mesh_routes, mesh_load_error) =
        aep_base_node::resolve_mesh_peers(data_dir, cfg.internet_up, cfg.mesh_peers);
    let sig_count = cfg.epscom_signatures_count.or_else(|| {
        let candidates = [
            cfg.epscom_signatures_path.clone(),
            std::env::var("AEP_EPSCOM_SIGNATURES_PATH")
                .ok()
                .map(PathBuf::from),
            Some(PathBuf::from("AEP-Base-Node/signatures")),
        ];
        candidates
            .into_iter()
            .flatten()
            .find(|p| p.join("trust-bundle/manifest.json").exists())
            .and_then(|p| aep_base_node::count_epscom_signature_entries(&p))
    });
    let report = health(
        env!("CARGO_PKG_VERSION"),
        mesh_peers,
        cfg.internet_up,
        &cfg.socket_base,
        events,
        cfg.epscom_priority,
        if cfg.epscom_signatures_enabled {
            Some(true)
        } else {
            Some(false)
        },
        sig_count,
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