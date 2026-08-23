//! dynAEP bridge: mints IDs, owns the clock, validates events.
//! @PAD: aep-sdk-dynaep-bridge
//! @GCDE: gaplune.code.v1

use super::causal::{CausalEvent, CausalOrderingEngine};
use super::forecast::ForecastCache;
use super::ledger::BufferedLedger;
use super::rego::{RegoConfig, UnifiedRegoEvaluator};
use super::scanner::{ScannerPattern, UnifiedScanner};
use super::template::TemplateInstanceResolver;
use super::temporal::{BridgeClock, ClockConfig, TemporalValidator, TemporalValidatorConfig};
use serde_json::{json, Map, Value};
use aep_live_entry::{LiveEntry, ProcessOut as LiveOut};
use std::collections::{HashMap, HashSet};

#[derive(Debug, Clone)]
pub struct DynAepBridgeConfig {
    pub validation_mode: String,
    pub jit_on_every_delta: bool,
    pub conflict_resolution: String,
    pub rego: RegoConfig,
}

impl Default for DynAepBridgeConfig {
    fn default() -> Self {
        Self {
            validation_mode: "strict".into(),
            jit_on_every_delta: true,
            conflict_resolution: "last_write_wins".into(),
            rego: RegoConfig::default(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct DynAepRejection { pub target_id: String, pub error: String }

#[derive(Debug, Clone)]
pub enum ProcessOut { Event(Value), Reject(DynAepRejection) }

#[derive(Debug, Clone)]
pub struct ToolCallResult {
    pub success: bool,
    pub element_id: Option<String>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Element {
    pub id: String,
    pub kind: String,
    pub z: i64,
    pub parent: Option<String>,
    pub children: Vec<String>,
    pub visible: bool,
    pub layout: Value,
}

const TYPE_TO_PREFIX: &[(&str, &str)] = &[
    ("shell", "SH"), ("panel", "PN"), ("component", "CP"), ("navigation", "NV"),
    ("cell_zone", "CZ"), ("cell_node", "CN"), ("toolbar", "TB"), ("widget", "WD"),
    ("overlay", "OV"), ("modal", "MD"), ("dropdown", "DD"), ("tooltip", "TT"),
    ("form", "FM"), ("icon", "IC"),
];

pub fn z_band_for_prefix(prefix: &str) -> (i64, i64) {
    match prefix {
        "SH" => (0, 9), "PN" | "NV" => (10, 19), "CP" | "FM" | "IC" => (20, 29),
        "CZ" | "CN" => (30, 39), "TB" => (40, 49), "WD" => (50, 59), "OV" => (60, 69),
        "MD" | "DD" => (70, 79), "TT" => (80, 89), _ => (0, 99),
    }
}

pub struct DynAepBridge {
    pub live: HashMap<String, Element>,
    versions: HashMap<String, u64>,
    id_counters: HashMap<String, u32>,
    styles: HashSet<String>,
    registry: HashSet<String>,
    clock: BridgeClock,
    temporal: TemporalValidator,
    causal: CausalOrderingEngine,
    evaluator: UnifiedRegoEvaluator,
    scanner: Option<UnifiedScanner>,
    templates: TemplateInstanceResolver,
    ledger: BufferedLedger,
    forecast: ForecastCache,
    live_entry: LiveEntry,
    config: DynAepBridgeConfig,
}

impl DynAepBridge {
    pub fn new(scene: Value, config: DynAepBridgeConfig) -> Self {
        let clock = BridgeClock::new(ClockConfig::default());
        let temporal = TemporalValidator::new(
            BridgeClock::new(ClockConfig::default()),
            TemporalValidatorConfig { mode: config.validation_mode.clone(), ..TemporalValidatorConfig::default() },
        );
        let mut live = HashMap::new();
        let mut counters: HashMap<String, u32> = HashMap::new();
        let mut registry = HashSet::new();
        if let Some(obj) = scene.as_object() {
            for (k, v) in obj {
                if k == "aep_version" { continue; }
                registry.insert(k.clone());
                let z = v.get("z").and_then(|x| x.as_i64()).unwrap_or(0);
                let parent = v.get("parent").and_then(|x| x.as_str()).map(|s| s.to_string());
                let children = v.get("children").and_then(|x| x.as_array()).map(|a| {
                    a.iter().filter_map(|c| c.as_str().map(|s| s.to_string())).collect()
                }).unwrap_or_default();
                live.insert(k.clone(), Element {
                    id: k.clone(), kind: v.get("type").and_then(|x| x.as_str()).unwrap_or("component").into(),
                    z, parent, children, visible: v.get("visible").and_then(|x| x.as_bool()).unwrap_or(true),
                    layout: v.get("layout").cloned().unwrap_or(json!({})),
                });
                if k.len() >= 8 {
                    let prefix = k[..2].to_string();
                    if let Ok(n) = k[3..].parse::<u32>() {
                        let e = counters.entry(prefix).or_insert(0);
                        if n > *e { *e = n; }
                    }
                }
            }
        }
        let ledger = BufferedLedger::new(BridgeClock::new(ClockConfig::default()), 256);
        Self {
            live, versions: HashMap::new(), id_counters: counters, styles: HashSet::new(), registry,
            clock, temporal, causal: CausalOrderingEngine::new(64),
            evaluator: UnifiedRegoEvaluator::new(config.rego.clone()), scanner: None,
            templates: TemplateInstanceResolver::new(HashSet::new()), ledger, forecast: ForecastCache::new(3.0),
            live_entry: LiveEntry::new(),
            config,
        }
    }

    pub fn with_scanner(mut self, patterns: Vec<ScannerPattern>) -> Self {
        self.scanner = Some(UnifiedScanner::new(patterns));
        self
    }
    pub fn with_styles(mut self, styles: HashSet<String>) -> Self { self.styles = styles; self }

    pub fn mint_element_id(&mut self, element_type: &str) -> Result<String, String> {
        let prefix = TYPE_TO_PREFIX.iter().find(|(t, _)| *t == element_type).map(|(_, p)| *p)
            .ok_or_else(|| format!("Unknown element type: {element_type}"))?;
        let next = self.id_counters.get(prefix).copied().unwrap_or(0) + 1;
        self.id_counters.insert(prefix.to_string(), next);
        Ok(format!("{prefix}-{next:05}"))
    }

    pub fn process_event(&mut self, event: Value) -> ProcessOut {
        match self.live_entry.process_event(event) {
            LiveOut::Event(v) => ProcessOut::Event(v),
            LiveOut::Reject(r) => ProcessOut::Reject(DynAepRejection { target_id: r.target_id, error: r.error }),
        }
    }

    pub fn load_lattice_yaml(&mut self, text: &str) -> Result<(), String> {
        self.live_entry = LiveEntry::from_yaml(text)?;
        Ok(())
    }

    fn scene_value(&self) -> Value {
        let mut m = Map::new();
        m.insert("aep_version".into(), json!("2.8.0"));
        for (k, e) in &self.live {
            m.insert(k.clone(), json!({"z": e.z, "parent": e.parent, "children": e.children, "type": e.kind, "visible": e.visible}));
        }
        Value::Object(m)
    }

    fn process_state_delta(&mut self, event: Value) -> ProcessOut {
        if !self.config.jit_on_every_delta { return ProcessOut::Event(event); }
        let Some(deltas) = event.get("delta").and_then(|v| v.as_array()).cloned() else { return ProcessOut::Event(event); };
        for op in &deltas {
            let path = op.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() < 2 { continue; }
            if parts[0] == "elements" {
                let tid = parts[1];
                if self.config.conflict_resolution == "optimistic_locking" {
                    if let Some(exp) = event.get("expected_version").and_then(|v| v.as_u64()) {
                        let cur = self.versions.get(tid).copied().unwrap_or(0);
                        if exp != cur {
                            return ProcessOut::Reject(DynAepRejection { target_id: tid.into(), error: format!("Optimistic lock conflict: expected {exp} but current is {cur}") });
                        }
                    }
                }
            }
        }
        for op in &deltas {
            let path = op.get("path").and_then(|v| v.as_str()).unwrap_or("");
            let parts: Vec<&str> = path.split('/').filter(|p| !p.is_empty()).collect();
            if parts.len() >= 3 && parts[0] == "elements" {
                if let Some(el) = self.live.get_mut(parts[1]) {
                    if parts[2] == "z" { if let Some(z) = op.get("value").and_then(|v| v.as_i64()) { el.z = z; } }
                    *self.versions.entry(parts[1].into()).or_insert(0) += 1;
                }
            }
        }
        ProcessOut::Event(event)
    }

    fn process_dynaep_event(&mut self, event: Value) -> ProcessOut {
        let dt = event.get("dynaep_type").and_then(|v| v.as_str()).unwrap_or("");
        match dt {
            "AEP_MUTATE_STRUCTURE" => self.validate_structure(event),
            "AEP_MUTATE_BEHAVIOUR" => self.validate_behaviour(event),
            "AEP_MUTATE_SKIN" => self.validate_skin(event),
            "AEP_QUERY" => ProcessOut::Event(self.handle_query(&event)),
            _ => ProcessOut::Event(event),
        }
    }

    fn validate_structure(&mut self, event: Value) -> ProcessOut {
        let tid = event.get("target_id").and_then(|v| v.as_str()).unwrap_or("").to_string();
        if !self.live.contains_key(&tid) && !tid.starts_with("CN-") {
            return ProcessOut::Reject(DynAepRejection { target_id: tid.clone(), error: format!("Unknown element: {tid}") });
        }
        if let Some(parent) = event.pointer("/mutation/parent").and_then(|v| v.as_str()) {
            if !self.live.contains_key(parent) {
                return ProcessOut::Reject(DynAepRejection { target_id: tid.clone(), error: format!("Cannot move {tid}: parent {parent} does not exist") });
            }
        }
        ProcessOut::Event(event)
    }
    fn validate_behaviour(&self, event: Value) -> ProcessOut {
        let tid = event.get("target_id").and_then(|v| v.as_str()).unwrap_or("");
        if !self.registry.contains(tid) && !tid.starts_with("CN-") {
            return ProcessOut::Reject(DynAepRejection { target_id: tid.into(), error: format!("Cannot mutate behaviour: {tid} has no registry entry") });
        }
        ProcessOut::Event(event)
    }
    fn validate_skin(&self, event: Value) -> ProcessOut {
        let tid = event.get("target_id").and_then(|v| v.as_str()).unwrap_or("");
        if !self.styles.is_empty() && !self.styles.contains(tid) {
            return ProcessOut::Reject(DynAepRejection { target_id: tid.into(), error: format!("Cannot mutate skin: {tid} not in component_styles") });
        }
        ProcessOut::Event(event)
    }
    fn handle_query(&self, event: &Value) -> Value {
        let q = event.get("query").and_then(|v| v.as_str()).unwrap_or("");
        let tid = event.get("target_id").and_then(|v| v.as_str()).unwrap_or("");
        let el = self.live.get(tid);
        let result = match q {
            "children_of" => json!(el.map(|e| e.children.clone()).unwrap_or_default()),
            "parent_of" => json!(el.and_then(|e| e.parent.clone())),
            "z_band_of" => { let p = tid.get(..2).unwrap_or(""); let b = z_band_for_prefix(p); json!([b.0, b.1]) }
            "next_available_id" => json!(format!("{}-{:05}", tid, self.id_counters.get(tid).copied().unwrap_or(0) + 1)),
            _ => Value::Null,
        };
        json!({"type":"CUSTOM","dynaep_type":"AEP_QUERY_RESULT","target_id": tid, "result": result})
    }

    pub fn handle_tool_call(&mut self, tool: &str, args: &Value) -> ToolCallResult {
        match tool {
            "aep_add_element" => self.add_element(args),
            "aep_move_element" => self.move_element(args),
            "aep_query_graph" => ToolCallResult { success: true, element_id: None, errors: Vec::new() },
            _ => ToolCallResult { success: false, element_id: None, errors: vec![format!("Unknown tool: {tool}")] },
        }
    }

    fn add_element(&mut self, args: &Value) -> ToolCallResult {
        let kind = args.get("type").and_then(|v| v.as_str()).unwrap_or("");
        let parent = args.get("parent").and_then(|v| v.as_str()).unwrap_or("");
        let z = args.get("z").and_then(|v| v.as_i64());
        if TYPE_TO_PREFIX.iter().all(|(t, _)| *t != kind) {
            return ToolCallResult { success: false, element_id: None, errors: vec![format!("Unknown element type: {kind}")] };
        }
        if !self.live.contains_key(parent) {
            return ToolCallResult { success: false, element_id: None, errors: vec![format!("Parent {parent} does not exist")] };
        }
        let prefix = TYPE_TO_PREFIX.iter().find(|(t, _)| *t == kind).map(|(_, p)| *p).unwrap();
        let (lo, hi) = z_band_for_prefix(prefix);
        let Some(z) = z else { return ToolCallResult { success: false, element_id: None, errors: vec!["z required".into()] }; };
        if z < lo || z > hi {
            return ToolCallResult { success: false, element_id: None, errors: vec![format!("z={z} outside band {lo}-{hi}")] };
        }
        let id = match self.mint_element_id(kind) { Ok(i) => i, Err(e) => return ToolCallResult { success: false, element_id: None, errors: vec![e] } };
        self.live.insert(id.clone(), Element { id: id.clone(), kind: kind.into(), z, parent: Some(parent.into()), children: Vec::new(), visible: true, layout: json!({}) });
        if let Some(p) = self.live.get_mut(parent) { p.children.push(id.clone()); }
        ToolCallResult { success: true, element_id: Some(id), errors: Vec::new() }
    }

    fn move_element(&mut self, args: &Value) -> ToolCallResult {
        let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
        let new_parent = args.get("new_parent").and_then(|v| v.as_str());
        if !self.live.contains_key(id) {
            return ToolCallResult { success: false, element_id: None, errors: vec![format!("Element {id} not found")] };
        }
        if let Some(np) = new_parent {
            if !self.live.contains_key(np) {
                return ToolCallResult { success: false, element_id: None, errors: vec![format!("Parent {np} not found")] };
            }
            let old = self.live.get(id).and_then(|e| e.parent.clone());
            if let Some(op) = old {
                if let Some(p) = self.live.get_mut(&op) { p.children.retain(|c| c != id); }
            }
            if let Some(p) = self.live.get_mut(np) { if !p.children.iter().any(|c| c == id) { p.children.push(id.into()); } }
            if let Some(el) = self.live.get_mut(id) { el.parent = Some(np.into()); }
        }
        ToolCallResult { success: true, element_id: Some(id.into()), errors: Vec::new() }
    }
}
