use aep_envelope::{admit, plan_apply, EnvelopeAction, Snapshot};
use clap::{Parser, Subcommand};
use std::io::{Read, Write};

#[derive(Parser)]
#[command(name = "aep-envelope", about = "AEP 2.9 Envelope Admit")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
}

#[derive(Subcommand)]
enum Cmd {
    Admit,
}

#[derive(serde::Deserialize)]
struct AdmitRequest {
    action: EnvelopeAction,
    snapshot: Snapshot,
}

#[derive(serde::Serialize)]
struct AdmitResponse {
    result: aep_envelope::AdmitResult,
    apply: aep_envelope::ApplyPlan,
}

/// Failure of one CLI run. Each one exits 1 with no Admit answer on stdout.
#[derive(Debug, thiserror::Error)]
enum CliError {
    #[error("stdin read failed: {0}")]
    Stdin(#[from] std::io::Error),
    #[error("admit request is not valid JSON: {0}")]
    Request(serde_json::Error),
    #[error("admit response could not be written as JSON: {0}")]
    Response(serde_json::Error),
}

fn admit_from_text(buf: &str) -> Result<String, CliError> {
    let req: AdmitRequest = serde_json::from_str(buf).map_err(CliError::Request)?;
    let result = admit(&req.action, &req.snapshot);
    let apply = plan_apply(&result, &req.snapshot);
    let out = AdmitResponse { result, apply };
    serde_json::to_string(&out).map_err(CliError::Response)
}

fn run(cmd: Cmd) -> Result<String, CliError> {
    match cmd {
        Cmd::Admit => {
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf)?;
            admit_from_text(&buf)
        }
    }
}

fn main() {
    let cli = Cli::parse();
    match run(cli.cmd) {
        Ok(line) => {
            let mut stdout = std::io::stdout();
            writeln!(stdout, "{line}").ok();
        }
        Err(err) => {
            eprintln!("{err}");
            std::process::exit(1);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn malformed_request_is_an_error_not_a_panic() {
        assert!(matches!(
            admit_from_text("{not json"),
            Err(CliError::Request(_))
        ));
        assert!(matches!(admit_from_text(""), Err(CliError::Request(_))));
    }
}
