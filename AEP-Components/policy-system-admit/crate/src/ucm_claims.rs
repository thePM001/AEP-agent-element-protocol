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
    match std::env::var("AEP_UCM_RECEIPT_PROFILE")
        .unwrap_or_default()
        .trim()
    {
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
        match (
            r.get("type").and_then(|t| t.as_str()),
            s("currency"),
            s("unit"),
        ) {
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
                && result.get("value").and_then(|x| x.as_str())
                    == Some(if *b { "true" } else { "false" })
        }
        other => other == result,
    }
}

/// Pointer of the object that holds the ucm block: the payload, then the foreign payload
/// that UCB keeps under payload.raw, then the event itself.
fn container_pointer(event: &Value) -> Option<&'static str> {
    ["/payload", "/payload/raw", ""]
        .into_iter()
        .find(|p| event.pointer(p).and_then(|h| h.get("ucm")).is_some())
}

fn container(event: &Value) -> Option<&Value> {
    container_pointer(event).and_then(|p| event.pointer(p))
}

/// Receipt fields that hold only signature material, keys and digests made by the UCM node.
/// agent_view never carries them; the tests check that.
#[cfg(test)]
const OPAQUE_RECEIPT_FIELDS: &[&str] = &[
    "signature",
    "public_key",
    "program_hash",
    "input_digest",
    "result_digest",
    "library_digests",
    "receipt_id",
    "node_id",
];

/// Program IR keys whose values are grammar tokens the engine checked (operators, function
/// names, types and the schema tag), not text the agent wrote.
const PROGRAM_TOKEN_KEYS: &[&str] = &["op", "call", "type", "ucm"];

fn program_strings(v: &Value, out: &mut Vec<Value>) {
    match v {
        Value::String(s) => out.push(Value::String(s.clone())),
        Value::Array(a) => a.iter().for_each(|x| program_strings(x, out)),
        Value::Object(m) => {
            for (k, x) in m {
                if !(PROGRAM_TOKEN_KEYS.contains(&k.as_str()) && x.is_string()) {
                    program_strings(x, out);
                }
            }
        }
        _ => {}
    }
}

/// What the text walls read of a receipt that verifies against a trusted key: the strings
/// the agent chose (literals, names and input values) and the result. Signature material,
/// digests, types and operators come from the node or the grammar and are not text.
fn agent_view(receipt: &Value) -> Value {
    let mut strings = Vec::new();
    program_strings(&receipt["program"], &mut strings);
    serde_json::json!({
        "program_strings": strings,
        "inputs": receipt.get("inputs").cloned().unwrap_or(Value::Null),
        "result": receipt.get("result").cloned().unwrap_or(Value::Null),
    })
}

/// Agent and event type of the receipt record that aep-ucm writes with UCM_LATTICE_RECORD=1.
const RECORD_AGENT: &str = "aep-ucm";
const RECORD_EVENT: &str = "UCM_RECEIPT";

/// Record fields with their fixed prefix. The rest of each value must be lowercase hex.
const RECORD_DIGEST_FIELDS: &[(&str, &str)] = &[
    ("receipt_id", "ucmr_"),
    ("receipt_digest", ""),
    ("program_hash", ""),
    ("result_digest", ""),
    ("node_id", "ucm-node-"),
];

fn prefixed_hex(v: &Value, prefix: &str) -> bool {
    v.as_str()
        .and_then(|s| s.strip_prefix(prefix))
        .map(|h| {
            !h.is_empty()
                && h.bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        })
        .unwrap_or(false)
}

/// A receipt record of aep-ucm holds digests only. Its digest fields are left out of the
/// text when every one of them has its exact digest form; any other record is read whole.
/// The dock binds the agent to its provisioned sign key and the lattice grants the record
/// action to aep-ucm alone.
fn record_view(event: &Value) -> Option<Value> {
    let kind = event
        .get("event_type")
        .or_else(|| event.get("type"))
        .and_then(Value::as_str);
    if kind != Some(RECORD_EVENT)
        || event.get("agent_id").and_then(Value::as_str) != Some(RECORD_AGENT)
    {
        return None;
    }
    let payload = event.get("payload")?.as_object()?;
    if RECORD_DIGEST_FIELDS.iter().any(|(k, pre)| {
        payload
            .get(*k)
            .map(|v| !prefixed_hex(v, pre))
            .unwrap_or(false)
    }) {
        return None;
    }
    let mut out = event.clone();
    if let Some(p) = out.get_mut("payload").and_then(Value::as_object_mut) {
        for (k, _) in RECORD_DIGEST_FIELDS {
            p.remove(*k);
        }
    }
    Some(out)
}

/// The event as the text walls (writing, PII and the other text rules) should read it.
/// Long hex values in a receipt look like phone or card numbers to the PII rules, and
/// program types such as money[EUR] look like bad prose to the writing rules. A receipt
/// whose signature verifies against a key in AEP_UCM_TRUSTED_KEYS is therefore read as
/// agent_view, which keeps what the agent chose. A receipt that does not verify is read
/// whole, so a forged receipt is no place to hide text from Admit.
pub fn text_view(event: &Value) -> std::borrow::Cow<'_, Value> {
    if let Some(view) = record_view(event) {
        return std::borrow::Cow::Owned(view);
    }
    let Some(ptr) = container_pointer(event) else {
        return std::borrow::Cow::Borrowed(event);
    };
    let has_receipts = event
        .pointer(ptr)
        .and_then(|h| h.get("ucm"))
        .and_then(|u| u.get("receipts"))
        .and_then(Value::as_object)
        .map(|m| !m.is_empty())
        .unwrap_or(false);
    if !has_receipts {
        return std::borrow::Cow::Borrowed(event);
    }
    let trusted = trusted_keys();
    if trusted.is_empty() {
        return std::borrow::Cow::Borrowed(event);
    }
    let mut out = event.clone();
    let receipts = out
        .pointer_mut(ptr)
        .and_then(|h| h.get_mut("ucm"))
        .and_then(|u| u.get_mut("receipts"))
        .and_then(Value::as_object_mut);
    if let Some(receipts) = receipts {
        for receipt in receipts.values_mut() {
            if verify_signature(receipt, &trusted)
                .map(|c| c.trusted)
                .unwrap_or(false)
            {
                *receipt = agent_view(receipt);
            }
        }
    }
    std::borrow::Cow::Owned(out)
}

pub fn findings(event: &Value, wrap: &str) -> Vec<Finding> {
    let Some(holder) = container(event) else {
        return Vec::new();
    };
    let ucm = &holder["ucm"];
    let fields: Vec<String> = ucm
        .get("computed_fields")
        .and_then(|x| x.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|x| x.as_str().map(|y| y.to_string()))
                .collect()
        })
        .unwrap_or_default();
    if fields.is_empty() {
        return Vec::new();
    }
    let trusted = trusted_keys();
    let replay = std::env::var("AEP_UCM_RECEIPT_VERIFY")
        .map(|v| v.trim() == "replay")
        .unwrap_or(false);
    let library_only = std::env::var("AEP_UCM_LIBRARY_ONLY_WRAPS")
        .map(|v| {
            v.split(',')
                .any(|w| !w.trim().is_empty() && w.trim() == wrap)
        })
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
                            out.push(Finding::Invalid(
                                ptr,
                                "replay budget above the Admit cap".into(),
                            ));
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
        if library_only && receipt.get("program_source").and_then(|x| x.as_str()) != Some("library")
        {
            out.push(Finding::Invalid(
                ptr,
                "wrap requires a library program".into(),
            ));
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
    let hits: Vec<Finding> = findings(event, wrap)
        .into_iter()
        .filter(|f| f.slug() == slug)
        .collect();
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
    fn record_view_drops_only_exact_digests_of_aep_ucm() {
        let d = "3a52c68c7dc4da9976f03057db745bd753095a6b528f39e2c5809a41e0a1607d";
        let phone_hex = "a5551234567b0000000000000000000000000000000000000000000000000000";
        let rec = |agent: &str, digest: &str| {
            json!({ "type": "UCM_RECEIPT", "event_type": "UCM_RECEIPT", "agent_id": agent, "action_path": "ucm:receipt",
                    "payload": { "receipt_id": "ucmr_58344d7a8acf0ebd77e91c04a1775893", "receipt_digest": digest,
                                 "program_hash": d, "result_digest": d, "node_id": "ucm-node-5db9561e69e9539d" } })
        };
        let ok = rec("aep-ucm", phone_hex);
        let view = text_view(&ok);
        assert_eq!(view["payload"], json!({}));
        assert_eq!(view["action_path"], json!("ucm:receipt"));
        // A record of another agent or with any value that is not a digest is read whole.
        let other = rec("someone", phone_hex);
        assert_eq!(*text_view(&other), other);
        let prose = rec("aep-ucm", "call 555 123 4567");
        assert_eq!(*text_view(&prose), prose);
        let upper = rec("aep-ucm", &d.to_uppercase());
        assert_eq!(*text_view(&upper), upper);
    }

    #[test]
    fn matching_rules() {
        let r =
            json!({ "type": "money", "currency": "EUR", "value": "3227/50", "decimal": "64.54" });
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

        let missing =
            json!({ "payload": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"] } } });
        assert_eq!(
            findings(&missing, ""),
            vec![Finding::Missing("/amount".into())]
        );

        let wrong = json!({ "payload": { "amount": "65.00", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": good } } } });
        assert_eq!(
            findings(&wrong, ""),
            vec![Finding::Mismatch("/amount".into())]
        );

        let mut forged = good.clone();
        forged["result"]["decimal"] = json!("65.00");
        let bad = json!({ "payload": { "amount": "65.00", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": forged } } } });
        assert!(matches!(
            findings(&bad, "").as_slice(),
            [Finding::Invalid(..)]
        ));

        let stranger = receipt(&NodeKey::generate(), "64.54", json!({}));
        let untrusted = json!({ "payload": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": stranger } } } });
        assert!(
            matches!(findings(&untrusted, "").as_slice(), [Finding::Invalid(_, why)] if why == "receipt_untrusted_signer")
        );

        let none = json!({ "payload": { "amount": "65.00" } });
        assert!(findings(&none, "").is_empty());

        // UCB keeps the foreign payload under payload.raw and binds computed_fields there.
        let ucb_missing = json!({ "payload": { "foreign_fixture": "mcp", "raw": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"] } } } });
        assert_eq!(
            findings(&ucb_missing, ""),
            vec![Finding::Missing("/amount".into())]
        );
        let ucb_ok = json!({ "payload": { "foreign_fixture": "mcp", "raw": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": good } } } } });
        assert!(findings(&ucb_ok, "").is_empty());
        let ucb_wrong = json!({ "payload": { "raw": { "amount": "1.00", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": good } } } } });
        assert_eq!(
            findings(&ucb_wrong, ""),
            vec![Finding::Mismatch("/amount".into())]
        );

        // The text view drops signature material of trusted receipts only.
        fn strings(v: &Value, out: &mut Vec<String>) {
            match v {
                Value::String(s) => out.push(s.clone()),
                Value::Array(a) => a.iter().for_each(|x| strings(x, out)),
                Value::Object(m) => m.values().for_each(|x| strings(x, out)),
                _ => {}
            }
        }
        let view = text_view(&ucb_ok);
        let r = &view["payload"]["raw"]["ucm"]["receipts"]["/amount"];
        for k in OPAQUE_RECEIPT_FIELDS {
            assert!(r.get(*k).is_none(), "{k} left in the text view");
        }
        assert_eq!(r["inputs"], json!({ "p": "19.90 EUR" }));
        assert_eq!(r["result"]["decimal"], json!("64.54"));
        let ps: Vec<&str> = r["program_strings"]
            .as_array()
            .unwrap()
            .iter()
            .filter_map(|x| x.as_str())
            .collect();
        assert!(
            ps.contains(&"half_even") && ps.contains(&"p") && ps.contains(&"1.081"),
            "{ps:?}"
        );
        assert!(
            !ps.iter()
                .any(|s| s.contains('[') || *s == "round" || *s == "*"),
            "{ps:?}"
        );
        let mut text = Vec::new();
        strings(&view, &mut text);
        assert!(
            text.iter().all(|t| !super::super::has_phone(t)),
            "receipt text still reads as a phone number"
        );
        // An agent that writes a phone number into a text literal is still seen.
        let leaky = receipt(&key, "\"call 5551234567 now\"", json!({}));
        let leaky_event = json!({ "payload": { "raw": { "note": "x", "ucm": { "receipts": { "/note": leaky } } } } });
        let mut lt = Vec::new();
        strings(&text_view(&leaky_event), &mut lt);
        assert!(lt.iter().any(|t| super::super::has_phone(t)));
        let stranger_event = json!({ "payload": { "raw": { "amount": "64.54", "ucm": { "computed_fields": ["/amount"], "receipts": { "/amount": stranger } } } } });
        assert_eq!(*text_view(&stranger_event), stranger_event);
        // The check itself still reads the whole receipt.
        assert!(findings(&ucb_ok, "").is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
