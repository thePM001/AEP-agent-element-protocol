//! Red team set for policy ucm-computed-claims, run through the real Admit wall compiler
//! over AEP-Policy-System. Every attack must close a UCM wall under the strict profile, the
//! honest action must pass. Admit must decide exactly as before for actions that name
//! no computed field. One test function, because the profile is process wide.

use aep_lattice_crypto as _;
use aep_policy_system_admit::{
    compile_policy_system_walls_from, policy_wall_id, PolicySystemCompileInput,
};
use aep_ucm_core::{canon, evaluate, load_program, Library, Limits};
use aep_ucm_receipt::{issue, NodeKey, ProgramSource};
use serde_json::{json, Value};
use std::path::PathBuf;

const STEM: &str = "ucm-computed-claims";
const SLUGS: [&str; 3] = [
    "ucm_receipt_present",
    "ucm_receipt_valid",
    "ucm_result_matches",
];

fn policy_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../AEP-Policy-System")
}

fn walls(event: &Value, wrap: &str) -> Vec<(String, bool)> {
    let input = PolicySystemCompileInput {
        event: event.clone(),
        wrap: wrap.to_string(),
        action_path: "finance:invoice.total".into(),
        ..Default::default()
    };
    compile_policy_system_walls_from(Some(&policy_dir()), &input)
        .into_iter()
        .map(|w| (w.id, w.closed))
        .collect()
}

fn ucm_closed(event: &Value, wrap: &str) -> Vec<String> {
    let ids: Vec<String> = SLUGS.iter().map(|s| policy_wall_id(STEM, s)).collect();
    walls(event, wrap)
        .into_iter()
        .filter(|(id, closed)| *closed && ids.contains(id))
        .map(|(id, _)| id)
        .collect()
}

fn receipt(key: &NodeKey, src: &str, inputs: Value, source: ProgramSource) -> Value {
    let lib = Library::builtin().expect("lib");
    let p = load_program(Some(src), None).expect("program");
    let o = evaluate(&p, &inputs, Limits::DEFAULT, &lib).expect("eval");
    issue(key, &p, &inputs, &o, &lib, source).expect("issue")
}

fn action(fields: &[&str], values: Value, receipts: Value) -> Value {
    let mut payload = values;
    payload["ucm"] = json!({ "computed_fields": fields, "receipts": receipts });
    json!({ "type": "INVOICE", "payload": payload })
}

/// Recompute the receipt id and digests after an edit, as a forger without the key would.
fn reseal_without_key(mut r: Value) -> Value {
    r["result_digest"] = Value::String(canon::digest(&r["result"]).expect("d"));
    let mut body = r.as_object().expect("o").clone();
    body.remove("receipt_id");
    body.remove("signature");
    let id = canon::digest(&Value::Object(body)).expect("d");
    r["receipt_id"] = Value::String(format!("ucmr_{}", &id[..32]));
    r
}

#[test]
fn red_team_and_unchanged_admit() {
    let key = NodeKey::generate();
    let other = NodeKey::generate();
    let dir = std::env::temp_dir().join(format!("ucm-redteam-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("dir");
    let trusted = dir.join("trusted.txt");
    std::fs::write(
        &trusted,
        format!("# trusted UCM nodes\n{}\n", key.public_hex),
    )
    .expect("trusted");
    std::env::set_var("AEP_UCM_TRUSTED_KEYS", &trusted);

    let total_src = "input p: money[EUR];\ninput n: int;\nround(p * n * 1.081, 2, \"half_even\")";
    let good = receipt(
        &key,
        total_src,
        json!({ "p": "19.90 EUR", "n": "3" }),
        ProgramSource::Agent,
    );
    assert_eq!(good["result"]["decimal"], "64.54");
    let tax = receipt(
        &key,
        "round(money(\"59.70\", \"EUR\") * 0.081, 2, \"half_even\")",
        json!({}),
        ProgramSource::Agent,
    );
    let stale = receipt(
        &key,
        "money(\"10.00\", \"EUR\")",
        json!({}),
        ProgramSource::Agent,
    );
    let stranger = receipt(
        &other,
        total_src,
        json!({ "p": "19.90 EUR", "n": "3" }),
        ProgramSource::Agent,
    );
    let echo = receipt(&key, "\"64.54\"", json!({}), ProgramSource::Agent);
    let honest = action(
        &["/total"],
        json!({ "total": "64.54" }),
        json!({ "/total": good }),
    );

    // Profile off: the policy closes nothing, even for an attack.
    std::env::set_var("AEP_UCM_RECEIPT_PROFILE", "off");
    let attack = action(
        &["/total"],
        json!({ "total": "99.00" }),
        json!({ "/total": good }),
    );
    assert!(ucm_closed(&attack, "").is_empty());

    // Admit is unchanged for actions with no computed field, in every profile.
    let plain = [
        json!({ "type": "PING", "payload": { "note": "hello" } }),
        json!({ "type": "INVOICE", "payload": { "total": "64.54", "customer": "acme" } }),
        json!({ "type": "INVOICE", "payload": { "total": "64.54", "ucm": { "receipts": {} } } }),
        json!({ "type": "DEPLOY", "payload": { "deployment_attempt": true } }),
    ];
    let before: Vec<Vec<(String, bool)>> = plain.iter().map(|e| walls(e, "")).collect();
    for p in ["warn", "strict"] {
        std::env::set_var("AEP_UCM_RECEIPT_PROFILE", p);
        let after: Vec<Vec<(String, bool)>> = plain.iter().map(|e| walls(e, "")).collect();
        assert_eq!(
            before, after,
            "profile {p} changed Admit for actions without computed fields"
        );
    }

    std::env::set_var("AEP_UCM_RECEIPT_PROFILE", "strict");
    assert!(
        ucm_closed(&honest, "").is_empty(),
        "the honest action must pass: {:?}",
        ucm_closed(&honest, "")
    );
    let two = action(
        &["/total", "/tax"],
        json!({ "total": "64.54", "tax": "4.84" }),
        json!({ "/total": good, "/tax": tax }),
    );
    assert!(
        ucm_closed(&two, "").is_empty(),
        "two honest fields must pass: {:?}",
        ucm_closed(&two, "")
    );

    let edit = |f: &dyn Fn(&mut Value)| -> Value {
        let mut r = good.clone();
        f(&mut r);
        r
    };
    let one = |r: Value, total: Value| {
        action(
            &["/total"],
            json!({ "total": total }),
            json!({ "/total": r }),
        )
    };

    let mut attacks: Vec<(&str, Value, &str)> = vec![
        (
            "no receipt",
            action(&["/total"], json!({ "total": "64.54" }), json!({})),
            "ucm_receipt_present",
        ),
        (
            "receipts missing",
            json!({ "type": "INVOICE", "payload": { "total": "64.54", "ucm": { "computed_fields": ["/total"] } } }),
            "ucm_receipt_present",
        ),
        (
            "receipts not an object",
            json!({ "type": "INVOICE", "payload": { "total": "64.54", "ucm": { "computed_fields": ["/total"], "receipts": "x" } } }),
            "ucm_receipt_present",
        ),
        (
            "receipt under a wrong pointer",
            action(
                &["/total"],
                json!({ "total": "64.54" }),
                json!({ "/sum": good }),
            ),
            "ucm_receipt_present",
        ),
        (
            "receipt is an id string",
            one(
                json!("ucmr_00000000000000000000000000000000"),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "result decimal edited",
            one(
                edit(&|r| r["result"]["decimal"] = json!("99.00")),
                json!("99.00"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "result value edited",
            one(edit(&|r| r["result"]["value"] = json!("99")), json!("99")),
            "ucm_receipt_valid",
        ),
        (
            "result resealed without key",
            one(
                reseal_without_key(edit(
                    &|r| r["result"] = json!({ "type": "money", "currency": "EUR", "value": "99", "decimal": "99" }),
                )),
                json!("99"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "receipt id edited",
            one(
                edit(&|r| r["receipt_id"] = json!("ucmr_11111111111111111111111111111111")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "signature removed",
            one(
                edit(&|r| {
                    r.as_object_mut().expect("o").remove("signature");
                }),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "signature garbage",
            one(
                edit(&|r| r["signature"] = json!("00ff00ff")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "signature not hex",
            one(edit(&|r| r["signature"] = json!("zz")), json!("64.54")),
            "ucm_receipt_valid",
        ),
        (
            "public key swapped to the trusted key",
            one(
                reseal_without_key({
                    let mut r = stranger.clone();
                    r["public_key"] = json!(key.public_hex);
                    r["node_id"] = json!(key.node_id);
                    r
                }),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "node id edited",
            one(
                edit(&|r| r["node_id"] = json!("ucm-node-0000000000000000")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "inputs edited",
            one(
                edit(&|r| r["inputs"]["p"] = json!("29.90 EUR")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "input digest edited",
            one(
                edit(&|r| r["input_digest"] = json!("00".repeat(32))),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "program edited",
            one(
                edit(&|r| r["program"]["inputs"] = json!([])),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "program hash edited",
            one(
                edit(&|r| r["program_hash"] = json!("00".repeat(32))),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "unknown field added",
            one(edit(&|r| r["approved_by"] = json!("cfo")), json!("64.54")),
            "ucm_receipt_valid",
        ),
        (
            "schema tag edited",
            one(
                edit(&|r| r["ucm"] = json!("ucm-receipt-v2")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "float flag flipped",
            one(edit(&|r| r["float_used"] = json!("true")), json!("64.54")),
            "ucm_receipt_valid",
        ),
        (
            "source flipped to library",
            one(
                edit(&|r| r["program_source"] = json!("library")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "engine build edited",
            one(
                edit(&|r| r["engine_build"] = json!("aep-ucm/9.9.9")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "issue time edited",
            one(
                edit(&|r| r["issued_at"] = json!("2020-01-01T00:00:00Z")),
                json!("64.54"),
            ),
            "ucm_receipt_valid",
        ),
        (
            "untrusted signer",
            one(stranger.clone(), json!("64.54")),
            "ucm_receipt_valid",
        ),
        (
            "field differs from result",
            one(good.clone(), json!("65.00")),
            "ucm_result_matches",
        ),
        (
            "field in another currency",
            one(good.clone(), json!("64.54 USD")),
            "ucm_result_matches",
        ),
        (
            "field as a wrong JSON number",
            one(good.clone(), json!(64.55)),
            "ucm_result_matches",
        ),
        (
            "field as an object of another type",
            one(good.clone(), json!({ "type": "decimal", "value": "64.54" })),
            "ucm_result_matches",
        ),
        (
            "stale receipt from another calculation",
            one(stale.clone(), json!("64.54")),
            "ucm_result_matches",
        ),
        (
            "receipts swapped between fields",
            action(
                &["/total", "/tax"],
                json!({ "total": "64.54", "tax": "4.84" }),
                json!({ "/total": tax, "/tax": good }),
            ),
            "ucm_result_matches",
        ),
        (
            "text echo program",
            one(echo.clone(), json!("64.54")),
            "ucm_result_matches",
        ),
    ];
    attacks.push((
        "agent program in a library only wrap",
        honest.clone(),
        "ucm_receipt_valid",
    ));

    let mut failures = Vec::new();
    for (name, event, want) in &attacks {
        let wrap = if *name == "agent program in a library only wrap" {
            "payroll"
        } else {
            ""
        };
        if wrap == "payroll" {
            std::env::set_var("AEP_UCM_LIBRARY_ONLY_WRAPS", "payroll");
        }
        let closed = ucm_closed(event, wrap);
        std::env::remove_var("AEP_UCM_LIBRARY_ONLY_WRAPS");
        let want_id = policy_wall_id(STEM, want);
        if !closed.contains(&want_id) {
            failures.push(format!("{name}: want {want} closed, closed {closed:?}"));
        }
    }
    assert!(
        failures.is_empty(),
        "{} of {} attacks passed Admit:\n{}",
        failures.len(),
        attacks.len(),
        failures.join("\n")
    );
    assert!(
        attacks.len() >= 30,
        "the red team set needs at least 30 cases"
    );

    // Replay mode passes the honest receipt and refuses one whose budget is above the cap.
    std::env::set_var("AEP_UCM_RECEIPT_VERIFY", "replay");
    assert!(ucm_closed(&honest, "").is_empty());
    std::env::remove_var("AEP_UCM_RECEIPT_VERIFY");

    // Warn reports but closes nothing.
    std::env::set_var("AEP_UCM_RECEIPT_PROFILE", "warn");
    assert!(ucm_closed(&attacks[0].1, "").is_empty());
    std::env::set_var("AEP_UCM_RECEIPT_PROFILE", "off");
    let _ = std::fs::remove_dir_all(&dir);
    eprintln!("{} red team cases denied under strict", attacks.len());
}
