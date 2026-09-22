// @PAD: gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:3efeaf869cffd594473d18810aca43e2efff1db5809fd1caf6fb426f98d6e05f
//! In-kernel display pre-staging store, display action paths and JSON HTTP adapter.
use crate::docking::{deny_resp, DockFrameResponse};
use aep_lattice_channel::decode_display_plaintext;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
pub const ACTION_INGEST: &str = "display-api:source:ingest";
pub const ACTION_STAGE: &str = "display-api:sector:stage";
pub const ACTION_REQUEST: &str = "display-api:view:request";
pub const ACTION_PROJECT: &str = "display-api:view:project";
pub const ACTION_LIST: &str = "display-api:catalog:list";
pub const ACTION_ATTACH: &str = "display-api:attach";
const MISSING_STAGED: &str = "missing staged JSON DENY on miss";
const UNKNOWN_ACTION: &str = "unknown action DENY on miss";
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
    staged: HashMap<(String, String), Value>, persist_dir: Option<PathBuf>,
    source_locators: HashMap<String, String>,
    source_sectors: HashMap<String, Vec<String>>,
}
impl Default for DisplayStaging { fn default() -> Self { Self::new() } }
impl DisplayStaging {
    pub fn new() -> Self {
        Self { views: HashSet::new(), sources: HashSet::new(), sectors: HashSet::new(), view_map: HashMap::new(), grants: Vec::new(), staged: HashMap::new(), persist_dir: None, source_locators: HashMap::new(), source_sectors: HashMap::new() }
    }
    pub fn load(data_dir: &Path) -> Result<Self, crate::BaseNodeError> {
        let mut staging = Self::new();
        staging.persist_dir = Some(data_dir.join("display-staging"));
        if let Some(dir) = staging.persist_dir.as_ref() {
            let _ = std::fs::create_dir_all(dir);
        }
        load_named_views_from_lattice(&mut staging, data_dir)?;
        load_grants_at_boot(&mut staging, data_dir)?;
        load_source_locators(&mut staging, data_dir)?;
        load_persisted_staging(&mut staging);
        Ok(staging)
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
    fn staged_json(&self,source:&str,sector:&str)->Result<Value,String>{if let Some(v)=self.staged.get(&(source.to_string(),sector.to_string())){Ok(v.clone())}else{Err(String::from(MISSING_STAGED))}}
    pub fn staged_len(&self)->usize{self.staged.len()}
    pub fn clear_staged(&mut self) { self.staged.clear(); }
    pub fn grant_len(&self)->usize{self.grants.len()}
    fn persist_pair(&self,source:&str,sector:&str,value:&Value){let Some(dir)=self.persist_dir.as_ref()else{return}; let _=std::fs::create_dir_all(dir); let path=dir.join(format!("{source}__{sector}.json")); let wrapped=serde_json::json!({"source":source,"sector":sector,"payload":value}); if let Ok(bytes)=serde_json::to_vec(&wrapped){let _=std::fs::write(path,bytes);}}
    pub fn apply(&mut self, agent_id: &str, action_path: &str, view: &str, source: Option<&str>, sector: Option<&str>, payload: Option<&Value>) -> Result<Option<Value>, String> {
        match action_path {
            ACTION_INGEST => {
                let source = source.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown source DENY on miss"))?;
                self.known_source(source)?;
                let sector = sector.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown sector DENY on miss"))?;
                self.known_sector(sector)?;
                self.require_grant(agent_id, source, sector)?;
                let stored = payload.cloned().unwrap_or(Value::Object(serde_json::Map::new()));
                self.staged.insert((source.to_string(), sector.to_string()), stored.clone());
                self.persist_pair(source,sector,&stored);
                Ok(None)
            }
            ACTION_STAGE => {
                let source = source.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown source DENY on miss"))?;
                self.known_source(source)?;
                let sector = sector.filter(|s| s.is_empty() == false).ok_or_else(|| String::from("unknown sector DENY on miss"))?;
                self.known_sector(sector)?;
                self.require_grant(agent_id, source, sector)?;
                if let Some(p) = payload { self.staged.insert((source.to_string(), sector.to_string()), p.clone());self.persist_pair(source,sector,p);self.persist_pair(source,sector,p); }
                else if self.staged.contains_key(&(source.to_string(), sector.to_string())) == false {
                    return Err(String::from(MISSING_STAGED));
                }
                Ok(None)
            }
            ACTION_REQUEST => {
                let (source, sector) = self.resolve_view(view)?;
                self.require_grant(agent_id, &source, &sector)?;
                Ok(Some(self.staged_json(&source,&sector)?))
            }
            ACTION_PROJECT => {
                let (source, sector) = self.resolve_view(view)?;
                self.require_grant(agent_id, &source, &sector)?;
                Ok(Some(self.staged_json(&source,&sector)?))
            }
            ACTION_LIST => catalog_list_body(self, agent_id).map(Some),
            _ => Err(String::from(UNKNOWN_ACTION)),
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
fn yaml_scalar(raw:&str)->String{raw.trim().to_string()}
fn yaml_after(line:&str,key:&str)->String{yaml_scalar(line.get(key.len()..).unwrap_or(""))}
fn lattice_yaml_path(data_dir:&Path)->PathBuf{if let Ok(p)=std::env::var("AEP_LATTICE_YAML"){return PathBuf::from(p)}data_dir.join("lattice.yaml")}
fn grant_wall_path(data_dir:&Path)->PathBuf{if let Ok(p)=std::env::var("AEP_DISPLAY_GRANTS"){if p.is_empty()==false{return PathBuf::from(p)}}data_dir.join("display-grants.gap")}
/// Mark the pre-staging family satisfied for every granted agent.
///
/// The packaged catalog loads each named source into pre-staging at boot for the
/// named sectors of that source, so the kernel records the attach, the source
/// ingest and the sector stage for each agent the grant wall names. A client then
/// asks for a projection without repeating the load it did not perform.
pub fn seed_pre_staged_display_actions(live: &mut aep_live_entry::LiveEntry, staging: &DisplayStaging) {
    let mut rows: Vec<(String, String, String)> = Vec::new();
    for grant in staging.grants.iter() {
        rows.push((grant.agent_id.clone(), grant.source_id.clone(), grant.sector_id.clone()));
    }
    for (agent_id, _source_id, _sector_id) in rows {
        aep_live_entry::seed_satisfied_action(live, &agent_id, ACTION_ATTACH);
        aep_live_entry::seed_satisfied_action(live, &agent_id, ACTION_INGEST);
        aep_live_entry::seed_satisfied_action(live, &agent_id, ACTION_STAGE);
    }
}

fn flush_view(staging:&mut DisplayStaging,view:&mut String,source:&mut String,sector:&mut String){if view.is_empty()==false{if source.is_empty()==false{if sector.is_empty()==false{staging.views.insert(view.clone()); staging.sources.insert(source.clone()); staging.sectors.insert(sector.clone()); staging.view_map.insert(view.clone(),(source.clone(),sector.clone()));}}}view.clear(); source.clear(); sector.clear();}
fn load_named_views_from_lattice(staging:&mut DisplayStaging,data_dir:&Path)->Result<(),crate::BaseNodeError>{
if lattice_yaml_path(data_dir).is_file()==false {
return Err(crate::BaseNodeError::LatticeYamlMissing)
}
match std::fs::read_to_string(lattice_yaml_path(data_dir)) {
Ok(text)=>Ok(parse_catalog_with_locators(staging,&text)),
Err(_)=>Err(crate::BaseNodeError::LatticeYamlUnreadable)
}
}
fn load_grants_at_boot(staging:&mut DisplayStaging,data_dir:&Path)->Result<(),crate::BaseNodeError>{
if grant_wall_path(data_dir).is_file()==false {
return Err(crate::BaseNodeError::DisplayGrantWallMissing)
}
match std::fs::read_to_string(grant_wall_path(data_dir)) {
Ok(text)=>Ok(staging.grants=parse_display_grants(&text)),
Err(_)=>Err(crate::BaseNodeError::DisplayGrantWallUnreadable)
}
}
fn load_persisted_staging(staging:&mut DisplayStaging){let Some(dir)=staging.persist_dir.as_ref()else{return}; let Ok(entries)=std::fs::read_dir(dir)else{return}; for entry in entries.flatten(){let path=entry.path(); let keep=match path.extension(){Some(x)=>match x.to_str(){Some("json")=>true,_=>false},_=>false}; if keep==false{continue}let Ok(bytes)=std::fs::read(&path)else{continue}; let Ok(value)=serde_json::from_slice::<Value>(&bytes)else{continue}; let source=match value.get("source"){Some(v)=>match v.as_str(){Some(s)if s.is_empty()==false=>s.to_string(),_=>continue},_=>continue}; let sector=match value.get("sector"){Some(v)=>match v.as_str(){Some(s)if s.is_empty()==false=>s.to_string(),_=>continue},_=>continue}; let payload=value.get("payload").cloned().unwrap_or(Value::Null); staging.staged.insert((source,sector),payload);}}
fn parse_display_grants(text:&str)->Vec<DisplayGrant>{let mut out=Vec::new(); let mut in_grants=false; let mut agent=String::new(); let mut source=String::new(); let mut sector=String::new(); for raw in text.lines(){let line=raw.trim(); if line.starts_with("grants:"){if agent.is_empty()==false{if source.is_empty()==false{if sector.is_empty()==false{out.push(DisplayGrant{agent_id:agent.clone(),source_id:source.clone(),sector_id:sector.clone()})}}}in_grants=true; agent.clear(); source.clear(); sector.clear(); continue}if in_grants==false{continue}if line.starts_with("action:"){in_grants=false; continue}if line.starts_with("weight:"){in_grants=false; continue}if line.starts_with("composition:"){in_grants=false; continue}if line.starts_with("metadata:"){in_grants=false; continue}if line.starts_with("walls:"){in_grants=false; continue}if line.starts_with("- agent_id:"){if agent.is_empty()==false{if source.is_empty()==false{if sector.is_empty()==false{out.push(DisplayGrant{agent_id:agent.clone(),source_id:source.clone(),sector_id:sector.clone()})}}}agent=yaml_after(line,"- agent_id:"); source.clear(); sector.clear();}else{if line.starts_with("source_id:"){source=yaml_after(line,"source_id:")}else{if line.starts_with("sector_id:"){sector=yaml_after(line,"sector_id:")}}}}if agent.is_empty()==false{if source.is_empty()==false{if sector.is_empty()==false{out.push(DisplayGrant{agent_id:agent,source_id:source,sector_id:sector})}}}out}
fn flush_source_record(staging: &mut DisplayStaging, current_id: &mut String, current_locator: &mut String, current_sectors: &mut Vec<String>) {
    if current_id.is_empty() {
        return;
    }
    staging.sources.insert(current_id.clone());
    staging.source_locators.insert(current_id.clone(), current_locator.clone());
    staging.source_sectors.insert(current_id.clone(), current_sectors.clone());
    current_id.clear();
    current_locator.clear();
    current_sectors.clear();
}
fn parse_catalog_with_locators(staging: &mut DisplayStaging, text: &str) {
    let mut section = String::new();
    let mut current_view = String::new();
    let mut current_source = String::new();
    let mut current_sector = String::new();
    let mut current_id = String::new();
    let mut current_locator = String::new();
    let mut current_sectors: Vec<String> = Vec::new();
    let mut source_mode = String::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with('#') {
            continue;
        }
        if line == "display_views:" {
            flush_view(staging, &mut current_view, &mut current_source, &mut current_sector);
            flush_source_record(staging, &mut current_id, &mut current_locator, &mut current_sectors);
            section = String::from("views");
            source_mode.clear();
            continue;
        }
        if line == "display_sources:" {
            flush_view(staging, &mut current_view, &mut current_source, &mut current_sector);
            flush_source_record(staging, &mut current_id, &mut current_locator, &mut current_sectors);
            section = String::from("sources");
            source_mode.clear();
            continue;
        }
        if line == "display_sectors:" {
            flush_view(staging, &mut current_view, &mut current_source, &mut current_sector);
            flush_source_record(staging, &mut current_id, &mut current_locator, &mut current_sectors);
            section = String::from("sectors");
            source_mode.clear();
            continue;
        }
        if line == "actions:" {
            flush_view(staging, &mut current_view, &mut current_source, &mut current_sector);
            flush_source_record(staging, &mut current_id, &mut current_locator, &mut current_sectors);
            section.clear();
            source_mode.clear();
            continue;
        }
        if section == "views" {
            if line.starts_with("source:") {
                current_source = yaml_after(line, "source:");
            } else if line.starts_with("sector:") {
                current_sector = yaml_after(line, "sector:");
            } else if line.ends_with(':') {
                flush_view(staging, &mut current_view, &mut current_source, &mut current_sector);
                current_view = yaml_scalar(line.trim_end_matches(':'));
            }
            continue;
        }
        if section == "sources" {
            if line.starts_with("- ") {
                let rest = yaml_after(line, "- ");
                if source_mode == "sectors" {
                    if rest.starts_with("id:") == false {
                        staging.sectors.insert(rest.clone());
                        current_sectors.push(rest);
                        continue;
                    }
                }
                flush_source_record(staging, &mut current_id, &mut current_locator, &mut current_sectors);
                if rest.starts_with("id:") {
                    current_id = yaml_after(rest.as_str(), "id:");
                    source_mode = String::from("item");
                } else {
                    staging.sources.insert(rest.clone());
                    staging.source_locators.insert(rest, String::new());
                    source_mode.clear();
                }
                continue;
            }
            if line.starts_with("locator:") {
                current_locator = yaml_after(line, "locator:");
                continue;
            }
            if line.starts_with("id:") {
                current_id = yaml_after(line, "id:");
                continue;
            }
            if line.starts_with("sectors:") {
                source_mode = String::from("sectors");
                continue;
            }
            continue;
        }
        if section == "sectors" {
            if line.starts_with("- ") {
                let v = yaml_after(line, "- ");
                staging.sectors.insert(v);
            }
        }
    }
    flush_view(staging, &mut current_view, &mut current_source, &mut current_sector);
    flush_source_record(staging, &mut current_id, &mut current_locator, &mut current_sectors);
}
fn load_source_locators(staging: &mut DisplayStaging, data_dir: &Path) -> Result<(), crate::BaseNodeError> {
    if staging.sources.is_empty() {
        return Ok(());
    }
    let yaml = lattice_yaml_path(data_dir);
    let base = match yaml.parent() {
        Some(p) => p.to_path_buf(),
        None => data_dir.to_path_buf(),
    };
    let mut ids: Vec<String> = Vec::new();
    for id in staging.sources.iter() {
        ids.push(id.clone());
    }
    ids.sort();
    for id in ids {
        let mut locator = String::new();
        match staging.source_locators.get(&id) {
            Some(v) => locator = v.trim().to_string(),
            None => {}
        };
        if locator.is_empty() {
            return Err(crate::BaseNodeError::DisplayLocatorMissing);
        }
        let path = if Path::new(&locator).is_absolute() {
            PathBuf::from(&locator)
        } else {
            base.join(&locator)
        };
        if path.is_file() == false {
            return Err(crate::BaseNodeError::DisplayLocatorMissing);
        }
        let text = match std::fs::read_to_string(&path) {
            Ok(v) => v,
            Err(_) => return Err(crate::BaseNodeError::DisplayLocatorMissing),
        };
        let value: Value = match serde_json::from_str(&text) {
            Ok(v) => v,
            Err(_) => return Err(crate::BaseNodeError::DisplayLocatorMissing),
        };
        let sectors_val = match value.get("sectors") {
            Some(v) => v,
            None => return Err(crate::BaseNodeError::DisplayLocatorMissing),
        };
        let sectors_obj = match sectors_val.as_object() {
            Some(v) => v,
            None => return Err(crate::BaseNodeError::DisplayLocatorMissing),
        };
        let mut needed: Vec<String> = Vec::new();
        match staging.source_sectors.get(&id) {
            Some(v) => {
                for sector in v.iter() {
                    needed.push(sector.clone());
                }
            }
            None => {}
        };
        for sector in needed {
            let payload = match sectors_obj.get(&sector) {
                Some(v) => v.clone(),
                None => return Err(crate::BaseNodeError::DisplayLocatorMissing),
            };
            staging.staged.insert((id.clone(), sector), payload);
        }
    }
    Ok(())
}
fn catalog_list_body(staging: &DisplayStaging, agent_id: &str) -> Result<Value, String> {
    if staging.grants.is_empty() {
        return Err(String::from("empty grant list refuses"));
    }
    let mut views: Vec<String> = Vec::new();
    for (view, pair) in staging.view_map.iter() {
        if staging.require_grant(agent_id, &pair.0, &pair.1).is_ok() {
            views.push(view.clone());
        }
    }
    let mut sources: Vec<String> = Vec::new();
    let mut sectors: Vec<String> = Vec::new();
    for grant in staging.grants.iter() {
        if grant.agent_id == agent_id {
            sources.push(grant.source_id.clone());
            sectors.push(grant.sector_id.clone());
        }
    }
    if sources.is_empty() {
        return Err(String::from("display grant DENY on miss"));
    }
    views.sort();
    views.dedup();
    sources.sort();
    sources.dedup();
    sectors.sort();
    sectors.dedup();
    Ok(serde_json::json!({"views": views, "sources": sources, "sectors": sectors}))
}
