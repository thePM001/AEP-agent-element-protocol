//! aep-ucm: the AEP Universal Computation Module service and CLI.

#![forbid(unsafe_code)]

use aep_ucm::engine::{self, Config, Engine};
use aep_ucm::{http, mcp, store};
use clap::{Parser, Subcommand};
use serde_json::{json, Value as J};
use std::io::{BufRead, Read, Write};
use std::path::PathBuf;
use std::process::ExitCode;

#[derive(Parser)]
#[command(
    name = "aep-ucm",
    version,
    about = "AEP Universal Computation Module: exact calculation with signed receipts"
)]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    /// Serve the HTTP API on UCM_HOST and UCM_PORT (default host 127.0.0.1, port 8414)
    Serve,
    /// Serve MCP on stdin and stdout
    Mcp,
    /// Evaluate a program file (or - for stdin) and print the result with a signed receipt
    Eval {
        file: String,
        /// Inputs as a JSON object, for example '{"p": "19.90 EUR"}'
        #[arg(long)]
        inputs: Option<String>,
        /// The file holds the JSON program form
        #[arg(long)]
        json: bool,
        /// Print only the result, without signing a receipt
        #[arg(long)]
        no_receipt: bool,
    },
    /// Verify a receipt file
    Verify {
        file: String,
        /// Also run the program again and compare the result digest
        #[arg(long)]
        replay: bool,
    },
    /// Find the UCM function, unit, constant or formula for a task
    Lookup {
        query: Vec<String>,
        #[arg(short, default_value_t = 5)]
        k: usize,
    },
    /// Typecheck a program file and show its types without running it
    Explain { file: String },
    /// Print the catalog the lookup indexes
    Catalog,
    /// Evaluate JSON lines from stdin without receipts: {"id", "program", "inputs"}
    Batch,
    /// Print this node's id and public key, creating the key when it is missing
    Key,
    /// Check every link of the receipt log
    VerifyLog,
}

fn read_source(file: &str) -> Result<String, String> {
    if file == "-" {
        let mut s = String::new();
        std::io::stdin()
            .read_to_string(&mut s)
            .map_err(|e| e.to_string())?;
        Ok(s)
    } else {
        std::fs::read_to_string(file).map_err(|e| format!("{file}: {e}"))
    }
}

fn program_request(file: &str, json_form: bool) -> Result<J, String> {
    let src = read_source(file)?;
    Ok(if json_form {
        json!({ "program_json": serde_json::from_str::<J>(&src).map_err(|e| format!("program JSON: {e}"))? })
    } else {
        json!({ "program": src })
    })
}

fn print(v: &J) {
    println!("{}", serde_json::to_string_pretty(v).unwrap_or_default());
}

fn finish(r: engine::ApiResult) -> ExitCode {
    match r {
        Ok(v) => {
            print(&v);
            ExitCode::SUCCESS
        }
        Err(e) => {
            print(&e.to_json());
            ExitCode::from(2)
        }
    }
}

fn open() -> Result<std::sync::Arc<Engine>, String> {
    Engine::open(Config::from_env())
}

fn main() -> ExitCode {
    let cli = Cli::parse();
    let result: Result<ExitCode, String> = (|| match cli.cmd {
        Cmd::Serve => {
            tracing_subscriber::fmt()
                .with_env_filter(
                    tracing_subscriber::EnvFilter::try_from_default_env()
                        .unwrap_or_else(|_| "info".into()),
                )
                .init();
            let e = open()?;
            let addr = format!("{}:{}", e.cfg.host, e.cfg.port);
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(|x| x.to_string())?;
            rt.block_on(async move {
                let listener = tokio::net::TcpListener::bind(&addr)
                    .await
                    .map_err(|x| format!("bind {addr}: {x}"))?;
                tracing::info!(node = %e.key.node_id, engine = %aep_ucm_core::engine_build(), "aep-ucm listening on {addr}");
                axum::serve(listener, http::router(e))
                    .with_graceful_shutdown(async {
                        let _ = tokio::signal::ctrl_c().await;
                    })
                    .await
                    .map_err(|x| x.to_string())
            })?;
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Mcp => {
            let e = open()?;
            let rt = tokio::runtime::Builder::new_multi_thread()
                .enable_all()
                .build()
                .map_err(|x| x.to_string())?;
            rt.block_on(mcp::serve_stdio(e))
                .map_err(|x| x.to_string())?;
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Eval {
            file,
            inputs,
            json,
            no_receipt,
        } => {
            let e = open()?;
            let mut req = program_request(&file, json)?;
            if let Some(i) = inputs {
                req["inputs"] = serde_json::from_str(&i).map_err(|x| format!("inputs: {x}"))?;
            }
            Ok(finish(if no_receipt {
                e.evaluate_unsigned(&req)
            } else {
                e.evaluate(&req)
            }))
        }
        Cmd::Verify { file, replay } => {
            let e = open()?;
            let receipt: J =
                serde_json::from_str(&read_source(&file)?).map_err(|x| format!("receipt: {x}"))?;
            Ok(finish(e.verify(
                &json!({ "receipt": receipt, "mode": if replay { "replay" } else { "signature" } }),
            )))
        }
        Cmd::Lookup { query, k } => {
            let e = open()?;
            let rt = tokio::runtime::Builder::new_current_thread()
                .enable_all()
                .build()
                .map_err(|x| x.to_string())?;
            Ok(finish(rt.block_on(e.lookup(
                &json!({ "query": query.join(" "), "k": k.to_string() }),
            ))))
        }
        Cmd::Explain { file } => {
            let e = open()?;
            Ok(finish(e.explain(&program_request(&file, false)?)))
        }
        Cmd::Catalog => {
            let e = open()?;
            print(&e.catalog());
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Batch => {
            let e = open()?;
            let stdout = std::io::stdout();
            let mut out = std::io::BufWriter::new(stdout.lock());
            for line in std::io::stdin().lock().lines() {
                let line = line.map_err(|x| x.to_string())?;
                if line.trim().is_empty() {
                    continue;
                }
                let req: J = serde_json::from_str(&line).map_err(|x| format!("batch line: {x}"))?;
                let id = req.get("id").cloned().unwrap_or(J::Null);
                let row = match e.evaluate_unsigned(&req) {
                    Ok(v) => json!({ "id": id, "result": v["result"] }),
                    Err(err) => json!({ "id": id, "error": err.code }),
                };
                writeln!(out, "{row}").map_err(|x| x.to_string())?;
            }
            Ok(ExitCode::SUCCESS)
        }
        Cmd::Key => {
            let e = open()?;
            print(
                &json!({ "node_id": e.key.node_id, "public_key": e.key.public_hex, "key_file": e.cfg.data_dir.join("ucm-sign.key") }),
            );
            Ok(ExitCode::SUCCESS)
        }
        Cmd::VerifyLog => {
            let cfg = Config::from_env();
            let path: PathBuf = cfg.data_dir.join("receipts.log");
            match store::verify_log(&path) {
                Ok((n, head)) => {
                    print(&json!({ "ok": true, "lines": n.to_string(), "head": head }));
                    Ok(ExitCode::SUCCESS)
                }
                Err(err) => {
                    print(&json!({ "ok": false, "error": err }));
                    Ok(ExitCode::from(2))
                }
            }
        }
    })();
    match result {
        Ok(c) => c,
        Err(e) => {
            eprintln!("aep-ucm: {e}");
            ExitCode::from(1)
        }
    }
}
