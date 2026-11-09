//! Runs every conformance vector in AEP-Components/ucm/vectors and every vector that the
//! formula library ships. A vector names a program, its inputs and either the exact result
//! JSON or the error code.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    reason = "integration test crate: a failed unwrap here is a failed test"
)]

use aep_ucm_core::{evaluate, load_program, Library, Limits};
use serde_json::{json, Value};
use std::path::PathBuf;

fn vectors_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../vectors")
}

struct Case {
    suite: String,
    id: String,
    program: Value,
    inputs: Value,
    expect: Option<Value>,
    error: Option<String>,
}

fn load_cases() -> Vec<Case> {
    let mut out = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(vectors_dir())
        .expect("vectors dir")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .filter(|p| p.extension().and_then(|x| x.to_str()) == Some("json"))
        .collect();
    files.sort();
    for f in files {
        let v: Value =
            serde_json::from_str(&std::fs::read_to_string(&f).expect("read")).expect("json");
        assert_eq!(v["ucm"], "ucm-vectors-v1", "{f:?}");
        let suite = v["suite"].as_str().expect("suite").to_string();
        for c in v["cases"].as_array().expect("cases") {
            out.push(Case {
                suite: suite.clone(),
                id: c["id"].as_str().expect("id").to_string(),
                program: c["program"].clone(),
                inputs: c.get("inputs").cloned().unwrap_or(json!({})),
                expect: c.get("expect").cloned(),
                error: c
                    .get("error")
                    .and_then(|e| e.as_str())
                    .map(|e| e.to_string()),
            });
        }
    }
    out
}

fn run(lib: &Library, c: &Case) -> Result<(), String> {
    let prog = match &c.program {
        Value::String(t) => load_program(Some(t), None),
        j => load_program(None, Some(j)),
    };
    let got = prog.and_then(|p| evaluate(&p, &c.inputs, Limits::DEFAULT, lib));
    match (&c.expect, &c.error, got) {
        (Some(want), None, Ok(o)) => {
            let r = o.result_json();
            if &r == want {
                Ok(())
            } else {
                Err(format!("want {want} got {r}"))
            }
        }
        (None, Some(code), Err(e)) => {
            if e.code() == code {
                Ok(())
            } else {
                Err(format!("want error {code} got {} ({e})", e.code()))
            }
        }
        (Some(want), None, Err(e)) => Err(format!("want {want} got error {} ({e})", e.code())),
        (None, Some(code), Ok(o)) => Err(format!("want error {code} got {}", o.result_json())),
        _ => Err("a case needs exactly one of expect or error".into()),
    }
}

#[test]
fn conformance_vectors() {
    let lib = Library::builtin().expect("library");
    let cases = load_cases();
    let mut failures = Vec::new();
    for c in &cases {
        if let Err(e) = run(&lib, c) {
            failures.push(format!("{}/{}: {e}", c.suite, c.id));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} vectors failed:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
    eprintln!("{} conformance vectors passed", cases.len());
}

#[test]
fn library_vectors() {
    let lib = Library::builtin().expect("library");
    let mut n = 0;
    let mut failures = Vec::new();
    for f in &lib.formulas {
        assert!(!f.vectors.is_empty(), "formula {} has no vectors", f.id);
        for (i, v) in f.vectors.iter().enumerate() {
            n += 1;
            let c = Case {
                suite: "library".into(),
                id: format!("{}#{i}", f.id),
                program: Value::String(f.program_text.clone()),
                inputs: v["inputs"].clone(),
                expect: Some(v["expect"].clone()),
                error: None,
            };
            if let Err(e) = run(&lib, &c) {
                failures.push(format!("{}: {e}", c.id));
            }
        }
    }
    for k in &lib.constants {
        assert!(!k.citation.is_empty(), "constant {} has no citation", k.id);
    }
    assert!(
        failures.is_empty(),
        "library vectors failed:\n{}",
        failures.join("\n")
    );
    eprintln!("{n} library vectors passed");
}
