// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune.policy.v1
// crate: aep-gap-kernel-json-wrap-bind
// GAP-285-P5. JSON-encoded kernel policies are legal GAP instructions.
// YAML remains valid GAP source. The kernel reads the instruction object not the skin.
use serde_json::Value;

pub const TICKET: &str = "GAP-285-P5";
pub const STEM_WRITING: &str = "writing";
pub const STEM_SECURITY: &str = "security";
pub const STEM_OTHER: &str = "other";
pub const SKIN_JSON: &str = "json";
pub const SKIN_YAML: &str = "yaml";
pub const WALL_SKIN: &str = "gap:kernel:skin";
pub const WALL_PATTERN_GUARD: &str = "gap:pattern:guard";
pub const WALL_ALWAYS_ON: &str = "gap:stem:always-on";
pub const README_CONTRACT: &str = "Live kernel policies may be JSON-encoded GAP instructions. YAML remains valid GAP source. Writing and security are always-on stems. Other GAP walls bind to a wrap or prefix.\n";

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
    pub applies: bool,
    pub stem: String,
    pub skin: String,
}

impl Default for AdmitResult {
    fn default() -> Self {
        Self {
            allow: true,
            closed: Vec::new(),
            applies: false,
            stem: String::from(STEM_OTHER),
            skin: String::from(SKIN_YAML),
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

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Instruction {
    pub domain: String,
    pub id: String,
    pub stem: String,
    pub wrap: String,
    pub prefix: String,
    pub guard: String,
    pub skin: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct BindRequest {
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

fn json_str_path(v: &Value, a: &str, b: &str, out: &mut String) {
    out.clear();
    if let Some(n) = v.get(a) {
        json_str(n, b, out);
    }
}

pub fn always_on_stem(stem: &str, out: &mut bool) {
    *out = stem == STEM_WRITING || stem == STEM_SECURITY;
}

pub fn classify_stem(domain: &str, id: &str, meta_stem: &str, out: &mut String) {
    out.clear();
    let ms = meta_stem.trim();
    if ms == STEM_WRITING || ms == STEM_SECURITY {
        out.push_str(ms);
        return;
    }
    let d = domain.trim().to_ascii_lowercase();
    let i = id.trim().to_ascii_lowercase();
    if d.contains("writing") || i == "writing" || i.starts_with("writing.") {
        out.push_str(STEM_WRITING);
        return;
    }
    if d.contains("security") || i == "security" || i.starts_with("security.") {
        out.push_str(STEM_SECURITY);
        return;
    }
    out.push_str(STEM_OTHER);
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

pub fn stem_applies(stem: &str, gap_wrap: &str, gap_prefix: &str, node_wrap: &str, action_path: &str, out: &mut bool) {
    let mut always = false;
    always_on_stem(stem, &mut always);
    if always {
        *out = true;
        return;
    }
    wrap_or_prefix_binds(gap_wrap, gap_prefix, node_wrap, action_path, out);
}

fn yaml_plain(src: &str, key: &str, out: &mut String) {
    out.clear();
    let mut needle = String::from(key);
    needle.push(':');
    for raw in src.lines() {
        let t = raw.trim();
        if t.starts_with(&needle) == false {
            continue;
        }
        let rest = t[needle.len()..].trim();
        if rest == "|" || rest == ">" || rest.is_empty() {
            continue;
        }
        if rest.starts_with('"') && rest.ends_with('"') && rest.len() >= 2 {
            out.push_str(&rest[1..rest.len() - 1]);
        } else {
            out.push_str(rest);
        }
        return;
    }
}

pub fn parse_gap_source(src: &str, out: &mut Value, skin: &mut String, err: &mut String) {
    err.clear();
    skin.clear();
    let t = src.trim();
    if t.is_empty() {
        err.push_str("empty GAP source");
        return;
    }
    let bytes = t.as_bytes();
    if bytes[0] == 123 {
        skin.push_str(SKIN_JSON);
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
    skin.push_str(SKIN_YAML);
    *out = Value::Null;
}

fn guard_from_pattern(pattern: &Value, out: &mut String) {
    out.clear();
    if let Some(s) = pattern.as_str() {
        out.push_str(s.trim());
        return;
    }
    if pattern.is_object() {
        if let Some(g) = pattern.get("guard") {
            if let Some(s) = g.as_str() {
                out.push_str(s.trim());
                return;
            }
            if g.is_object() {
                json_str(g, "expr", out);
            }
        }
    }
}

fn wrap_from_doc(doc: &Value, out: &mut String) {
    out.clear();
    if let Some(meta) = doc.get("metadata") {
        json_str(meta, "wrap", out);
        if out.is_empty() == false {
            return;
        }
    }
    if let Some(p) = doc.get("pattern") {
        json_str(p, "wrap", out);
    }
}

fn prefix_from_doc(doc: &Value, out: &mut String) {
    out.clear();
    if let Some(meta) = doc.get("metadata") {
        json_str(meta, "action_path_prefix", out);
        if out.is_empty() == false {
            return;
        }
        json_str(meta, "prefix", out);
        if out.is_empty() == false {
            return;
        }
    }
    if let Some(p) = doc.get("pattern") {
        json_str(p, "action_path_prefix", out);
        if out.is_empty() == false {
            return;
        }
        json_str(p, "prefix", out);
    }
}

pub fn instruction_from_doc(doc: &Value, skin: &str, out: &mut Instruction) {
    out.skin = String::from(skin);
    json_str_path(doc, "address", "domain", &mut out.domain);
    json_str_path(doc, "address", "id", &mut out.id);
    let mut meta_stem = String::new();
    if let Some(meta) = doc.get("metadata") {
        json_str(meta, "stem", &mut meta_stem);
    }
    classify_stem(&out.domain, &out.id, &meta_stem, &mut out.stem);
    wrap_from_doc(doc, &mut out.wrap);
    prefix_from_doc(doc, &mut out.prefix);
    if let Some(p) = doc.get("pattern") {
        guard_from_pattern(p, &mut out.guard);
    } else {
        out.guard.clear();
    }
}

fn instruction_from_yaml(src: &str, out: &mut Instruction) {
    out.skin = String::from(SKIN_YAML);
    yaml_plain(src, "domain", &mut out.domain);
    yaml_plain(src, "id", &mut out.id);
    let mut meta_stem = String::new();
    yaml_plain(src, "stem", &mut meta_stem);
    classify_stem(&out.domain, &out.id, &meta_stem, &mut out.stem);
    yaml_plain(src, "wrap", &mut out.wrap);
    yaml_plain(src, "action_path_prefix", &mut out.prefix);
    if out.prefix.is_empty() {
        yaml_plain(src, "prefix", &mut out.prefix);
    }
    yaml_plain(src, "guard", &mut out.guard);
}

pub fn parse_gap_instruction(src: &str, out: &mut Instruction, err: &mut String) {
    err.clear();
    let mut doc = Value::Null;
    let mut skin = String::new();
    parse_gap_source(src, &mut doc, &mut skin, err);
    if err.is_empty() == false {
        return;
    }
    if skin.as_str() == SKIN_JSON {
        instruction_from_doc(&doc, &skin, out);
        return;
    }
    instruction_from_yaml(src, out);
}

pub fn compile_guard_wall(instr: &Instruction, wall: &mut AdmitWall) {
    let g = instr.guard.trim();
    if g.is_empty() || g == "true" {
        AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
        return;
    }
    if g == "false" {
        AdmitWall::close_into(WALL_PATTERN_GUARD, "pattern.guard is false", wall);
        return;
    }
    AdmitWall::open_into(WALL_PATTERN_GUARD, wall);
}

pub fn live_admit_json_kernel(source: &str, req: &BindRequest, out: &mut AdmitResult, err: &mut String) {
    err.clear();
    *out = AdmitResult::default();
    let mut instr = Instruction::default();
    parse_gap_instruction(source, &mut instr, err);
    if err.is_empty() == false {
        let mut w = AdmitWall {
            id: String::new(),
            closed: false,
            reason: String::new(),
        };
        AdmitWall::close_into(WALL_SKIN, err, &mut w);
        out.allow = false;
        out.closed.clear();
        out.closed.push(w);
        out.applies = false;
        return;
    }
    out.stem = instr.stem.clone();
    out.skin = instr.skin.clone();
    let mut applies = false;
    stem_applies(
        &instr.stem,
        &instr.wrap,
        &instr.prefix,
        &req.wrap,
        &req.action_path,
        &mut applies,
    );
    out.applies = applies;
    if applies == false {
        out.allow = true;
        out.closed = Vec::new();
        return;
    }
    let mut walls: Vec<AdmitWall> = Vec::new();
    let mut gwall = AdmitWall {
        id: String::new(),
        closed: false,
        reason: String::new(),
    };
    compile_guard_wall(&instr, &mut gwall);
    walls.push(gwall);
    let mut always = false;
    always_on_stem(&instr.stem, &mut always);
    if always {
        let mut aw = AdmitWall {
            id: String::new(),
            closed: false,
            reason: String::new(),
        };
        AdmitWall::open_into(WALL_ALWAYS_ON, &mut aw);
        walls.push(aw);
    }
    admit_collect_all(&walls, out);
    out.applies = true;
    out.stem = instr.stem;
    out.skin = instr.skin;
}

pub mod parse_gap_instruction {
    use super::Instruction;
    pub struct ParseGapInstruction {
        pub source: String,
        pub result: Instruction,
        pub err: String,
    }
    impl ParseGapInstruction {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                result: Instruction::default(),
                err: String::new(),
            }
        }
        pub fn process(&mut self) {
            super::parse_gap_instruction(&self.source, &mut self.result, &mut self.err);
        }
    }
}

pub mod live_admit_json_kernel {
    use super::{AdmitResult, BindRequest};
    pub struct LiveAdmitJsonKernel {
        pub source: String,
        pub request: BindRequest,
        pub result: AdmitResult,
        pub err: String,
    }
    impl LiveAdmitJsonKernel {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                request: BindRequest::default(),
                result: AdmitResult::default(),
                err: String::new(),
            }
        }
        pub fn process(&mut self) {
            super::live_admit_json_kernel(&self.source, &self.request, &mut self.result, &mut self.err);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn must(cond: bool) {
        if cond == false {
            std::process::abort();
        }
    }

    fn json_writing() -> String {
        let mut s = String::new();
        s.push('{');
        s.push_str("\"address\":{\"domain\":\"aep.reference.writing\",\"id\":\"conventions.v1\"},");
        s.push_str("\"pattern\":{\"guard\":\"true\"},");
        s.push_str("\"action\":{\"type\":\"reference\"},\"weight\":1.0,");
        s.push_str("\"composition\":{\"type\":\"atomic\"},");
        s.push_str("\"metadata\":{\"provenance\":\"AEP 2.8.6\",\"version\":\"1.0.0\",\"stability\":\"stable\"}");
        s.push('}');
        s
    }

    fn json_security() -> String {
        let mut s = String::new();
        s.push('{');
        s.push_str("\"address\":{\"domain\":\"aep.reference.security\",\"id\":\"policy-lattice.v1\"},");
        s.push_str("\"pattern\":{\"guard\":\"true\"},");
        s.push_str("\"action\":{\"type\":\"reference\"},\"weight\":1.0,");
        s.push_str("\"composition\":{\"type\":\"atomic\"},");
        s.push_str("\"metadata\":{\"provenance\":\"AEP 2.8.6\",\"version\":\"1.0.0\",\"stability\":\"stable\"}");
        s.push('}');
        s
    }

    fn json_finance() -> String {
        let mut s = String::new();
        s.push('{');
        s.push_str("\"address\":{\"domain\":\"com.example.finance\",\"id\":\"pay.v1\"},");
        s.push_str("\"pattern\":{\"guard\":\"true\"},");
        s.push_str("\"action\":{\"type\":\"template\",\"content\":\"pay\"},\"weight\":1.0,");
        s.push_str("\"composition\":{\"type\":\"atomic\"},");
        s.push_str("\"metadata\":{\"provenance\":\"system.seed\",\"version\":\"1.0.0\",\"stability\":\"experimental\",\"wrap\":\"finance\"}");
        s.push('}');
        s
    }

    fn yaml_finance() -> String {
        String::from("address:\n  domain: com.example.finance\n  id: pay.v1\npattern:\n  guard: true\naction:\n  type: template\n  content: pay\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  wrap: finance\n")
    }

    fn yaml_empty_wrap() -> String {
        String::from("address:\n  domain: com.example.inventory\n  id: stock.v1\npattern:\n  guard: true\naction:\n  type: template\n  content: stock\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n")
    }

    fn yaml_prefix() -> String {
        String::from("address:\n  domain: com.example.ledger\n  id: row.v1\npattern:\n  guard: true\naction:\n  type: template\n  content: row\nweight: 1.0\ncomposition:\n  type: atomic\nmetadata:\n  provenance: system.seed\n  version: 1.0.0\n  stability: experimental\n  action_path_prefix: ledger/\n")
    }

    fn inv() -> BindRequest {
        BindRequest {
            wrap: String::from("inventory"),
            action_path: String::from("inventory/stock"),
        }
    }

    fn fin() -> BindRequest {
        BindRequest {
            wrap: String::from("finance"),
            action_path: String::from("finance/pay"),
        }
    }

    #[test]
    fn json_kernel_policy_parses() {
        let mut instr = Instruction::default();
        let mut err = String::new();
        parse_gap_instruction(&json_writing(), &mut instr, &mut err);
        must(err.as_str() == "");
        must(instr.skin.as_str() == SKIN_JSON);
        must(instr.stem.as_str() == STEM_WRITING);
        must(instr.guard.as_str() == "true");
        must(instr.id.as_str() == "conventions.v1");
    }

    #[test]
    fn yaml_gap_source_parses() {
        let mut instr = Instruction::default();
        let mut err = String::new();
        parse_gap_instruction(&yaml_finance(), &mut instr, &mut err);
        must(err.as_str() == "");
        must(instr.skin.as_str() == SKIN_YAML);
        must(instr.wrap.as_str() == "finance");
        must(instr.id.as_str() == "pay.v1");
    }

    #[test]
    fn kernel_reads_instruction_object_not_skin() {
        let mut j = Instruction::default();
        let mut y = Instruction::default();
        let mut err = String::new();
        parse_gap_instruction(&json_finance(), &mut j, &mut err);
        must(err.as_str() == "");
        parse_gap_instruction(&yaml_finance(), &mut y, &mut err);
        must(err.as_str() == "");
        must(j.wrap.as_str() == y.wrap.as_str());
        must(j.stem.as_str() == y.stem.as_str());
        must(j.id.as_str() == y.id.as_str());
        must(j.skin.as_str() == SKIN_JSON);
        must(y.skin.as_str() == SKIN_YAML);
    }

    #[test]
    fn writing_stem_always_on_inventory_ping() {
        let mut result = AdmitResult::default();
        let mut err = String::new();
        live_admit_json_kernel(&json_writing(), &inv(), &mut result, &mut err);
        must(err.as_str() == "");
        must(result.applies == true);
        must(result.allow == true);
        must(result.stem.as_str() == STEM_WRITING);
        must(result.skin.as_str() == SKIN_JSON);
    }

    #[test]
    fn security_stem_always_on_finance_ping() {
        let mut result = AdmitResult::default();
        let mut err = String::new();
        live_admit_json_kernel(&json_security(), &fin(), &mut result, &mut err);
        must(err.as_str() == "");
        must(result.applies == true);
        must(result.allow == true);
        must(result.stem.as_str() == STEM_SECURITY);
    }

    #[test]
    fn finance_wrap_does_not_close_inventory_ping() {
        let mut result = AdmitResult::default();
        let mut err = String::new();
        live_admit_json_kernel(&json_finance(), &inv(), &mut result, &mut err);
        must(err.as_str() == "");
        must(result.applies == false);
        must(result.allow == true);
        must(result.closed.len() == 0);
    }

    #[test]
    fn finance_wrap_binds_finance_ping() {
        let mut result = AdmitResult::default();
        let mut err = String::new();
        live_admit_json_kernel(&yaml_finance(), &fin(), &mut result, &mut err);
        must(err.as_str() == "");
        must(result.applies == true);
        must(result.allow == true);
        must(result.skin.as_str() == SKIN_YAML);
    }

    #[test]
    fn empty_wrap_other_does_not_fold_onto_every_event() {
        let mut result = AdmitResult::default();
        let mut err = String::new();
        live_admit_json_kernel(&yaml_empty_wrap(), &inv(), &mut result, &mut err);
        must(err.as_str() == "");
        must(result.stem.as_str() == STEM_OTHER);
        must(result.applies == false);
        must(result.allow == true);
        live_admit_json_kernel(&yaml_empty_wrap(), &fin(), &mut result, &mut err);
        must(result.applies == false);
    }

    #[test]
    fn prefix_binds_matching_action_path() {
        let mut result = AdmitResult::default();
        let mut err = String::new();
        let req = BindRequest {
            wrap: String::from("other"),
            action_path: String::from("ledger/row"),
        };
        live_admit_json_kernel(&yaml_prefix(), &req, &mut result, &mut err);
        must(err.as_str() == "");
        must(result.applies == true);
        let miss = BindRequest {
            wrap: String::from("other"),
            action_path: String::from("inventory/stock"),
        };
        live_admit_json_kernel(&yaml_prefix(), &miss, &mut result, &mut err);
        must(result.applies == false);
    }

    #[test]
    fn readme_contract_names_json_yaml_and_stems() {
        must(README_CONTRACT.contains("JSON-encoded GAP instructions"));
        must(README_CONTRACT.contains("YAML remains valid GAP source"));
        must(README_CONTRACT.contains("always-on stems"));
        must(README_CONTRACT.contains("wrap or prefix"));
        must(TICKET == "GAP-285-P5");
    }
}
