//! The program `aep-lattice-memory` across processes: two writers on one store, a
//! writer that is killed in the middle of its work and the round trip of every command.

use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::Path;
use std::process::{Command, Output, Stdio};

fn program() -> Command {
    Command::new(env!("CARGO_BIN_EXE_aep-lattice-memory"))
}

/// Run one command of the program with `input` on its standard input.
fn run(store: &Path, command: &str, input: &str) -> Output {
    let spawned = program()
        .arg("--store")
        .arg(store)
        .arg(command)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => panic!("the program does not start: {e}"),
    };
    if let Some(mut stdin) = child.stdin.take() {
        if let Err(e) = stdin.write_all(input.as_bytes()) {
            panic!("the program takes no input: {e}");
        }
    }
    match child.wait_with_output() {
        Ok(output) => output,
        Err(e) => panic!("the program does not end: {e}"),
    }
}

fn answer(output: &Output) -> Value {
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    match serde_json::from_slice(&output.stdout) {
        Ok(value) => value,
        Err(e) => panic!("the program printed no JSON: {e}"),
    }
}

fn line(writer: &str, serial: usize) -> String {
    json!({
        "id": format!("{writer}-{serial}"),
        "element_id": format!("agent-{writer}"),
        "domain": "admit.validation_engine",
        "result": if serial.is_multiple_of(5) { "rejected" } else { "accepted" },
        "timestamp": 1_795_000_000 + serial,
        "shape": {
            "type": "CUSTOM",
            "action_path": format!("action:step-{}", serial % 40),
            "agent_id": format!("agent-{writer}"),
            "payload": {"note": format!("work item number {serial} of writer {writer}")}
        }
    })
    .to_string()
}

#[test]
fn two_process_writers_no_key_collision() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    const EACH: usize = 400;
    let mut children = Vec::new();
    for writer in ["a", "b"] {
        let mut child = program()
            .arg("--store")
            .arg(&store)
            .arg("record-lines")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let feeder = std::thread::spawn(move || {
            for serial in 1..=EACH {
                writeln!(stdin, "{}", line(writer, serial)).unwrap();
                // A flush per line lets both writers reach the log in turns.
                stdin.flush().unwrap();
            }
        });
        children.push((child, feeder));
    }
    let mut keys = Vec::new();
    for (child, feeder) in children {
        feeder.join().unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let mut own = Vec::new();
        for text in String::from_utf8(output.stdout).unwrap().lines() {
            let receipt: Value = serde_json::from_str(text).unwrap();
            assert_eq!(receipt["ok"], json!(true));
            own.push(receipt["key"].as_i64().unwrap());
        }
        assert_eq!(own.len(), EACH);
        // The keys of one writer rise in the order of its writes.
        assert!(own.windows(2).all(|pair| pair[0] < pair[1]));
        keys.extend(own);
    }
    // No key was given out twice and none was left out.
    let distinct: BTreeSet<i64> = keys.iter().copied().collect();
    assert_eq!(distinct.len(), 2 * EACH);
    assert_eq!(distinct.first().copied(), Some(1));
    assert_eq!(distinct.last().copied(), Some(2 * EACH as i64));

    let verified = answer(&run(&store, "verify", ""));
    assert_eq!(verified["ok"], json!(true));
    assert_eq!(verified["records"], json!(2 * EACH));
    let health = answer(&run(&store, "health", ""));
    assert_eq!(health["records"], json!(2 * EACH));
    assert_eq!(health["attractors"], verified["attractors"]);
    // Every record of both writers is in the log once.
    let exported = answer(&run(&store, "export", r#"{"limit": 100000}"#));
    let ids: BTreeSet<String> = exported
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(ids.len(), 2 * EACH);
    for writer in ["a", "b"] {
        for serial in 1..=EACH {
            assert!(ids.contains(&format!("{writer}-{serial}")));
        }
    }
}

#[test]
fn a_killed_writer_leaves_the_store_consistent() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    for round in 0..6u64 {
        let mut child = program()
            .arg("--store")
            .arg(&store)
            .arg("record-lines")
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap();
        let mut stdin = child.stdin.take().unwrap();
        let feeder = std::thread::spawn(move || {
            // The writer is killed while lines still arrive, so the pipe breaks.
            for serial in 1..=200_000usize {
                let text = line(&format!("k{round}"), serial);
                if writeln!(stdin, "{text}").is_err() {
                    break;
                }
            }
        });
        std::thread::sleep(std::time::Duration::from_millis(40 + 35 * round));
        child.kill().unwrap();
        child.wait().unwrap();
        feeder.join().unwrap();

        // After the kill the store verifies and its health reads.
        let verified = answer(&run(&store, "verify", ""));
        assert_eq!(verified["ok"], json!(true), "round {round}");
        let health = answer(&run(&store, "health", ""));
        assert_eq!(health["records"], verified["records"], "round {round}");
        // The next writer takes the next key and the store still verifies.
        let receipt = answer(&run(&store, "record", &line(&format!("after{round}"), 1)));
        let records = verified["records"].as_i64().unwrap();
        assert_eq!(receipt["key"], json!(records + 1), "round {round}");
        let verified = answer(&run(&store, "verify", ""));
        assert_eq!(verified["records"], json!(records + 1), "round {round}");
    }
}

#[test]
fn every_command_round_trips() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    // Reads of a store that does not exist answer empty and make nothing.
    let health = answer(&run(&store, "health", ""));
    assert_eq!(health["present"], json!(false));
    let history = answer(&run(
        &store,
        "history",
        r#"{"domain":"intent","element_id":"INT-1"}"#,
    ));
    assert_eq!(history, json!([]));
    assert!(!store.exists());

    let knot = |id: &str, intent: &str, phase: &str, statement: &str| {
        json!({
            "id": id,
            "element_id": intent,
            "domain": "intent",
            "result": "accepted",
            "timestamp": "2026-11-20T19:20:40.123Z",
            "shape": {"kind": "intent_knot", "intent_id": intent, "statement": statement},
            "labels": {"kind": "intent_knot", "phase": phase},
            "body": {"statement": statement}
        })
        .to_string()
    };
    let first = answer(&run(
        &store,
        "record",
        &knot("ik-1", "INT-1", "propose", "rename the parser module"),
    ));
    assert_eq!(first["key"], json!(1));
    assert_eq!(first["attractor_key"], json!(1));
    let second = answer(&run(
        &store,
        "record",
        &knot("ik-2", "INT-1", "solidify", "rename the parser module"),
    ));
    assert_eq!(second["key"], json!(2));
    // The same shape reinforces the attractor of the first record.
    assert_eq!(second["attractor_key"], json!(1));
    answer(&run(
        &store,
        "record",
        &knot("ik-3", "INT-2", "propose", "delete the billing export job"),
    ));

    let history = answer(&run(
        &store,
        "history",
        r#"{"domain":"intent","element_id":"INT-1"}"#,
    ));
    let entries = history.as_array().unwrap();
    assert_eq!(entries.len(), 2);
    assert_eq!(entries[0]["labels"]["phase"], json!("propose"));
    assert_eq!(entries[1]["labels"]["phase"], json!("solidify"));
    assert_eq!(entries[0]["timestamp"], json!("2026-11-20T19:20:40Z"));
    assert_eq!(entries[0]["recorded_at_unix"], json!(1_795_202_440));
    assert_eq!(
        entries[0]["body"],
        json!({"statement": "rename the parser module"})
    );
    assert_eq!(entries[0]["result"], json!("accepted"));

    let count = answer(&run(
        &store,
        "count",
        r#"{"domain":"intent","element_id":"INT-1"}"#,
    ));
    assert_eq!(count, json!({"count": 2}));

    let search = answer(&run(
        &store,
        "search",
        r#"{"domain":"intent","limit":5,"shape":{"kind":"intent_knot","intent_id":"INT-1","statement":"rename the parser module"}}"#,
    ));
    let hits = search.as_array().unwrap();
    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0]["score"], json!(256));
    assert_eq!(hits[0]["similarity"], json!(1.0));
    assert_eq!(hits[0]["attractor"]["support"], json!(2));
    assert_eq!(hits[0]["entry"]["element_id"], json!("INT-1"));
    assert_eq!(hits[0]["entry"]["id"], json!("ik-2"));
    assert_eq!(hits[1]["entry"]["element_id"], json!("INT-2"));
    assert!(hits[1]["score"].as_i64().unwrap() < 230);
    let above = answer(&run(
        &store,
        "search",
        r#"{"domain":"intent","min_score":230,"shape":{"kind":"intent_knot","intent_id":"INT-1","statement":"rename the parser module"}}"#,
    ));
    assert_eq!(above.as_array().unwrap().len(), 1);

    let exported = answer(&run(&store, "export", r#"{"domain":"intent"}"#));
    assert_eq!(exported.as_array().unwrap().len(), 3);
    let health = answer(&run(&store, "health", ""));
    assert_eq!(health["present"], json!(true));
    assert_eq!(health["records"], json!(3));
    assert_eq!(health["attractors"], json!(2));
    assert_eq!(health["domains"][0]["domain"], json!("intent"));

    // A request that is refused ends with exit code 1 and writes no record.
    let refused = run(
        &store,
        "record",
        r#"{"id":"x","element_id":"e","domain":"intent","result":"accepted","shape":{},"embedding":[1.0,0.0]}"#,
    );
    assert_eq!(refused.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&refused.stderr).contains("operator embeddings are off"));
    let bad_time = run(
        &store,
        "record",
        r#"{"id":"x","element_id":"e","domain":"intent","result":"accepted","shape":{},"timestamp":"soon"}"#,
    );
    assert_eq!(bad_time.status.code(), Some(1));
    assert_eq!(answer(&run(&store, "health", ""))["records"], json!(3));
}

#[test]
fn operator_embeddings_need_the_dimension_of_the_store() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    let record = |id: &str, embedding: &str| {
        let input = format!(
            r#"{{"id":"{id}","element_id":"doc-1","domain":"ops","result":"accepted","shape":{{"doc":"{id}"}},"embedding":{embedding}}}"#
        );
        let mut child = program()
            .arg("--store")
            .arg(&store)
            .arg("--embedding-dim")
            .arg("4")
            .arg("record")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .unwrap();
        child.wait_with_output().unwrap()
    };
    assert_eq!(answer(&record("a", "[1.0,0.0,0.0,0.0]"))["key"], json!(1));
    let wrong = record("b", "[1.0,0.0,0.0]");
    assert_eq!(wrong.status.code(), Some(1));
    assert!(
        String::from_utf8_lossy(&wrong.stderr).contains("dimension mismatch: expected 4, got 3")
    );
    // The store keeps its dimension, so a search without the flag uses it.
    let hits = answer(&run(
        &store,
        "search",
        r#"{"domain":"ops","embedding":[0.99,0.1,0.0,0.0]}"#,
    ));
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert!(hits[0]["score"].as_i64().unwrap() > 15_323);
    let short = run(&store, "search", r#"{"domain":"ops","embedding":[1.0]}"#);
    assert_eq!(short.status.code(), Some(1));
    assert_eq!(answer(&run(&store, "health", ""))["records"], json!(1));
}
