//! The program `aep-lattice-memory`: Lattice Memory for callers outside the Base Node.
//!
//! Every command reads JSON on standard input where it needs a request and writes JSON
//! on standard output. An error goes to standard error and the exit code is 1.

use aep_lattice_memory::wire::{
    fingerprint_of, health_json, match_json, parse_result, record_json, verify_json, WireExport,
    WireHistory, WireRecord, WireSearch,
};
use aep_lattice_memory::{
    CoreConfig, LogBackend, MemoryBackend, MemoryError, OpenOptionsLog, ProposalShape,
};
use clap::{Parser, Subcommand};
use serde_json::json;
use std::io::{self, BufRead, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Debug, Parser)]
#[command(
    name = "aep-lattice-memory",
    about = "AEP 2.9 Lattice Memory: append-only record logs with attractors"
)]
struct Cli {
    /// Folder of the store. Default: AEP_LATTICE_MEMORY_DIR, then the folder
    /// lattice-memory under AEP_DATA or under .aep in the home folder.
    #[arg(long)]
    store: Option<PathBuf>,
    /// Dimension of operator embeddings. A new store keeps it. An existing store must
    /// have been made with the same dimension.
    #[arg(long, default_value_t = 0)]
    embedding_dim: usize,
    /// Attractors one domain holds before eviction starts.
    #[arg(long)]
    capacity: Option<usize>,
    /// Flush every record to the disk before the command answers.
    #[arg(long, default_value_t = false)]
    durable: bool,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Write one record. The request is one JSON record on standard input.
    Record,
    /// Write one record per line of standard input and answer with one line each.
    RecordLines,
    /// Exact search over the attractors of one domain.
    Search,
    /// The records of one element in one domain.
    History,
    /// The records of one domain or of every domain.
    Export,
    /// The number of records of one element in one domain.
    Count,
    /// Counts of the store. Opens files to read and changes nothing.
    Health,
    /// Walk the hash chain of every domain and rebuild its attractors from the log.
    Verify,
}

fn store_dir(cli: &Cli) -> PathBuf {
    if let Some(dir) = &cli.store {
        return dir.clone();
    }
    if let Ok(dir) = std::env::var("AEP_LATTICE_MEMORY_DIR") {
        if !dir.trim().is_empty() {
            return PathBuf::from(dir);
        }
    }
    let data = match std::env::var("AEP_DATA") {
        Ok(dir) if !dir.trim().is_empty() => PathBuf::from(dir),
        _ => {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| String::from("."))).join(".aep")
        }
    };
    data.join("lattice-memory")
}

fn config(cli: &Cli) -> CoreConfig {
    let mut config = CoreConfig {
        embedding_dim: cli.embedding_dim,
        ..CoreConfig::default()
    };
    if let Some(capacity) = cli.capacity {
        config.capacity_per_domain = capacity;
    }
    config
}

fn now_unix() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0)
}

fn read_request<T: serde::de::DeserializeOwned>() -> Result<T, MemoryError> {
    let mut text = String::new();
    io::stdin().read_to_string(&mut text)?;
    Ok(serde_json::from_str(&text)?)
}

fn open_writer(cli: &Cli) -> Result<LogBackend, MemoryError> {
    let dir = store_dir(cli);
    if let Some(parent) = dir.parent() {
        std::fs::create_dir_all(parent)?;
    }
    LogBackend::open(
        &dir,
        OpenOptionsLog {
            durable: cli.durable,
            ..OpenOptionsLog::new(config(cli))
        },
    )
}

fn open_reader(cli: &Cli) -> Result<LogBackend, MemoryError> {
    let mut backend = LogBackend::open_read_only(&store_dir(cli), config(cli))?;
    backend.open_all()?;
    Ok(backend)
}

fn write_record(
    backend: &mut LogBackend,
    wire: WireRecord,
) -> Result<serde_json::Value, MemoryError> {
    let record = wire.into_record(backend.config().embedding_dim, now_unix())?;
    let receipt = backend.record(&record)?;
    Ok(json!({
        "ok": true,
        "key": receipt.key,
        "domain": record.domain,
        "attractor_key": receipt.attractor_key,
        "hash": hex::encode(receipt.hash),
    }))
}

fn run(cli: &Cli) -> Result<(), MemoryError> {
    let mut out = io::stdout().lock();
    match cli.command {
        Command::Record => {
            let wire: WireRecord = read_request()?;
            let mut backend = open_writer(cli)?;
            writeln!(out, "{}", write_record(&mut backend, wire)?)?;
        }
        Command::RecordLines => {
            let mut backend = open_writer(cli)?;
            for line in io::stdin().lock().lines() {
                let line = line?;
                if line.trim().is_empty() {
                    continue;
                }
                let wire: WireRecord = serde_json::from_str(&line)?;
                writeln!(out, "{}", write_record(&mut backend, wire)?)?;
            }
        }
        Command::Search => {
            let request: WireSearch = read_request()?;
            let backend = open_reader(cli)?;
            let shape = ProposalShape::from_value(&request.shape.unwrap_or(json!({})));
            let fingerprint = fingerprint_of(
                &shape,
                request.embedding.as_deref(),
                backend.config().embedding_dim,
            )?;
            let hits = backend.search(
                &request.domain,
                &fingerprint,
                request.limit,
                request.min_score.unwrap_or(i32::MIN),
            )?;
            let printed: Vec<_> = hits.iter().map(match_json).collect();
            writeln!(out, "{}", serde_json::Value::Array(printed))?;
        }
        Command::History => {
            let request: WireHistory = read_request()?;
            let accepted = match request.result.as_deref() {
                None => None,
                Some(text) => Some(parse_result(text)?),
            };
            let backend = open_reader(cli)?;
            let records = backend.history(
                &request.domain,
                &request.element_id,
                accepted,
                request.limit,
            )?;
            let printed: Vec<_> = records.iter().map(record_json).collect();
            writeln!(out, "{}", serde_json::Value::Array(printed))?;
        }
        Command::Export => {
            let request: WireExport = read_request()?;
            let backend = open_reader(cli)?;
            let records = backend.export(request.domain.as_deref(), request.limit)?;
            let printed: Vec<_> = records.iter().map(record_json).collect();
            writeln!(out, "{}", serde_json::Value::Array(printed))?;
        }
        Command::Count => {
            let request: WireHistory = read_request()?;
            let backend = open_reader(cli)?;
            let records =
                backend.history(&request.domain, &request.element_id, None, usize::MAX)?;
            writeln!(out, "{}", json!({ "count": records.len() }))?;
        }
        Command::Health => {
            let health = LogBackend::health(&store_dir(cli))?;
            writeln!(out, "{}", health_json(&health))?;
        }
        Command::Verify => {
            let backend = LogBackend::open_read_only(&store_dir(cli), config(cli))?;
            writeln!(out, "{}", verify_json(&backend.verify()?))?;
        }
    }
    Ok(())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    match run(&cli) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("aep-lattice-memory: {error}");
            ExitCode::from(1)
        }
    }
}
