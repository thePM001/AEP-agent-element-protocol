// crate: gap-schema-profile-v13
// GAP-285-P1 classic GAP v1.3 live Admit profile. GAP-285-P8 one-law: presence of trust_ring is Deny.
// GAP-OPEN-SOURCE is the one source of this crate. AEP holds a byte pinned copy of src.
// This file depends on serde_json only so the pinned copy builds in any workspace.
use serde_json::{Map, Number, Value};
use yaml_rust2::{Yaml, YamlLoader};

pub const TICKET: &str = "GAP-285-P1";
pub const PROFILE: &str = "v1.3";
/// This crate version. VERSIONING.md in GAP-OPEN-SOURCE links it to the schema and AEP versions.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");
pub const WALL_LEFTOVER_RANK_FIELD: &str = "gap:leftover_rank_field";
pub const WALL_AGENT_PERMISSION: &str = "gap:agent_permission";
/// Exact Deny text when the agent permission wall closes.
pub const DENY_NO_PERMISSION: &str = "this agent does not have permission for this action";
pub const WALL_WRAP_BIND: &str = "gap:wrap:bind";
pub const WALL_PATTERN_GUARD: &str = "gap:pattern:guard";
pub const RANK_SANDBOX: &str = "sandbox";
pub const RANK_USER: &str = "user";
pub const RANK_SYSTEM: &str = "system";
pub const RANK_ENTERPRISE: &str = "enterprise";
pub const SCHEMA_V13_CONTRACT: &str = "GAP Instruction Meta-Schema v1.3\nagent_permission\nwrap\naction_path_prefix\noneOf\nload-time\nPresence of trust_ring is Deny.\nPresence of rank is Deny.\nEvery non-empty rank value is Deny.\nLeftover rank wall id is gap:leftover_rank_field.\ncovenants\nscanners\n";
/// The canonical GAP meta schema v1.3 JSON. Byte copy of schemas/gap-meta-schema-v1.3.json.
pub const SCHEMA_V13_JSON: &str = include_str!("schema_v13.body");

/// One Admit wall. A wall that did not close is open.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdmitWall {
    pub id: String,
    pub closed: bool,
    pub reason: String,
}

impl AdmitWall {
    pub fn open(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            closed: false,
            reason: String::new(),
        }
    }

    pub fn close(id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            closed: true,
            reason: reason.into(),
        }
    }
}

/// Collect-all Admit result. allow is true only when no wall closed.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdmitResult {
    pub allow: bool,
    pub closed: Vec<AdmitWall>,
    pub open: Vec<AdmitWall>,
}

impl AdmitResult {
    pub fn new(closed: Vec<AdmitWall>, open: Vec<AdmitWall>) -> Self {
        Self {
            allow: closed.is_empty(),
            closed,
            open,
        }
    }
}

/// One agent permission record. Agent A may X. Not a rank.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentPermission {
    pub agent_id: String,
    pub action: String,
}

pub fn open_into(id: &str, wall: &mut AdmitWall) {
    *wall = AdmitWall::open(id);
}

pub fn close_into(id: &str, reason: &str, wall: &mut AdmitWall) {
    *wall = AdmitWall::close(id, reason);
}

pub fn schema_v13_body(out: &mut String) {
    out.clear();
    out.push_str(SCHEMA_V13_CONTRACT);
}

pub fn admit_collect_all(walls: &[AdmitWall], out: &mut AdmitResult) {
    let mut closed: Vec<AdmitWall> = Vec::new();
    let mut i = 0usize;
    while i < walls.len() {
        if walls[i].closed {
            closed.push(walls[i].clone());
        }
        i += 1;
    }
    closed.sort_by(|a, b| a.id.cmp(&b.id).then(a.reason.cmp(&b.reason)));
    closed.dedup_by(|a, b| a.id == b.id && a.reason == b.reason);
    let open: Vec<AdmitWall> = walls.iter().filter(|w| !w.closed).cloned().collect();
    *out = AdmitResult::new(closed, open);
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct LiveAdmitRequest {
    pub agent_id: String,
    pub action: String,
    pub wrap: String,
    pub action_path: String,
}

fn json_str(v: &Value, key: &str, out: &mut String) {
    out.clear();
    if let Some(x) = v.get(key) {
        if let Some(s) = x.as_str() {
            out.push_str(s.trim());
        }
    }
}

fn meta_of(doc: &Value) -> &Value {
    if let Some(m) = doc.get("metadata") {
        m
    } else {
        &Value::Null
    }
}

pub fn enabled_is_load_time(out: &mut bool) {
    *out = true;
}

pub fn enabled_skips_admit(_doc: &Value, out: &mut bool) {
    *out = false;
}

fn is_rank_name(name: &str, out: &mut bool) {
    *out =
        name == RANK_SANDBOX || name == RANK_USER || name == RANK_SYSTEM || name == RANK_ENTERPRISE;
}

fn field_present(v: &Value, key: &str, out: &mut bool) {
    *out = v.get(key).is_some();
}

fn value_is_non_empty(v: &Value, out: &mut bool) {
    *out = false;
    match v {
        Value::Null => {}
        Value::Bool(_) => {
            *out = true;
        }
        Value::Number(_) => {
            *out = true;
        }
        Value::String(s) => {
            *out = !s.trim().is_empty();
        }
        Value::Array(a) => {
            *out = !a.is_empty();
        }
        Value::Object(o) => {
            *out = !o.is_empty();
        }
    }
}

pub fn compile_leftover_rank_field_wall(doc: &Value, wall: &mut AdmitWall) {
    let meta = meta_of(doc);
    let mut present = false;
    field_present(meta, "trust_ring", &mut present);
    let mut score_present = false;
    field_present(meta, "trust_score", &mut score_present);
    let mut tier_present = false;
    field_present(meta, "trust_tier", &mut tier_present);
    if score_present {
        present = true;
    }
    if tier_present {
        present = true;
    }
    let mut rank_key = false;
    field_present(meta, "rank", &mut rank_key);
    let mut ring = String::new();
    json_str(meta, "trust_ring", &mut ring);
    let mut rank_val = String::new();
    json_str(meta, "rank", &mut rank_val);
    let mut is_rank = false;
    is_rank_name(&ring, &mut is_rank);
    if !is_rank {
        is_rank_name(&rank_val, &mut is_rank);
    }
    let mut nonempty = false;
    if let Some(x) = meta.get("trust_ring") {
        value_is_non_empty(x, &mut nonempty);
    }
    if !nonempty {
        if let Some(x) = meta.get("rank") {
            value_is_non_empty(x, &mut nonempty);
        }
    }
    if let Some(fleet) = meta.get("fleet") {
        if let Some(spawn) = fleet.get("spawn") {
            let mut ceiling_present = false;
            field_present(spawn, "ring_ceiling", &mut ceiling_present);
            if ceiling_present {
                present = true;
            }
            if !nonempty {
                if let Some(x) = spawn.get("ring_ceiling") {
                    value_is_non_empty(x, &mut nonempty);
                }
            }
            let mut ceiling = String::new();
            json_str(spawn, "ring_ceiling", &mut ceiling);
            if !is_rank {
                is_rank_name(&ceiling, &mut is_rank);
            }
        }
    }
    if present || rank_key || nonempty || is_rank {
        close_into(
            WALL_LEFTOVER_RANK_FIELD,
            "leftover rank field is Deny; agent permission is agent_permission",
            wall,
        );
        return;
    }
    open_into(WALL_LEFTOVER_RANK_FIELD, wall);
}

fn permission_from_value(v: &Value, out: &mut AgentPermission, ok: &mut bool) {
    *ok = false;
    if let Some(s) = v.as_str() {
        let s = s.trim();
        if s.is_empty() {
            return;
        }
        if let Some((a, act)) = s.split_once(char::from(47)) {
            let agent_id = a.trim();
            let action = act.trim();
            if !agent_id.is_empty() && !action.is_empty() {
                out.agent_id = String::from(agent_id);
                out.action = String::from(action);
                *ok = true;
                return;
            }
        }
        out.agent_id = String::from("*");
        out.action = String::from(s);
        *ok = true;
        return;
    }
    if v.is_object() {
        let mut agent_id = String::new();
        let mut action = String::new();
        json_str(v, "agent_id", &mut agent_id);
        json_str(v, "action", &mut action);
        if agent_id.is_empty() || action.is_empty() {
            return;
        }
        out.agent_id = agent_id;
        out.action = action;
        *ok = true;
    }
}

pub fn permissions_from_doc(doc: &Value, out: &mut Vec<AgentPermission>) {
    out.clear();
    let meta = meta_of(doc);
    if let Some(arr) = meta.get("agent_permission").and_then(|x| x.as_array()) {
        let mut i = 0usize;
        while i < arr.len() {
            let mut g = AgentPermission {
                agent_id: String::new(),
                action: String::new(),
            };
            let mut ok = false;
            permission_from_value(&arr[i], &mut g, &mut ok);
            if ok {
                out.push(g);
            }
            i += 1;
        }
    }
}

fn permission_matches(record: &AgentPermission, agent_id: &str, action: &str, out: &mut bool) {
    let star = record.agent_id == "*" && !agent_id.is_empty();
    let named = !agent_id.is_empty() && record.agent_id == agent_id;
    let unbound = record.agent_id == "unbound" && agent_id.is_empty();
    let agent_ok = star || named || unbound;
    let action_ok = record.action == "*" || record.action == action;
    *out = agent_ok && action_ok;
}

pub fn agent_has_permission(
    agent_id: &str,
    action: &str,
    records: &[AgentPermission],
    out: &mut bool,
) {
    *out = false;
    let mut i = 0usize;
    while i < records.len() {
        let mut hit = false;
        permission_matches(&records[i], agent_id, action, &mut hit);
        if hit {
            *out = true;
            return;
        }
        i += 1;
    }
}

pub fn agent_permission_wall_id(agent: &str, action: &str, out: &mut String) {
    out.clear();
    out.push_str(WALL_AGENT_PERMISSION);
    out.push(char::from(58));
    if agent.is_empty() {
        out.push_str("unbound");
    } else {
        out.push_str(agent);
    }
    out.push(char::from(58));
    out.push_str(action);
}

pub fn compile_agent_permission_profile_wall(
    doc: &Value,
    req: &LiveAdmitRequest,
    wall: &mut AdmitWall,
) {
    let agent_id = req.agent_id.trim();
    let action = req.action.trim();
    if agent_id.is_empty() && action.is_empty() {
        open_into(WALL_AGENT_PERMISSION, wall);
        return;
    }
    let meta = meta_of(doc);
    let mut declared = false;
    field_present(meta, "agent_permission", &mut declared);
    if !declared {
        open_into(WALL_AGENT_PERMISSION, wall);
        return;
    }
    let mut records: Vec<AgentPermission> = Vec::new();
    permissions_from_doc(doc, &mut records);
    let mut id = String::new();
    agent_permission_wall_id(agent_id, action, &mut id);
    if records.is_empty() {
        close_into(&id, DENY_NO_PERMISSION, wall);
        return;
    }
    let mut allowed = false;
    agent_has_permission(agent_id, action, &records, &mut allowed);
    if allowed {
        open_into(&id, wall);
        return;
    }
    close_into(&id, DENY_NO_PERMISSION, wall);
}

pub fn action_path_matches_prefix(action_path: &str, prefix: &str, out: &mut bool) {
    let p = prefix.trim();
    let a = action_path.trim();
    *out = false;
    if p.is_empty() || a.is_empty() {
        return;
    }
    if a == p {
        *out = true;
        return;
    }
    if !a.starts_with(p) {
        return;
    }
    let last = p.as_bytes()[p.len() - 1];
    if last == 58 || last == 47 {
        *out = true;
        return;
    }
    let rest = &a[p.len()..];
    *out = rest.starts_with(":") || rest.starts_with("/");
}

pub fn wrap_or_prefix_binds(
    gap_wrap: &str,
    gap_prefix: &str,
    node_wrap: &str,
    action_path: &str,
    out: &mut bool,
) {
    *out = false;
    let w = gap_wrap.trim();
    let nw = node_wrap.trim();
    if !w.is_empty() && w == nw {
        *out = true;
        return;
    }
    let pref = gap_prefix.trim();
    if !pref.is_empty() {
        action_path_matches_prefix(action_path, pref, out);
    }
}

pub fn compile_wrap_prefix_bind(doc: &Value, req: &LiveAdmitRequest, wall: &mut AdmitWall) {
    let meta = meta_of(doc);
    let mut wrap = String::new();
    let mut prefix = String::new();
    json_str(meta, "wrap", &mut wrap);
    json_str(meta, "action_path_prefix", &mut prefix);
    if wrap.is_empty() && prefix.is_empty() {
        open_into(WALL_WRAP_BIND, wall);
        return;
    }
    let mut binds = false;
    wrap_or_prefix_binds(&wrap, &prefix, &req.wrap, &req.action_path, &mut binds);
    if binds {
        open_into(WALL_WRAP_BIND, wall);
    } else {
        close_into(
            WALL_WRAP_BIND,
            "wrap or action_path_prefix does not bind this action_path",
            wall,
        );
    }
}

pub fn compile_guard_wall(doc: &Value, wall: &mut AdmitWall) {
    let p = doc.get("pattern");
    if p.is_none() {
        open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    let p = p.unwrap();
    if p.is_string() {
        open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    let g = p.get("guard");
    if g.is_none() {
        open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    let g = g.unwrap();
    if g.is_string() {
        open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    if g.is_object() {
        let expr = g.get("expr").and_then(|x| x.as_str()).unwrap_or("").trim();
        if expr.is_empty() {
            close_into(
                WALL_PATTERN_GUARD,
                "structured pattern.guard requires expr",
                wall,
            );
        } else {
            open_into(WALL_PATTERN_GUARD, wall);
        }
        return;
    }
    close_into(
        WALL_PATTERN_GUARD,
        "pattern.guard must be a string or a structured object",
        wall,
    );
}

/// Convert one YAML node to the JSON instruction value. Mapping keys must be strings.
pub fn yaml_to_json(node: &Yaml, out: &mut Value, err: &mut String) {
    err.clear();
    match node {
        Yaml::Null => *out = Value::Null,
        Yaml::Boolean(b) => *out = Value::Bool(*b),
        Yaml::Integer(i) => *out = Value::Number((*i).into()),
        Yaml::Real(raw) => match raw.parse::<f64>().ok().and_then(Number::from_f64) {
            Some(n) => *out = Value::Number(n),
            None => {
                err.push_str("number ");
                err.push_str(raw);
                err.push_str(" is not a finite real");
            }
        },
        Yaml::String(s) => *out = Value::String(s.clone()),
        Yaml::Array(items) => {
            let mut arr = Vec::with_capacity(items.len());
            for item in items {
                let mut v = Value::Null;
                yaml_to_json(item, &mut v, err);
                if !err.is_empty() {
                    return;
                }
                arr.push(v);
            }
            *out = Value::Array(arr);
        }
        Yaml::Hash(map) => {
            let mut obj = Map::new();
            for (k, v) in map {
                let key = match k {
                    Yaml::String(s) => s.clone(),
                    _ => {
                        err.push_str("mapping key is not a string");
                        return;
                    }
                };
                let mut x = Value::Null;
                yaml_to_json(v, &mut x, err);
                if !err.is_empty() {
                    return;
                }
                obj.insert(key, x);
            }
            *out = Value::Object(obj);
        }
        Yaml::Alias(_) => err.push_str("YAML alias does not resolve to an anchor"),
        Yaml::BadValue => err.push_str("YAML value could not be read"),
    }
}

/// Read every document of a GAP source. JSON-encoded GAP is one document. YAML 1.2 GAP
/// source may hold several documents separated by `---`. Empty documents are dropped.
pub fn read_gap_documents(src: &str, out: &mut Vec<Value>, err: &mut String) {
    out.clear();
    err.clear();
    let t = src.trim();
    if t.is_empty() {
        err.push_str("empty GAP source");
        return;
    }
    if t.starts_with('{') {
        match serde_json::from_str(t) {
            Ok(v) => out.push(v),
            Err(e) => {
                err.push_str("JSON GAP source parse failed: ");
                err.push_str(&e.to_string());
            }
        }
        return;
    }
    let docs = match YamlLoader::load_from_str(src) {
        Ok(d) => d,
        Err(e) => {
            err.push_str("YAML GAP source parse failed: ");
            err.push_str(&e.to_string());
            return;
        }
    };
    for (i, doc) in docs.iter().enumerate() {
        let mut v = Value::Null;
        yaml_to_json(doc, &mut v, err);
        if !err.is_empty() {
            let detail = std::mem::take(err);
            err.push_str("YAML GAP source document ");
            err.push_str(&i.to_string());
            err.push_str(": ");
            err.push_str(&detail);
            out.clear();
            return;
        }
        if !v.is_null() {
            out.push(v);
        }
    }
    if out.is_empty() {
        err.push_str("YAML GAP source parsed empty");
    }
}

/// Read a YAML GAP source that holds exactly one instruction document.
pub fn parse_yaml_gap(src: &str, out: &mut Value, err: &mut String) {
    let mut docs = Vec::new();
    read_gap_documents(src, &mut docs, err);
    if !err.is_empty() {
        return;
    }
    one_document(docs, out, err);
}

fn one_document(mut docs: Vec<Value>, out: &mut Value, err: &mut String) {
    if docs.len() != 1 {
        err.push_str("a GAP source judged at Admit holds one instruction document, found ");
        err.push_str(&docs.len().to_string());
        return;
    }
    *out = docs.remove(0);
}

/// Read the one instruction of a GAP source. The live kernel judges exactly this object.
pub fn parse_gap_source(src: &str, out: &mut Value, err: &mut String) {
    let mut docs = Vec::new();
    read_gap_documents(src, &mut docs, err);
    if !err.is_empty() {
        return;
    }
    one_document(docs, out, err);
}

pub fn live_admit_gap_profile(
    source: &str,
    req: &LiveAdmitRequest,
    out: &mut AdmitResult,
    err: &mut String,
) {
    err.clear();
    let mut doc = Value::Null;
    parse_gap_source(source, &mut doc, err);
    if !err.is_empty() {
        return;
    }
    let mut walls: Vec<AdmitWall> = Vec::new();
    // the wall row is the public AdmitWall row.
    let mut w1 = AdmitWall::open("");
    let mut w2 = w1.clone();
    let mut w3 = w1.clone();
    let mut w4 = w1.clone();
    compile_leftover_rank_field_wall(&doc, &mut w1);
    compile_agent_permission_profile_wall(&doc, req, &mut w2);
    compile_wrap_prefix_bind(&doc, req, &mut w3);
    compile_guard_wall(&doc, &mut w4);
    walls.push(w1);
    walls.push(w2);
    walls.push(w3);
    walls.push(w4);
    admit_collect_all(&walls, out);
}

pub mod parse_gap_source {
    use super::Value;
    pub struct ParseGapSource {
        pub source: String,
        pub result: Value,
        pub err: String,
    }
    impl Default for ParseGapSource {
        fn default() -> Self {
            Self::new()
        }
    }

    impl ParseGapSource {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                result: Value::Null,
                err: String::new(),
            }
        }
        pub fn process(&mut self) {
            super::parse_gap_source(&self.source, &mut self.result, &mut self.err);
        }
    }
}

pub mod live_admit_gap_profile {
    use super::{AdmitResult, LiveAdmitRequest};
    pub struct LiveAdmitGapProfile {
        pub source: String,
        pub request: LiveAdmitRequest,
        pub result: AdmitResult,
        pub err: String,
    }
    impl Default for LiveAdmitGapProfile {
        fn default() -> Self {
            Self::new()
        }
    }

    impl LiveAdmitGapProfile {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                request: LiveAdmitRequest::default(),
                result: AdmitResult::new(Vec::new(), Vec::new()),
                err: String::new(),
            }
        }
        pub fn process(&mut self) {
            super::live_admit_gap_profile(
                &self.source,
                &self.request,
                &mut self.result,
                &mut self.err,
            );
        }
    }
}

pub mod enabled_is_load_time {
    pub struct EnabledIsLoadTime {
        pub source: String,
        pub result: bool,
    }
    impl Default for EnabledIsLoadTime {
        fn default() -> Self {
            Self::new()
        }
    }

    impl EnabledIsLoadTime {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                result: true,
            }
        }
        pub fn process(&mut self) {
            let _ = &self.source;
            super::enabled_is_load_time(&mut self.result);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_yaml_rank() -> String {
        String::from("address:\n  domain: com.example.old\n  id: rank-doc\npattern: old pattern\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  trust_ring: user\n")
    }

    fn sample_yaml_profile() -> String {
        String::from("address:\n  domain: com.example.live\n  id: profile-doc\npattern:\n  guard:\n    expr: wrap == finance\n    lang: gapdsl\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  agent_permission:\n    - agent_id: agent-a\n      action: write\n  wrap: finance\n  action_path_prefix: finance\nenabled: false\n")
    }

    #[test]
    fn yaml_gap_source_parses() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&sample_yaml_profile(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut id = String::new();
        json_str(&doc["address"], "id", &mut id);
        assert_eq!(id.as_str(), "profile-doc");
        assert_eq!(doc.get("enabled").and_then(|v| v.as_bool()), Some(false));
    }

    #[test]
    fn json_gap_source_parses() {
        let src = "{\"address\":{\"domain\":\"com.example.live\",\"id\":\"json-doc\"},\"pattern\":\"p\",\"action\":{\"type\":\"template\",\"content\":\"c\"},\"weight\":1.0,\"composition\":{\"type\":\"atomic\"},\"metadata\":{\"provenance\":\"system.seed\",\"version\":\"1.0.0\",\"stability\":\"experimental\"}}";
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(src, &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut id = String::new();
        json_str(&doc["address"], "id", &mut id);
        assert_eq!(id.as_str(), "json-doc");
    }

    #[test]
    fn structured_guard_parses() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&sample_yaml_profile(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut wall = AdmitWall::open("");
        compile_guard_wall(&doc, &mut wall);
        assert!(!wall.closed);
        let g = doc["pattern"]["guard"]["expr"].as_str().unwrap_or("");
        assert!(g.contains("finance"));
    }

    #[test]
    fn old_v12_rank_doc_still_parses() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&sample_yaml_rank(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut ring = String::new();
        json_str(meta_of(&doc), "trust_ring", &mut ring);
        assert_eq!(ring.as_str(), "user");
    }

    #[test]
    fn trust_ring_user_fails_live_admit() {
        let req = LiveAdmitRequest::default();
        let mut result = AdmitResult::new(Vec::new(), Vec::new());
        let mut err = String::new();
        live_admit_gap_profile(&sample_yaml_rank(), &req, &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert!(!result.allow);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id == WALL_LEFTOVER_RANK_FIELD {
                hit = true;
            }
            i += 1;
        }
        assert!(hit);
    }
}

#[cfg(test)]
mod tests_more {
    use super::*;

    fn profile() -> String {
        String::from("address:\n  domain: com.example.live\n  id: profile-doc\npattern:\n  guard:\n    expr: wrap == finance\n    lang: gapdsl\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  agent_permission:\n    - agent_id: agent-a\n      action: write\n  wrap: finance\n  action_path_prefix: finance\nenabled: false\n")
    }

    #[test]
    fn enabled_false_still_evaluates_agent_permission() {
        let req = LiveAdmitRequest {
            agent_id: String::from("agent-b"),
            action: String::from("write"),
            wrap: String::from("finance"),
            action_path: String::from("finance/pay"),
        };
        let mut result = AdmitResult::new(Vec::new(), Vec::new());
        let mut err = String::new();
        live_admit_gap_profile(&profile(), &req, &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert!(!result.allow);
        let mut may_id = String::new();
        agent_permission_wall_id("agent-b", "write", &mut may_id);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id == may_id {
                hit = true;
            }
            i += 1;
        }
        assert!(hit);
        let mut skip = true;
        enabled_skips_admit(&Value::Bool(false), &mut skip);
        assert!(!skip);
        let mut load = false;
        enabled_is_load_time(&mut load);
        assert!(load);
    }

    #[test]
    fn agent_a_may_write_not_agent_b() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&profile(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut a = AdmitWall::open("");
        let mut b = a.clone();
        compile_agent_permission_profile_wall(
            &doc,
            &LiveAdmitRequest {
                agent_id: String::from("agent-a"),
                action: String::from("write"),
                wrap: String::from("finance"),
                action_path: String::from("finance/pay"),
            },
            &mut a,
        );
        compile_agent_permission_profile_wall(
            &doc,
            &LiveAdmitRequest {
                agent_id: String::from("agent-b"),
                action: String::from("write"),
                wrap: String::from("finance"),
                action_path: String::from("finance/pay"),
            },
            &mut b,
        );
        assert!(!a.closed);
        assert!(b.closed);
    }

    #[test]
    fn wrap_finance_not_inventory() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&profile(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut okw = AdmitWall::open("");
        let mut bad = okw.clone();
        compile_wrap_prefix_bind(
            &doc,
            &LiveAdmitRequest {
                agent_id: String::from("agent-a"),
                action: String::from("write"),
                wrap: String::from("finance"),
                action_path: String::from("finance/pay"),
            },
            &mut okw,
        );
        compile_wrap_prefix_bind(
            &doc,
            &LiveAdmitRequest {
                agent_id: String::from("agent-a"),
                action: String::from("write"),
                wrap: String::from("inventory"),
                action_path: String::from("inventory/stock"),
            },
            &mut bad,
        );
        assert!(!okw.closed);
        assert!(bad.closed);
    }

    #[test]
    fn schema_v13_body_contains_required_fields() {
        let mut body = String::new();
        schema_v13_body(&mut body);
        assert!(body.contains("agent_permission"));
        assert!(body.contains("action_path_prefix"));
        assert!(body.contains("wrap"));
        assert!(body.contains("oneOf"));
        assert!(body.contains("load-time"));
        assert!(body.contains("Presence of trust_ring is Deny"));
        assert!(body.contains("Presence of rank is Deny"));
        assert!(body.contains("Every non-empty rank value is Deny"));
        assert!(body.contains("Leftover rank wall id is gap:leftover_rank_field"));
        assert!(body.contains("covenants"));
        assert!(body.contains("scanners"));
        assert!(body.contains("v1.3"));
    }

    #[test]
    fn schema_v13_json_is_the_v13_meta_schema() {
        let schema: Value = serde_json::from_str(SCHEMA_V13_JSON).unwrap_or(Value::Null);
        let mut id = String::new();
        json_str(&schema, "$id", &mut id);
        assert_eq!(
            id.as_str(),
            "https://gap-lang.aep.dev/schemas/gap-meta-schema-v1.3.json"
        );
        let meta = &schema["$defs"]["Metadata"];
        assert_eq!(meta["additionalProperties"], Value::Bool(false));
        assert!(meta["properties"].get("agent_permission").is_some());
        assert!(meta["properties"].get("aep_version").is_some());
        assert!(meta["properties"].get("trust_ring").is_none());
        assert!(meta["properties"].get("rank").is_none());
    }

    #[test]
    fn schema_v13_json_presence_is_deny() {
        let body = include_str!("schema_v13.body");
        assert!(body.contains("Presence of trust_ring is Deny"));
        assert!(body.contains("Presence of rank is Deny"));
        assert!(body.contains("Every non-empty rank value is Deny"));
        assert!(!body.contains("\"rank\":"));
        assert!(!body.contains("\"trust_ring\":"));
        assert!(!body.contains("subprotocol"));
        assert_eq!(body, SCHEMA_V13_JSON);
        assert!(!body.contains("documentary"));
        assert!(!body.contains("Not a live Admit floor"));
        assert!(!body.contains("unused at Admit"));
        assert!(!body.contains("\"enum\": [\"sandbox\", \"user\", \"system\", \"enterprise\"]"));
        assert!(body.contains("agent_permission"));
    }

    fn yaml_trust_ring(value: &str) -> String {
        let mut s = String::from("address:\n  domain: com.example.old\n  id: rank-doc\npattern: old pattern\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  trust_ring: ");
        s.push_str(value);
        s.push('\n');
        s
    }

    fn json_meta_extra(extra: &str) -> String {
        let mut s = String::from("{\"address\":{\"domain\":\"com.example.old\",\"id\":\"rank-doc\"},\"pattern\":\"p\",\"action\":{\"type\":\"template\",\"content\":\"c\"},\"weight\":1.0,\"composition\":{\"type\":\"atomic\"},\"metadata\":{\"provenance\":\"system.seed\",\"version\":\"1.0.0\",\"stability\":\"experimental\"");
        s.push_str(extra);
        s.push_str("}}");
        s
    }

    fn assert_rank_wall_closed(src: &str) {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(src, &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut wall = AdmitWall::open("");
        compile_leftover_rank_field_wall(&doc, &mut wall);
        assert!(wall.closed);
        assert_eq!(wall.id.as_str(), WALL_LEFTOVER_RANK_FIELD);
        let mut result = AdmitResult::new(Vec::new(), Vec::new());
        live_admit_gap_profile(src, &LiveAdmitRequest::default(), &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert!(!result.allow);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id == WALL_LEFTOVER_RANK_FIELD && result.closed[i].closed {
                hit = true;
            }
            i += 1;
        }
        assert!(hit);
    }

    fn yaml_rank_field(value: &str) -> String {
        let mut s = String::from("address:\n  domain: com.example.old\n  id: rank-doc\npattern: old pattern\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  rank: ");
        s.push_str(value);
        s.push('\n');
        s
    }

    #[test]
    fn document_that_sets_leftover_rank_field_closes() {
        assert_rank_wall_closed(&yaml_rank_field(RANK_USER));
        assert_rank_wall_closed(&json_meta_extra(",\"rank\":\"user\""));
        assert_rank_wall_closed(&json_meta_extra(",\"trust_ring\":\"user\""));
    }

    #[test]
    fn every_non_empty_rank_value_keeps_compiled_wall_deny() {
        assert_rank_wall_closed(&yaml_trust_ring(RANK_SANDBOX));
        assert_rank_wall_closed(&yaml_trust_ring(RANK_USER));
        assert_rank_wall_closed(&yaml_trust_ring(RANK_SYSTEM));
        assert_rank_wall_closed(&yaml_trust_ring(RANK_ENTERPRISE));
        assert_rank_wall_closed(&yaml_trust_ring("other"));
        assert_rank_wall_closed(&yaml_rank_field(RANK_SANDBOX));
        assert_rank_wall_closed(&yaml_rank_field(RANK_USER));
        assert_rank_wall_closed(&yaml_rank_field(RANK_SYSTEM));
        assert_rank_wall_closed(&yaml_rank_field(RANK_ENTERPRISE));
        assert_rank_wall_closed(&yaml_rank_field("other"));
    }

    #[test]
    fn presence_of_trust_ring_on_live_document_is_deny() {
        assert_rank_wall_closed(&json_meta_extra(",\"trust_ring\":\"\""));
        assert_rank_wall_closed(&json_meta_extra(",\"trust_ring\":null"));
        assert_rank_wall_closed(&json_meta_extra(",\"trust_ring\":1"));
        assert_rank_wall_closed(&json_meta_extra(",\"rank\":\"user\""));
        assert_rank_wall_closed(&json_meta_extra(",\"rank\":\"\""));
        assert_rank_wall_closed(&json_meta_extra(",\"rank\":null"));
        assert_rank_wall_closed(&json_meta_extra(",\"rank\":1"));
    }

    #[test]
    fn leftover_score_and_tier_fields_close() {
        assert_rank_wall_closed(&json_meta_extra(",\"trust_score\":1"));
        assert_rank_wall_closed(&json_meta_extra(",\"trust_tier\":\"high\""));
    }

    #[test]
    fn presence_of_ring_ceiling_rank_keeps_compiled_wall_deny() {
        let src = String::from("address:\n  domain: com.example.old\n  id: rank-doc\npattern: old pattern\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  fleet:\n    spawn:\n      ring_ceiling: user\n");
        assert_rank_wall_closed(&src);
        assert_rank_wall_closed(&yaml_trust_ring(RANK_SANDBOX));
    }

    #[test]
    fn empty_list_refuses_on_miss_for_agent_action() {
        // A declared but empty agent_permission list refuses on miss. An
        // undeclared list keeps the wall open, see compile_agent_permission_profile_wall.
        let src = String::from("address:\n  domain: com.example.live\n  id: empty-list\npattern: p\naction:\n  type: template\n  content: c\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  agent_permission: []\n");
        let mut result = AdmitResult::new(Vec::new(), Vec::new());
        let mut err = String::new();
        live_admit_gap_profile(
            &src,
            &LiveAdmitRequest {
                agent_id: String::from("agent-a"),
                action: String::from("write"),
                wrap: String::new(),
                action_path: String::new(),
            },
            &mut result,
            &mut err,
        );
        assert_eq!(err.as_str(), "");
        assert!(!result.allow);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id.starts_with(WALL_AGENT_PERMISSION) {
                hit = true;
            }
            i += 1;
        }
        assert!(hit);
    }

    #[test]
    fn leftover_rank_wall_id_is_gap_leftover_rank_field() {
        assert_eq!(WALL_LEFTOVER_RANK_FIELD, "gap:leftover_rank_field");
        assert!(!WALL_LEFTOVER_RANK_FIELD.contains("trust_ring:rank"));
    }

    #[test]
    fn document_that_omits_leftover_rank_field_does_not_close_on_that_wall() {
        let src = profile();
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&src, &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut wall = AdmitWall::close("", "unset");
        compile_leftover_rank_field_wall(&doc, &mut wall);
        assert!(!wall.closed);
        assert_eq!(wall.id.as_str(), WALL_LEFTOVER_RANK_FIELD);
        let mut result = AdmitResult::new(Vec::new(), Vec::new());
        live_admit_gap_profile(
            &src,
            &LiveAdmitRequest {
                agent_id: String::from("agent-a"),
                action: String::from("write"),
                wrap: String::from("finance"),
                action_path: String::from("finance/pay"),
            },
            &mut result,
            &mut err,
        );
        assert_eq!(err.as_str(), "");
        assert!(!result
            .closed
            .iter()
            .any(|w| w.id == WALL_LEFTOVER_RANK_FIELD));
    }

    #[test]
    fn undeclared_agent_permission_keeps_the_wall_open() {
        let src = String::from("address:\n  domain: com.example.live\n  id: no-list\npattern: p\naction:\n  type: template\n  content: c\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n");
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&src, &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut wall = AdmitWall::close("", "unset");
        compile_agent_permission_profile_wall(
            &doc,
            &LiveAdmitRequest {
                agent_id: String::from("agent-a"),
                action: String::from("write"),
                wrap: String::new(),
                action_path: String::new(),
            },
            &mut wall,
        );
        assert!(!wall.closed);
        assert_eq!(wall.id.as_str(), WALL_AGENT_PERMISSION);
    }

    #[test]
    fn yaml_reals_and_single_quotes_read_as_yaml() {
        let src = "address:\n  domain: com.example.live\n  id: scalars\npattern: 'it''s'\naction:\n  type: template\n  content: c\nweight: 0.75\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  grade: 8\n";
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(src, &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        assert_eq!(doc["weight"].as_f64(), Some(0.75));
        assert_eq!(doc["metadata"]["grade"].as_i64(), Some(8));
        assert_eq!(doc["pattern"].as_str(), Some("it's"));
        assert_eq!(doc["metadata"]["version"].as_str(), Some("1.0.0"));
    }

    #[test]
    fn block_scalar_does_not_hide_the_metadata_below_it() {
        // A block scalar above metadata once stopped the reader, so trust_ring below it
        // never reached the leftover rank wall and the document passed Admit.
        let src = "address:\n  domain: com.example.old\n  id: hidden-rank\npattern: |\n  Review pull requests.\n  Name file and line.\naction:\n  type: template\n  content: >\n    folded\n    text\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  trust_ring: user\n  agent_permission: [agent-a/write]\n";
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(src, &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        assert_eq!(
            doc["pattern"].as_str(),
            Some("Review pull requests.\nName file and line.\n")
        );
        assert_eq!(doc["action"]["content"].as_str(), Some("folded text\n"));
        let mut records = Vec::new();
        permissions_from_doc(&doc, &mut records);
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].agent_id.as_str(), "agent-a");
        let mut result = AdmitResult::new(Vec::new(), Vec::new());
        live_admit_gap_profile(src, &LiveAdmitRequest::default(), &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert!(!result.allow);
        assert!(result
            .closed
            .iter()
            .any(|w| w.id == WALL_LEFTOVER_RANK_FIELD));
    }

    #[test]
    fn admit_source_holds_one_instruction() {
        let one = "address:\n  domain: a.b\n  id: x\n";
        let two = format!("{one}---\n{one}");
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&two, &mut doc, &mut err);
        assert!(err.contains("one instruction document, found 2"));
        let mut docs = Vec::new();
        read_gap_documents(&two, &mut docs, &mut err);
        assert_eq!(err.as_str(), "");
        assert_eq!(docs.len(), 2);
        parse_gap_source("a: [1, 2\n", &mut doc, &mut err);
        assert!(err.starts_with("YAML GAP source parse failed"));
        parse_gap_source("{1: 2}", &mut doc, &mut err);
        assert!(err.starts_with("JSON GAP source parse failed"));
        parse_gap_source("? [a]\n: b\n", &mut doc, &mut err);
        assert!(err.contains("mapping key is not a string"));
    }

    #[test]
    fn hvvc_as_process_live_admit() {
        let mut svc = live_admit_gap_profile::LiveAdmitGapProfile::new();
        svc.source = profile();
        svc.request.agent_id = String::from("agent-a");
        svc.request.action = String::from("write");
        svc.request.wrap = String::from("finance");
        svc.request.action_path = String::from("finance/pay");
        svc.process();
        assert_eq!(svc.err.as_str(), "");
        assert!(svc.result.allow);
        let mut load = false;
        enabled_is_load_time(&mut load);
        assert!(load);
    }
}
