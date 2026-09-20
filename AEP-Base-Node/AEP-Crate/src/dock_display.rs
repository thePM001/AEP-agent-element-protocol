// @PAD: gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:3efeaf869cffd594473d18810aca43e2efff1db5809fd1caf6fb426f98d6e05f
//! In-kernel display pre-staging store, display action paths and JSON HTTP adapter.
use crate::docking::{deny_resp, DockFrameResponse};
use aep_lattice_channel::decode_display_plaintext;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
pub const ACTION_INGEST: &str = "display:source:ingest";
pub const ACTION_STAGE: &str = "display:sector:stage";
pub const ACTION_REQUEST: &str = "display:view:request";
pub const ACTION_PROJECT: &str = "display:view:project";
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DisplayGrant {
    pub agent_id: String,
    pub source_id: String,
    pub sector_id: String,
}
#[derive(Debug, Clone)]
pub struct DisplayStaging {
    views: HashSet<String>,
    sources: HashSet<String>,
    sectors: HashSet<String>,
    view_map: HashMap<String, (String, String)>,
    grants: Vec<DisplayGrant>,
    staged: HashMap<(String, String), Value>,
}
impl Default for DisplayStaging { fn default() -> Self { Self::new() } }
impl DisplayStaging {
    pub fn new() -> Self {
        let mut views = HashSet::new();
        views.insert(String::from("view.alpha"));
        views.insert(String::from("view.beta"));
        let mut sources = HashSet::new();
        sources.insert(String::from("source.alpha"));
        sources.insert(String::from("source.beta"));
        let mut sectors = HashSet::new();
        sectors.insert(String::from("sector.one"));
        sectors.insert(String::from("sector.two"));
        let mut view_map = HashMap::new();
        view_map.insert(String::from("view.alpha"), (String::from("source.alpha"), String::from("sector.one")));
        view_map.insert(String::from("view.beta"), (String::from("source.alpha"), String::from("sector.two")));
        Self { views, sources, sectors, view_map, grants: Vec::new(), staged: HashMap::new() }
    }
    pub fn add_grant(&mut self, agent_id: &str, source_id: &str, sector_id: &str) {
        self.grants.push(DisplayGrant { agent_id: agent_id.into(), source_id: source_id.into(), sector_id: sector_id.into() });
    }
    fn known_view(&self, view: &str) -> Result<(), String> {
        if self.views.contains(view) { Ok(()) } else { Err(String::from("unknown view DENY on miss")) }
    }
    fn known_source(&self, source: &str) -> Result<(), String> {
        if self.sources.contains(source) { Ok(()) } else { Err(String::from("unknown source DENY on miss")) }
    }
    fn known_sector(&self, sector: &str) -> Result<(), String> {
        if self.sectors.contains(sector) { Ok(()) } else { Err(String::from("unknown sector DENY on miss")) }
    }
    fn require_grant(&self, agent_id: &str, source_id: &str, sector_id: &str) -> Result<(), String> {
        if self.grants.is_empty() { return Err(String::from("empty grant list refuses")); }
        if self.grants.iter().any(|g| g.agent_id == agent_id && g.source_id == source_id && g.sector_id == sector_id) { Ok(()) } else { Err(String::from("display grant DENY on miss")) }
    }
    fn resolve_view(&self, view: &str) -> Result<(String, String), String> {
        self.known_view(view)?;
        self.view_map.get(view).cloned().ok_or_else(|| String::from("unknown view DENY on miss"))
    }
    pub fn apply(&mut self, agent_id: &str, action_path: &str, view: &str, source: Option<&str>, sector: Option<&str>, payload: Option<&Value>) -> Result<Option<Value>, String> {
        match action_path {
            ACTION_INGEST => {
                let source = source.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown source DENY on miss"))?;
                self.known_source(source)?;
                let sector = sector.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown sector DENY on miss"))?;
                self.known_sector(sector)?;
                self.require_grant(agent_id, source, sector)?;
                let stored = payload.cloned().unwrap_or(Value::Object(serde_json::Map::new()));
                self.staged.insert((source.to_string(), sector.to_string()), stored);
                Ok(None)
            }
            ACTION_STAGE => {
                let source = source.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown source DENY on miss"))?;
                self.known_source(source)?;
                let sector = sector.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown sector DENY on miss"))?;
                self.known_sector(sector)?;
                self.require_grant(agent_id, source, sector)?;
                if let Some(p) = payload { self.staged.insert((source.to_string(), sector.to_string()), p.clone()); }
                else if self.staged.contains_key(&(source.to_string(), sector.to_string())) == false {
                    self.staged.insert((source.to_string(), sector.to_string()), Value::Object(serde_json::Map::new()));
                }
                Ok(None)
            }
            ACTION_REQUEST => {
                let (source, sector) = self.resolve_view(view)?;
                self.require_grant(agent_id, &source, &sector)?;
                Ok(None)
            }
            ACTION_PROJECT => {
                let (source, sector) = self.resolve_view(view)?;
                self.require_grant(agent_id, &source, &sector)?;
                Ok(Some(self.staged.get(&(source, sector)).cloned().unwrap_or(Value::Object(serde_json::Map::new()))))
            }
            _ => Err(String::from("unknown view DENY on miss")),
        }
    }
}
pub fn payload_from_plaintext(plaintext: &[u8]) -> Option<Value> {
    let value: Value = serde_json::from_slice(plaintext).ok()?;
    value.get("payload").cloned()
}
pub fn apply_display_plaintext(staging: &mut DisplayStaging, agent_id: &str, plaintext: &[u8]) -> Result<Option<Value>, String> {
    let body = decode_display_plaintext(plaintext).map_err(|e| e.to_string())?;
    let payload = payload_from_plaintext(plaintext);
    staging.apply(agent_id, &body.action_path, &body.view, body.source.as_deref(), body.sector.as_deref(), payload.as_ref())
}
pub fn display_action_deny(digest: Option<String>, error: String) -> DockFrameResponse { deny_resp(digest, error) }
pub fn looks_like_http(first_line: &str) -> bool {
    let t = first_line.trim_start();
    t.starts_with("POST ") || t.starts_with("PUT ") || t.starts_with("GET ")
}
pub fn extract_json_body_from_http(raw: &str) -> Result<String, String> {
    let split = raw.find("\r\n\r\n").or_else(|| raw.find("\n\n"));
    let Some(idx) = split else { return Err(String::from("JSON body that skips the sealed frame is refused")); };
    let sep_len = if raw[idx..].starts_with("\r\n\r\n") { 4 } else { 2 };
    let body = raw[idx + sep_len..].trim().to_string();
    if body.is_empty() || body.as_bytes().first().copied() != Some(b'{') {
        return Err(String::from("JSON body that skips the sealed frame is refused"));
    }
    Ok(body)
}
pub fn http_json_reply(ok: bool, json_body: &str) -> String {
    let status = if ok { "200 OK" } else { "403 Forbidden" };
    format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{json_body}", json_body.len())
}
