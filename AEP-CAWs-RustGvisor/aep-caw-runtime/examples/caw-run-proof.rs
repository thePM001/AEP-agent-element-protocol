//! Runs one command through a session of the CAW and prints what the policy refused.
//! A proof tool for the acceptance script, not the CAW command: its kernel gate
//! admits every run, so it proves the sandbox and the audit log, not the dock.
//!
//! Usage: caw-run-proof <runsc> <record.json> <project folder> <work folder> <command> [args]
//!
//! The path of the init program comes from the variable CAW_PROOF_INIT.
//!
//! Prints one line per deny event, one line per other egress request, one AUDIT line
//! and one RESULT line:
//!
//! ```text
//! DENY kind=file-outside target=/home/agent/.ssh/id process=sh errno=2 rule=
//! AUDIT lines=4 chain=ok
//! RESULT exit=0 deny=1 points=212 dropped=0 complete=true
//! ```
//!
//! Its own exit code is the exit code of the command.

use std::path::Path;
use std::process::ExitCode;
use std::time::Duration;

use aep_caw_policy::plan::Variables;
use aep_caw_runtime::audit::verify;
use aep_caw_runtime::session::{
    create, default_init, exec, CawConfig, GateRequest, KernelGate, Layout,
};

/// Admits every run. Only this proof tool uses it.
struct ProofGate;

impl KernelGate for ProofGate {
    fn admit(&self, _: &GateRequest<'_>) -> Result<(), String> {
        Ok(())
    }
}

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
    let text = std::fs::read_to_string(&args[1]).map_err(|e| format!("{}: {e}", args[1]))?;
    let profile = serde_json::from_str::<serde_json::Value>(&text)
        .ok()
        .and_then(|v| {
            v.get("profile_id")
                .and_then(|p| p.as_str())
                .map(str::to_string)
        })
        .ok_or("the record names no profile")?;
    let layout = Layout::new(Path::new(&args[3]));
    std::fs::create_dir_all(layout.profiles()).map_err(|e| e.to_string())?;
    std::fs::write(layout.profiles().join(format!("{profile}.json")), &text)
        .map_err(|e| e.to_string())?;
    let config = CawConfig {
        allowed_profiles: vec![profile.clone()],
        runsc: args[0].clone().into(),
        init: std::env::var_os("CAW_PROOF_INIT").map_or_else(default_init, Into::into),
    };
    let home = std::env::var("CAW_PROOF_HOME").unwrap_or_else(|_| "/home/agent".to_string());
    let vars = Variables::new()
        .with("HOME", &home)
        .with("AEP_MODEL_GATEWAY_HOST", "gateway.example.com");
    let session = create(&layout, &config, &profile, Path::new(&args[2]), &vars)
        .map_err(|e| e.to_string())?;
    let outcome = exec(
        &layout,
        &config,
        &ProofGate,
        &session.session_id,
        &args[4..],
        Some(Duration::from_secs(60)),
    )
    .map_err(|e| e.to_string())?;
    for event in &outcome.run.deny_events {
        println!(
            "DENY kind={} target={} process={} errno={} rule={}",
            event.kind.name(),
            event.target,
            event.process,
            event.errno,
            event.rule
        );
    }
    for event in &outcome.egress {
        let target = format!("{}:{}", event.host, event.port);
        match (&event.allowed, &event.refusal) {
            (Some((route, address)), _) => {
                println!("EGRESS allowed target={target} route={route} address={address}")
            }
            (None, Some(refusal)) if refusal.is_policy() => println!(
                "DENY kind=egress target={target} process=- errno=0 rule={}",
                refusal.name()
            ),
            (None, Some(refusal)) => {
                println!("EGRESS failed target={target} reason={}", refusal.name())
            }
            (None, None) => {}
        }
    }
    let audit = layout.session(&session.session_id).join("audit.log");
    match verify(&audit) {
        Ok((lines, _)) => println!("AUDIT lines={lines} chain=ok"),
        Err(err) => println!("AUDIT chain=broken {err}"),
    }
    println!(
        "RESULT exit={} deny={} points={} dropped={} complete={}",
        outcome.exit_code,
        outcome.deny_count,
        outcome.run.trace_points,
        outcome.run.trace_dropped,
        outcome.run.trace_complete
    );
    Ok(outcome.exit_code)
}
