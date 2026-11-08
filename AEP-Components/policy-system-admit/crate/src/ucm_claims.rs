//! Policy ucm-computed-claims: fields that the task manifest declares as computed must carry
//! a valid UCM receipt whose signed result equals the field value.
//!
//! The declaration lives at payload.ucm.computed_fields (or ucm.computed_fields on the event
//! itself); UCB writes it from the task manifest. Receipts live at ucm.receipts keyed by the
//! same JSON pointer. Pointers resolve against the object that holds the ucm block.
//!
//! Profiles (AEP_UCM_RECEIPT_PROFILE): off, the default, closes nothing; warn reports a
//! finding on stderr and closes nothing; strict closes the wall. Admit decides exactly as
//! before for every action whose event names no computed field.

use aep_ucm_core::Library;
use aep_ucm_receipt::{verify_replay, verify_signature, ReceiptError};
use serde_json::Value;
use std::sync::OnceLock;

/// File stem of the reference policy in AEP-Policy-System/reference.
pub const STEM: &str = "ucm-computed-claims";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile {
    Off,
    Warn,
    Strict,
}

pub fn profile() -> Profile {
    match std::env::var("AEP_UCM_RECEIPT_PROFILE").unwrap_or_default().trim() {
        "strict" => Profile::Strict,
        "warn" => Profile::Warn,
        _ => Profile::Off,
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Finding {
    /// Deny kind UcmReceiptMissing.
    Missing(String),
    /// Deny kind UcmReceiptInvalid.
    Invalid(String, String),
    /// Deny kind UcmResultMismatch.
    Mismatch(String),
}

impl Finding {
    pub fn slug(&self) -> &'static str {
        match self {
            Finding::Missing(_) => "ucm_receipt_present",
            Finding::Invalid(..) => "ucm_receipt_valid",
            Finding::Mismatch(_) => "ucm_result_matches",
        }
    }

    pub fn deny_kind(&self) -> &'static str {
        match self {
            Finding::Missing(_) => "UcmReceiptMissing",
            Finding::Invalid(..) => "UcmReceiptInvalid",
            Finding::Mismatch(_) => "UcmResultMismatch",
        }
    }
}

fn trusted_keys() -> Vec<String> {
    let Ok(path) = std::env::var("AEP_UCM_TRUSTED_KEYS") else {
        return Vec::new();
    };
    std::fs::read_to_string(path.trim())
        .map(|raw| {
            raw.lines()
                .map(|l| l.trim().to_string())
                .filter(|l| !l.is_empty() && !l.starts_with('#'))
                .collect()
        })
        .unwrap_or_default()
}

fn library() -> Option<&'static Library> {
    static LIB: OnceLock<Option<Library>> = OnceLock::new();
    LIB.get_or_init(|| Library::builtin().ok()).as_ref()
}

/// Largest step budget a replay inside Admit may use, whatever the receipt asked for.
const REPLAY_MAX_STEPS: u64 = 1_000_000;

/// Text forms a field may use for a receipt result.
fn result_texts(r: &Value) -> Vec<String> {
    let s = |k: &str| r.get(k).and_then(|x| x.as_str()).map(|x| x.to_string());
    let mut out = Vec::new();
    for v in [s("value"), s("decimal")].into_iter().flatten() {
        match (r.get("type").and_then(|t| t.as_str()), s("currency"), s("unit")) {
            (Some("money"), Some(c), _) => {
                out.push(format!("{v} {c}"));
                out.push(v);
            }
            (Some("quantity"), _, Some(u)) => {
                out.push(format!("{v} {u}"));
                out.push(v);
            }
            _ => out.push(v),
        }
    }
    out
}

fn value_matches(field: &Value, result: &Value) -> bool {
    // A text result proves no calculation, so it never backs a computed field.
    if result.get("type").and_then(|t| t.as_str()) == Some("text") {
        return false;
    }
    match field {
        Value::String(t) => result_texts(result).iter().any(|x| x == t.trim()),
        Value::Number(n) => result_texts(result).iter().any(|x| *x == n.to_string()),
        Value::Bool(b) => {
            result.get("type").and_then(|x| x.as_str()) == Some("bool")
                && result.get("value").and_then(|x| x.as_str()) == Some(if *b { "true" } else { "false" })
        }
        other => other == result,
    }
}

/// Locate the object that holds the ucm block: the payload first, then the event.
fn container(event: &Value) -> Option<&Value> {
    if event.get("payload").and_then(|p| p.get("ucm")).is_some() {
        return event.get("payload");
    }
    if event.get("ucm").is_some() {
        return Some(event);
    }
    None
}

pub fn findings(event: &Value, wrap: &str) -> Vec<Finding> {
    let Some(holder) = container(event) else { return Vec::new() };
    let ucm = &holder["ucm"];
    let fields: Vec<String> = ucm
        .get("computed_fields")
        .and_then(|x| x.as_array())
        .map(|a| a.iter().filter_map(|x| x.as_str().map(|y| y.to_string())).collect())
        .unwrap_or_default();
    if fields.is_empty() {
        return Vec::new();
    }
    let trusted = trusted_keys();
    let replay = std::env::var("AEP_UCM_RECEIPT_VERIFY")
        .map(|v| v.trim() == "replay")
        .unwrap_or(false);
    let library_only = std::env::var("AEP_UCM_LIBRARY_ONLY_WRAPS")
        .map(|v| v.split(',').any(|w| !w.trim().is_empty() && w.trim() == wrap))
        .unwrap_or(false);
    let mut out = Vec::new();
    for ptr in fields {
        let Some(value) = holder.pointer(&ptr) else {
            // A declared field the action does not carry makes no claim.
            continue;
        };
        let Some(receipt) = ucm.get("receipts").and_then(|r| r.get(&ptr)) else {
            out.push(Finding::Missing(ptr));
            continue;
        };
        let check = if replay {
            match library() {
                Some(lib) => {
                    // Cap the replay so one action cannot hold Admit for long.
                    if let Some(steps) = receipt
                        .pointer("/budget_limits/steps")
                        .and_then(|x| x.as_str())
                        .and_then(|x| x.parse::<u64>().ok())
                    {
                        if steps > REPLAY_MAX_STEPS {
                            out.push(Finding::Invalid(ptr, "replay budget above the Admit cap".into()));
                            continue;
                        }
                    }
                    verify_replay(receipt, &trusted, lib)
                }
                None => Err(ReceiptError::Replay("library unavailable".into())),
            }
        } else {
            verify_signature(receipt, &trusted)
        };
        match check {
            Err(ReceiptError::ResultMismatch) => {
                out.push(Finding::Mismatch(ptr));
                continue;
            }
            Err(e) => {
                out.push(Finding::Invalid(ptr, e.code().into()));
                continue;
            }
            Ok(c) if !c.trusted => {
                out.push(Finding::Invalid(ptr, "receipt_untrusted_signer".into()));
                continue;
            }
            Ok(_) => {}
        }
        if library_only && receipt.get("program_source").and_then(|x| x.as_str()) != Some("library") {
            out.push(Finding::Invalid(ptr, "wrap requires a library program".into()));
            continue;
        }
        if !value_matches(value, &receipt["result"]) {
            out.push(Finding::Mismatch(ptr));
        }
    }
    out
}

/// Whether the wall named by `slug` closes for this event.
pub fn wall_closed(slug: &str, event: &Value, wrap: &str) -> bool {
    let p = profile();
    if p == Profile::Off {
        return false;
    }
    let hits: Vec<Finding> = findings(event, wrap).into_iter().filter(|f| f.slug() == slug).collect();
    if hits.is_empty() {
        return false;
    }
    if p == Profile::Warn {
        for h in &hits {
            eprintln!("ucm-computed-claims warn: {} {:?}", h.deny_kind(), h);
        }
        return false;
    }
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_ucm_core::{evaluate, load_program, Limits};
    use aep_ucm_receipt::{issue, NodeKey, ProgramSource};
    use serde_json::json;

    fn receipt(key: &NodeKey, src: &str, inputs: Value) -> Value {
        let lib = Library::builtin().expect("lib");
        let p = load_program(Some(src), None).expect("p");
        let o = evaluate(&p, &inputs, Limits::DEFAULT, &lib).expect("eval");
        issue(key, &p, &inputs, &o, &lib, ProgramSource::Agent).expect("issue")
    }

    #[test]
    fn matching_rules() {
        let r = json!({ "type": "money", "currency": "EUR", "value": "3227/50", "decimal": "64.54" });
        assert!(value_matches(&json!("64.54"), &r));
        assert!(value_matches(&json!("64.54 EUR"), &r));
        assert!(value_matches(&json!(64.54), &r));
        assert!(!value_matches(&json!("64.55"), &r));
        assert!(!value_matches(&json!("64.54 USD"), &r));
    }

    #[test]
    fn findings_cover_every_kind() {
        let key = NodeKey::generate();
        let dir = std::env::temp_dir().join(format!("ucm-claims-{}", std::process::id()));
        std::fs::create_dir_all(&dir).expect("dir");
        let keys = dir.join("trusted.txt");
        std::fs::write(&keys, format!("{}\n", key.public_hex)).expect("keys");
        std::env::set_var("AEP_UCM_TRUSTED_KEYS", &keys);
        let good = receipt(
            &key,
            "input p: money[EUR];\nround(p * 3 * 1.081, 2, \"half_even\")",
            json!({ "p": "19.90 EUR" }),
        );

        let ok = json!({ "payload": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": good } } } });
        assert!(findings(&ok, "").is_empty());

        let missing = json!({ "payload": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"] } } });
        assert_eq!(findings(&missing, ""), vec![Finding::Missing("/amount".into())]);

        let wrong = json!({ "payload": { "amount": "65.00", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": good } } } });
        assert_eq!(findings(&wrong, ""), vec![Finding::Mismatch("/amount".into())]);

        let mut forged = good.clone();
        forged["result"]["decimal"] = json!("65.00");
        let bad = json!({ "payload": { "amount": "65.00", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": forged } } } });
        assert!(matches!(findings(&bad, "").as_slice(), [Finding::Invalid(..)]));

        let stranger = receipt(&NodeKey::generate(), "64.54", json!({}));
        let untrusted =
            json!({ "payload": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": stranger } } } });
        assert!(matches!(findings(&untrusted, "").as_slice(), [Finding::Invalid(_, why)] if why == "receipt_untrusted_signer"));

        let none = json!({ "payload": { "amount": "65.00" } });
        assert!(findings(&none, "").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
