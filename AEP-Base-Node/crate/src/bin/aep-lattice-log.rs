use aep_base_node::{
    bootstrap_contracts_from_lrps, build_transport_frame, enforce_writing_text, enforce_writing_value,
    event_count, export_dynaep_events, open_lattice_db, record_dynaep_event, DynAepEventInput,
    EPSCOM_CORE_ID,
};
use aep_lattice_channel::LatticeChannelFrame;
use clap::{Parser, Subcommand};
use std::io::{self, Read};
use std::path::PathBuf;

const MAX_STDIN_BYTES: usize = 4 * 1024 * 1024;
const CONFIG_VERSION: &str = "2.8.0";

#[derive(Debug, Parser)]
#[command(name = "aep-lattice-log", about = "AEP 2.8 dynAEP Action Lattice event logger")]
struct Cli {
    #[arg(long)]
    db: Option<PathBuf>,
    #[arg(long)]
    config: Option<PathBuf>,
    #[command(subcommand)]
    command: Commands,
}

#[derive(Debug, Subcommand)]
enum Commands {
    /// Record a dynAEP event JSON object from stdin
    Record,
    /// Export recent events as JSON array on stdout
    Export {
        #[arg(long, default_value_t = 100)]
        limit: u32,
    },
    /// Event count on stdout as JSON
    Count,
    /// Build a LatticeChannelFrame JSON envelope for docking transport (no DB write)
    BuildFrame,
    /// EPSCOM kernel writing.gap enforcement for prose text
    ValidateWriting,
    /// EPSCOM kernel writing.gap enforcement for arbitrary JSON values
    EnforceWritingValue,
}

fn read_stdin_json<T: serde::de::DeserializeOwned>() -> Result<T, Box<dyn std::error::Error>> {
    let mut limited = String::new();
    let mut chunk = [0u8; 8192];
    let mut total = 0usize;
    loop {
        let n = io::stdin().read(&mut chunk)?;
        if n == 0 {
            break;
        }
        total = total.saturating_add(n);
        if total > MAX_STDIN_BYTES {
            return Err(format!("stdin exceeds {MAX_STDIN_BYTES} byte limit").into());
        }
        let piece = std::str::from_utf8(&chunk[..n])
            .map_err(|e| format!("stdin is not valid UTF-8: {e}"))?;
        limited.push_str(piece);
    }
    Ok(serde_json::from_str(&limited)?)
}

fn resolve_db(cli: &Cli) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(db) = &cli.db {
        return Ok(db.clone());
    }
    if let Some(config) = &cli.config {
        #[derive(serde::Deserialize)]
        struct ConfigFile {
            version: String,
            base_node: BaseNodeSection,
        }
        #[derive(serde::Deserialize)]
        struct BaseNodeSection {
            lattice_db: String,
        }
        let raw = std::fs::read_to_string(config)?;
        let parsed: ConfigFile = serde_json::from_str(&raw)?;
        if parsed.version != CONFIG_VERSION {
            return Err(format!("unsupported config version: {}", parsed.version).into());
        }
        return Ok(PathBuf::from(parsed.base_node.lattice_db));
    }
    if let Ok(path) = std::env::var("AEP_LATTICE_DB") {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    Ok(PathBuf::from(format!("{home}/.aep/action-lattice.db")))
}

fn resolve_lrps(cli: &Cli) -> Vec<String> {
    if let Some(config) = &cli.config {
        if let Ok(raw) = std::fs::read_to_string(config) {
            #[derive(serde::Deserialize)]
            struct ConfigFile {
                version: String,
                base_node: BaseNodeSection,
            }
            #[derive(serde::Deserialize)]
            struct BaseNodeSection {
                #[serde(default)]
                lrps: Vec<String>,
            }
            if let Ok(parsed) = serde_json::from_str::<ConfigFile>(&raw) {
                if parsed.version == CONFIG_VERSION {
                    return parsed.base_node.lrps;
                }
            }
        }
    }
    Vec::new()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let db_path = resolve_db(&cli)?;
    let lrps = resolve_lrps(&cli);
    let conn = open_lattice_db(&db_path)?;

    match cli.command {
        Commands::Record => {
            let input: DynAepEventInput = read_stdin_json()?;
            let contracts = bootstrap_contracts_from_lrps(&lrps);
            let record = record_dynaep_event(&conn, &input, &contracts, &db_path)?;
            println!("{}", serde_json::to_string(&record)?);
        }
        Commands::Export { limit } => {
            let events = export_dynaep_events(&conn, Some(limit))?;
            println!("{}", serde_json::to_string(&events)?);
        }
        Commands::Count => {
            let count = event_count(&conn)?;
            println!("{}", serde_json::json!({ "count": count }));
        }
        Commands::BuildFrame => {
            let input: DynAepEventInput = read_stdin_json()?;
            let contracts = bootstrap_contracts_from_lrps(&lrps);
            let frame: LatticeChannelFrame = build_transport_frame(&input, &contracts, &db_path)?;
            let sign_hex = aep_base_node::dock_keys::AgentSignKeyStore::load(
                db_path.parent().unwrap_or(std::path::Path::new("/tmp")),
            )
            .public_for(&input.agent_id)
            .map(hex::encode)
            .unwrap_or_default();
            println!(
                "{}",
                serde_json::json!({
                    "frame": frame,
                    "signer_public_hex": sign_hex,
                })
            );
        }
        Commands::ValidateWriting => {
            #[derive(serde::Deserialize)]
            struct ValidateWritingInput {
                text: String,
            }
            let input: ValidateWritingInput = read_stdin_json()?;
            let result = enforce_writing_text(&input.text);
            println!(
                "{}",
                serde_json::json!({
                    "ok": result.ok,
                    "authority": EPSCOM_CORE_ID,
                    "text": result.text,
                    "violations_corrected": result.violations_corrected,
                    "violations": result.violations,
                })
            );
        }
        Commands::EnforceWritingValue => {
            #[derive(serde::Deserialize)]
            struct EnforceValueInput {
                value: serde_json::Value,
            }
            let input: EnforceValueInput = read_stdin_json()?;
            let enforced = enforce_writing_value(&input.value);
            let ok = !aep_base_node::value_has_writing_violations(&enforced);
            println!(
                "{}",
                serde_json::json!({
                    "ok": ok,
                    "authority": EPSCOM_CORE_ID,
                    "value": enforced,
                })
            );
        }
    }

    Ok(())
}