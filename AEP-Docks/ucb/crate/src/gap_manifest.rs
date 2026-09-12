// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Local gap-manifest-v1 compiler. Public UCB does not call a remote engine.

use crate::manifest::{synthesis_forbidden, trust_fields_forbidden};
use crate::store::{value_has_trust_fields, TaskManifestV1};
use aep_ucb_perimeter_v1::digest_canonical;
use aep_wall_set_backpressure::{ClosedWall, DenyReport, RepairHint, CLASS_STRUCTURAL};
use serde_json::{Map, Value};

/// Public local compiler profile. Not a licensed GAP engine.
pub const LOCAL_PROFILE: &str = "gap-manifest-v1";

fn required_keys_missing() -> DenyReport {
    let closed = vec![ClosedWall::with_class(
        "ucb.gap_manifest.keys",
        "manifest_version, id, agent_id and intent are required",
        CLASS_STRUCTURAL,
    )];
    let mut report = DenyReport::from_error_and_closed("ManifestMissing", &closed);
    report.repairs = vec![RepairHint {
        wall_id: String::from("ucb.gap_manifest.keys"),
        field: String::from("task_manifest"),
        kind: String::from("bind_field"),
        fix: String::from(
            "supply GAP text or JSON with manifest_version, id, agent_id and intent then reseal",
        ),
    }];
    report.reseal_required = true;
    report
}

fn contains_trust(value: &Value) -> bool {
    match value {
        Value::Object(_) => {
            if value_has_trust_fields(value) {
                return true;
            }
            value
                .as_object()
                .map(|m| m.values().any(contains_trust))
                .unwrap_or(false)
        }
        Value::Array(items) => items.iter().any(contains_trust),
        _ => false,
    }
}

fn as_required_string(value: Option<&Value>) -> Option<String> {
    match value {
        Some(Value::String(s)) => {
            let t = s.trim();
            if t.is_empty() {
                None
            } else {
                Some(t.to_string())
            }
        }
        Some(Value::Number(n)) => Some(n.to_string()),
        _ => None,
    }
}

fn digest_of(manifest: &TaskManifestV1) -> String {
    let mut value = serde_json::to_value(manifest).unwrap_or(Value::Null);
    if let Some(obj) = value.as_object_mut() {
        obj.remove("manifest_digest");
        obj.remove("signature");
        obj.remove("trust");
    }
    digest_canonical(&value)
}

fn compile_object(value: Value) -> Result<TaskManifestV1, DenyReport> {
    if contains_trust(&value) {
        return Err(trust_fields_forbidden());
    }
    let Some(obj) = value.as_object() else {
        return Err(required_keys_missing());
    };
    let synthesized = obj
        .get("synthesized_by")
        .and_then(Value::as_str)
        .unwrap_or("")
        .trim();
    if !synthesized.is_empty() && synthesized != "provided" {
        return Err(synthesis_forbidden());
    }
    let manifest_version =
        as_required_string(obj.get("manifest_version")).ok_or_else(required_keys_missing)?;
    let id = as_required_string(obj.get("id")).ok_or_else(required_keys_missing)?;
    let agent_id = as_required_string(obj.get("agent_id")).ok_or_else(required_keys_missing)?;
    let intent = match obj.get("intent") {
        Some(v) if !v.is_null() => v.clone(),
        _ => return Err(required_keys_missing()),
    };
    let signature = obj
        .get("signature")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let requested_provisional = obj
        .get("provisional")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let provisional = if signature.is_some() {
        requested_provisional
    } else {
        true
    };
    let session_id = obj
        .get("session_id")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let promotion_required = obj
        .get("promotion_required")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();
    let mut compiled = TaskManifestV1 {
        manifest_version,
        id,
        agent_id,
        session_id,
        intent,
        agentmesh: obj.get("agentmesh").cloned().filter(|v| !v.is_null()),
        egress: obj.get("egress").cloned().filter(|v| !v.is_null()),
        mcp: obj.get("mcp").cloned().filter(|v| !v.is_null()),
        provisional,
        synthesized_by: String::from("provided"),
        promotion_required,
        created_at_unix: obj
            .get("created_at_unix")
            .and_then(Value::as_u64)
            .unwrap_or(0),
        manifest_digest: String::new(),
        signature,
    };
    compiled.manifest_digest = digest_of(&compiled);
    Ok(compiled)
}

fn indent_of(line: &str) -> usize {
    line.chars().take_while(|c| *c == ' ' || *c == '\t').count()
}

fn parse_scalar_or_json(raw: &str) -> Value {
    let t = raw.trim();
    if t.is_empty() {
        return Value::Null;
    }
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return v;
    }
    if t.len() >= 2
        && ((t.starts_with('"') && t.ends_with('"')) || (t.starts_with('\'') && t.ends_with('\'')))
    {
        return Value::String(t[1..t.len() - 1].to_string());
    }
    if t.eq_ignore_ascii_case("true") {
        return Value::Bool(true);
    }
    if t.eq_ignore_ascii_case("false") {
        return Value::Bool(false);
    }
    if let Ok(n) = t.parse::<u64>() {
        return Value::from(n);
    }
    Value::String(t.to_string())
}

fn parse_gap_text(text: &str) -> Result<Value, DenyReport> {
    let mut obj = Map::new();
    let lines: Vec<&str> = text.lines().collect();
    let mut i = 0usize;
    while i < lines.len() {
        let raw = lines[i];
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            i += 1;
            continue;
        }
        let Some((key_raw, rest)) = line.split_once(':') else {
            i += 1;
            continue;
        };
        let key = key_raw.trim();
        if key.is_empty() {
            i += 1;
            continue;
        }
        let val = rest.trim();
        if val.is_empty() {
            let parent_indent = indent_of(raw);
            let mut nested = Map::new();
            i += 1;
            while i < lines.len() {
                let nested_raw = lines[i];
                if nested_raw.trim().is_empty() {
                    i += 1;
                    continue;
                }
                if indent_of(nested_raw) <= parent_indent {
                    break;
                }
                let nested_line = nested_raw.trim();
                if let Some((nk, nv)) = nested_line.split_once(':') {
                    nested.insert(nk.trim().to_string(), parse_scalar_or_json(nv));
                }
                i += 1;
            }
            obj.insert(key.to_string(), Value::Object(nested));
            continue;
        }
        obj.insert(key.to_string(), parse_scalar_or_json(val));
        i += 1;
    }
    if obj.is_empty() {
        return Err(required_keys_missing());
    }
    Ok(Value::Object(obj))
}

fn extract_json_object(text: &str) -> Option<Value> {
    let start = text.find('{')?;
    let end = text.rfind('}')?;
    if end <= start {
        return None;
    }
    serde_json::from_str::<Value>(&text[start..=end]).ok()
}

fn parse_input_to_json(input: &str) -> Result<Value, DenyReport> {
    let t = input.trim();
    if t.is_empty() {
        return Err(required_keys_missing());
    }
    if let Ok(v) = serde_json::from_str::<Value>(t) {
        return Ok(v);
    }
    if t.starts_with('{') {
        if let Some(v) = extract_json_object(t) {
            return Ok(v);
        }
    }
    let mut fallback: Option<Value> = None;
    for part in t.split("---") {
        match parse_gap_text(part) {
            Ok(v) => {
                let has_keys = v.get("manifest_version").is_some()
                    && v.get("id").is_some()
                    && v.get("agent_id").is_some()
                    && v.get("intent").is_some();
                if has_keys {
                    return Ok(v);
                }
                fallback = Some(v);
            }
            Err(_) => continue,
        }
    }
    fallback.ok_or_else(required_keys_missing)
}

/// Compile provided GAP text or JSON. Local gap-manifest-v1 only.
pub fn compile_provided(input: &str) -> Result<TaskManifestV1, DenyReport> {
    compile_object(parse_input_to_json(input)?)
}

/// Compile a provided JSON object. Local gap-manifest-v1 only.
pub fn compile_provided_json(value: Value) -> Result<TaskManifestV1, DenyReport> {
    compile_object(value)
}

/// Compile provided JSON. Alias used by ingest.
pub fn compile_local(raw: &Value) -> Result<TaskManifestV1, DenyReport> {
    compile_provided_json(raw.clone())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_json() -> Value {
        let mut m = Map::new();
        m.insert(
            String::from("manifest_version"),
            Value::String(String::from("1")),
        );
        m.insert(String::from("id"), Value::String(String::from("m1")));
        m.insert(
            String::from("agent_id"),
            Value::String(String::from("agent-a")),
        );
        m.insert(String::from("intent"), Value::Object(Map::new()));
        m.insert(
            String::from("synthesized_by"),
            Value::String(String::from("provided")),
        );
        Value::Object(m)
    }

    #[test]
    fn compile_provided_json_ok() {
        let compiled = compile_provided_json(sample_json()).expect("compile provided json");
        assert_eq!(compiled.synthesized_by, "provided");
        assert_eq!(compiled.agent_id, "agent-a");
        assert_eq!(compiled.id, "m1");
        assert_eq!(compiled.manifest_version, "1");
        assert!(!compiled.manifest_digest.is_empty());
        assert!(compiled.provisional);
        assert!(compiled.signature.is_none());

        let mut signed = sample_json();
        signed.as_object_mut().unwrap().insert(
            String::from("signature"),
            Value::String(String::from("sig-1")),
        );
        let signed_m = compile_provided_json(signed).expect("signed compile");
        assert!(!signed_m.provisional);
        assert_eq!(signed_m.signature.as_deref(), Some("sig-1"));

        let gap_text = "manifest_version: \"1\"\nid: m1\nagent_id: agent-a\nintent: {}\nsynthesized_by: provided\n";
        let from_text = compile_provided(gap_text).expect("compile gap text");
        assert_eq!(from_text.synthesized_by, "provided");
        assert_eq!(from_text.agent_id, "agent-a");
        assert!(!from_text.manifest_digest.is_empty());
    }

    #[test]
    fn compile_trust_refuses() {
        let mut raw = sample_json();
        raw.as_object_mut()
            .unwrap()
            .insert(String::from("trust_score"), Value::from(9u64));
        let err = compile_provided_json(raw).unwrap_err();
        assert!(err.error.contains("trust"));

        let mut ring = sample_json();
        ring.as_object_mut()
            .unwrap()
            .insert(String::from("trust_ring"), Value::String(String::from("x")));
        let err = compile_provided_json(ring).unwrap_err();
        assert!(err.error.contains("trust"));

        let mut synth = sample_json();
        synth.as_object_mut().unwrap().insert(
            String::from("synthesized_by"),
            Value::String(String::from("llm_structured")),
        );
        let err = compile_provided_json(synth).unwrap_err();
        assert!(err.error.contains("synthesis"));
    }
}
