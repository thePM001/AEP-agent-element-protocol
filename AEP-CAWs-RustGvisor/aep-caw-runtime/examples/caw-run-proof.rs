//! Runs one command in a sandbox built from a profile record and prints what the
//! policy refused. A proof tool for the acceptance script, not the CAW command.
//!
//! Usage: caw-run-proof <runsc> <record.json> <project folder> <work folder> <command> [args]
//!
//! Prints one line per deny event and one RESULT line:
//!
//! ```text
//! DENY kind=file-outside target=/home/agent/.ssh/id process=sh errno=2 rule=
//! RESULT exit=0 deny=1 points=212 dropped=0 complete=true
//! ```
//!
//! Its own exit code is the exit code of the command.

use std::path::Path;
use std::process::ExitCode;

use aep_caw_policy::plan::{compile, Variables};
use aep_caw_policy::record::parse_record;
use aep_caw_runtime::bundle::Limits;
use aep_caw_runtime::rootfs::{build_root, resolve_root, DEFAULT_LIBRARY_DIRS};
use aep_caw_runtime::sandbox::{run, RunInput};

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.len() < 5 {
        eprintln!("usage: caw-run-proof <runsc> <record.json> <project folder> <work folder> <command> [args]");
        return ExitCode::from(2);
    }
    match prove(&args) {
        Ok(code) => ExitCode::from(u8::try_from(code.clamp(0, 255)).unwrap_or(1)),
        Err(message) => {
            eprintln!("caw-run-proof: {message}");
            ExitCode::from(70)
        }
    }
}

fn prove(args: &[String]) -> Result<i32, String> {
    let project = &args[2];
    let work = Path::new(&args[3]);
    let text = std::fs::read_to_string(&args[1]).map_err(|e| format!("{}: {e}", args[1]))?;
    let record = parse_record(&text).map_err(|e| e.to_string())?;
    let home = std::env::var("CAW_PROOF_HOME").unwrap_or_else(|_| "/home/agent".to_string());
    let vars = Variables::new()
        .with("PROJECT_ROOT", project)
        .with("HOME", &home)
        .with("AEP_MODEL_GATEWAY_HOST", "gateway.example.com");
    let plan = compile(&record, &vars).map_err(|e| e.to_string())?;
    let image = resolve_root(&plan.programs, &DEFAULT_LIBRARY_DIRS).map_err(|e| e.to_string())?;
    let root = work.join("rootfs");
    let mount_paths: Vec<&str> = plan.mounts.iter().map(|m| m.path.as_str()).collect();
    build_root(&image, &mount_paths, &root).map_err(|e| e.to_string())?;
    let command_dir = work.join("command");
    let outcome = run(
        &plan,
        &RunInput {
            runsc: Path::new(&args[0]),
            root: &root,
            work: &command_dir,
            args: &args[4..],
            cwd: project,
            egress_dir: None,
            extra_env: &[],
            limits: Limits::default(),
            time_limit: Some(std::time::Duration::from_secs(60)),
        },
    )
    .map_err(|e| e.to_string())?;
    for event in &outcome.deny_events {
        println!(
            "DENY kind={} target={} process={} errno={} rule={}",
            event.kind.name(),
            event.target,
            event.process,
            event.errno,
            event.rule
        );
    }
    println!(
        "RESULT exit={} deny={} points={} dropped={} complete={}",
        outcome.exit_code,
        outcome.deny_events.len(),
        outcome.trace_points,
        outcome.trace_dropped,
        outcome.trace_complete
    );
    Ok(outcome.exit_code)
}
