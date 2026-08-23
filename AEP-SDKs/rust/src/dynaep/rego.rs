//! Unified policy evaluator. Fail-closed OPA CLI. Precompiled tables when evaluation=precompiled.
//! @PAD: aep-sdk-dynaep-rego
//! @GCDE: gaplune.code.v1

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Debug, Clone)]
pub struct RegoConfig {
    pub policy_path: String,
    pub evaluation: String,
    pub bundle_mode: String,
    pub decision_cache_size: usize,
    pub separate_policy_paths: Option<(String, String, String)>,
}

impl Default for RegoConfig {
    fn default() -> Self {
        Self {
            policy_path: "./aep-policy.rego".into(),
            evaluation: "precompiled".into(),
            bundle_mode: "unified".into(),
            decision_cache_size: 5000,
            separate_policy_paths: None,
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct RegoResult {
    pub structural_deny: Vec<String>,
    pub temporal_deny: Vec<String>,
    pub perception_deny: Vec<String>,
    pub temporal_warn: Vec<String>,
    pub perception_warn: Vec<String>,
    pub temporal_escalate: Vec<String>,
    pub perception_escalate: Vec<String>,
}

impl RegoResult {
    pub fn any_deny(&self) -> bool {
        !self.structural_deny.is_empty()
            || !self.temporal_deny.is_empty()
            || !self.perception_deny.is_empty()
    }
}

pub struct UnifiedRegoEvaluator {
    config: RegoConfig,
    cache: HashMap<String, RegoResult>,
}

impl UnifiedRegoEvaluator {
    pub fn new(config: RegoConfig) -> Self {
        Self {
            config,
            cache: HashMap::new(),
        }
    }

    pub fn evaluate(&mut self, input: &Value) -> Result<RegoResult, String> {
        let key = cache_key(input);
        if let Some(hit) = self.cache.get(&key) {
            return Ok(hit.clone());
        }
        let result = if self.config.evaluation == "cli" {
            self.evaluate_cli(input)?
        } else {
            evaluate_precompiled(input)
        };
        if self.config.decision_cache_size > 0 {
            if self.cache.len() >= self.config.decision_cache_size {
                self.cache.clear();
            }
            self.cache.insert(key, result.clone());
        }
        Ok(result)
    }

    fn evaluate_cli(&self, input: &Value) -> Result<RegoResult, String> {
        let fallback = std::env::var("AEP_LATTICE_OPA_FALLBACK").ok().as_deref() == Some("1")
            && std::env::var("AEP_ENV").ok().as_deref() != Some("production");
        match self.evaluate_cli_inner(input) {
            Ok(r) => Ok(r),
            Err(e) if fallback => {
                let mut r = evaluate_precompiled(input);
                r.temporal_warn
                    .push(format!("OPA CLI failed; precompiled fallback: {e}"));
                Ok(r)
            }
            Err(e) => Ok(RegoResult {
                structural_deny: vec![format!("OPA CLI evaluation failed (fail-closed): {e}")],
                ..RegoResult::default()
            }),
        }
    }

    fn evaluate_cli_inner(&self, input: &Value) -> Result<RegoResult, String> {
        let input_json = serde_json::to_string(input).map_err(|e| e.to_string())?;
        let (structural_path, temporal_path, perception_path) =
            match &self.config.separate_policy_paths {
                Some(p) => p.clone(),
                None => (
                    self.config.policy_path.clone(),
                    "policies/temporal-policy.rego".into(),
                    "policies/perception-policy.rego".into(),
                ),
            };
        let structural = run_opa(&input_json, &structural_path, "data.aep.forbidden.deny")?;
        let temporal = run_opa(
            &input_json,
            &temporal_path,
            "data.dynaep.temporal.deny_temporal",
        )?;
        let perception = run_opa(
            &input_json,
            &perception_path,
            "data.dynaep.perception.deny_perception",
        )?;
        Ok(RegoResult {
            structural_deny: structural,
            temporal_deny: temporal,
            perception_deny: perception,
            ..RegoResult::default()
        })
    }
}

fn run_opa(input_json: &str, policy_path: &str, query: &str) -> Result<Vec<String>, String> {
    let bin = std::env::var("AEP_OPA_BIN")
        .or_else(|_| std::env::var("OPA_BIN"))
        .unwrap_or_else(|_| "opa".into());
    let out = Command::new(&bin)
        .args(["eval", "-I", "-d", policy_path, query])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            use std::io::Write;
            if let Some(mut stdin) = child.stdin.take() {
                stdin.write_all(input_json.as_bytes())?;
            }
            child.wait_with_output()
        })
        .map_err(|e| format!("opa eval failed (fail-closed): {e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        let err = if err.trim().is_empty() {
            String::from_utf8_lossy(&out.stdout).into_owned()
        } else {
            err.into_owned()
        };
        return Err(format!(
            "opa eval exit {:?} (fail-closed): {}",
            out.status.code(),
            err.chars().take(800).collect::<String>()
        ));
    }
    let parsed: Value =
        serde_json::from_slice(&out.stdout).map_err(|e| format!("opa json (fail-closed): {e}"))?;
    extract_opa_list(&parsed)
}

fn extract_opa_list(parsed: &Value) -> Result<Vec<String>, String> {
    let results = parsed
        .get("result")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "opa eval returned empty result (fail-closed)".to_string())?;
    if results.is_empty() {
        return Err("opa eval returned empty result (fail-closed)".into());
    }
    let exprs = results[0]
        .get("expressions")
        .and_then(|v| v.as_array())
        .ok_or_else(|| "opa eval returned no expressions (fail-closed)".to_string())?;
    if exprs.is_empty() {
        return Err("opa eval returned no expressions (fail-closed)".into());
    }
    match exprs[0].get("value") {
        None | Some(Value::Null) => Ok(Vec::new()),
        Some(Value::Array(items)) => Ok(items.iter().map(|v| match v {
            Value::String(s) => s.clone(),
            other => other.to_string(),
        }).collect()),
        Some(_) => Err("opa eval deny value is not a list (fail-closed)".into()),
    }
}

fn cache_key(input: &Value) -> String {
    let mut h = Sha256::new();
    h.update(input.to_string().as_bytes());
    hex::encode(h.finalize())
}

fn num(v: &Value) -> f64 {
    v.as_f64()
        .or_else(|| v.as_i64().map(|i| i as f64))
        .unwrap_or(0.0)
}

fn obj<'a>(v: &'a Value, k: &str) -> &'a Map<String, Value> {
    v.get(k)
        .and_then(|x| x.as_object())
        .unwrap_or_else(|| {
            static EMPTY: once_lock_map::Empty = once_lock_map::Empty;
            EMPTY.get()
        })
}

mod once_lock_map {
    use serde_json::{Map, Value};
    use std::sync::OnceLock;
    pub struct Empty;
    impl Empty {
        pub fn get(&self) -> &'static Map<String, Value> {
            static M: OnceLock<Map<String, Value>> = OnceLock::new();
            M.get_or_init(Map::new)
        }
    }
}

fn z_band(prefix: &str) -> Option<(f64, f64)> {
    match prefix {
        "SH" => Some((0.0, 9.0)),
        "PN" | "NV" => Some((10.0, 19.0)),
        "CP" | "FM" | "IC" => Some((20.0, 29.0)),
        "CZ" | "CN" => Some((30.0, 39.0)),
        "TB" => Some((40.0, 49.0)),
        "WD" => Some((50.0, 59.0)),
        "OV" => Some((60.0, 69.0)),
        "MD" | "DD" => Some((70.0, 79.0)),
        "TT" => Some((80.0, 89.0)),
        _ => None,
    }
}

pub fn evaluate_precompiled(input: &Value) -> RegoResult {
    let mut r = RegoResult::default();
    r.structural_deny = structural(input);
    let (td, tw, te) = temporal(input);
    r.temporal_deny = td;
    r.temporal_warn = tw;
    r.temporal_escalate = te;
    let (pd, pw, pe) = perception(input);
    r.perception_deny = pd;
    r.perception_warn = pw;
    r.perception_escalate = pe;
    r
}

fn structural(input: &Value) -> Vec<String> {
    let mut deny = Vec::new();
    let scene_v = input.get("scene").cloned().unwrap_or(Value::Object(Map::new()));
    let registry_v = input.get("registry").cloned().unwrap_or(Value::Object(Map::new()));
    let theme_v = input.get("theme").cloned().unwrap_or(Value::Object(Map::new()));
    let scene = scene_v.as_object().cloned().unwrap_or_default();
    let registry = registry_v.as_object().cloned().unwrap_or_default();
    let theme = theme_v.as_object().cloned().unwrap_or_default();
    let styles = theme
        .get("component_styles")
        .and_then(|v| v.as_object())
        .cloned()
        .unwrap_or_default();
    let ids: Vec<String> = scene.keys().filter(|k| *k != "aep_version").cloned().collect();

    for m in &ids {
        if !m.starts_with("MD") {
            continue;
        }
        for g in &ids {
            if !g.starts_with("CZ") {
                continue;
            }
            let mz = scene.get(m).and_then(|e| e.get("z")).map(num);
            let gz = scene.get(g).and_then(|e| e.get("z")).map(num);
            if let (Some(mz), Some(gz)) = (mz, gz) {
                if mz <= gz {
                    deny.push(format!("Modal {m} (z={mz}) must render above grid {g} (z={gz})"));
                }
            }
        }
    }
    for tt in &ids {
        if !tt.starts_with("TT") {
            continue;
        }
        for md in &ids {
            if !md.starts_with("MD") {
                continue;
            }
            let ttz = scene.get(tt).and_then(|e| e.get("z")).map(num);
            let mdz = scene.get(md).and_then(|e| e.get("z")).map(num);
            if let (Some(ttz), Some(mdz)) = (ttz, mdz) {
                if ttz <= mdz {
                    deny.push(format!(
                        "Tooltip {tt} (z={ttz}) must render above modal {md} (z={mdz})"
                    ));
                }
            }
        }
    }
    for id in &ids {
        if let Some(parent) = scene.get(id).and_then(|e| e.get("parent")) {
            if !parent.is_null() {
                let p = parent.as_str().unwrap_or("");
                if !p.is_empty() && !scene.contains_key(p) {
                    deny.push(format!("Orphan element: {id} references non-existent parent {p}"));
                }
            }
        }
    }
    for id in &ids {
        if !registry.contains_key(id) {
            let prefix = id.get(..2).unwrap_or("");
            let is_template = registry.values().any(|r| {
                r.get("instance_prefix").and_then(|v| v.as_str()) == Some(prefix)
            });
            if !is_template {
                deny.push(format!(
                    "Unregistered element: {id} exists in scene but has no registry entry"
                ));
            }
        }
    }
    for (eid, entry) in &registry {
        if let Some(sb) = entry.get("skin_binding").and_then(|v| v.as_str()) {
            if !sb.is_empty() && !styles.contains_key(sb) {
                deny.push(format!(
                    "Unresolved skin_binding: {eid} references '{sb}' which does not exist in theme component_styles"
                ));
            }
        }
    }
    for id in &ids {
        let Some(z) = scene.get(id).and_then(|e| e.get("z")).map(num) else {
            continue;
        };
        let prefix = id.get(..2).unwrap_or("");
        if let Some((lo, hi)) = z_band(prefix) {
            if z < lo {
                deny.push(format!(
                    "z-band violation: {id} has z={z}, below minimum {lo} for prefix {prefix}"
                ));
            }
            if z > hi {
                deny.push(format!(
                    "z-band violation: {id} has z={z}, above maximum {hi} for prefix {prefix}"
                ));
            }
        }
    }
    for id in &ids {
        let children = scene
            .get(id)
            .and_then(|e| e.get("children"))
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        for child in children {
            let c = child.as_str().unwrap_or("");
            if !c.is_empty() && !scene.contains_key(c) {
                deny.push(format!(
                    "Missing child: {id} declares child {c} which does not exist in scene"
                ));
            }
        }
    }
    if scene.get("aep_version").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        deny.push("Missing aep_version in scene config".into());
    }
    if registry.get("aep_version").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        deny.push("Missing aep_version in registry config".into());
    }
    if theme.get("aep_version").and_then(|v| v.as_str()).unwrap_or("").is_empty() {
        deny.push("Missing aep_version in theme config".into());
    }
    let sv = scene.get("aep_version").and_then(|v| v.as_str());
    let rv = registry.get("aep_version").and_then(|v| v.as_str());
    let tv = theme.get("aep_version").and_then(|v| v.as_str());
    if let (Some(sv), Some(rv)) = (sv, rv) {
        if sv != rv {
            deny.push(format!("Version mismatch: scene is {sv} but registry is {rv}"));
        }
    }
    if let (Some(sv), Some(tv)) = (sv, tv) {
        if sv != tv {
            deny.push(format!("Version mismatch: scene is {sv} but theme is {tv}"));
        }
    }
    let _ = obj;
    let _ = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs());
    deny
}

fn temporal(input: &Value) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut deny = Vec::new();
    let mut warn = Vec::new();
    let mut escalate = Vec::new();
    let temporal = input.get("temporal").cloned().unwrap_or(Value::Object(Map::new()));
    let causal = input.get("causal").cloned().unwrap_or(Value::Object(Map::new()));
    let forecast = input.get("forecast").cloned().unwrap_or(Value::Object(Map::new()));
    let config = input.get("config").cloned().unwrap_or(Value::Object(Map::new()));
    let event = input.get("event").cloned().unwrap_or(Value::Object(Map::new()));
    let timekeeping = config.get("timekeeping").cloned().unwrap_or(Value::Object(Map::new()));
    let forecast_cfg = config.get("forecast").cloned().unwrap_or(Value::Object(Map::new()));
    let drift = num(temporal.get("drift_ms").unwrap_or(&Value::from(0)));
    let max_drift = num(timekeeping.get("max_drift_ms").unwrap_or(&Value::from(50)));
    let agent_time = num(temporal.get("agent_time_ms").unwrap_or(&Value::from(0)));
    let bridge_time = num(temporal.get("bridge_time_ms").unwrap_or(&Value::from(0)));
    let max_future = num(timekeeping.get("max_future_ms").unwrap_or(&Value::from(500)));
    let max_staleness = num(timekeeping.get("max_staleness_ms").unwrap_or(&Value::from(5000)));
    let target = event
        .get("target_id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown");
    if drift > max_drift {
        deny.push(format!(
            "Temporal drift exceeded: agent drift {drift} ms exceeds threshold {max_drift} ms for event targeting {target}"
        ));
    }
    if agent_time > bridge_time + max_future {
        deny.push(format!(
            "Future timestamp detected: agent time {agent_time} exceeds bridge time {bridge_time} + tolerance {max_future} ms"
        ));
    }
    if bridge_time - agent_time > max_staleness {
        deny.push(format!(
            "Stale event: agent time {agent_time} is {} ms behind bridge time {bridge_time}",
            bridge_time - agent_time
        ));
    }
    if causal.get("violation_type").and_then(|v| v.as_str()) == Some("agent_clock_regression") {
        deny.push(format!(
            "Causal regression: agent {} sent sequence {} but expected {}",
            causal.get("agent_id").and_then(|v| v.as_str()).unwrap_or(""),
            causal.get("received_sequence").unwrap_or(&Value::Null),
            causal.get("expected_sequence").unwrap_or(&Value::Null)
        ));
    }
    if drift > max_drift / 2.0 && drift <= max_drift {
        warn.push(format!(
            "High drift warning: agent drift {drift} ms approaching threshold {max_drift} ms"
        ));
    }
    let score = num(forecast.get("anomaly_score").unwrap_or(&Value::from(0)));
    let thresh = num(forecast_cfg.get("anomaly_threshold").unwrap_or(&Value::from(3.0)));
    let action = forecast_cfg
        .get("anomaly_action")
        .and_then(|v| v.as_str())
        .unwrap_or("warn");
    if score > thresh && action == "require_approval" {
        escalate.push(format!(
            "Temporal anomaly on {target}: score {score} exceeds threshold {thresh}, approval required"
        ));
    }
    (deny, warn, escalate)
}

fn perception(input: &Value) -> (Vec<String>, Vec<String>, Vec<String>) {
    let mut deny = Vec::new();
    let mut warn = Vec::new();
    let escalate = Vec::new();
    let perception = input.get("perception").cloned().unwrap_or(Value::Object(Map::new()));
    let modality = perception.get("modality").and_then(|v| v.as_str()).unwrap_or("");
    let ann = perception
        .get("annotations")
        .cloned()
        .unwrap_or(Value::Object(Map::new()));
    if modality == "speech" {
        let sr = num(ann.get("syllable_rate").unwrap_or(&Value::from(0)));
        if sr > 8.0 {
            deny.push(format!("Speech syllable rate {sr} exceeds hard limit 8.0 per second"));
        }
        if let Some(tg) = ann.get("turn_gap_ms") {
            let tg = num(tg);
            if tg < 150.0 {
                deny.push(format!("Speech turn gap {tg} ms below 150 ms interruption threshold"));
            }
        }
        if sr > 5.5 && sr <= 8.0 {
            warn.push(format!(
                "Speech syllable rate {sr} exceeds comfortable maximum 5.5 per second"
            ));
        }
    }
    if modality == "notification" {
        if let Some(mi) = ann.get("min_interval_ms") {
            let mi = num(mi);
            if mi < 1000.0 {
                deny.push(format!(
                    "Notification interval {mi} ms constitutes spam (below 1000 ms)"
                ));
            }
        }
    }
    (deny, warn, escalate)
}
