//! One gate: exactly one place starts runsc and exactly one place calls it.
//!
//! The CAW starts a sandbox only after the kernel dock admitted the run and the audit
//! log took the start event. That holds only while no second path to runsc exists, so
//! this test reads the source of the crate and counts the call sites.

#![allow(clippy::expect_used)]

use std::fs;
use std::path::Path;

/// The source of every file below `src`, with the test modules cut off.
fn product_sources() -> Vec<(String, String)> {
    let dir = Path::new(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut out = Vec::new();
    for entry in fs::read_dir(&dir).expect("src folder") {
        let path = entry.expect("entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let text = fs::read_to_string(&path).expect("source");
        let product = text.split("#[cfg(test)]").next().unwrap_or("").to_string();
        let name = path
            .file_name()
            .expect("name")
            .to_string_lossy()
            .into_owned();
        out.push((name, product));
    }
    out.sort();
    out
}

fn count(sources: &[(String, String)], needle: &str) -> Vec<(String, usize)> {
    sources
        .iter()
        .map(|(name, text)| (name.clone(), text.matches(needle).count()))
        .filter(|(_, hits)| *hits > 0)
        .collect()
}

#[test]
fn exactly_one_place_starts_a_program_on_the_host() {
    let sources = product_sources();
    assert_eq!(
        count(&sources, "Command::new("),
        vec![("sandbox.rs".to_string(), 1)],
        "runsc is the only program the runtime starts and it starts it in one place"
    );
    assert!(count(&sources, ".spawn()")
        .iter()
        .all(|(name, hits)| name == "sandbox.rs" && *hits == 1));
}

#[test]
fn exactly_one_place_calls_the_sandbox_and_it_is_the_gate() {
    let sources = product_sources();
    assert_eq!(
        count(&sources, "= run(\n"),
        vec![("session.rs".to_string(), 1)],
        "only the gate of the session calls the sandbox"
    );
    let (_, session) = sources
        .iter()
        .find(|(name, _)| name == "session.rs")
        .expect("session.rs");
    let admit = session
        .find("gate.admit(")
        .expect("the gate asks the kernel dock");
    let start_event = session
        .find("\"kind\": \"start\"")
        .expect("the gate writes the start event");
    let sandbox = session
        .find("= run(\n")
        .expect("the gate starts the sandbox");
    assert!(
        admit < start_event && start_event < sandbox,
        "the order is: kernel dock, start event, sandbox"
    );
}

#[test]
fn the_sandbox_function_is_not_reachable_from_outside_the_gate_by_name() {
    let sources = product_sources();
    let callers = count(&sources, "sandbox::run");
    assert!(
        callers.iter().all(|(name, _)| name == "session.rs"),
        "{callers:?}"
    );
}
