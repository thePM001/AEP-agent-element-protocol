// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:b478d503a6842ab07413e7268f7c2ef74fb5f5e348059a3dcfd911e126da8cd9
// Parse temporal kv records into TemporalCompileInput.

use crate::compile::{
    TemporalCompileInput, DEFAULT_MAX_DRIFT_MS, DEFAULT_MAX_FUTURE_MS, DEFAULT_MAX_STALENESS_MS,
};
use aep_admit::AdmitWall;

pub fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

fn kv_line(line: &str) -> Option<(String, String)> {
    line.split_once('=')
        .map(|(k, v)| (k.trim().to_string(), v.trim().to_string()))
}

fn parse_i64(raw: &str, default: i64) -> i64 {
    raw.trim().parse::<i64>().unwrap_or(default)
}

pub fn parse_temporal_from_text(text: &str) -> TemporalCompileInput {
    let mut input = TemporalCompileInput::with_defaults();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        let (k, v) = match kv_line(line) {
            Some(p) => p,
            None => continue,
        };
        match k.as_str() {
            "drift_ms" | "drift" => input.drift_ms = parse_i64(&v, 0),
            "agent_time_ms" | "timestamp" | "agent_time" => {
                input.agent_time_ms = parse_i64(&v, 0);
                input.has_agent_time = true;
            }
            "bridge_time_ms" | "bridge_timestamp" | "bridge_time" => {
                input.bridge_time_ms = parse_i64(&v, 0);
            }
            "max_drift_ms" => input.max_drift_ms = parse_i64(&v, DEFAULT_MAX_DRIFT_MS),
            "max_future_ms" => input.max_future_ms = parse_i64(&v, DEFAULT_MAX_FUTURE_MS),
            "max_staleness_ms" => input.max_staleness_ms = parse_i64(&v, DEFAULT_MAX_STALENESS_MS),
            "has_agent_time" => input.has_agent_time = parse_bool(&v),
            "causal_parent" | "causal_dependency" => {
                if v.is_empty() == false {
                    input.causal_parents.push(v);
                }
            }
            "causal_satisfied" | "delivered" => {
                if v.is_empty() == false {
                    input.causal_satisfied.push(v);
                }
            }
            "causal_violation_type" | "violation_type" => input.causal_violation_type = v,
            "agent_id" => input.agent_id = v,
            "target_id" => input.target_id = v,
            "event_id" => input.event_id = v,
            _ => {}
        }
    }
    input
}

pub fn parse_extra_walls(text: &str) -> Vec<AdmitWall> {
    let mut extra = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        if line.contains('\t') == false && line.starts_with("id=") == false {
            continue;
        }
        let mut id = String::new();
        let mut closed = false;
        let mut reason = String::new();
        for part in line.split('\t') {
            if let Some((k, v)) = part.split_once('=') {
                match k.trim() {
                    "id" => id = v.trim().to_string(),
                    "closed" => closed = parse_bool(v),
                    "reason" => reason = v.trim().to_string(),
                    _ => {}
                }
            }
        }
        if id.is_empty() {
            continue;
        }
        if id.starts_with("temporal:") {
            continue;
        }
        if closed {
            extra.push(AdmitWall::close(id, reason));
        } else {
            extra.push(AdmitWall::open(id));
        }
    }
    extra
}
