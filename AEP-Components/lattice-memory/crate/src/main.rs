use aep_lattice_memory::{
    LatticeMemoryStore, MemoryCountRequest, MemoryEntryJson, MemoryHistoryRequest,
    MemorySearchRequest,
};
use clap::{Parser, Subcommand};
use std::io::{self, Read};
use std::path::PathBuf;

#[derive(Debug, Parser)]
#[command(name = "aep-memory", about = "AEP 2.8 Lattice Memory CLI (sqlite-vec + USearch)")]
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
    /// Record a MemoryEntry JSON object from stdin
    Record,
    /// Vector similarity search (JSON request on stdin)
    Search,
    /// Element history (JSON request on stdin)
    History,
    /// Export all entries as JSON array on stdout
    Export,
    /// Validation count for element (JSON request on stdin)
    Count,
}

fn read_stdin_json<T: serde::de::DeserializeOwned>() -> Result<T, Box<dyn std::error::Error>> {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf)?;
    Ok(serde_json::from_str(&buf)?)
}

fn resolve_db(cli: &Cli) -> Result<PathBuf, Box<dyn std::error::Error>> {
    if let Some(db) = &cli.db {
        return Ok(db.clone());
    }
    if let Some(config) = &cli.config {
        #[derive(serde::Deserialize)]
        struct ConfigFile {
            base_node: BaseNodeSection,
        }
        #[derive(serde::Deserialize)]
        struct BaseNodeSection {
            lattice_db: String,
        }
        let raw = std::fs::read_to_string(config)?;
        let parsed: ConfigFile = serde_json::from_str(&raw)?;
        return Ok(PathBuf::from(parsed.base_node.lattice_db));
    }
    if let Ok(path) = std::env::var("AEP_LATTICE_DB") {
        return Ok(PathBuf::from(path));
    }
    let home = std::env::var("HOME").unwrap_or_else(|_| "/tmp".into());
    Ok(PathBuf::from(format!("{home}/.aep/action-lattice.db")))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let db_path = resolve_db(&cli)?;
    let mut store = LatticeMemoryStore::open_default(&db_path)?;

    match cli.command {
        Commands::Record => {
            let entry: MemoryEntryJson = read_stdin_json()?;
            let key = store.record_entry(&entry)?;
            println!("{}", serde_json::json!({ "ok": true, "key": key }));
        }
        Commands::Search => {
            let req: MemorySearchRequest = read_stdin_json()?;
            let matches = store.search_entries(
                &req.embedding,
                req.limit,
                req.threshold,
                req.accepted_only,
            )?;
            println!("{}", serde_json::to_string(&matches)?);
        }
        Commands::History => {
            let req: MemoryHistoryRequest = read_stdin_json()?;
            let entries = store.history_entries(
                &req.element_id,
                req.result.as_deref(),
            )?;
            println!("{}", serde_json::to_string(&entries)?);
        }
        Commands::Export => {
            let entries = store.export_entries()?;
            println!("{}", serde_json::to_string(&entries)?);
        }
        Commands::Count => {
            let req: MemoryCountRequest = read_stdin_json()?;
            let count = store.validation_count(&req.element_id)?;
            println!("{}", serde_json::json!({ "count": count }));
        }
    }

    Ok(())
}