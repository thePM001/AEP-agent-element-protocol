use aep_envelope::{admit, plan_apply, EnvelopeAction, Snapshot};
use clap::{Parser, Subcommand};
use std::io::{Read, Write};

#[derive(Parser)]
#[command(name = "aep-envelope", about = "AEP 2.8 Envelope Admit")]
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

fn main() {
    let cli = Cli::parse();
    match cli.cmd {
        Cmd::Admit => {
            let mut buf = String::new();
            std::io::stdin().read_to_string(&mut buf).expect("stdin");
            let req: AdmitRequest = serde_json::from_str(&buf).expect("json");
            let result = admit(&req.action, &req.snapshot);
            let apply = plan_apply(&result, &req.snapshot);
            let out = AdmitResponse { result, apply };
            let mut stdout = std::io::stdout();
            writeln!(stdout, "{}", serde_json::to_string(&out).expect("ser")).ok();
        }
    }
}
