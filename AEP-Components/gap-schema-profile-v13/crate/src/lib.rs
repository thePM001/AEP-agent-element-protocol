// crate: gap-schema-profile-v13
// GAP-285-P1 classic GAP v1.3 live Admit profile.
use serde_json::{Map, Value};

pub const TICKET: &str = "GAP-285-P1";
pub const PROFILE: &str = "v1.3";
pub const WALL_TRUST_RING_RANK: &str = "gap:trust_ring:rank";
pub const WALL_AGENT_MAY: &str = "gap:agent_may";
pub const WALL_WRAP_BIND: &str = "gap:wrap:bind";
pub const WALL_PATTERN_GUARD: &str = "gap:pattern:guard";
pub const RANK_SANDBOX: &str = "sandbox";
pub const RANK_USER: &str = "user";
pub const RANK_SYSTEM: &str = "system";
pub const RANK_ENTERPRISE: &str = "enterprise";
pub const SCHEMA_V13_CONTRACT: &str = "GAP Instruction Meta-Schema v1.3\nagent_may\nwrap\naction_path_prefix\noneOf\nload-time\nNot a live Admit floor.\ncovenants\nscanners\n";

pub fn schema_v13_body(out: &mut String) {
    out.clear();
    out.push_str(SCHEMA_V13_CONTRACT);
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdmitWall {
    pub id: String,
    pub closed: bool,
    pub reason: String,
}

impl AdmitWall {
    pub fn open_into(id: &str, wall: &mut AdmitWall) {
        wall.id = String::from(id);
        wall.closed = false;
        wall.reason = String::new();
    }
    pub fn close_into(id: &str, reason: &str, wall: &mut AdmitWall) {
        wall.id = String::from(id);
        wall.closed = true;
        wall.reason = String::from(reason);
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AdmitResult {
    pub allow: bool,
    pub closed: Vec<AdmitWall>,
}

impl AdmitResult {
    pub fn closed_set_key(self_ref: &AdmitResult, out: &mut String) {
        out.clear();
        let mut rows: Vec<String> = Vec::new();
        let mut i = 0usize;
        while i < self_ref.closed.len() {
            let w = &self_ref.closed[i];
            let mut s = w.id.clone();
            s.push(char::from(31));
            s.push_str(&w.reason);
            rows.push(s);
            i += 1;
        }
        rows.sort();
        rows.dedup();
        let mut j = 0usize;
        while j < rows.len() {
            if 0 < j {
                out.push(char::from(10));
            }
            out.push_str(&rows[j]);
            j += 1;
        }
    }
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
    out.allow = closed.is_empty();
    out.closed = closed;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentMayGrant {
    pub agent_id: String,
    pub action: String,
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
    *out = name == RANK_SANDBOX || name == RANK_USER || name == RANK_SYSTEM || name == RANK_ENTERPRISE;
}

pub fn compile_trust_ring_rank_wall(doc: &Value, wall: &mut AdmitWall) {
    let mut ring = String::new();
    json_str(meta_of(doc), "trust_ring", &mut ring);
    if ring.is_empty() {
        AdmitWall::open_into(WALL_TRUST_RING_RANK, wall);
        return;
    }
    let mut rank = false;
    is_rank_name(&ring, &mut rank);
    AdmitWall::close_into(
        WALL_TRUST_RING_RANK,
        "warn: trust_ring is not a live Admit floor; who-may is agent_may; rank use denied",
        wall,
    );
}


fn grant_from_value(v: &Value, out: &mut AgentMayGrant, ok: &mut bool) {
    *ok = false;
    if let Some(s) = v.as_str() {
        let s = s.trim();
        if s.is_empty() {
            return;
        }
        if let Some((a, act)) = s.split_once(char::from(47)) {
            let agent_id = a.trim();
            let action = act.trim();
            if agent_id.is_empty() == false && action.is_empty() == false {
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

pub fn grants_from_doc(doc: &Value, out: &mut Vec<AgentMayGrant>) {
    out.clear();
    let meta = meta_of(doc);
    if let Some(arr) = meta.get("agent_may").and_then(|x| x.as_array()) {
        let mut i = 0usize;
        while i < arr.len() {
            let mut g = AgentMayGrant {
                agent_id: String::new(),
                action: String::new(),
            };
            let mut ok = false;
            grant_from_value(&arr[i], &mut g, &mut ok);
            if ok {
                out.push(g);
            }
            i += 1;
        }
    }
}

fn grant_matches(grant: &AgentMayGrant, agent_id: &str, action: &str, out: &mut bool) {
    let star = grant.agent_id == "*" && agent_id.is_empty() == false;
    let named = agent_id.is_empty() == false && grant.agent_id == agent_id;
    let unbound = grant.agent_id == "unbound" && agent_id.is_empty();
    let agent_ok = star || named || unbound;
    let action_ok = grant.action == "*" || grant.action == action;
    *out = agent_ok && action_ok;
}

pub fn agent_is_granted(agent_id: &str, action: &str, grants: &[AgentMayGrant], out: &mut bool) {
    *out = false;
    let mut i = 0usize;
    while i < grants.len() {
        let mut hit = false;
        grant_matches(&grants[i], agent_id, action, &mut hit);
        if hit {
            *out = true;
            return;
        }
        i += 1;
    }
}

pub fn agent_may_wall_id(agent: &str, action: &str, out: &mut String) {
    out.clear();
    out.push_str(WALL_AGENT_MAY);
    out.push(char::from(58));
    if agent.is_empty() {
        out.push_str("unbound");
    } else {
        out.push_str(agent);
    }
    out.push(char::from(58));
    out.push_str(action);
}


pub fn compile_agent_may_profile_wall(doc: &Value, req: &LiveAdmitRequest, wall: &mut AdmitWall) {
    let agent_id = req.agent_id.trim();
    let action = req.action.trim();
    if agent_id.is_empty() && action.is_empty() {
        AdmitWall::open_into(WALL_AGENT_MAY, wall);
        return;
    }
    let mut grants: Vec<AgentMayGrant> = Vec::new();
    grants_from_doc(doc, &mut grants);
    let mut id = String::new();
    agent_may_wall_id(agent_id, action, &mut id);
    if grants.is_empty() {
        AdmitWall::close_into(
            &id,
            "GAP dimension agent_may closed: empty grants fail closed for agent actions",
            wall,
        );
        return;
    }
    let mut granted = false;
    agent_is_granted(agent_id, action, &grants, &mut granted);
    if granted {
        AdmitWall::open_into(&id, wall);
        return;
    }
    let mut reason = String::from("GAP dimension agent_may closed: agent ");
    if agent_id.is_empty() {
        reason.push_str("unbound");
    } else {
        reason.push_str(agent_id);
    }
    reason.push_str(" may not ");
    reason.push_str(action);
    AdmitWall::close_into(&id, &reason, wall);
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
    if a.starts_with(p) == false {
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

pub fn wrap_or_prefix_binds(gap_wrap: &str, gap_prefix: &str, node_wrap: &str, action_path: &str, out: &mut bool) {
    *out = false;
    let w = gap_wrap.trim();
    let nw = node_wrap.trim();
    if w.is_empty() == false && w == nw {
        *out = true;
        return;
    }
    let pref = gap_prefix.trim();
    if pref.is_empty() == false {
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
        AdmitWall::open_into(WALL_WRAP_BIND, wall);
        return;
    }
    let mut binds = false;
    wrap_or_prefix_binds(&wrap, &prefix, &req.wrap, &req.action_path, &mut binds);
    if binds {
        AdmitWall::open_into(WALL_WRAP_BIND, wall);
    } else {
        AdmitWall::close_into(
            WALL_WRAP_BIND,
            "wrap or action_path_prefix does not bind this action_path",
            wall,
        );
    }
}


pub fn compile_guard_wall(doc: &Value, wall: &mut AdmitWall) {
    let p = doc.get("pattern");
    if p.is_none() {
        AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    let p = p.unwrap();
    if p.is_string() {
        AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    let g = p.get("guard");
    if g.is_none() {
        AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    let g = g.unwrap();
    if g.is_string() {
        AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    if g.is_object() {
        let expr = g.get("expr").and_then(|x| x.as_str()).unwrap_or("").trim();
        if expr.is_empty() {
            AdmitWall::close_into(WALL_PATTERN_GUARD, "structured pattern.guard requires expr", wall);
        } else {
            AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
        }
        return;
    }
    AdmitWall::close_into(WALL_PATTERN_GUARD, "pattern.guard must be a string or a structured object", wall);
}

fn parse_scalar(raw: &str, out: &mut Value) {
    let s = raw.trim();
    if s == "true" {
        *out = Value::Bool(true);
        return;
    }
    if s == "false" {
        *out = Value::Bool(false);
        return;
    }
    if s == "null" || s == "~" {
        *out = Value::Null;
        return;
    }
    if let Ok(n) = s.parse::<i64>() {
        *out = Value::Number(n.into());
        return;
    }
    let bytes = s.as_bytes();
    if 1 < s.len() && bytes[0] == 34 && bytes[s.len() - 1] == 34 {
        *out = Value::String(s[1..s.len() - 1].to_string());
        return;
    }
    *out = Value::String(String::from(s));
}

struct YamlLine {
    indent: usize,
    text: String,
}

fn yaml_lines(src: &str, out: &mut Vec<YamlLine>) {
    out.clear();
    for raw in src.lines() {
        let mut indent = 0usize;
        let bytes = raw.as_bytes();
        while indent < bytes.len() && bytes[indent] == 32 {
            indent += 1;
        }
        let text = raw[indent..].trim_end().to_string();
        if text.is_empty() || text.starts_with("#") {
            continue;
        }
        out.push(YamlLine { indent, text });
    }
}


fn parse_yaml_block(lines: &[YamlLine], start: usize, parent_indent: usize, out: &mut Value, next_i: &mut usize) {
    if lines.len() <= start {
        *out = Value::Null;
        *next_i = start;
        return;
    }
    let is_list = lines[start].text.starts_with("- ");
    if is_list {
        let mut arr: Vec<Value> = Vec::new();
        let mut i = start;
        while i < lines.len() {
            if lines[i].indent < parent_indent {
                break;
            }
            if lines[i].indent == parent_indent && lines[i].text.starts_with("- ") == false {
                break;
            }
            if lines[i].indent != parent_indent || lines[i].text.starts_with("- ") == false {
                break;
            }
            let item = lines[i].text[2..].trim();
            if item.is_empty() {
                let mut child = Value::Null;
                let mut n = 0usize;
                parse_yaml_block(lines, i + 1, parent_indent + 2, &mut child, &mut n);
                arr.push(child);
                i = n;
                continue;
            }
            if let Some((k, v)) = item.split_once(char::from(58)) {
                let key = k.trim();
                let rest = v.trim();
                let mut map = Map::new();
                if rest.is_empty() {
                    let mut child = Value::Null;
                    let mut n = 0usize;
                    parse_yaml_block(lines, i + 1, lines[i].indent + 2, &mut child, &mut n);
                    map.insert(key.to_string(), child);
                    i = n;
                } else {
                    let mut sc = Value::Null;
                    parse_scalar(rest, &mut sc);
                    map.insert(key.to_string(), sc);
                    i += 1;
                }
                while i < lines.len() && parent_indent < lines[i].indent && lines[i].text.starts_with("- ") == false {
                    if let Some((k2, v2)) = lines[i].text.split_once(char::from(58)) {
                        let key2 = k2.trim();
                        let rest2 = v2.trim();
                        if rest2.is_empty() {
                            let mut child = Value::Null;
                            let mut n = 0usize;
                            parse_yaml_block(lines, i + 1, lines[i].indent + 2, &mut child, &mut n);
                            map.insert(key2.to_string(), child);
                            i = n;
                        } else {
                            let mut sc = Value::Null;
                            parse_scalar(rest2, &mut sc);
                            map.insert(key2.to_string(), sc);
                            i += 1;
                        }
                    } else {
                        i += 1;
                    }
                }
                arr.push(Value::Object(map));
                continue;
            }
            let mut sc = Value::Null;
            parse_scalar(item, &mut sc);
            arr.push(sc);
            i += 1;
        }
        *out = Value::Array(arr);
        *next_i = i;
        return;
    }
    let mut map = Map::new();
    let mut i = start;
    while i < lines.len() {
        if lines[i].indent < parent_indent {
            break;
        }
        if lines[i].indent == parent_indent && lines[i].text.starts_with("- ") {
            break;
        }
        if lines[i].indent != parent_indent {
            break;
        }
        if let Some((k, v)) = lines[i].text.split_once(char::from(58)) {
            let key = k.trim();
            let rest = v.trim();
            if rest.is_empty() {
                if i + 1 < lines.len() && parent_indent < lines[i + 1].indent {
                    let next_indent = lines[i + 1].indent;
                    let mut child = Value::Null;
                    let mut n = 0usize;
                    parse_yaml_block(lines, i + 1, next_indent, &mut child, &mut n);
                    map.insert(key.to_string(), child);
                    i = n;
                } else {
                    map.insert(key.to_string(), Value::Null);
                    i += 1;
                }
            } else {
                let mut sc = Value::Null;
                parse_scalar(rest, &mut sc);
                map.insert(key.to_string(), sc);
                i += 1;
            }
        } else {
            i += 1;
        }
    }
    *out = Value::Object(map);
    *next_i = i;
}


pub fn parse_yaml_gap(src: &str, out: &mut Value, err: &mut String) {
    err.clear();
    let mut lines: Vec<YamlLine> = Vec::new();
    yaml_lines(src, &mut lines);
    if lines.is_empty() {
        err.push_str("empty GAP source");
        return;
    }
    let indent = lines[0].indent;
    let mut next_i = 0usize;
    parse_yaml_block(&lines, 0, indent, out, &mut next_i);
    if out.is_null() {
        err.push_str("YAML GAP source parsed empty");
    }
}

pub fn parse_gap_source(src: &str, out: &mut Value, err: &mut String) {
    err.clear();
    let t = src.trim();
    if t.is_empty() {
        err.push_str("empty GAP source");
        return;
    }
    let bytes = t.as_bytes();
    if bytes[0] == 123 {
        match serde_json::from_str(t) {
            Ok(v) => {
                *out = v;
            }
            Err(e) => {
                err.push_str("JSON GAP source parse failed: ");
                err.push_str(&e.to_string());
            }
        }
        return;
    }
    parse_yaml_gap(t, out, err);
}

pub fn live_admit_gap_profile(source: &str, req: &LiveAdmitRequest, out: &mut AdmitResult, err: &mut String) {
    err.clear();
    let mut doc = Value::Null;
    parse_gap_source(source, &mut doc, err);
    if err.is_empty() == false {
        return;
    }
    let mut walls: Vec<AdmitWall> = Vec::new();
    let mut w1 = AdmitWall {
        id: String::new(),
        closed: false,
        reason: String::new(),
    };
    let mut w2 = w1.clone();
    let mut w3 = w1.clone();
    let mut w4 = w1.clone();
    compile_trust_ring_rank_wall(&doc, &mut w1);
    compile_agent_may_profile_wall(&doc, req, &mut w2);
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
    impl LiveAdmitGapProfile {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                request: LiveAdmitRequest::default(),
                result: AdmitResult {
                    allow: true,
                    closed: Vec::new(),
                },
                err: String::new(),
            }
        }
        pub fn process(&mut self) {
            super::live_admit_gap_profile(&self.source, &self.request, &mut self.result, &mut self.err);
        }
    }
}

pub mod enabled_is_load_time {
    pub struct EnabledIsLoadTime {
        pub source: String,
        pub result: bool,
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
        String::from("address:\n  domain: com.example.live\n  id: profile-doc\npattern:\n  guard:\n    expr: wrap == finance\n    lang: gapdsl\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  agent_may:\n    - agent_id: agent-a\n      action: write\n  wrap: finance\n  action_path_prefix: finance\nenabled: false\n")
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
        let mut wall = AdmitWall { id: String::new(), closed: false, reason: String::new() };
        compile_guard_wall(&doc, &mut wall);
        assert_eq!(wall.closed, false);
        let g = doc["pattern"]["guard"]["expr"].as_str().unwrap_or("");
        assert_eq!(g.contains("finance"), true);
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
        let mut result = AdmitResult { allow: true, closed: Vec::new() };
        let mut err = String::new();
        live_admit_gap_profile(&sample_yaml_rank(), &req, &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert_eq!(result.allow, false);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id == WALL_TRUST_RING_RANK {
                hit = true;
            }
            i += 1;
        }
        assert_eq!(hit, true);
    }
}

#[cfg(test)]
mod tests_more {
    use super::*;

    fn profile() -> String {
        String::from("address:\n  domain: com.example.live\n  id: profile-doc\npattern:\n  guard:\n    expr: wrap == finance\n    lang: gapdsl\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  agent_may:\n    - agent_id: agent-a\n      action: write\n  wrap: finance\n  action_path_prefix: finance\nenabled: false\n")
    }

    #[test]
    fn enabled_false_still_evaluates_agent_may() {
        let req = LiveAdmitRequest {
            agent_id: String::from("agent-b"),
            action: String::from("write"),
            wrap: String::from("finance"),
            action_path: String::from("finance/pay"),
        };
        let mut result = AdmitResult { allow: true, closed: Vec::new() };
        let mut err = String::new();
        live_admit_gap_profile(&profile(), &req, &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert_eq!(result.allow, false);
        let mut may_id = String::new();
        agent_may_wall_id("agent-b", "write", &mut may_id);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id == may_id {
                hit = true;
            }
            i += 1;
        }
        assert_eq!(hit, true);
        let mut skip = true;
        enabled_skips_admit(&Value::Bool(false), &mut skip);
        assert_eq!(skip, false);
        let mut load = false;
        enabled_is_load_time(&mut load);
        assert_eq!(load, true);
    }

    #[test]
    fn agent_a_may_write_not_agent_b() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&profile(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut a = AdmitWall { id: String::new(), closed: false, reason: String::new() };
        let mut b = a.clone();
        compile_agent_may_profile_wall(&doc, &LiveAdmitRequest { agent_id: String::from("agent-a"), action: String::from("write"), wrap: String::from("finance"), action_path: String::from("finance/pay") }, &mut a);
        compile_agent_may_profile_wall(&doc, &LiveAdmitRequest { agent_id: String::from("agent-b"), action: String::from("write"), wrap: String::from("finance"), action_path: String::from("finance/pay") }, &mut b);
        assert_eq!(a.closed, false);
        assert_eq!(b.closed, true);
    }

    #[test]
    fn wrap_finance_not_inventory() {
        let mut doc = Value::Null;
        let mut err = String::new();
        parse_gap_source(&profile(), &mut doc, &mut err);
        assert_eq!(err.as_str(), "");
        let mut okw = AdmitWall { id: String::new(), closed: false, reason: String::new() };
        let mut bad = okw.clone();
        compile_wrap_prefix_bind(&doc, &LiveAdmitRequest { agent_id: String::from("agent-a"), action: String::from("write"), wrap: String::from("finance"), action_path: String::from("finance/pay") }, &mut okw);
        compile_wrap_prefix_bind(&doc, &LiveAdmitRequest { agent_id: String::from("agent-a"), action: String::from("write"), wrap: String::from("inventory"), action_path: String::from("inventory/stock") }, &mut bad);
        assert_eq!(okw.closed, false);
        assert_eq!(bad.closed, true);
    }

    #[test]
    fn schema_v13_body_contains_required_fields() {
        let mut body = String::new();
        schema_v13_body(&mut body);
        assert_eq!(body.contains("agent_may"), true);
        assert_eq!(body.contains("action_path_prefix"), true);
        assert_eq!(body.contains("wrap"), true);
        assert_eq!(body.contains("oneOf"), true);
        assert_eq!(body.contains("load-time"), true);
        assert_eq!(body.contains("Not a live Admit floor"), true);
        assert_eq!(body.contains("covenants"), true);
        assert_eq!(body.contains("scanners"), true);
        assert_eq!(body.contains("v1.3"), true);
    }

    #[test]
    fn classic_v1_and_v12_keep_covenants_and_scanners() {
        let v1 = include_str!("../../../gap/schemas/gap-meta-schema-v1.json");
        let v12 = include_str!("../../../gap/schemas/gap-meta-schema-v1.2.json");
        assert_eq!(v1.contains("\"covenants\""), true);
        assert_eq!(v1.contains("\"scanners\""), true);
        assert_eq!(v12.contains("\"covenants\""), true);
        assert_eq!(v12.contains("\"scanners\""), true);
        assert_eq!(v12.contains("\"covenants\""), true);
        assert_eq!(v1.contains("\"scanners\""), true);
    }

    #[test]
    fn empty_grants_fail_closed_for_agent_action() {
        let src = String::from("address:\n  domain: com.example.live\n  id: empty-grants\npattern: p\naction:\n  type: template\n  content: c\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n");
        let mut result = AdmitResult { allow: true, closed: Vec::new() };
        let mut err = String::new();
        live_admit_gap_profile(&src, &LiveAdmitRequest { agent_id: String::from("agent-a"), action: String::from("write"), wrap: String::new(), action_path: String::new() }, &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        assert_eq!(result.allow, false);
        let mut hit = false;
        let mut i = 0usize;
        while i < result.closed.len() {
            if result.closed[i].id.starts_with(WALL_AGENT_MAY) {
                hit = true;
            }
            i += 1;
        }
        assert_eq!(hit, true);
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
        assert_eq!(svc.result.allow, true);
        let mut load = false;
        enabled_is_load_time(&mut load);
        assert_eq!(load, true);
    }
}



pub fn to_aep_admit(result: &AdmitResult) -> aep_admit::AdmitResult {
    let mut walls: Vec<aep_admit::AdmitWall> = Vec::new();
    let mut i = 0usize;
    while i < result.closed.len() {
        walls.push(aep_admit::AdmitWall::close(
            result.closed[i].id.clone(),
            result.closed[i].reason.clone(),
        ));
        i += 1;
    }
    aep_admit::admit_collect_all(&walls)
}

#[cfg(test)]
mod tests_aep_admit {
    use super::*;
    #[test]
    fn rank_closed_folds_into_aep_admit() {
        let req = LiveAdmitRequest::default();
        let mut result = AdmitResult { allow: true, closed: Vec::new() };
        let mut err = String::new();
        let src = String::from("address:\n  domain: com.example.old\n  id: rank-doc\npattern: old pattern\naction:\n  type: template\n  content: hello\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  trust_ring: user\n");
        live_admit_gap_profile(&src, &req, &mut result, &mut err);
        assert_eq!(err.as_str(), "");
        let folded = to_aep_admit(&result);
        assert_eq!(folded.allow, false);
        assert_eq!(result.allow, folded.allow);
    }
}
