//! The program `aep-lattice-memory` across processes: two writers on one store, a
//! writer that is killed in the middle of its work, the round trip of every command,
//! what one call costs and what a verification reports.

use aep_lattice_memory::{
    CoreConfig, Fingerprint, LogBackend, MemoryBackend, NewRecord, OpenOptionsLog, SimHash,
    LOG_SUFFIX, SNAPSHOT_SUFFIX,
};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
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

/// The text a refused command wrote to standard error. The command must end with
/// exit code 1.
fn refused(output: &Output) -> String {
    assert_eq!(
        output.status.code(),
        Some(1),
        "{}",
        String::from_utf8_lossy(&output.stdout)
    );
    String::from_utf8_lossy(&output.stderr).to_string()
}

fn line_in(domain: &str, writer: &str, serial: usize) -> String {
    json!({
        "id": format!("{writer}-{serial}"),
        "element_id": format!("agent-{writer}"),
        "domain": domain,
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

fn line(writer: &str, serial: usize) -> String {
    line_in("work", writer, serial)
}

/// Write many records through one call of `record-lines`.
fn write_lines(store: &Path, lines: impl Iterator<Item = String> + Send + 'static) -> usize {
    let spawned = program()
        .arg("--store")
        .arg(store)
        .arg("record-lines")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn();
    let mut child = match spawned {
        Ok(child) => child,
        Err(e) => panic!("the program does not start: {e}"),
    };
    let Some(mut stdin) = child.stdin.take() else {
        panic!("the program has no standard input");
    };
    let feeder = std::thread::spawn(move || {
        for text in lines {
            if let Err(e) = writeln!(stdin, "{text}") {
                panic!("the program takes no input: {e}");
            }
        }
    });
    let output = match child.wait_with_output() {
        Ok(output) => output,
        Err(e) => panic!("the program does not end: {e}"),
    };
    if feeder.join().is_err() {
        panic!("the feeder of the program failed");
    }
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8_lossy(&output.stdout).lines().count()
}

/// Every record a history or export request names, read page by page.
fn every_page(store: &Path, command: &str, request: &Value) -> (Vec<Value>, usize) {
    let mut records = Vec::new();
    let mut pages = 0;
    let mut request = request.clone();
    loop {
        let page = answer(&run(store, command, &request.to_string()));
        pages += 1;
        let Some(found) = page["records"].as_array() else {
            panic!("the page holds no list of records: {page}");
        };
        records.extend(found.iter().cloned());
        match page["next"].as_str() {
            Some(next) => request["after"] = json!(next),
            None => {
                assert_eq!(page["next"], Value::Null);
                return (records, pages);
            }
        }
    }
}

/// The length and the change time of a file.
fn stamp(path: &Path) -> (u64, std::time::SystemTime) {
    let meta = match std::fs::metadata(path) {
        Ok(meta) => meta,
        Err(e) => panic!("{} has no metadata: {e}", path.display()),
    };
    match meta.modified() {
        Ok(changed) => (meta.len(), changed),
        Err(e) => panic!("{} has no change time: {e}", path.display()),
    }
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
    let (exported, _) = every_page(&store, "export", &json!({"limit": 300}));
    let ids: BTreeSet<String> = exported
        .iter()
        .map(|r| r["id"].as_str().unwrap().to_string())
        .collect();
    assert_eq!(exported.len(), 2 * EACH);
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

        // After the kill the health reads every whole record. A write the kill cut
        // short is no record. The next writer cuts it off and takes the next key.
        let health = answer(&run(&store, "health", ""));
        let records = health["records"].as_i64().unwrap();
        let receipt = answer(&run(&store, "record", &line(&format!("after{round}"), 1)));
        assert_eq!(receipt["key"], json!(records + 1), "round {round}");
        // The store verifies: no whole record was lost and none was changed.
        let verified = answer(&run(&store, "verify", ""));
        assert_eq!(verified["ok"], json!(true), "round {round}");
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
    assert_eq!(history, json!({"records": [], "next": null}));
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
    assert_eq!(history["next"], Value::Null);
    let entries = history["records"].as_array().unwrap();
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
    // A page of one record names the place of the next page.
    let page = answer(&run(
        &store,
        "history",
        r#"{"domain":"intent","element_id":"INT-1","limit":1}"#,
    ));
    assert_eq!(page["records"].as_array().unwrap().len(), 1);
    let next = page["next"].as_str().unwrap().to_string();
    let rest = answer(&run(
        &store,
        "history",
        &json!({"domain": "intent", "element_id": "INT-1", "limit": 1, "after": next}).to_string(),
    ));
    assert_eq!(rest["records"][0]["id"], json!("ik-2"));
    assert_eq!(rest["next"], Value::Null);
    // A place that no page named is refused.
    let bad = run(
        &store,
        "history",
        r#"{"domain":"intent","element_id":"INT-1","after":"intent:1:13"}"#,
    );
    assert!(refused(&bad).contains("after"));

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
    assert_eq!(exported["records"].as_array().unwrap().len(), 3);
    assert_eq!(exported["next"], Value::Null);
    let health = answer(&run(&store, "health", ""));
    assert_eq!(health["present"], json!(true));
    assert_eq!(health["records"], json!(3));
    assert_eq!(health["attractors"], json!(2));
    assert_eq!(health["domains"][0]["domain"], json!("intent"));

    // A request that is refused ends with exit code 1 and writes no record.
    let embedded = run(
        &store,
        "record",
        r#"{"id":"x","element_id":"e","domain":"intent","result":"accepted","shape":{},"embedding":[1.0,0.0]}"#,
    );
    assert!(refused(&embedded).contains("operator embeddings are off"));
    let bad_time = run(
        &store,
        "record",
        r#"{"id":"x","element_id":"e","domain":"intent","result":"accepted","shape":{},"timestamp":"soon"}"#,
    );
    refused(&bad_time);
    assert_eq!(answer(&run(&store, "health", ""))["records"], json!(3));
}

#[test]
fn the_program_writes_no_record_into_a_domain_of_judged_proposals() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    answer(&run(&store, "record", &line("a", 1)));
    for domain in ["admit", "admit.validation_engine", "admit.other"] {
        let single = run(&store, "record", &line_in(domain, "forger", 1));
        assert!(
            refused(&single).contains("only the Base Node writes there"),
            "{domain}"
        );
        let many = run(
            &store,
            "record-lines",
            &format!("{}\n", line_in(domain, "forger", 2)),
        );
        assert!(
            refused(&many).contains("only the Base Node writes there"),
            "{domain}"
        );
        assert!(!store.join(format!("{domain}{LOG_SUFFIX}")).exists());
    }
    // A domain whose name only starts with the same letters is no judged domain.
    answer(&run(&store, "record", &line_in("admitted", "a", 1)));
    assert_eq!(answer(&run(&store, "health", ""))["records"], json!(2));
}

#[test]
fn the_verdicts_of_a_port_are_read_in_pages() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    // The Base Node writes the judged domains through the library.
    {
        let mut node =
            LogBackend::open(&store, OpenOptionsLog::new(CoreConfig::default())).unwrap();
        for serial in 1..=7u64 {
            let accepted = serial % 3 != 0;
            let mut labels = BTreeMap::new();
            labels.insert(
                String::from("verdict"),
                String::from(if accepted { "allow" } else { "deny" }),
            );
            if !accepted {
                labels.insert(
                    String::from("closed"),
                    String::from("writing:no_oxford_comma,temporal:drift"),
                );
            }
            node.record(&NewRecord {
                entry_id: format!("frame-{serial}"),
                domain: String::from("admit.validation_engine"),
                element_id: format!("agent-{}", serial % 2),
                accepted,
                recorded_at_unix: 1_795_000_000 + serial as i64,
                shape_digest: [serial as u8; 32],
                fingerprint: Fingerprint::SimHash(SimHash([serial, !serial, serial << 9, 7])),
                labels,
                body: None,
            })
            .unwrap();
        }
    }
    let all = answer(&run(&store, "verdicts", r#"{"port":"validation_engine"}"#));
    assert_eq!(all["domain"], json!("admit.validation_engine"));
    assert_eq!(all["next"], Value::Null);
    let verdicts = all["records"].as_array().unwrap();
    assert_eq!(verdicts.len(), 7);
    assert_eq!(verdicts[0]["verdict"], json!("allow"));
    assert_eq!(verdicts[0]["frame"], json!("frame-1"));
    assert_eq!(verdicts[0]["agent_id"], json!("agent-1"));
    assert_eq!(verdicts[0]["closed"], json!([]));
    assert_eq!(verdicts[2]["verdict"], json!("deny"));
    assert_eq!(
        verdicts[2]["closed"],
        json!(["writing:no_oxford_comma", "temporal:drift"])
    );
    assert_eq!(verdicts[2]["attractor_key"], Value::Null);
    let denies = answer(&run(
        &store,
        "verdicts",
        r#"{"port":"validation_engine","verdict":"deny"}"#,
    ));
    assert_eq!(denies["records"].as_array().unwrap().len(), 2);
    let (of_agent, pages) = every_page(
        &store,
        "verdicts",
        &json!({"port": "validation_engine", "agent_id": "agent-1", "limit": 3}),
    );
    assert_eq!(of_agent.len(), 4);
    assert_eq!(pages, 2);
    let none = answer(&run(&store, "verdicts", r#"{"port":"inference_engine"}"#));
    assert_eq!(none["records"], json!([]));
    assert!(refused(&run(
        &store,
        "verdicts",
        r#"{"port":"validation_engine","verdict":"maybe"}"#
    ))
    .contains("allow or deny"));
}

#[test]
fn a_call_that_adds_one_record_writes_no_snapshot_and_opens_one_domain() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    assert_eq!(
        write_lines(&store, (1..=3000).map(|serial| line("bulk", serial))),
        3000
    );
    assert_eq!(
        write_lines(
            &store,
            (1..=20).map(|serial| line_in("other", "bulk", serial))
        ),
        20
    );
    let snapshot = store.join(format!("work{SNAPSHOT_SUFFIX}"));
    let log = store.join(format!("work{LOG_SUFFIX}"));
    let before = (stamp(&snapshot), std::fs::read(&snapshot).unwrap());
    let log_before = stamp(&log).0;
    let other = stamp(&store.join(format!("other{SNAPSHOT_SUFFIX}")));

    // One record more: the log grows by one frame and no snapshot is written.
    let receipt = answer(&run(&store, "record", &line("one", 1)));
    assert_eq!(receipt["key"], json!(3001));
    assert!(stamp(&log).0 > log_before);
    assert_eq!(
        (stamp(&snapshot), std::fs::read(&snapshot).unwrap()),
        before,
        "the call wrote the snapshot again"
    );
    assert_eq!(stamp(&store.join(format!("other{SNAPSHOT_SUFFIX}"))), other);
    // No scratch file of a snapshot is left in the folder.
    let names: BTreeSet<String> = std::fs::read_dir(&store)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
        .collect();
    assert_eq!(names.len(), 5, "{names:?}");

    // The log of the other domain is damaged. A call on `work` does not read it.
    let other_log = store.join(format!("other{LOG_SUFFIX}"));
    let mut bytes = std::fs::read(&other_log).unwrap();
    let at = bytes.len() / 2;
    bytes[at] ^= 0xff;
    std::fs::write(&other_log, &bytes).unwrap();
    assert_eq!(
        answer(&run(&store, "record", &line("one", 2)))["key"],
        json!(3002)
    );
    let history = answer(&run(
        &store,
        "history",
        r#"{"domain":"work","element_id":"agent-one"}"#,
    ));
    assert_eq!(history["records"].as_array().unwrap().len(), 2);
    assert_eq!(
        answer(&run(
            &store,
            "count",
            r#"{"domain":"work","element_id":"agent-bulk"}"#
        )),
        json!({"count": 3000})
    );
    let hits = answer(&run(
        &store,
        "search",
        r#"{"domain":"work","limit":1,"shape":{"type":"CUSTOM","action_path":"action:step-1","agent_id":"agent-one","payload":{"note":"work item number 1 of writer one"}}}"#,
    ));
    assert_eq!(hits[0]["score"], json!(256));
    let (exported, _) = every_page(&store, "export", &json!({"domain": "work", "limit": 1000}));
    assert_eq!(exported.len(), 3002);
    // A question about every domain meets the damage and says so.
    refused(&run(&store, "export", "{}"));
    refused(&run(&store, "verify", ""));
    assert_eq!(std::fs::read(&other_log).unwrap(), bytes);
}

#[test]
fn a_verification_reports_a_changed_bit_and_a_cut_log() {
    let scratch = tempfile::tempdir().unwrap();
    // A store whose last frame holds one changed bit.
    let flipped = scratch.path().join("flipped");
    write_lines(&flipped, (1..=40).map(|serial| line("a", serial)));
    answer(&run(&flipped, "verify", ""));
    let log = flipped.join(format!("work{LOG_SUFFIX}"));
    let mut bytes = std::fs::read(&log).unwrap();
    let at = bytes.len() - 60;
    bytes[at] ^= 0x04;
    std::fs::write(&log, &bytes).unwrap();
    assert!(refused(&run(&flipped, "verify", "")).contains("does not hash"));
    assert_eq!(std::fs::read(&log).unwrap(), bytes);
    // A writer that replays the log reports the change too and cuts nothing off. With
    // the snapshot in place a writer reads no frame the snapshot covers, so the
    // verification is the check that reads every frame.
    std::fs::remove_file(flipped.join(format!("work{SNAPSHOT_SUFFIX}"))).unwrap();
    assert!(refused(&run(&flipped, "record", &line("b", 1))).contains("does not hash"));
    assert_eq!(std::fs::read(&log).unwrap(), bytes);

    // A store whose log is cut at a frame boundary. Five single writes leave a
    // snapshot of all five records. The sizes of the log after each write are the
    // frame boundaries.
    let cut = scratch.path().join("cut");
    let log = cut.join(format!("work{LOG_SUFFIX}"));
    let mut boundaries = Vec::new();
    for serial in 1..=5 {
        answer(&run(&cut, "record", &line("a", serial)));
        boundaries.push(std::fs::metadata(&log).unwrap().len());
    }
    answer(&run(&cut, "verify", ""));
    let whole = std::fs::read(&log).unwrap();
    let shorter = &whole[..boundaries[2] as usize];
    std::fs::write(&log, shorter).unwrap();
    assert!(refused(&run(&cut, "verify", "")).contains("shorter than its snapshot"));
    assert!(refused(&run(&cut, "record", &line("b", 1))).contains("shorter than its snapshot"));
    assert_eq!(std::fs::read(&log).unwrap(), shorter);

    // A log that ends in a part of a frame: the next writer cuts the part off, and
    // until then a verification names it.
    let torn = scratch.path().join("torn");
    for serial in 1..=5 {
        answer(&run(&torn, "record", &line("a", serial)));
    }
    let log = torn.join(format!("work{LOG_SUFFIX}"));
    let whole = std::fs::read(&log).unwrap();
    let mut with_part = whole.clone();
    with_part.extend_from_slice(&whole[12..40]);
    std::fs::write(&log, &with_part).unwrap();
    assert!(refused(&run(&torn, "verify", "")).contains("not whole"));
    assert_eq!(answer(&run(&torn, "health", ""))["records"], json!(5));
    assert_eq!(
        answer(&run(&torn, "record", &line("b", 1)))["key"],
        json!(6)
    );
    assert_eq!(answer(&run(&torn, "verify", ""))["records"], json!(6));
}

/// One checkpoint of a graph run as the Graph Engine writes it.
fn checkpoint(run_id: &str, index: usize) -> String {
    let history: Vec<String> = (index.saturating_sub(40)..index)
        .map(|step| format!("node-{step}"))
        .collect();
    json!({
        "id": format!("cp-{run_id}-{index}"),
        "element_id": run_id,
        "domain": "graph",
        "result": "accepted",
        "timestamp": 1_795_000_000 + index,
        "shape": {"kind": "graph_checkpoint", "node_id": format!("node-{index}"), "history": history},
        "labels": {"kind": "graph_checkpoint", "node_id": format!("node-{index}")},
        "body": {
            "nodeId": format!("node-{index}"),
            "timestamp": 1_795_000_000 + index,
            "context": {"input": {"n": index}, "variables": {}, "history": history},
            "vectorClock": {"graph-engine": index + 1}
        }
    })
    .to_string()
}

#[test]
fn a_graph_run_of_10000_checkpoints_is_read_back_in_pages() {
    let scratch = tempfile::tempdir().unwrap();
    let store = scratch.path().join("store");
    const RUN: usize = 10_000;
    // A second run lies between the checkpoints of the first.
    let lines = (0..RUN).flat_map(|index| {
        let mut both = vec![checkpoint("run-long", index)];
        if index % 50 == 0 {
            both.push(checkpoint("run-other", index));
        }
        both
    });
    assert_eq!(write_lines(&store, lines), RUN + RUN / 50);

    // One request for the whole run gets a page of a bounded size and the place of
    // the next page, where the store before this one answered with the whole run.
    let whole_run = json!({"domain": "graph", "element_id": "run-long", "limit": 1_000_000});
    let first = run(&store, "history", &whole_run.to_string());
    assert!(
        first.stdout.len() < 16 * 1024 * 1024,
        "one answer holds {} bytes",
        first.stdout.len()
    );
    let first = answer(&first);
    assert!(first["records"].as_array().unwrap().len() < RUN);
    assert!(first["next"].is_string());

    // Read in pages, the run comes back whole and in order.
    let (records, pages) = every_page(
        &store,
        "history",
        &json!({"domain": "graph", "element_id": "run-long", "limit": 500}),
    );
    assert_eq!(pages, RUN / 500);
    assert_eq!(records.len(), RUN);
    for (index, record) in records.iter().enumerate() {
        assert_eq!(record["body"]["nodeId"], json!(format!("node-{index}")));
        assert_eq!(record["element_id"], json!("run-long"));
    }
    // The last checkpoint holds what a resumed run needs.
    let last = &records[RUN - 1]["body"];
    assert_eq!(last["vectorClock"]["graph-engine"], json!(RUN));
    assert_eq!(last["context"]["history"][39], json!("node-9998"));
    assert_eq!(
        answer(&run(
            &store,
            "count",
            r#"{"domain":"graph","element_id":"run-long"}"#
        )),
        json!({"count": RUN})
    );
    // A bound on the bytes of a page holds also when the limit is large.
    let small = answer(&run(
        &store,
        "history",
        &json!({"domain": "graph", "element_id": "run-long", "limit": 1_000_000, "max_bytes": 20_000})
            .to_string(),
    ));
    assert!(small["records"].as_array().unwrap().len() < 40);
    assert!(small["next"].is_string());
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
    assert!(refused(&wrong).contains("dimension mismatch: expected 4, got 3"));
    // The store keeps its dimension, so a search without the flag uses it.
    let hits = answer(&run(
        &store,
        "search",
        r#"{"domain":"ops","embedding":[0.99,0.1,0.0,0.0]}"#,
    ));
    assert_eq!(hits.as_array().unwrap().len(), 1);
    assert!(hits[0]["score"].as_i64().unwrap() > 15_323);
    let short = run(&store, "search", r#"{"domain":"ops","embedding":[1.0]}"#);
    refused(&short);
    assert_eq!(answer(&run(&store, "health", ""))["records"], json!(1));
}
