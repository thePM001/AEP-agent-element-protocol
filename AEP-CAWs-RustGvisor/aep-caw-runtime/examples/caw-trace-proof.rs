//! Proof listener for the gVisor trace sink.
//!
//! Usage: caw-trace-proof <socket path>
//!
//! Binds the socket, prints READY, takes the trace stream of one sandbox and prints
//! one line per exit point of an open, execve or connect call and one line per loaded
//! program:
//!
//! ```text
//! EVENT kind=open errno=2 result=-1 process=cat path=/outside/secret
//! ```
//!
//! It ends with a DONE line when the sandbox closes the stream.

use std::io::Write;
use std::path::Path;
use std::process::ExitCode;

use aep_caw_runtime::trace::{TraceError, TraceKind};
use aep_caw_runtime::trace_listener::TraceListener;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn run(path: &Path) -> Result<(), TraceError> {
    let listener = TraceListener::bind(path)?;
    println!("READY");
    let _ = std::io::stdout().flush();
    let mut connection = listener.accept()?;
    let mut points: u64 = 0;
    let mut dropped: u32 = 0;
    while let Some(event) = connection.next_event()? {
        points += 1;
        dropped = event.dropped_count;
        if event.kind == TraceKind::ExecDone {
            println!(
                "EVENT kind=exec-done process={} path={}",
                event.process_name, event.pathname
            );
            continue;
        }
        let Some(exit) = event.exit else { continue };
        let target = match event.kind {
            TraceKind::Open | TraceKind::Execve => format!("path={}", event.pathname),
            TraceKind::Connect => format!("address={}", hex(&event.address)),
            TraceKind::ExecDone | TraceKind::Other(_) => continue,
        };
        println!(
            "EVENT kind={} errno={} result={} process={} {}",
            event.kind.name(),
            exit.errno,
            exit.result,
            event.process_name,
            target
        );
    }
    println!("DONE points={points} dropped={dropped}");
    Ok(())
}

fn main() -> ExitCode {
    let Some(path) = std::env::args().nth(1) else {
        eprintln!("usage: caw-trace-proof <socket path>");
        return ExitCode::from(2);
    };
    match run(Path::new(&path)) {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("caw-trace-proof: {err}");
            ExitCode::FAILURE
        }
    }
}
