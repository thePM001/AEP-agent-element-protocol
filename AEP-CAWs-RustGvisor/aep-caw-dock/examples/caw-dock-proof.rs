//! Asks the validation dock of a Base Node to admit one run and prints the outcome.
//! A proof tool for the dock acceptance script.
//!
//! Usage: caw-dock-proof <data folder of the Base Node> <validation socket>
//!
//! Prints `ADMITTED` and ends with 0, or `REFUSED <reason>` and ends with 1.

use std::path::Path;
use std::process::ExitCode;

use aep_caw_dock::DockClient;
use aep_caw_runtime::session::{GateRequest, KernelGate};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() != 2 {
        eprintln!("usage: caw-dock-proof <data folder of the Base Node> <validation socket>");
        return ExitCode::from(2);
    }
    let client = DockClient::new(Path::new(&args[0]), Path::new(&args[1]));
    let command = vec![String::from("true")];
    let request = GateRequest {
        session_id: "dock-proof",
        plan_digest: "sha256:0000000000000000000000000000000000000000000000000000000000000000",
        args: &command,
    };
    match client.admit(&request) {
        Ok(()) => {
            println!("ADMITTED");
            ExitCode::SUCCESS
        }
        Err(reason) => {
            println!("REFUSED {reason}");
            ExitCode::FAILURE
        }
    }
}
