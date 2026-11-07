//! AEP 2.9 UCB validator. One foreign ingest check per process.
//!
//! The UCB starts this program for every bounded validation. It confines itself
//! first, then reads one JSON request from stdin, runs the perimeter-v1
//! predicates and writes one JSON result to stdout. It opens no file, socket or
//! process. When confinement cannot be installed it exits with status 3 and
//! writes nothing, so the UCB denies the ingest.

use aep_ucb::sandbox;
use aep_ucb::validate_process::{answer_request, EXIT_CONFINE_FAILED, MAX_REQUEST_BYTES};
use std::io::{Read, Write};

fn main() {
    if sandbox::confine().is_err() {
        std::process::exit(EXIT_CONFINE_FAILED);
    }
    let mut input = Vec::new();
    let limit = MAX_REQUEST_BYTES as u64 + 1;
    if std::io::stdin()
        .lock()
        .take(limit)
        .read_to_end(&mut input)
        .is_err()
    {
        std::process::exit(2);
    }
    let output = answer_request(&input);
    let mut stdout = std::io::stdout().lock();
    if stdout
        .write_all(&output)
        .and_then(|()| stdout.flush())
        .is_err()
    {
        std::process::exit(2);
    }
}
