//! The program `aep-lattice-memory`: Lattice Memory for callers outside the Base Node.
//!
//! Every command reads JSON on standard input where it needs a request and writes JSON
//! on standard output. An error goes to standard error and the exit code is 1.
//!
//! A command opens what it needs and nothing more. A write opens the log of its
//! domain. A search opens the attractors of its domain. History, export, count and
//! verdicts read frames of the logs they name and open no attractors at all. The
//! program writes no record into a domain of judged proposals: those belong to the
//! Base Node alone.

use aep_lattice_memory::wire::{
    fingerprint_of, health_json, match_json, page_json, parse_result, record_json, verdicts_json,
    verify_json, WireExport, WireHistory, WireRecord, WireSearch, WireVerdicts,
};
use aep_lattice_memory::{
    is_judged_domain, CoreConfig, CoreError, Cursor, LogBackend, MemoryBackend, MemoryError,
    OpenOptionsLog, ProposalShape, RecordQuery, DEFAULT_PAGE_BYTES, JUDGED_DOMAIN,
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
    /// This is the way to write many records: the store is opened once.
    RecordLines,
    /// Exact search over the attractors of one domain.
    Search,
    /// One page of the records of one element in one domain.
    History,
    /// One page of the records of one domain or of every domain.
    Export,
    /// The number of records of one element in one domain.
    Count,
    /// One page of the verdicts the Base Node recorded for one docking port.
    Verdicts,
    /// Counts of the store. Opens files to read and changes nothing.
    Health,
    /// Walk the hash chain of every domain, rebuild its attractors from the log and
    /// compare its snapshot with the log.
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
    LogBackend::open_read_only(&store_dir(cli), config(cli))
}

fn write_record(
    backend: &mut LogBackend,
    wire: WireRecord,
) -> Result<serde_json::Value, MemoryError> {
    if is_judged_domain(&wire.domain) {
        return Err(MemoryError::Core(CoreError::Invalid {
            field: "domain",
            reason: format!(
                "{} is a domain of judged proposals: only the Base Node writes there",
                wire.domain
            ),
        }));
    }
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

/// The place a request names as the start of its page.
fn cursor_of(after: Option<&str>) -> Result<Option<Cursor>, MemoryError> {
    after.map(str::parse::<Cursor>).transpose()
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
            let mut backend = open_reader(cli)?;
            backend.open_domain(&request.domain)?;
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
            let after = cursor_of(request.after.as_deref())?;
            let page = open_reader(cli)?.records(&RecordQuery {
                domain: Some(&request.domain),
                element_id: Some(&request.element_id),
                accepted,
                after: after.as_ref(),
                limit: request.limit,
                max_bytes: request.max_bytes.unwrap_or(DEFAULT_PAGE_BYTES),
            })?;
            writeln!(out, "{}", page_json(&page, record_json))?;
        }
        Command::Export => {
            let request: WireExport = read_request()?;
            let after = cursor_of(request.after.as_deref())?;
            let page = open_reader(cli)?.records(&RecordQuery {
                domain: request.domain.as_deref(),
                element_id: None,
                accepted: None,
                after: after.as_ref(),
                limit: request.limit,
                max_bytes: request.max_bytes.unwrap_or(DEFAULT_PAGE_BYTES),
            })?;
            writeln!(out, "{}", page_json(&page, record_json))?;
        }
        Command::Count => {
            let request: WireHistory = read_request()?;
            let accepted = match request.result.as_deref() {
                None => None,
                Some(text) => Some(parse_result(text)?),
            };
            let count = open_reader(cli)?.count(&RecordQuery {
                domain: Some(&request.domain),
                element_id: Some(&request.element_id),
                accepted,
                after: None,
                limit: usize::MAX,
                max_bytes: usize::MAX,
            })?;
            writeln!(out, "{}", json!({ "count": count }))?;
        }
        Command::Verdicts => {
            let request: WireVerdicts = read_request()?;
            let domain = format!("{JUDGED_DOMAIN}.{}", request.port);
            let accepted = match request.verdict.as_deref() {
                None => None,
                Some("allow") => Some(true),
                Some("deny") => Some(false),
                Some(other) => {
                    return Err(MemoryError::Core(CoreError::Invalid {
                        field: "verdict",
                        reason: format!("is {other}, expected allow or deny"),
                    }))
                }
            };
            let after = cursor_of(request.after.as_deref())?;
            let page = open_reader(cli)?.records(&RecordQuery {
                domain: Some(&domain),
                element_id: request.agent_id.as_deref(),
                accepted,
                after: after.as_ref(),
                limit: request.limit,
                max_bytes: request.max_bytes.unwrap_or(DEFAULT_PAGE_BYTES),
            })?;
            writeln!(out, "{}", verdicts_json(&domain, &page))?;
        }
        Command::Health => {
            let health = LogBackend::health(&store_dir(cli))?;
            writeln!(out, "{}", health_json(&health))?;
        }
        Command::Verify => {
            let backend = open_reader(cli)?;
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
