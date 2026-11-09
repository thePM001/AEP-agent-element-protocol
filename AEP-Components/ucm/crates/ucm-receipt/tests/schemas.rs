//! Every receipt, the catalog and the JSON form of every vector program validate against the
//! public JSON Schemas in AEP-Base-Node/AEP-Registry/schemas.

use aep_ucm_core::{catalog_document, evaluate, load_program, Library, Limits};
use aep_ucm_receipt::{issue, NodeKey, ProgramSource};
use jsonschema::{Resource, Validator};
use serde_json::{json, Value};
use std::path::PathBuf;

fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../..")
}

fn schema(name: &str) -> Value {
    let p = root().join("AEP-Base-Node/AEP-Registry/schemas").join(name);
    serde_json::from_str(&std::fs::read_to_string(&p).expect("schema file")).expect("schema json")
}

fn validator(name: &str) -> Validator {
    let program = schema("ucm-program-v1.json");
    jsonschema::options()
        .with_resource(
            "https://aep.protocol.local/schemas/ucm-program-v1.json",
            Resource::from_contents(program).expect("resource"),
        )
        .build(&schema(name))
        .expect("compile schema")
}

fn assert_valid(v: &Validator, doc: &Value, what: &str) {
    let errs: Vec<String> = v
        .iter_errors(doc)
        .map(|e| format!("{} at {}", e, e.instance_path))
        .collect();
    assert!(
        errs.is_empty(),
        "{what} does not validate:\n{}",
        errs.join("\n")
    );
}

fn vector_programs() -> Vec<(String, Value, Value)> {
    let dir = root().join("AEP-Components/ucm/vectors");
    let mut out = Vec::new();
    let mut files: Vec<PathBuf> = std::fs::read_dir(&dir)
        .expect("vectors")
        .filter_map(|e| e.ok().map(|e| e.path()))
        .collect();
    files.sort();
    for f in files {
        let doc: Value =
            serde_json::from_str(&std::fs::read_to_string(&f).expect("read")).expect("json");
        for c in doc["cases"].as_array().expect("cases") {
            out.push((
                c["id"].as_str().unwrap_or("").to_string(),
                c["program"].clone(),
                c.get("inputs").cloned().unwrap_or(json!({})),
            ));
        }
    }
    out
}

#[test]
fn programs_receipts_and_catalog_validate() {
    let lib = Library::builtin().expect("lib");
    let key = NodeKey::generate();
    let pv = validator("ucm-program-v1.json");
    let rv = validator("ucm-receipt-v1.json");
    let cv = validator("ucm-catalog-v1.json");

    assert_valid(&cv, &catalog_document(&lib), "catalog");

    let mut receipts = 0;
    // Every program validates; every tenth one also gets a signed receipt, which keeps the
    // debug build test short since ML-DSA signing is slow without optimisation.
    for (n, (id, program, inputs)) in vector_programs().into_iter().enumerate() {
        let p = match &program {
            Value::String(t) => load_program(Some(t), None),
            j => load_program(None, Some(j)),
        };
        let Ok(p) = p else { continue };
        assert_valid(&pv, &p.to_json(), &format!("program {id}"));
        if n % 10 != 0 {
            continue;
        }
        if let Ok(o) = evaluate(&p, &inputs, Limits::DEFAULT, &lib) {
            let r = issue(&key, &p, &inputs, &o, &lib, ProgramSource::Agent).expect("issue");
            assert_valid(&rv, &r, &format!("receipt for {id}"));
            receipts += 1;
        }
    }
    for f in &lib.formulas {
        let v = &f.vectors[0];
        let o = evaluate(&f.program, &v["inputs"], Limits::DEFAULT, &lib).expect("formula");
        let r = issue(
            &key,
            &f.program,
            &v["inputs"],
            &o,
            &lib,
            ProgramSource::Library,
        )
        .expect("issue");
        assert_valid(&rv, &r, &format!("receipt for formula {}", f.id));
        receipts += 1;
    }
    assert!(receipts > 100, "only {receipts} receipts were checked");
    eprintln!("{receipts} receipts validated");
}
