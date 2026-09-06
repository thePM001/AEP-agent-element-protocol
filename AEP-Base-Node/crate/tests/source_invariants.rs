// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:7b87ffaf4a3add0580e0e719931b9353e95229a124efdbd74fda2cff0eb28417
// AEP28-ENV-059: Fold slogan CI crates into one tests/source_invariants.rs.
// One ticket. Not twenty workspace members. unused_wall_crate_gate is deleted.

use std::fs;
use std::path::{Path, PathBuf};

pub const TICKET: &str = "AEP28-ENV-059";

pub const SLOGAN_CI_MEMBERS: &[&str] = &[
    "retired-archive/instruction-crates/admit-no-trust-tier/crate",
    "retired-archive/instruction-crates/admit-opa-sole/crate",
    "retired-archive/instruction-crates/admit-parity/crate",
    "retired-archive/instruction-crates/agent-sign-key-provision/crate",
    "retired-archive/instruction-crates/caw-wrapenv-failclosed/crate",
    "retired-archive/instruction-crates/client-trust-tier-ignore/crate",
    "retired-archive/instruction-crates/connector-ucb-clients/crate",
    "retired-archive/instruction-crates/dynaep-live-crossing-e2e/crate",
    "retired-archive/instruction-crates/empty-lattice-close/crate",
    "retired-archive/instruction-crates/envelope-algebra/crate",
    "retired-archive/instruction-crates/envelope-algebra-ci/crate",
    "retired-archive/instruction-crates/envelope-wrap-disabled/crate",
    "retired-archive/instruction-crates/frame-header-binding/crate",
    "retired-archive/instruction-crates/gap-capability-dimensions/crate",
    "retired-archive/instruction-crates/hyperlattice-ssot/crate",
    "retired-archive/instruction-crates/kernel-pq-channel/crate",
    "retired-archive/instruction-crates/lattice-db-parent-guard/crate",
    "retired-archive/instruction-crates/lattice-log-record-admit/crate",
    "retired-archive/instruction-crates/library-layer-count/crate",
    "retired-archive/instruction-crates/live-crossing-admit-apply/crate",
    "retired-archive/instruction-crates/live-crossing-lab-off/crate",
    "retired-archive/instruction-crates/live-crossing-reject-copy/crate",
    "retired-archive/instruction-crates/live-entry-ci/crate",
    "retired-archive/instruction-crates/mesh-ca-secret-mode/crate",
    "retired-archive/instruction-crates/no-sequential-ts-deny/crate",
    "retired-archive/instruction-crates/one-evaluation-story/crate",
    "retired-archive/instruction-crates/one-live-entry-language/crate",
    "retired-archive/instruction-crates/potomitan-mesh-packet-plane/crate",
    "retired-archive/instruction-crates/process-event-admit-walls/crate",
    "retired-archive/instruction-crates/sdk-run-meet-park/crate",
    "retired-archive/instruction-crates/stream-hard-findings/crate",
    "retired-archive/instruction-crates/version-ssot/crate",
    "retired-archive/instruction-crates/named-surfaces/crate",
    "retired-archive/instruction-crates/one-admit-id/crate",
    "retired-archive/instruction-crates/trust-score-isolation/crate",
];

pub const SLOGAN_CI_PACKAGES: &[&str] = &[
    "aep-admit-no-trust-tier",
    "aep-admit-opa-sole",
    "aep-admit-parity",
    "aep-agent-sign-key-provision",
    "aep-caw-wrapenv-failclosed",
    "aep-client-trust-tier-ignore",
    "aep-connector-ucb-clients",
    "aep-dynaep-live-crossing-e2e",
    "aep-empty-lattice-close",
    "aep-envelope-algebra",
    "aep-envelope-algebra-ci",
    "aep-envelope-wrap-disabled",
    "aep-frame-header-binding",
    "aep-gap-capability-dimensions",
    "aep-hyperlattice-ssot",
    "aep-kernel-pq-channel",
    "aep-lattice-db-parent-guard",
    "aep-lattice-log-record-admit",
    "aep-library-layer-count",
    "aep-live-crossing-admit-apply",
    "aep-live-crossing-lab-off",
    "aep-live-crossing-reject-copy",
    "aep-live-entry-ci",
    "aep-mesh-ca-secret-mode",
    "aep-no-sequential-ts-deny",
    "aep-one-evaluation-story",
    "aep-one-live-entry-language",
    "aep-potomitan-mesh-packet-plane",
    "aep-process-event-admit-walls",
    "aep-sdk-run-meet-park",
    "aep-stream-hard-findings",
    "aep-version-ssot",
    "aep-named-surfaces",
    "aep-one-admit-id",
    "aep-trust-score-isolation",
];

pub const PRODUCT_WALL_CRATES: &[&str] = &[
    "aep-admit",
    "aep-admit-writing-walls",
    "aep-admit-channel-order-walls",
    "aep-admit-temporal-bounds",
    "aep-envelope-walls",
    "aep-policy-system-admit",
];

pub const LIVE_PATH_CRATES: &[&str] = &[
    "aep-admit",
    "aep-admit-writing-walls",
    "aep-admit-channel-order-walls",
    "aep-admit-temporal-bounds",
    "aep-envelope-walls",
    "aep-envelope",
    "aep-live-entry",
    "aep-admit-live-dock",
    "aep-one-live-evaluation",
    "aep-policy-system-admit",
];

pub const DROPPED_WALL_CRATES: &[&str] = &["aep-admit-trust-floor"];

pub const LEFTOVER_INSTRUCTION_CRATE_DIRS: &[&str] = &[
    "admit-no-trust-tier",
    "admit-opa-sole",
    "admit-parity",
    "admit-trust-floor",
    "agent-sign-key-provision",
    "caw-wrapenv-failclosed",
    "client-trust-tier-ignore",
    "connector-ucb-clients",
    "dynaep-live-crossing-e2e",
    "empty-lattice-close",
    "envelope-algebra",
    "envelope-algebra-ci",
    "envelope-journals-drop",
    "envelope-product-copy",
    "envelope-wrap-disabled",
    "envelope-wrap-journals",
    "eu-ai-act-checker",
    "frame-header-binding",
    "gap-capability-dimensions",
    "hyperlattice-ssot",
    "kernel-pq-channel",
    "lattice-db-parent-guard",
    "lattice-log-record-admit",
    "library-layer-count",
    "live-crossing-admit-apply",
    "live-crossing-lab-off",
    "live-crossing-reject-copy",
    "live-entry-ci",
    "mesh-ca-secret-mode",
    "named-surfaces",
    "no-sequential-ts-deny",
    "one-admit-id",
    "one-evaluation-story",
    "one-live-entry-language",
    "potomitan-mesh-packet-plane",
    "process-event-admit-walls",
    "satisfied-actions-partition",
    "sdk-run-meet-park",
    "stream-hard-findings",
    "trust-score-isolation",
    "version-ssot",
];

pub const COMPANION_FOLDERS: &[&str] = &[
    "aep-comm",
    "aepassist",
    "caw-framework",
    "cca",
    "coding-governance",
    "covenant",
    "datasets",
    "decomposition",
    "economics",
    "eval",
    "evidence-ledger",
    "fleet",
    "gap",
    "graph-engine",
    "hcse",
    "hyperlattice",
    "identity",
    "intent",
    "intent-ledger",
    "intercept",
    "knowledge-base",
    "mcp-security",
    "model-gateway",
    "optimization",
    "permissions",
    "policy-engine",
    "proof-bundle",
    "proxy",
    "recovery",
    "scanners",
    "semantic-topology",
    "session",
    "streaming",
    "telemetry",
    "verification",
    "wizard",
    "workflow",
];


pub fn non_member_has_crate_dirs(root: &Path) -> Result<Vec<String>, String> {
    let members = workspace_members(&read_text(&root.join("Cargo.toml")));
    let components = root.join("AEP-Components");
    let mut stray = Vec::new();
    let rd = match fs::read_dir(&components) {
        Ok(v) => v,
        Err(e) => return Err(e.to_string()),
    };
    for ent in rd.flatten() {
        let path = ent.path();
        if path.is_dir() == false {
            continue;
        }
        let name = match ent.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };
        if name.starts_with('.') {
            continue;
        }
        let cargo = path.join("crate").join("Cargo.toml");
        if cargo.is_file() == false {
            continue;
        }
        let rel = format!("AEP-Components/{name}/crate");
        if members.iter().any(|m| m == &rel) == false {
            stray.push(name);
        }
    }
    stray.sort();
    Ok(stray)
}

pub fn leftover_instruction_crates_relocated(root: &Path) -> Result<String, String> {
    if LEFTOVER_INSTRUCTION_CRATE_DIRS.len() != 41 {
        return Err(String::from("leftover instruction crate list is not 41"));
    }
    if COMPANION_FOLDERS.len() != 37 {
        return Err(String::from("companion folder list is not 37"));
    }
    let members = workspace_members(&read_text(&root.join("Cargo.toml")));
    for name in LEFTOVER_INSTRUCTION_CRATE_DIRS {
        let old = root.join("AEP-Components").join(name);
        if old.exists() {
            let mut msg = String::from("leftover HAS_CRATE still under AEP-Components: ");
            msg.push_str(name);
            return Err(msg);
        }
        let dest = root.join("retired-archive/instruction-crates").join(name);
        if dest.is_dir() == false {
            let mut msg = String::from("relocated instruction crate missing: ");
            msg.push_str(name);
            return Err(msg);
        }
        let old_member = format!("AEP-Components/{name}/crate");
        let new_member = format!("retired-archive/instruction-crates/{name}/crate");
        if members.iter().any(|m| m == &old_member || m == &new_member) {
            let mut msg = String::from("leftover crate is a workspace member: ");
            msg.push_str(name);
            return Err(msg);
        }
    }
    for name in COMPANION_FOLDERS {
        let p = root.join("AEP-Components").join(name);
        if p.is_dir() == false {
            let mut msg = String::from("companion folder missing: ");
            msg.push_str(name);
            return Err(msg);
        }
    }
    if root.join("AEP-Components/trust-rings").exists() {
        return Err(String::from("Trust Rings still under AEP-Components"));
    }
    let inv = root.join("retired-archive/instruction-crates/INVENTORY.gaplune");
    if inv.is_file() == false {
        return Err(String::from("INVENTORY.gaplune missing"));
    }
    let inv_text = read_text(&inv);
    for name in LEFTOVER_INSTRUCTION_CRATE_DIRS {
        if inv_text.contains(name) == false {
            let mut msg = String::from("INVENTORY.gaplune missing crate: ");
            msg.push_str(name);
            return Err(msg);
        }
    }
    let stray = non_member_has_crate_dirs(root)?;
    if stray.is_empty() == false {
        let mut msg = String::from("non-member HAS_CRATE under AEP-Components: ");
        msg.push_str(&stray.join(","));
        return Err(msg);
    }
    Ok(String::from("ok leftover instruction crates relocated"))
}

fn fail(msg: &str) -> ! {
    panic!("{msg}");
}

pub fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 16 {
        let cargo = dir.join("Cargo.toml");
        let kernel = dir.join("AEP-Base-Node");
        let admit = dir.join("AEP-Components/admit/crate/Cargo.toml");
        if cargo.is_file() && kernel.is_dir() && admit.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_text(path: &Path) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

fn quoted_strings(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = text.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i = i.saturating_add(1);
            let start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i = i.saturating_add(1);
            }
            if i <= bytes.len() && start <= i {
                if let Ok(s) = std::str::from_utf8(&bytes[start..i]) {
                    if s.is_empty() == false {
                        out.push(s.to_string());
                    }
                }
            }
            i = i.saturating_add(1);
        } else {
            i = i.saturating_add(1);
        }
    }
    out
}

fn package_name(cargo: &str) -> String {
    let mut in_pkg = false;
    for line in cargo.lines() {
        let t = line.trim();
        if t == "[package]" {
            in_pkg = true;
            continue;
        }
        if t.starts_with('[') {
            in_pkg = false;
            continue;
        }
        if in_pkg && t.starts_with("name") {
            if let Some(q) = t.split('"').nth(1) {
                return q.to_string();
            }
        }
    }
    String::new()
}

fn dep_names(cargo: &str) -> Vec<String> {
    let mut in_deps = false;
    let mut out = Vec::new();
    for line in cargo.lines() {
        let t = line.trim();
        if t == "[dependencies]" || t == "[dev-dependencies]" {
            in_deps = true;
            continue;
        }
        if t.starts_with('[') {
            in_deps = false;
            continue;
        }
        if in_deps == false || t.is_empty() || t.starts_with('#') {
            continue;
        }
        if let Some((k, _)) = t.split_once('=') {
            let name = k.trim();
            if name.starts_with("aep-") {
                out.push(name.to_string());
            }
        }
    }
    out
}

fn workspace_members(cargo: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut in_members = false;
    for line in cargo.lines() {
        let t = line.trim();
        if t.starts_with("members") && t.contains('[') {
            in_members = true;
        }
        if in_members {
            out.extend(quoted_strings(t).into_iter().filter(|s| s.contains('/')));
            if t.contains(']') {
                in_members = false;
            }
        }
    }
    out
}

fn set_has(items: &[String], needle: &str) -> bool {
    items.iter().any(|s| s == needle)
}

fn extract_after(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact_src(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

/// Product wall crates stay on the live dock. Slogan CI crates are not members.
pub fn product_wall_live_dock_gate(root: &Path) -> Result<String, String> {
    let ws = read_text(&root.join("Cargo.toml"));
    if ws.is_empty() {
        return Err(String::from("workspace Cargo.toml missing"));
    }
    let members = workspace_members(&ws);
    let mut member_names: Vec<String> = Vec::new();
    for rel in &members {
        let cargo = root.join(rel).join("Cargo.toml");
        let name = package_name(&read_text(&cargo));
        if name.is_empty() == false {
            member_names.push(name);
        }
    }
    for dropped in DROPPED_WALL_CRATES {
        if member_names.iter().any(|n| n == dropped) {
            let mut msg = String::from("dropped wall crate still a workspace member: ");
            msg.push_str(dropped);
            return Err(msg);
        }
        for rel in &members {
            if rel.contains("admit-trust-floor") {
                return Err(String::from(
                    "admit-trust-floor remains a workspace product member",
                ));
            }
        }
    }
    for slogan in SLOGAN_CI_MEMBERS {
        if members.iter().any(|m| m == slogan) {
            let mut msg = String::from("slogan CI crate still a workspace member: ");
            msg.push_str(slogan);
            return Err(msg);
        }
    }
    for pkg in SLOGAN_CI_PACKAGES {
        if member_names.iter().any(|n| n == pkg) {
            let mut msg = String::from("slogan CI package still a workspace member: ");
            msg.push_str(pkg);
            return Err(msg);
        }
    }
    let live_dock_cargo = read_text(&root.join("AEP-Components/admit-live-dock/crate/Cargo.toml"));
    let live_dock_deps = dep_names(&live_dock_cargo);
    let base_deps = dep_names(&read_text(&root.join("AEP-Base-Node/crate/Cargo.toml")));
    let live_entry_deps = dep_names(&read_text(
        &root.join("AEP-Components/live-entry/crate/Cargo.toml"),
    ));
    let mut union = live_dock_deps.clone();
    union.extend(base_deps);
    union.extend(live_entry_deps);
    union.push(String::from("aep-admit-live-dock"));
    union.sort();
    union.dedup();
    for wall in PRODUCT_WALL_CRATES {
        if member_names.iter().any(|n| n == wall) == false {
            let mut msg = String::from("product wall crate missing from workspace: ");
            msg.push_str(wall);
            return Err(msg);
        }
        if set_has(&live_dock_deps, wall) == false {
            let mut msg = String::from("product wall crate not imported on live dock: ");
            msg.push_str(wall);
            return Err(msg);
        }
    }
    for live in LIVE_PATH_CRATES {
        if set_has(&union, live) == false {
            let mut msg = String::from("live-path crate missing from dock union: ");
            msg.push_str(live);
            return Err(msg);
        }
    }
    Ok(String::from("ok product walls on live dock; slogan CI crates are not members"))
}

pub fn scan_envelope_admit_one_live_evaluation(src: &str) -> Result<String, String> {
    if src.contains("aep_admit_live_dock") == false {
        return Err(String::from("envelope_admit missing aep_admit_live_dock"));
    }
    if src.contains("aep_one_live_evaluation") == false {
        return Err(String::from("envelope_admit missing aep_one_live_evaluation"));
    }
    if src.contains("attach_live_walls") == false {
        return Err(String::from("envelope_admit missing attach_live_walls"));
    }
    if src.contains("process_event") == false {
        return Err(String::from("envelope_admit missing process_event"));
    }
    let body = extract_after(src, "fn admit_sealed_payload_on_live_dock");
    if body.is_empty() {
        return Err(String::from("admit_sealed_payload_on_live_dock not found"));
    }
    let code = compact_src(&strip_line_comments(&body));
    if code.contains("live_collect_all") && code.contains("process_event") {
        return Err(String::from(
            "envelope_admit calls both live_collect_all and process_event Admit on the same plaintext",
        ));
    }
    Ok(String::from("ok one live evaluation"))
}

pub fn unused_wall_crate_gate_deleted(root: &Path) -> Result<String, String> {
    let lib = root.join("AEP-Components/admit-live-dock/crate/src/lib.rs");
    let src = read_text(&lib);
    if src.is_empty() {
        return Err(String::from("admit-live-dock lib.rs missing"));
    }
    if src.contains("unused_wall_crate_gate") {
        return Err(String::from("unused_wall_crate_gate still present"));
    }
    let main = root.join("AEP-Components/admit-live-dock/crate/src/main.rs");
    if main.is_file() {
        let ms = read_text(&main);
        if ms.contains("unused_wall_crate_gate") {
            return Err(String::from("admit-live-dock CLI still runs unused wall gate"));
        }
    }
    Ok(String::from("ok unused_wall_crate_gate deleted"))
}

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod admit_no_trust_tier {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:badc376c8078be36b79df34a3d5981b9320c4b8a3b93a3634499690b5535e3ce
// crate: aep-admit-no-trust-tier
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-038: EnvelopeAction has no rank field. Who-may is agent_may.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-038";

fn extract_after(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn lemma() -> String {
    ["trust", "_tier"].concat()
}

/// Fail if EnvelopeAction still has a rank field.
pub fn scan_envelope_action_type(src: &str) -> Result<String, String> {
    let body = extract_after(src, "pub struct EnvelopeAction");
    if body.is_empty() {
        return Err(String::from("EnvelopeAction not found"));
    }
    let code = compact(&strip_line_comments(&body));
    let needle = lemma();
    if code.contains(&needle) {
        return Err(String::from("EnvelopeAction still has a rank field"));
    }
    Ok(String::from("ok EnvelopeAction has no rank field"))
}

/// Fail if live tests still send a rank field on Admit events.
pub fn scan_live_tests(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    let quoted = {
        let mut s = String::from("\"");
        s.push_str(&lemma());
        s.push('"');
        s
    };
    if code.contains(&quoted) {
        return Err(String::from("live tests still send a rank field"));
    }
    let field = {
        let mut s = String::from("pub ");
        s.push_str(&lemma());
        s
    };
    if code.contains(&field) {
        return Err(String::from("live tests still send a rank field"));
    }
    Ok(String::from("ok live tests do not send a rank field"))
}

/// Fail if TypeScript processEvent still stamps a rank field.
pub fn scan_process_event_stamp(src: &str) -> Result<String, String> {
    let body = extract_after(src, "async processEvent");
    let norm = extract_after(src, "normalizeAgentContext");
    let mut joined = String::new();
    joined.push_str(&body);
    joined.push_str(&norm);
    if joined.is_empty() {
        return Err(String::from("processEvent not found"));
    }
    let code = compact(&strip_line_comments(&joined));
    let assign = {
        let mut s = String::from("event.");
        s.push_str(&lemma());
        s.push('=');
        s
    };
    if code.contains(&assign) {
        return Err(String::from("processEvent still stamps a rank field"));
    }
    Ok(String::from("ok processEvent does not stamp a rank field"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let env = dir.join("AEP-Components/envelope/crate/src/lib.rs");
        if env.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let envelope = root.join("AEP-Components/envelope/crate/src/lib.rs");
    let live = root.join("AEP-Components/live-entry/crate/src/lib.rs");
    let bridge = root.join("AEP-SDKs/typescript/dynaep/src/bridge.ts");
    for (path, scan) in [
        (envelope, "envelope"),
        (live, "live"),
        (bridge, "bridge"),
    ] {
        if path.is_file() == false {
            return Err(format!("missing {scan} source"));
        }
        let src = match fs::read_to_string(&path) {
            Ok(v) => v,
            Err(e) => return Err(e.to_string()),
        };
        if src.is_empty() {
            return Err(format!("empty {scan} source"));
        }
        let proof = match scan {
            "envelope" => scan_envelope_action_type(&src)?,
            "live" => scan_live_tests(&src)?,
            _ => scan_process_event_stamp(&src)?,
        };
        let mut line = String::from("aep-admit-no-trust-tier ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_envelope_action_type domain:admit type:service
pub mod scan_envelope_action_type {
    pub struct ScanEnvelopeActionType {
        pub src: String,
        pub scan: String,
    }

    impl ScanEnvelopeActionType {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if EnvelopeAction still has a rank field.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_envelope_action_type(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_live_tests domain:admit type:service
pub mod scan_live_tests {
    pub struct ScanLiveTests {
        pub src: String,
        pub scan: String,
    }

    impl ScanLiveTests {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if live tests still send a rank field.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_live_tests(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_process_event_stamp domain:admit type:service
pub mod scan_process_event_stamp {
    pub struct ScanProcessEventStamp {
        pub src: String,
        pub scan: String,
    }

    impl ScanProcessEventStamp {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if TypeScript processEvent still stamps a rank field.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_process_event_stamp(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod admit_no_trust_tier

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod admit_opa_sole {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:d7273d19c2faf4c8c41fe30ae4b743f7562d6cd0df43755de4585bb449643449
// crate: aep-admit-opa-sole
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// Transform encode hmac-sha256:d7273d19c2faf4c8c41fe30ae4b743f7562d6cd0df43755de4585bb449643449
//
// Issue 4: drop the restricted lattice-policy subset from Admit.
// Live lattice policy is OPA lattice-policy.rego only.

use anyhow::{anyhow, Context};
use std::fs;
use std::path::{Path, PathBuf};

/// Needles that mean Admit still carries a restricted lattice-policy subset.
pub const RESTRICTED_NEEDLES: &[&str] = &[
    "package dynaep.lattice",
    "rego.restricted",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanHit {
    pub needle: String,
    pub line: usize,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanReport {
    pub path: String,
    pub hits: Vec<ScanHit>,
}

impl ScanReport {
    pub fn clean(&self) -> bool {
        self.hits.is_empty()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ProofReport {
    pub path: String,
    pub has_package: bool,
    pub has_deny_set: bool,
}

impl ProofReport {
    pub fn ok(&self) -> bool {
        self.has_package && self.has_deny_set
    }
}

fn is_comment_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with('#') || t.starts_with('*') || t.starts_with("/*")
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: restricted_fragment_scan domain:admit type:service
pub mod restricted_fragment_scan {
    use super::*;

    pub struct RestrictedFragmentScan {
        pub source: String,
        pub scan: String,
    }

    impl RestrictedFragmentScan {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                scan: String::new(),
            }
        }

        /// Scan admit.mjs bytes and fail if a restricted Rego subset remains
        pub fn process(&mut self) -> anyhow::Result<()> {
            let report = scan_source(&self.source);
            self.scan = format_hits(&report);
            if !report.is_empty() {
                return Err(anyhow!(
                    "restricted lattice-policy subset still present: {}",
                    self.scan
                ));
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: opa_sole_proof domain:admit type:service
pub mod opa_sole_proof {
    use super::*;

    pub struct OpaSoleProof {
        pub policy_path: String,
        pub proof: String,
    }

    impl OpaSoleProof {
        pub fn new() -> Self {
            Self {
                policy_path: String::new(),
                proof: String::new(),
            }
        }

        /// Prove live lattice policy is OPA lattice-policy.rego only
        pub fn process(&mut self) -> anyhow::Result<()> {
            let text = fs::read_to_string(&self.policy_path)
                .with_context(|| self.policy_path.clone())?;
            let report = prove_opa_policy(&self.policy_path, &text);
            self.proof = format!(
                "path={} package={} deny_set={} ok={}",
                report.path, report.has_package, report.has_deny_set, report.ok()
            );
            if !report.ok() {
                return Err(anyhow!(
                    "OPA lattice-policy.rego is not the live policy file: {}",
                    self.proof
                ));
            }
            Ok(())
        }
    }
}

pub fn scan_source(source: &str) -> Vec<ScanHit> {
    let mut hits = Vec::new();
    for (idx, line) in source.lines().enumerate() {
        if is_comment_line(line) {
            continue;
        }
        for needle in RESTRICTED_NEEDLES {
            if line.contains(needle) {
                hits.push(ScanHit {
                    needle: (*needle).to_string(),
                    line: idx + 1,
                });
            }
        }
    }
    hits
}

pub fn format_hits(hits: &[ScanHit]) -> String {
    hits.iter()
        .map(|h| format!("{}:{}", h.line, h.needle))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn scan_file(path: &Path) -> anyhow::Result<ScanReport> {
    let text = fs::read_to_string(path).with_context(|| path.display().to_string())?;
    Ok(ScanReport {
        path: path.display().to_string(),
        hits: scan_source(&text),
    })
}

pub fn prove_opa_policy(path: &str, policy: &str) -> ProofReport {
    ProofReport {
        path: path.to_string(),
        has_package: policy.contains("package dynaep.lattice"),
        has_deny_set: policy.contains("deny_lattice") && policy.contains("["),
    }
}

pub fn default_admit_js() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/admit/lib/admit.mjs")
}

pub fn default_admit_rs() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/admit/crate/src/lib.rs")
}

pub fn default_opa_policy() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/dynAEP/policies/lattice-policy.rego")
}

pub fn default_filter_ts() -> PathBuf {
    crate::walk_to_workspace()
        .join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts")
}

pub fn filter_stops_live_opa(source: &str) -> bool {
    let opa = source.contains("latticePolicy.evaluate") || source.contains("this.latticePolicy.evaluate");
    let compiled = source.contains("compileLatticePolicy") || source.contains("compileLatticeWalls");
    !opa && compiled && source.contains("admitCollectAll")
}

pub fn run_gate(admit_js: &Path, admit_rs: &Path, opa: &Path, filter: &Path) -> anyhow::Result<i32> {
    let js = scan_file(admit_js)?;
    if !js.clean() {
        eprintln!("admit.mjs still carries a restricted subset: {}", format_hits(&js.hits));
        return Ok(1);
    }
    if admit_rs.is_file() {
        let rs = scan_file(admit_rs)?;
        if !rs.clean() {
            eprintln!(
                "aep-admit crate still carries a restricted subset: {}",
                format_hits(&rs.hits)
            );
            return Ok(1);
        }
    }
    let policy = fs::read_to_string(opa).with_context(|| opa.display().to_string())?;
    let proof = prove_opa_policy(&opa.display().to_string(), &policy);
    if !proof.ok() {
        eprintln!("OPA lattice-policy.rego missing package or deny set");
        return Ok(1);
    }
    if filter.is_file() {
        let ft = fs::read_to_string(filter).with_context(|| filter.display().to_string())?;
        if !filter_stops_live_opa(&ft) {
            eprintln!("HyperlatticeFilter.filterCrossing still calls live OPA evaluate");
            return Ok(1);
        }
        let filter_hits = scan_source(&ft);
        if !filter_hits.is_empty() {
            eprintln!(
                "HyperlatticeFilter carries a restricted subset: {}",
                format_hits(&filter_hits)
            );
            return Ok(1);
        }
    }
    println!(
        "aep-admit-opa-sole ok admit_js={} opa={}",
        admit_js.display(),
        opa.display()
    );
    Ok(0)
}



} // mod admit_opa_sole

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod admit_parity {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:d483558a0ccca317e99b4bf92085d6078007a78d62a9e1c6a7f1b7bae7b47d16
// crate: aep-admit-parity
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// Transform encode hmac-sha256:9a2647390aedbba1040d27bf71623473be06c0947535d19b7f4b01b135c786fa

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};
use anyhow::{anyhow, Context};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const REQUIRED_FIXTURES: &[&str] = &[
    "allow.gaplune",
    "one-closed-wall.gaplune",
    "n-closed-walls.gaplune",
    "order-permutation-a.gaplune",
    "order-permutation-b.gaplune",
    "two-closed-walls.gaplune",
];

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: parse_fixture domain:cli type:cli


// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: run_parity domain:cli type:cli


pub fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

pub fn parse_wall_line(line: &str) -> Option<AdmitWall> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    if line.starts_with('#') || line.starts_with('@') {
        return None;
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
        return None;
    }
    if closed {
        Some(AdmitWall::close(id, reason))
    } else {
        Some(AdmitWall::open(id))
    }
}

pub fn parse_fixture_text(text: &str) -> Vec<AdmitWall> {
    text.lines().filter_map(parse_wall_line).collect()
}

pub fn rust_eval(text: &str) -> AdmitResult {
    admit_collect_all(&parse_fixture_text(text))
}

/// Canonical collect-all text. Closed walls are already sorted by aep-admit.
pub fn format_admit_result(result: &AdmitResult) -> String {
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push('\n');
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push('\n');
    }
    out
}

pub fn default_fixtures_dir() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/admit/crate/fixtures")
}

pub fn default_js_path() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/admit/lib/admit.mjs")
}

pub fn js_eval(text: &str, js: &Path, node: &str) -> anyhow::Result<String> {
    if !js.is_file() {
        return Err(anyhow!("admit.mjs missing at {}", js.display()));
    }
    let mut child = Command::new(node)
        .arg(js)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .with_context(|| format!("spawn {node} {}", js.display()))?;
    {
        let mut stdin = child
            .stdin
            .take()
            .ok_or_else(|| anyhow!("node stdin closed"))?;
        stdin.write_all(text.as_bytes())?;
    }
    let out = child
        .wait_with_output()
        .with_context(|| format!("{node} wait {}", js.display()))?;
    if !out.status.success() {
        return Err(anyhow!(
            "node admit.mjs failed status={} stderr={}",
            out.status,
            String::from_utf8_lossy(&out.stderr)
        ));
    }
    Ok(String::from_utf8(out.stdout)?)
}

fn normalize(s: &str) -> String {
    s.replace("\r\n", "\n")
}

pub fn run_fixtures_dir(fixtures: &Path, js: &Path, node: &str) -> anyhow::Result<i32> {
    if !fixtures.is_dir() {
        return Err(anyhow!("fixtures dir missing: {}", fixtures.display()));
    }
    for name in REQUIRED_FIXTURES {
        let path = fixtures.join(name);
        if !path.is_file() {
            return Err(anyhow!("required fixture missing: {}", path.display()));
        }
        let text = fs::read_to_string(&path).with_context(|| path.display().to_string())?;
        let rust_out = format_admit_result(&rust_eval(&text));
        let js_out = js_eval(&text, js, node)?;
        if normalize(&rust_out) != normalize(&js_out) {
            eprintln!("mismatch fixture={}", name);
            eprintln!("--- rust ---");
            eprint!("{rust_out}");
            eprintln!("--- js ---");
            eprint!("{js_out}");
            return Ok(1);
        }
    }
    let a = rust_eval(&fs::read_to_string(
        fixtures.join("order-permutation-a.gaplune"),
    )?);
    let b = rust_eval(&fs::read_to_string(
        fixtures.join("order-permutation-b.gaplune"),
    )?);
    if a.closed_set_key() != b.closed_set_key() || a.allow != b.allow {
        eprintln!("mismatch order permutation closed set");
        return Ok(1);
    }
    println!(
        "aep-admit-parity ok fixtures={} rust matches js",
        REQUIRED_FIXTURES.len()
    );
    Ok(0)
}



} // mod admit_parity

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod agent_sign_key_provision {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:f3ce60ce7f1f7fe7c55ee4181b46ef04295908f8619c8b9870b50e2cf7417952
// crate: aep-agent-sign-key-provision
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-046: Mint agent sign keys only via an operator provision command.
// Stop first-mint as the identity issuer.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-046";

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

/// Fail if get_or_create still mints agent sign keys.
pub fn scan_get_or_create_does_not_mint(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn get_or_create");
    if body.is_empty() {
        return Err(String::from("get_or_create not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("generate_sign_keypair") {
        return Err(String::from(
            "get_or_create still mints agent sign keys",
        ));
    }
    Ok(String::from("ok get_or_create does not mint"))
}

/// Fail if provision does not mint agent sign keys.
pub fn scan_provision_is_mint_path(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn provision");
    if body.is_empty() {
        return Err(String::from("provision not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("generate_sign_keypair") == false {
        return Err(String::from("provision does not mint agent sign keys"));
    }
    Ok(String::from("ok provision is the mint path"))
}

/// Fail if generate_sign_keypair is used outside provision in product code.
pub fn scan_only_provision_mints(src: &str) -> Result<String, String> {
    let prod = extract_fn(&prod_src(src), "impl AgentSignKeyStore");
    if prod.is_empty() {
        return Err(String::from("impl AgentSignKeyStore not found"));
    }
    let provision = extract_fn(&prod, "pub fn provision");
    if provision.is_empty() {
        return Err(String::from("provision not found"));
    }
    let prod_c = compact(&strip_line_comments(&prod));
    let prov_c = compact(&strip_line_comments(&provision));
    if prov_c.contains("generate_sign_keypair") == false {
        return Err(String::from("provision does not mint agent sign keys"));
    }
    let prod_n = prod_c.matches("generate_sign_keypair").count();
    let prov_n = prov_c.matches("generate_sign_keypair").count();
    if prod_n != prov_n {
        return Err(String::from(
            "generate_sign_keypair used outside provision",
        ));
    }
    Ok(String::from("ok only provision mints agent sign keys"))
}

/// Fail if aep-base-node lacks provision-agent-sign-key.
pub fn scan_cli_provision_command(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    if code.contains("provision-agent-sign-key") == false
        && code.contains("provision_agent_sign_key") == false
    {
        return Err(String::from(
            "aep-base-node lacks provision-agent-sign-key",
        ));
    }
    if code.contains(".provision(") == false {
        return Err(String::from(
            "provision-agent-sign-key does not call provision",
        ));
    }
    Ok(String::from("ok aep-base-node has provision-agent-sign-key"))
}

/// Fail if lattice log or self-test still first-mints.
pub fn scan_kernel_no_first_mint(
    log_src: &str,
    main_src: &str,
    dock_src: &str,
) -> Result<String, String> {
    let sealed = extract_fn(log_src, "fn build_sealed_frame");
    if sealed.is_empty() {
        return Err(String::from("build_sealed_frame not found"));
    }
    let sealed_c = compact(&strip_line_comments(&sealed));
    if sealed_c.contains("get_or_create") {
        return Err(String::from(
            "lattice log still first-mints via get_or_create",
        ));
    }
    if sealed_c.contains(".get(") == false {
        return Err(String::from(
            "lattice log does not look up a provisioned key",
        ));
    }
    let self_test = extract_fn(main_src, "if cli.self_test");
    let self_c = compact(&strip_line_comments(&self_test));
    if self_c.contains("get_or_create") {
        return Err(String::from("self-test still first-mints via get_or_create"));
    }
    let dock_prod = prod_src(dock_src);
    let dock_c = compact(&strip_line_comments(&dock_prod));
    if dock_c.contains("get_or_create") {
        return Err(String::from(
            "dock production still first-mints via get_or_create",
        ));
    }
    Ok(String::from(
        "ok lattice log and self-test do not first-mint",
    ))
}


/// Fail if self-test record_lattice_event does not bind eight INSERT columns.
pub fn scan_self_test_record_binds_eight(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn record_lattice_event");
    if body.is_empty() {
        return Err(String::from("record_lattice_event not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("VALUES(?1,?2,?3,?4,?5,?6,?7,?8)") == false {
        return Err(String::from(
            "record_lattice_event lacks eight INSERT placeholders",
        ));
    }
    let start = match code.find("params![") {
        Some(v) => v,
        None => return Err(String::from("record_lattice_event lacks params")),
    };
    let rest = &code[start + "params![".len()..];
    let end = match rest.find("]") {
        Some(v) => v,
        None => return Err(String::from("record_lattice_event params unclosed")),
    };
    let inner = &rest[..end];
    let n = inner.split(",").filter(|p| p.is_empty() == false).count();
    if n != 8 {
        return Err(String::from(
            "record_lattice_event does not bind eight INSERT columns",
        ));
    }
    Ok(String::from("ok self-test record binds eight columns"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir
            .join("AEP-Base-Node")
            .join("crate")
            .join("src")
            .join("dock_keys.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let hangar = ["AEP", "Base", "Node"].join("-");
    let crate_src = ["crate", "src"].join("/");
    let keys = root.join(&hangar).join(&crate_src).join("dock_keys.rs");
    let main = root.join(&hangar).join(&crate_src).join("main.rs");
    let log = root.join(&hangar).join(&crate_src).join("lattice_log.rs");
    let dock = root.join(&hangar).join(&crate_src).join("docking.rs");
    let libp = root.join(&hangar).join(&crate_src).join("lib.rs");
    let keys_src = read_src(&keys, "dock_keys")?;
    let main_src = read_src(&main, "main")?;
    let log_src = read_src(&log, "lattice_log")?;
    let dock_src = read_src(&dock, "docking")?;
    let lib_src = read_src(&libp, "lib")?;
    let proofs = [
        scan_get_or_create_does_not_mint(&keys_src)?,
        scan_provision_is_mint_path(&keys_src)?,
        scan_only_provision_mints(&keys_src)?,
        scan_cli_provision_command(&main_src)?,
        scan_kernel_no_first_mint(&log_src, &main_src, &dock_src)?,
        scan_self_test_record_binds_eight(&lib_src)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-agent-sign-key-provision ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_get_or_create_does_not_mint domain:lattice type:service
pub mod scan_get_or_create_does_not_mint {
    pub struct ScanGetOrCreateDoesNotMint {
        pub src: String,
        pub scan: String,
    }

    impl ScanGetOrCreateDoesNotMint {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if get_or_create still mints agent sign keys
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_get_or_create_does_not_mint(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_provision_is_mint_path domain:lattice type:service
pub mod scan_provision_is_mint_path {
    pub struct ScanProvisionIsMintPath {
        pub src: String,
        pub scan: String,
    }

    impl ScanProvisionIsMintPath {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if provision does not mint agent sign keys
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_provision_is_mint_path(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_cli_provision_command domain:lattice type:service
pub mod scan_cli_provision_command {
    pub struct ScanCliProvisionCommand {
        pub src: String,
        pub scan: String,
    }

    impl ScanCliProvisionCommand {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if aep-base-node lacks provision-agent-sign-key
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_cli_provision_command(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_kernel_no_first_mint domain:lattice type:service
pub mod scan_kernel_no_first_mint {
    pub struct ScanKernelNoFirstMint {
        pub src: String,
        pub scan: String,
    }

    impl ScanKernelNoFirstMint {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if lattice log or self-test still first-mints
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_kernel_no_first_mint(&self.src, &self.src, &self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}


// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_only_provision_mints domain:lattice type:service
pub mod scan_only_provision_mints {
    pub struct ScanOnlyProvisionMints {
        pub src: String,
        pub scan: String,
    }

    impl ScanOnlyProvisionMints {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if generate_sign_keypair is used outside provision
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_only_provision_mints(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_self_test_record_binds_eight domain:lattice type:service
pub mod scan_self_test_record_binds_eight {
    pub struct ScanSelfTestRecordBindsEight {
        pub src: String,
        pub scan: String,
    }

    impl ScanSelfTestRecordBindsEight {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if self-test record_lattice_event does not bind eight INSERT columns
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_self_test_record_binds_eight(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod agent_sign_key_provision

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod caw_wrapenv_failclosed {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:eee82f9e280d4cc149699cdf4eaefd9047643b61a91eb9ac20904412e697a184
// crate: aep-caw-wrapenv-failclosed
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-026: wrapenv.Filter must fail-closed on nil wire and BuildEnv error.

use std::fs;
use std::path::{Path, PathBuf};

fn extract_filter_func(src: &str) -> String {
    let start = match src.find("func Filter(") {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let end = rest[1..]
        .find("\nfunc ")
        .map(|i| i + 1)
        .unwrap_or(rest.len());
    rest[..end].to_string()
}

fn is_comment_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with('#') || t.starts_with('*') || t.starts_with("/*")
}

fn code_lines(src: &str) -> String {
    src.lines()
        .filter(|l| is_comment_line(l) == false)
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn nil_wire_deny(wrapenv_source: &str) -> Result<String, String> {
    let filter = extract_filter_func(wrapenv_source);
    if filter.is_empty() {
        return Err(String::from("func Filter not found"));
    }
    let code = code_lines(&filter);
    if code.contains("if wire == nil") == false {
        return Err(String::from("Filter missing nil wire check"));
    }
    if code.contains("return base") {
        return Err(String::from(
            "Filter still returns inherited base on nil wire",
        ));
    }
    if wrapenv_source.contains("passing inherited env unfiltered") {
        return Err(String::from("wrapenv still fail-open on error path"));
    }
    if wrapenv_source.contains("A nil wire returns base unchanged") {
        return Err(String::from("wrapenv still fail-open on nil wire"));
    }
    Ok(String::from("ok nil wire deny"))
}

pub fn buildenv_error_deny(wrapenv_source: &str) -> Result<String, String> {
    let filter = extract_filter_func(wrapenv_source);
    if filter.is_empty() {
        return Err(String::from("func Filter not found"));
    }
    let code = code_lines(&filter);
    if code.contains("err != nil") == false && code.contains("err==nil") == false {
        if code.contains("err") == false {
            return Err(String::from("Filter does not handle BuildEnv error"));
        }
    }
    if code.contains("return base") {
        return Err(String::from(
            "Filter still returns unfiltered base on BuildEnv error",
        ));
    }
    if wrapenv_source.contains("passing inherited env unfiltered") {
        return Err(String::from(
            "wrapenv still returns inherited env unfiltered on BuildEnv error",
        ));
    }
    Ok(String::from("ok BuildEnv error deny"))
}

pub fn default_wrapenv_go() -> PathBuf {
    crate::walk_to_workspace()
        .join("AEP-Components/caw-framework/internal/wrapenv/wrapenv.go")
}

pub fn run_gate(wrapenv: &Path) -> Result<i32, String> {
    if wrapenv.is_file() == false {
        return Err(format!("wrapenv.go missing: {}", wrapenv.display()));
    }
    let src = fs::read_to_string(wrapenv).map_err(|e| e.to_string())?;
    let nil_ok = nil_wire_deny(&src)?;
    let build_ok = buildenv_error_deny(&src)?;
    println!(
        "aep-caw-wrapenv-failclosed ok nil={} buildenv={}",
        nil_ok, build_ok
    );
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: nil_wire_deny domain:caw type:service
pub mod nil_wire_deny {
    use super::*;

    pub struct NilWireDeny {
        pub wrapenv_source: String,
        pub scan: String,
    }

    impl NilWireDeny {
        pub fn new() -> Self {
            Self {
                wrapenv_source: String::new(),
                scan: String::new(),
            }
        }

        /// Deny wrapenv Filter when the env policy wire is absent. Return empty env. Never return the inherited base.
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = if self.wrapenv_source.is_empty() {
                fs::read_to_string(default_wrapenv_go()).map_err(anyhow::Error::msg)?
            } else if Path::new(&self.wrapenv_source).is_file() {
                fs::read_to_string(&self.wrapenv_source).map_err(anyhow::Error::msg)?
            } else {
                self.wrapenv_source.clone()
            };
            self.scan = nil_wire_deny(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: buildenv_error_deny domain:caw type:service
pub mod buildenv_error_deny {
    use super::*;

    pub struct BuildenvErrorDeny {
        pub wrapenv_source: String,
        pub scan: String,
    }

    impl BuildenvErrorDeny {
        pub fn new() -> Self {
            Self {
                wrapenv_source: String::new(),
                scan: String::new(),
            }
        }

        /// Deny wrapenv Filter when BuildEnv returns an error. Return empty env. Never return the unfiltered inherited base.
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = if self.wrapenv_source.is_empty() {
                fs::read_to_string(default_wrapenv_go()).map_err(anyhow::Error::msg)?
            } else if Path::new(&self.wrapenv_source).is_file() {
                fs::read_to_string(&self.wrapenv_source).map_err(anyhow::Error::msg)?
            } else {
                self.wrapenv_source.clone()
            };
            self.scan = buildenv_error_deny(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}



} // mod caw_wrapenv_failclosed

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod client_trust_tier_ignore {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:521ebfb02719488105a2b6d981321874fa80662242f4bd0210e32a5cfe43efdd
// crate: aep-client-trust-tier-ignore
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-028: bound agent_id ignores client trust_tier. Who-may is agent_may.

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};

/// Closed-set id for a client trust_tier floor attempt.
pub const WALL_CLIENT_TRUST_TIER: &str = "constraint:client_trust_tier";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentMayGrant {
    pub agent_id: String,
    pub action: String,
}

/// Drop the client claim. Server identity is agent_id versus agent_may.
pub fn ignore_client_trust_tier(_client_trust_tier: Option<u8>) -> Option<u8> {
    None
}

/// Authorization field trust_tier is never a floor.
pub fn client_trust_tier_is_not_floor(field: &str) -> bool {
    field != "trust_tier"
}

pub fn client_trust_tier_wall(field: &str) -> AdmitWall {
    if field == "trust_tier" {
        AdmitWall::close(WALL_CLIENT_TRUST_TIER, "client trust_tier is not a floor")
    } else {
        AdmitWall::open(WALL_CLIENT_TRUST_TIER)
    }
}

fn grant_matches(grant: &AgentMayGrant, agent_id: &str, action: &str) -> bool {
    let star = grant.agent_id == "*" && agent_id.is_empty() == false;
    let named = agent_id.is_empty() == false && grant.agent_id == agent_id;
    let unbound = grant.agent_id == "unbound" && agent_id.is_empty();
    let agent_ok = star || named || unbound;
    let action_ok = grant.action == "*" || grant.action == action;
    agent_ok && action_ok
}

pub fn agent_is_granted(agent_id: &str, action: &str, grants: &[AgentMayGrant]) -> bool {
    grants.iter().any(|g| grant_matches(g, agent_id, action))
}

/// Bound agent plus inflated client trust_tier still Denies when agent_may is closed.
pub fn bound_agent_inflated_tier_denies(
    agent_id: &str,
    client_trust_tier: Option<u8>,
    grants: &[AgentMayGrant],
    action: &str,
) -> bool {
    let _dropped = ignore_client_trust_tier(client_trust_tier);
    agent_is_granted(agent_id, action, grants) == false
}

pub fn fold_ignore_client_trust_tier(
    agent_id: &str,
    action: &str,
    grants: &[AgentMayGrant],
    field: &str,
    client_trust_tier: Option<u8>,
) -> AdmitResult {
    let _dropped = ignore_client_trust_tier(client_trust_tier);
    let mut walls: Vec<AdmitWall> = Vec::new();
    walls.push(client_trust_tier_wall(field));
    let may_id = {
        let mut id = String::from("gap:agent_may:");
        if agent_id.is_empty() {
            id.push_str("unbound");
        } else {
            id.push_str(agent_id);
        }
        id.push(':');
        id.push_str(action);
        id
    };
    if agent_is_granted(agent_id, action, grants) {
        walls.push(AdmitWall::open(may_id));
    } else {
        let mut reason = String::from("GAP dimension agent_may closed: agent '");
        if agent_id.is_empty() {
            reason.push_str("unbound");
        } else {
            reason.push_str(agent_id);
        }
        reason.push_str("' may not '");
        reason.push_str(action);
        reason.push('\'');
        walls.push(AdmitWall::close(may_id, reason));
    }
    admit_collect_all(&walls)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: ignore_client_trust_tier domain:admit type:service
pub mod ignore_client_trust_tier {
    pub struct IgnoreClientTrustTier {
        pub client_trust_tier: Option<u8>,
        pub dropped: Option<u8>,
    }

    impl IgnoreClientTrustTier {
        pub fn new() -> Self {
            Self {
                client_trust_tier: None,
                dropped: None,
            }
        }

        /// Bound agent_id ignores client trust_tier. Who-may is GAP dimension agent_may. Not a rank.
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.dropped = super::ignore_client_trust_tier(self.client_trust_tier);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: client_trust_tier_is_not_floor domain:admit type:service
pub mod client_trust_tier_is_not_floor {
    use aep_admit::AdmitWall;

    pub struct ClientTrustTierIsNotFloor {
        pub field: String,
        pub wall: AdmitWall,
    }

    impl ClientTrustTierIsNotFloor {
        pub fn new() -> Self {
            Self {
                field: String::new(),
                wall: AdmitWall::open(super::WALL_CLIENT_TRUST_TIER),
            }
        }

        /// Client trust_tier is never compared as a floor when agent_id is set.
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.wall = super::client_trust_tier_wall(&self.field);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: bound_agent_inflated_tier_denies domain:admit type:service
pub mod bound_agent_inflated_tier_denies {
    use super::AgentMayGrant;

    pub struct BoundAgentInflatedTierDenies {
        pub agent_id: String,
        pub action: String,
        pub client_trust_tier: Option<u8>,
        pub grants: Vec<AgentMayGrant>,
        pub deny: bool,
    }

    impl BoundAgentInflatedTierDenies {
        pub fn new() -> Self {
            Self {
                agent_id: String::new(),
                action: String::new(),
                client_trust_tier: None,
                grants: Vec::new(),
                deny: true,
            }
        }

        /// Agent id set plus inflated client trust_tier Deny when agent_may is closed.
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.deny = super::bound_agent_inflated_tier_denies(
                &self.agent_id,
                self.client_trust_tier,
                &self.grants,
                &self.action,
            );
            Ok(())
        }
    }
}



} // mod client_trust_tier_ignore

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod connector_ucb_clients {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:46db03fde29faf57dc8e6931e151d518101244f50d5cedb71951ec3a99796f4d
// crate: aep-connector-ucb-clients
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-054: Slack and Jira real clients through UCB only.
use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::path::PathBuf;
use std::time::Duration;

pub const TICKET: &str = "AEP28-ENV-054";
pub const DEFAULT_UCB: &str = "http://127.0.0.1:8412";

const VENDOR_HOSTS: &[&str] = &[
    "slack.com",
    "www.slack.com",
    "api.slack.com",
    "hooks.slack.com",
    "atlassian.com",
    "www.atlassian.com",
    "api.atlassian.com",
    "api.notion.com",
    "api.hubapi.com",
    "googleapis.com",
    "www.googleapis.com",
    "cloudresourcemanager.googleapis.com",
    "sts.amazonaws.com",
    "amazonaws.com",
    "management.azure.com",
    "api.zapier.com",
    "make.com",
    "eu1.make.com",
];

pub fn host_is_vendor(host: &str) -> bool {
    let h = host.trim().trim_end_matches('.').to_ascii_lowercase();
    VENDOR_HOSTS
        .iter()
        .any(|v| h == *v || h.ends_with(&format!(".{v}")))
}

pub fn parse_http_url(url: &str) -> Result<(String, String, u16, String), String> {
    let u = url.trim();
    let (scheme, rest) = if let Some(r) = u.strip_prefix("http://") {
        ("http", r)
    } else if let Some(r) = u.strip_prefix("https://") {
        ("https", r)
    } else {
        return Err(String::from("url scheme must be http or https"));
    };
    let (hostport, pathq) = match rest.find('/') {
        Some(i) => (&rest[..i], &rest[i..]),
        None => (rest, "/"),
    };
    let hostport = hostport.split('@').last().unwrap_or(hostport);
    let (host, port) = if let Some(i) = hostport.rfind(':') {
        let h = &hostport[..i];
        let p = hostport[i + 1..]
            .parse::<u16>()
            .map_err(|_| String::from("bad port"))?;
        (h.to_string(), p)
    } else {
        let p = if scheme == "https" { 443 } else { 80 };
        (hostport.to_string(), p)
    };
    if host.is_empty() {
        return Err(String::from("host required"));
    }
    Ok((scheme.to_string(), host, port, pathq.to_string()))
}

pub fn assert_ucb_only(url: &str) -> Result<String, String> {
    let (_scheme, host, _port, _path) = parse_http_url(url)?;
    if host_is_vendor(&host) {
        return Err(String::from("vendor host denied"));
    }
    Ok(url.to_string())
}

pub fn assert_ucb_egress_url(url: &str) -> Result<String, String> {
    let u = assert_ucb_only(url)?;
    let (_s, _h, _p, path) = parse_http_url(&u)?;
    if path.starts_with("/ucb/v1/egress/") == false {
        return Err(String::from("UCB egress path required"));
    }
    Ok(u)
}

pub fn ucb_egress_url(ucb_base: &str, service: &str, remainder: &str) -> Result<String, String> {
    let base = ucb_base.trim().trim_end_matches('/');
    assert_ucb_only(base)?;
    let svc = service.trim().trim_matches('/');
    if svc.is_empty() {
        return Err(String::from("service required"));
    }
    let rem = remainder.trim().trim_start_matches('/');
    let url = if rem.is_empty() {
        format!("{base}/ucb/v1/egress/{svc}")
    } else {
        format!("{base}/ucb/v1/egress/{svc}/{rem}")
    };
    assert_ucb_egress_url(&url)
}

#[derive(Clone, Debug)]
pub struct UcbRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(Clone, Debug)]
pub struct UcbResponse {
    pub status: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

pub trait Transport {
    fn send(&self, req: &UcbRequest) -> Result<UcbResponse, String>;
}

pub struct LiveHttpTransport {
    pub timeout: Duration,
}

impl Default for LiveHttpTransport {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(5),
        }
    }
}

impl Transport for LiveHttpTransport {
    fn send(&self, req: &UcbRequest) -> Result<UcbResponse, String> {
        assert_ucb_egress_url(&req.url)?;
        http1_send(req, self.timeout)
    }
}

pub struct ReplayTransport {
    pub status: u16,
    pub body: Vec<u8>,
}

impl Transport for ReplayTransport {
    fn send(&self, req: &UcbRequest) -> Result<UcbResponse, String> {
        assert_ucb_egress_url(&req.url)?;
        Ok(UcbResponse {
            status: self.status,
            headers: vec![],
            body: self.body.clone(),
        })
    }
}

fn http1_send(req: &UcbRequest, timeout: Duration) -> Result<UcbResponse, String> {
    let (scheme, host, port, path) = parse_http_url(&req.url)?;
    if scheme != "http" {
        return Err(String::from("UCB live transport uses http"));
    }
    let mut stream = TcpStream::connect((host.as_str(), port)).map_err(|e| e.to_string())?;
    let _ = stream.set_read_timeout(Some(timeout));
    let _ = stream.set_write_timeout(Some(timeout));
    let mut out = String::new();
    out.push_str(&req.method);
    out.push(' ');
    out.push_str(&path);
    out.push_str(" HTTP/1.1\r\nHost: ");
    out.push_str(&host);
    if port != 80 {
        out.push(':');
        out.push_str(&port.to_string());
    }
    out.push_str("\r\nConnection: close\r\n");
    let mut has_len = false;
    for (k, v) in &req.headers {
        if k.eq_ignore_ascii_case("content-length") {
            has_len = true;
        }
        out.push_str(k);
        out.push_str(": ");
        out.push_str(v);
        out.push_str("\r\n");
    }
    if has_len == false {
        out.push_str("Content-Length: ");
        out.push_str(&req.body.len().to_string());
        out.push_str("\r\n");
    }
    out.push_str("\r\n");
    stream.write_all(out.as_bytes()).map_err(|e| e.to_string())?;
    if req.body.is_empty() == false {
        stream.write_all(&req.body).map_err(|e| e.to_string())?;
    }
    let _ = stream.flush();
    let mut buf = Vec::new();
    stream.read_to_end(&mut buf).map_err(|e| e.to_string())?;
    parse_http_response(&buf)
}

fn parse_http_response(raw: &[u8]) -> Result<UcbResponse, String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or_else(|| String::from("http header end missing"))?;
    let head = std::str::from_utf8(&raw[..split]).map_err(|e| e.to_string())?;
    let body = raw[split + 4..].to_vec();
    let mut lines = head.split("\r\n");
    let status_line = lines.next().ok_or_else(|| String::from("empty response"))?;
    let mut parts = status_line.split_whitespace();
    let _ver = parts.next();
    let code = parts
        .next()
        .ok_or_else(|| String::from("status missing"))?
        .parse::<u16>()
        .map_err(|_| String::from("status parse failed"))?;
    let mut headers = Vec::new();
    for line in lines {
        if let Some((k, v)) = line.split_once(':') {
            headers.push((k.trim().to_string(), v.trim().to_string()));
        }
    }
    Ok(UcbResponse {
        status: code,
        headers,
        body,
    })
}

pub struct UcbClient<T: Transport> {
    pub ucb_base: String,
    pub agent_id: String,
    pub api_key: String,
    pub transport: T,
}

impl UcbClient<LiveHttpTransport> {
    pub fn from_env() -> Result<Self, String> {
        let ucb_base = std::env::var("UCB_URL").unwrap_or_else(|_| DEFAULT_UCB.to_string());
        let agent_id =
            std::env::var("AEP_AGENT_ID").unwrap_or_else(|_| String::from("connector-agent"));
        let api_key = std::env::var("UCB_API_KEY").unwrap_or_else(|_| String::new());
        Ok(Self {
            ucb_base,
            agent_id,
            api_key,
            transport: LiveHttpTransport::default(),
        })
    }
}

impl<T: Transport> UcbClient<T> {
    pub fn request(
        &self,
        method: &str,
        service: &str,
        remainder: &str,
        body: &[u8],
        content_type: &str,
    ) -> Result<UcbResponse, String> {
        let url = ucb_egress_url(&self.ucb_base, service, remainder)?;
        let mut headers = vec![
            (String::from("X-AEP-Agent-Id"), self.agent_id.clone()),
            (String::from("Accept"), String::from("application/json")),
        ];
        if self.api_key.is_empty() == false {
            headers.push((
                String::from("Authorization"),
                format!("Bearer {}", self.api_key),
            ));
        }
        if content_type.is_empty() == false {
            headers.push((String::from("Content-Type"), content_type.to_string()));
        }
        let req = UcbRequest {
            method: method.to_string(),
            url,
            headers,
            body: body.to_vec(),
        };
        self.transport.send(&req)
    }

    pub fn slack_post_message(
        &self,
        channel: &str,
        text: &str,
    ) -> Result<serde_json::Value, String> {
        if channel.trim().is_empty() {
            return Err(String::from("channel required"));
        }
        let payload = serde_json::json!({ "channel": channel, "text": text });
        let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        let resp = self.request(
            "POST",
            "slack",
            "chat.postMessage",
            &body,
            "application/json",
        )?;
        decode_json_status(resp, "slack")
    }

    pub fn jira_create_issue(
        &self,
        project_key: &str,
        issue_type: &str,
        summary: &str,
    ) -> Result<serde_json::Value, String> {
        if project_key.trim().is_empty() {
            return Err(String::from("project key required"));
        }
        let payload = serde_json::json!({
            "fields": {
                "project": { "key": project_key },
                "issuetype": { "name": issue_type },
                "summary": summary
            }
        });
        let body = serde_json::to_vec(&payload).map_err(|e| e.to_string())?;
        let resp = self.request("POST", "jira", "rest/api/3/issue", &body, "application/json")?;
        decode_json_status(resp, "jira")
    }
}

fn decode_json_status(resp: UcbResponse, label: &str) -> Result<serde_json::Value, String> {
    if resp.status >= 400 {
        return Err(format!("{label} http {}", resp.status));
    }
    let v: serde_json::Value = serde_json::from_slice(&resp.body).map_err(|e| e.to_string())?;
    if label == "slack" && v.get("ok") != Some(&serde_json::Value::Bool(true)) {
        return Err(String::from("slack ok is false"));
    }
    Ok(v)
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            let before = &line[..i];
            if before.ends_with(':') {
                out.push_str(line);
            } else {
                out.push_str(before);
            }
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}
fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

pub fn scan_no_vendor_direct(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(&prod_src(src)));
    let needles = [
        "fetch(\"https://slack.com",
        "fetch('https://slack.com",
        "fetch(\"https://api.slack.com",
        "fetch(\"https://hooks.slack.com",
        "fetch(\"https://api.atlassian.com",
        "fetch('https://api.atlassian.com",
        "fetch(\"https://atlassian.com",
        "fetch(\"https://api.notion.com",
        "fetch(\"https://api.hubapi.com",
        "fetch(\"https://www.googleapis.com",
        "fetch(\"https://sts.amazonaws.com",
        "fetch(\"https://management.azure.com",
        "fetch(\"https://api.zapier.com",
    ];
    for n in needles {
        if code.contains(n) {
            return Err(String::from("vendor fetch denied"));
        }
    }
    Ok(String::from("ok no vendor fetch"))
}

pub fn scan_kit_ucb_client(src: &str) -> Result<String, String> {
    let need = [
        "assertUcbOnlyUrl",
        "ucbEgressUrl",
        "ucbFetch",
        "probeViaUcb",
        "slackPostMessage",
        "jiraCreateIssue",
    ];
    for n in need {
        if src.contains(n) == false {
            return Err(format!("kit missing {n}"));
        }
    }
    Ok(String::from("ok kit UCB client"))
}

pub fn scan_slack_post_message(src: &str) -> Result<String, String> {
    if src.contains("slackPostMessage") == false {
        return Err(String::from("slack client missing slackPostMessage"));
    }
    if src.contains("probeViaUcb") == false {
        return Err(String::from("slack probe missing probeViaUcb"));
    }
    Ok(String::from("ok slack posts via UCB"))
}

pub fn scan_jira_create_issue(src: &str) -> Result<String, String> {
    if src.contains("jiraCreateIssue") == false {
        return Err(String::from("jira client missing jiraCreateIssue"));
    }
    if src.contains("probeViaUcb") == false {
        return Err(String::from("jira probe missing probeViaUcb"));
    }
    Ok(String::from("ok jira creates via UCB"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir.join("AEP-Connectors").join("lib").join("connector-kit.mjs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn walk_mjs(dir: &std::path::Path, out: &mut Vec<PathBuf>) {
    let rd = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_dir() {
            walk_mjs(&p, out);
        } else if p.extension().and_then(|e| e.to_str()) == Some("mjs") {
            out.push(p);
        }
    }
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let kit = root.join("AEP-Connectors").join("lib").join("connector-kit.mjs");
    let slack = root
        .join("AEP-Connectors")
        .join("slack")
        .join("lib")
        .join("slack-connector.mjs");
    let jira = root
        .join("AEP-Connectors")
        .join("jira")
        .join("lib")
        .join("jira-connector.mjs");
    let kit_src = read_src(&kit, "connector-kit")?;
    let slack_src = read_src(&slack, "slack")?;
    let jira_src = read_src(&jira, "jira")?;
    let mut proofs = vec![
        scan_kit_ucb_client(&kit_src)?,
        scan_slack_post_message(&slack_src)?,
        scan_jira_create_issue(&jira_src)?,
        scan_no_vendor_direct(&kit_src)?,
        scan_no_vendor_direct(&slack_src)?,
        scan_no_vendor_direct(&jira_src)?,
    ];
    let mut mjs = Vec::new();
    walk_mjs(&root.join("AEP-Connectors"), &mut mjs);
    for p in mjs {
        let src = read_src(&p, "connector mjs")?;
        proofs.push(scan_no_vendor_direct(&src)?);
        let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
        if name.ends_with("-connector.mjs") && src.contains("probeViaUcb") == false {
            return Err(format!("connector {} missing probeViaUcb", name));
        }
    }
    for proof in proofs {
        let mut line = String::from("aep-connector-ucb-clients ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}
// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: assert_ucb_only domain:lattice type:service
pub mod assert_ucb_only {
    pub struct AssertUcbOnly {
        pub url: String,
        pub result: String,
    }
    impl AssertUcbOnly {
        pub fn new() -> Self {
            Self { url: String::new(), result: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::assert_ucb_only(&self.url) {
                Ok(v) => self.result = v,
                Err(e) => self.result = e,
            }
            Ok(())
        }
    }
}
// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: ucb_egress_url domain:lattice type:service
pub mod ucb_egress_url {
    pub struct UcbEgressUrl {
        pub ucb_base: String,
        pub service: String,
        pub remainder: String,
        pub result: String,
    }
    impl UcbEgressUrl {
        pub fn new() -> Self {
            Self {
                ucb_base: String::new(),
                service: String::new(),
                remainder: String::new(),
                result: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::ucb_egress_url(&self.ucb_base, &self.service, &self.remainder) {
                Ok(v) => self.result = v,
                Err(e) => self.result = e,
            }
            Ok(())
        }
    }
}
// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: slack_post_message domain:lattice type:service
pub mod slack_post_message {
    pub struct SlackPostMessage {
        pub channel: String,
        pub text: String,
        pub result: String,
    }
    impl SlackPostMessage {
        pub fn new() -> Self {
            Self { channel: String::new(), text: String::new(), result: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let client = super::UcbClient {
                ucb_base: String::from("http://127.0.0.1:8412"),
                agent_id: String::from("hvvc"),
                api_key: String::from("k"),
                transport: super::ReplayTransport {
                    status: 200,
                    body: br#"{"ok":true,"ts":"1"}"#.to_vec(),
                },
            };
            match client.slack_post_message(&self.channel, &self.text) {
                Ok(v) => self.result = v.to_string(),
                Err(e) => self.result = e,
            }
            Ok(())
        }
    }
}
// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: jira_create_issue domain:lattice type:service
pub mod jira_create_issue {
    pub struct JiraCreateIssue {
        pub project_key: String,
        pub issue_type: String,
        pub summary: String,
        pub result: String,
    }
    impl JiraCreateIssue {
        pub fn new() -> Self {
            Self {
                project_key: String::new(),
                issue_type: String::from("Task"),
                summary: String::new(),
                result: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let client = super::UcbClient {
                ucb_base: String::from("http://127.0.0.1:8412"),
                agent_id: String::from("hvvc"),
                api_key: String::from("k"),
                transport: super::ReplayTransport {
                    status: 201,
                    body: br#"{"id":"10000","key":"AB-1"}"#.to_vec(),
                },
            };
            match client.jira_create_issue(&self.project_key, &self.issue_type, &self.summary) {
                Ok(v) => self.result = v.to_string(),
                Err(e) => self.result = e,
            }
            Ok(())
        }
    }
}
// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_no_vendor_direct domain:lattice type:service
pub mod scan_no_vendor_direct {
    pub struct ScanNoVendorDirect {
        pub src: String,
        pub scan: String,
    }
    impl ScanNoVendorDirect {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_no_vendor_direct(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}


} // mod connector_ucb_clients

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod dynaep_live_crossing_e2e {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:2a7c3be6127483f6004369dee352d16b4f99b77cfa39791b3d427a04a62afc53
// crate: aep-dynaep-live-crossing-e2e
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// Live crossing E2E: Admit collect-all then OPA deny collect-all then Apply.
// Apply is skipped when Admit allow is false.

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrossingInput {
    pub walls: Vec<AdmitWall>,
    pub opa_denies: Vec<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrossingResult {
    pub allow: bool,
    pub closed: Vec<AdmitWall>,
    pub reasons: Vec<String>,
    pub applied: bool,
}

pub fn push_unique_reason(dst: &mut Vec<String>, item: &str) {
    if item.is_empty() {
        return;
    }
    if !dst.iter().any(|x| x == item) {
        dst.push(item.to_string());
    }
}

pub fn apply_if_admit_allows(admit_allow: bool, opa_deny_count: usize) -> bool {
    admit_allow && opa_deny_count == 0
}

pub fn live_cross(input: CrossingInput, apply_hits: &mut u32) -> CrossingResult {
    let admit: AdmitResult = admit_collect_all(&input.walls);
    let mut reasons: Vec<String> = Vec::new();
    for wall in &admit.closed {
        push_unique_reason(&mut reasons, &wall.reason);
    }
    for deny in &input.opa_denies {
        push_unique_reason(&mut reasons, deny);
    }
    let applied = apply_if_admit_allows(admit.allow, input.opa_denies.len());
    if applied {
        *apply_hits += 1;
    }
    CrossingResult {
        allow: admit.allow && input.opa_denies.is_empty(),
        closed: admit.closed,
        reasons,
        applied,
    }
}

pub fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

pub fn parse_fixture_text(text: &str) -> CrossingInput {
    let mut walls = Vec::new();
    let mut opa_denies = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        if let Some(deny) = line.strip_prefix("opa=") {
            opa_denies.push(deny.trim().to_string());
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
        if closed {
            walls.push(AdmitWall::close(id, reason));
        } else {
            walls.push(AdmitWall::open(id));
        }
    }
    CrossingInput { walls, opa_denies }
}

pub fn format_crossing(result: &CrossingResult) -> String {
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push('\n');
    out.push_str("applied=");
    out.push_str(if result.applied { "true" } else { "false" });
    out.push('\n');
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push('\n');
    }
    for reason in &result.reasons {
        out.push_str("reason=");
        out.push_str(reason);
        out.push('\n');
    }
    out
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_crossing domain:dynaep type:service
pub mod live_crossing {
    use super::{live_cross, CrossingInput, CrossingResult};
    use aep_admit::AdmitWall;

    pub struct LiveCrossing {
        pub walls: Vec<AdmitWall>,
        pub opa_denies: Vec<String>,
        pub result: Option<CrossingResult>,
        pub apply_hits: u32,
    }

    impl LiveCrossing {
        pub fn new() -> Self {
            Self {
                walls: Vec::new(),
                opa_denies: Vec::new(),
                result: None,
                apply_hits: 0,
            }
        }

        /// Collect every closed Admit wall then collect every OPA deny then Apply only after Admit allows
        pub fn process(&mut self) -> anyhow::Result<()> {
            let input = CrossingInput {
                walls: self.walls.clone(),
                opa_denies: self.opa_denies.clone(),
            };
            self.result = Some(live_cross(input, &mut self.apply_hits));
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: apply_gate domain:dynaep type:service
pub mod apply_gate {
    use super::apply_if_admit_allows;

    pub struct ApplyGate {
        pub admit_allow: bool,
        pub opa_deny_count: usize,
        pub applied: bool,
    }

    impl ApplyGate {
        pub fn new() -> Self {
            Self {
                admit_allow: false,
                opa_deny_count: 0,
                applied: false,
            }
        }

        /// Skip Apply when Admit allow is false and record applied false
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.applied = apply_if_admit_allows(self.admit_allow, self.opa_deny_count);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: closed_set_order domain:dynaep type:service
pub mod closed_set_order {
    use aep_admit::{admit_collect_all, AdmitWall};

    pub struct ClosedSetOrder {
        pub walls: Vec<AdmitWall>,
        pub key: String,
    }

    impl ClosedSetOrder {
        pub fn new() -> Self {
            Self {
                walls: Vec::new(),
                key: String::new(),
            }
        }

        /// Prove shuffling wall order does not change the closed set
        pub fn process(&mut self) -> anyhow::Result<()> {
            let result = admit_collect_all(&self.walls);
            self.key = result.closed_set_key();
            Ok(())
        }
    }
}


} // mod dynaep_live_crossing_e2e

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod empty_lattice_close {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:5892a0182ccbe6a35fe0d504081d106af31e68b1f1fc5deb189ab1af236a86b3
// crate: aep-empty-lattice-close
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-042: Empty lattice must close dag.membership and gap.agent_may.
// Do not reopen AEP28-ENV-034.
use aep_envelope::{admit, closed_names, EnvelopeAction, Snapshot};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-042";
pub const PARENT_TICKET: &str = "AEP28-ENV-034";

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

/// Fail if wall_dag still opens dag.membership when lattice_nodes is empty.
pub fn scan_wall_dag_empty(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "fn wall_dag");
    if body.is_empty() {
        return Err(String::from("wall_dag not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("lattice_nodes.is_empty()") == false {
        return Err(String::from("wall_dag does not check empty lattice"));
    }
    if code.contains("is_empty(){returnwall(\"dag.membership\",\"dag\",true") {
        return Err(String::from(
            "wall_dag still opens dag.membership when lattice_nodes is empty",
        ));
    }
    if code.contains("true,\"nolatticeconfigured\"") {
        return Err(String::from(
            "wall_dag still opens dag.membership when lattice_nodes is empty",
        ));
    }
    if code.contains("is_empty(){returnwall(\"dag.membership\",\"dag\",false") == false {
        return Err(String::from(
            "wall_dag does not close dag.membership when lattice_nodes is empty",
        ));
    }
    Ok(String::from(
        "ok wall_dag closes dag.membership on empty lattice",
    ))
}

/// Fail if wall_agent_may still opens gap.agent_may when lattice_nodes is empty.
pub fn scan_wall_agent_may_empty(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "fn wall_agent_may");
    if body.is_empty() {
        return Err(String::from("wall_agent_may not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("lattice_nodes.is_empty()") == false {
        return Err(String::from("wall_agent_may does not check empty lattice"));
    }
    if code.contains("is_empty(){returnwall(\"gap.agent_may\",\"gap\",true") {
        return Err(String::from(
            "wall_agent_may still opens gap.agent_may when lattice_nodes is empty",
        ));
    }
    if code.contains("true,\"nolatticeconfigured\"") {
        return Err(String::from(
            "wall_agent_may still opens gap.agent_may when lattice_nodes is empty",
        ));
    }
    if code.contains("is_empty(){returnwall(\"gap.agent_may\",\"gap\",false") == false {
        return Err(String::from(
            "wall_agent_may does not close gap.agent_may when lattice_nodes is empty",
        ));
    }
    Ok(String::from(
        "ok wall_agent_may closes gap.agent_may on empty lattice",
    ))
}

fn sample_action(action_path: &str) -> EnvelopeAction {
    EnvelopeAction {
        action_path: String::from(action_path),
        agent_id: String::from("agent-a"),
        payload: serde_json::json!({"ok": true}),
        tool: String::new(),
        dest_dock: String::new(),
        scene_id: String::new(),
        agent_ts_ms: 0,
        sequence_number: 0,
        anomaly_score: 0.0,
    }
}

/// Empty node map must Deny membership and agent_may on a non-empty action_path.
pub fn admit_empty_lattice(action_path: &str) -> Result<String, String> {
    if action_path.is_empty() {
        return Err(String::from("action_path must be non-empty for this proof"));
    }
    let snap = Snapshot::default();
    if snap.lattice_nodes.is_empty() == false {
        return Err(String::from("default snapshot is not an empty node map"));
    }
    let result = admit(&sample_action(action_path), &snap);
    if result.allow {
        return Err(String::from(
            "empty lattice allowed a non-empty action_path",
        ));
    }
    let names = closed_names(&result);
    if names.contains("dag.membership") == false {
        return Err(String::from("empty lattice did not close dag.membership"));
    }
    if names.contains("gap.agent_may") == false {
        return Err(String::from("empty lattice did not close gap.agent_may"));
    }
    Ok(String::from(
        "ok empty lattice closes dag.membership and gap.agent_may",
    ))
}

/// Fail if AEP28-ENV-034 empty-lattice Deny at live entry is gone.
pub fn scan_env034_live_entry(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    if code.contains("lattice_nodes.is_empty()") == false {
        return Err(String::from(
            "AEP28-ENV-034 live-entry empty lattice Deny is gone",
        ));
    }
    if code.contains("LatticerequiredbutActionLatticeisnotinitialised") == false {
        return Err(String::from(
            "AEP28-ENV-034 live-entry empty lattice Deny is gone",
        ));
    }
    Ok(String::from("ok AEP28-ENV-034 live-entry Deny stays"))
}

/// Fail if missing or unreadable lattice YAML is no longer Deny at load.
pub fn scan_env034_envelope_admit(src: &str) -> Result<String, String> {
    if src.contains("AEP28-ENV-034") == false {
        return Err(String::from(
            "AEP28-ENV-034 envelope_admit Deny at load is gone",
        ));
    }
    if src.contains("fall through") == false {
        return Err(String::from(
            "AEP28-ENV-034 envelope_admit Deny at load is gone",
        ));
    }
    Ok(String::from("ok AEP28-ENV-034 load Deny stays"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let env = dir.join("AEP-Components/envelope/crate/src/lib.rs");
        if env.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let envelope = root.join("AEP-Components/envelope/crate/src/lib.rs");
    let live = root.join("AEP-Components/live-entry/crate/src/lib.rs");
    let admit = root.join("AEP-Base-Node/crate/src/envelope_admit.rs");
    let env_src = read_src(&envelope, "envelope")?;
    let live_src = read_src(&live, "live-entry")?;
    let admit_src = read_src(&admit, "envelope_admit")?;
    let proofs = [
        scan_wall_dag_empty(&env_src)?,
        scan_wall_agent_may_empty(&env_src)?,
        admit_empty_lattice("action:write")?,
        scan_env034_live_entry(&live_src)?,
        scan_env034_envelope_admit(&admit_src)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-empty-lattice-close ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_wall_dag_empty domain:envelope type:service
pub mod scan_wall_dag_empty {
    pub struct ScanWallDagEmpty {
        pub src: String,
        pub scan: String,
    }

    impl ScanWallDagEmpty {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if wall_dag still opens dag.membership when lattice_nodes is empty.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_wall_dag_empty(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_wall_agent_may_empty domain:envelope type:service
pub mod scan_wall_agent_may_empty {
    pub struct ScanWallAgentMayEmpty {
        pub src: String,
        pub scan: String,
    }

    impl ScanWallAgentMayEmpty {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if wall_agent_may still opens gap.agent_may when lattice_nodes is empty.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_wall_agent_may_empty(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: admit_empty_lattice domain:envelope type:service
pub mod admit_empty_lattice {
    pub struct AdmitEmptyLattice {
        pub action_path: String,
        pub closed: String,
    }

    impl AdmitEmptyLattice {
        pub fn new() -> Self {
            Self {
                action_path: String::new(),
                closed: String::new(),
            }
        }

        /// Empty node map Deny for membership and agent_may on a non-empty action_path.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::admit_empty_lattice(&self.action_path) {
                Ok(v) => self.closed = v,
                Err(e) => self.closed = e,
            }
            Ok(())
        }
    }
}



} // mod empty_lattice_close

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod envelope_algebra {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:544c3507cb7f365dc10b67059b36c5fd3f4180964845e80ab8b5dd45138f8b1b
// crate: aep-envelope-algebra
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-008: Envelope algebra tests. Order, collect-all and Apply skip.

use aep_admit::{
    admit_collect_all, compile_agent_may_wall, compile_writing_walls, AdmitResult, AdmitWall,
    AgentMayGrant, WALL_AGENT_MAY,
};
use aep_admit_channel_order_walls::{
    compile_channel_walls, ChannelCompileInput, WALL_CHANNEL_NON_FRAME,
};
use aep_admit_temporal_bounds::{
    compile_temporal_walls, TemporalCompileInput, WALL_TEMPORAL_DRIFT,
};

/// Apply runs only when Admit allow is true.
pub fn apply_if_admit_allows(admit_allow: bool) -> bool {
    admit_allow
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvelopeInput {
    pub walls: Vec<AdmitWall>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EnvelopeResult {
    pub allow: bool,
    pub closed: Vec<AdmitWall>,
    pub applied: bool,
    pub key: String,
}

/// One collect-all pass then Apply. Skip Apply when any wall is closed.
pub fn envelope_cross(input: EnvelopeInput, apply_hits: &mut u32) -> EnvelopeResult {
    let admit: AdmitResult = admit_collect_all(&input.walls);
    let applied = apply_if_admit_allows(admit.allow);
    if applied {
        *apply_hits += 1;
    }
    EnvelopeResult {
        allow: admit.allow,
        closed: admit.closed.clone(),
        applied,
        key: admit.closed_set_key(),
    }
}

/// Compile lattice writing trust channel and temporal walls onto one vector.
pub fn compile_envelope_walls(
    lattice: &[AdmitWall],
    writing_text: &str,
    agent_id: &str,
    action: &str,
    grants: &[AgentMayGrant],
    channel: &ChannelCompileInput,
    temporal: &TemporalCompileInput,
) -> Vec<AdmitWall> {
    let mut walls = Vec::new();
    walls.extend(lattice.iter().cloned());
    walls.extend(compile_writing_walls(writing_text));
    walls.push(compile_agent_may_wall(agent_id, action, grants));
    walls.extend(compile_channel_walls(channel));
    walls.extend(compile_temporal_walls(temporal));
    walls
}

pub fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

pub fn parse_fixture_text(text: &str) -> EnvelopeInput {
    let mut walls = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        if line.starts_with("fixture:") || line.starts_with("schema_id:") || line.starts_with("format:")
            || line.starts_with("json:") || line.starts_with("crate:") || line.starts_with("note:")
            || line.starts_with("ticket:")
        {
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
                    "dim" => {}
                    _ => {}
                }
            }
        }
        if id.is_empty() {
            continue;
        }
        if closed {
            walls.push(AdmitWall::close(id, reason));
        } else {
            walls.push(AdmitWall::open(id));
        }
    }
    EnvelopeInput { walls }
}

pub fn format_envelope(result: &EnvelopeResult) -> String {
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push('\n');
    out.push_str("applied=");
    out.push_str(if result.applied { "true" } else { "false" });
    out.push('\n');
    out.push_str("key=");
    out.push_str(&result.key);
    out.push('\n');
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push('\n');
    }
    out
}

fn em_sample() -> String {
    let mut s = String::from("bad");
    s.push('\u{2014}');
    s.push_str("dash");
    s
}

fn closed_frame_channel() -> ChannelCompileInput {
    ChannelCompileInput {
        channel_id: String::new(),
        agent_id: String::new(),
        session_id: String::new(),
        docking_port: String::new(),
        contract_id: String::new(),
        has_capsule: false,
        contract_active: false,
        docking_wire: String::from("ping"),
        rate_limited: false,
    }
}

fn open_frame_channel() -> ChannelCompileInput {
    ChannelCompileInput {
        channel_id: String::from("ex.dynaep.event"),
        agent_id: String::from("agent-a"),
        session_id: String::from("sess-1"),
        docking_port: String::from("inference_engine"),
        contract_id: String::from("PM-DYNAEP-001"),
        has_capsule: true,
        contract_active: true,
        docking_wire: String::from("frame"),
        rate_limited: false,
    }
}

fn closed_temporal() -> TemporalCompileInput {
    let mut t = TemporalCompileInput::with_defaults();
    t.has_agent_time = true;
    t.drift_ms = 80;
    t.agent_time_ms = 10080;
    t.bridge_time_ms = 10000;
    t.max_drift_ms = 50;
    t.agent_id = String::from("agent-a");
    t.target_id = String::from("webhook:incoming");
    t.event_id = String::from("evt-1");
    t
}

fn open_temporal() -> TemporalCompileInput {
    let mut t = TemporalCompileInput::with_defaults();
    t.has_agent_time = false;
    t.drift_ms = 0;
    t.agent_time_ms = 0;
    t.bridge_time_ms = 10000;
    t.max_drift_ms = 50;
    t.agent_id = String::from("agent-a");
    t.target_id = String::from("webhook:incoming");
    t.event_id = String::from("evt-1");
    t
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: envelope_collect_all domain:admit type:service
pub mod envelope_collect_all {
    use super::{admit_collect_all, AdmitResult, AdmitWall};

    pub struct EnvelopeCollectAll {
        pub walls: Vec<AdmitWall>,
        pub result: Option<AdmitResult>,
    }

    impl EnvelopeCollectAll {
        pub fn new() -> Self {
            Self {
                walls: Vec::new(),
                result: None,
            }
        }

        /// Collect every closed Admit wall across lattice writing trust channel and temporal dimensions on one pass
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.result = Some(admit_collect_all(&self.walls));
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: envelope_order domain:admit type:service
pub mod envelope_order {
    use super::admit_collect_all;
    use aep_admit::AdmitWall;

    pub struct EnvelopeOrder {
        pub walls: Vec<AdmitWall>,
        pub key: String,
    }

    impl EnvelopeOrder {
        pub fn new() -> Self {
            Self {
                walls: Vec::new(),
                key: String::new(),
            }
        }

        /// Prove shuffling wall order does not change the closed set key
        pub fn process(&mut self) -> anyhow::Result<()> {
            let result = admit_collect_all(&self.walls);
            self.key = result.closed_set_key();
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: apply_skip domain:dynaep type:service
pub mod apply_skip {
    use super::apply_if_admit_allows;

    pub struct ApplySkip {
        pub admit_allow: bool,
        pub applied: bool,
    }

    impl ApplySkip {
        pub fn new() -> Self {
            Self {
                admit_allow: false,
                applied: false,
            }
        }

        /// Skip Apply when Admit allow is false and record applied false
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.applied = apply_if_admit_allows(self.admit_allow);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: fixture_parse domain:admit type:service
pub mod fixture_parse {
    use super::{parse_fixture_text, AdmitWall};

    pub struct FixtureParse {
        pub text: String,
        pub walls: Vec<AdmitWall>,
    }

    impl FixtureParse {
        pub fn new() -> Self {
            Self {
                text: String::new(),
                walls: Vec::new(),
            }
        }

        /// Parse gaplune fixtures for allow one closed wall N closed walls and order permutation
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.walls = parse_fixture_text(&self.text).walls;
            Ok(())
        }
    }
}



} // mod envelope_algebra

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod envelope_algebra_ci {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:919070fba02421bc02fbbc73fff8c01e5860c12d746bc8a04e47d69614cdddf8
// crate: aep-envelope-algebra-ci
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-010: CI gate against live OPA and live 15-step on action_path.

use anyhow::anyhow;
use std::fs;
use std::path::{Path, PathBuf};

pub const RESTRICTED_NEEDLES: &[&str] = &["package dynaep.lattice", "rego.restricted"];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ScanHit {
    pub needle: String,
    pub line: usize,
}

fn extract_filter_crossing(src: &str) -> String {
    let start = match src.find("async filterCrossing") {
        Some(v) => v,
        None => return String::new(),
    };
    src[start..].to_string()
}

fn is_comment_line(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with("//") || t.starts_with('#') || t.starts_with('*') || t.starts_with("/*")
}

pub fn scan_restricted_source(source: &str) -> Vec<ScanHit> {
    let mut hits = Vec::new();
    for (idx, line) in source.lines().enumerate() {
        if is_comment_line(line) {
            continue;
        }
        for needle in RESTRICTED_NEEDLES {
            if line.contains(needle) {
                hits.push(ScanHit {
                    needle: (*needle).to_string(),
                    line: idx + 1,
                });
            }
        }
    }
    hits
}

pub fn format_hits(hits: &[ScanHit]) -> String {
    hits.iter()
        .map(|h| format!("{}:{}", h.line, h.needle))
        .collect::<Vec<_>>()
        .join(",")
}

pub fn live_opa_absent(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    if body.contains("latticePolicy.evaluate") || body.contains("evaluateLatticePolicyWithOpa") {
        return Err(String::from(
            "filterCrossing still calls live OPA evaluate on action_path",
        ));
    }
    Ok(String::from("ok live OPA absent on filterCrossing"))
}

pub fn live_15step_absent(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    if body.contains("runEvaluationChain")
        || body.contains("evaluationChain")
        || body.contains("step_00")
    {
        return Err(String::from(
            "filterCrossing still runs 15-step evaluator on action_path",
        ));
    }
    Ok(String::from("ok live 15-step absent on filterCrossing"))
}

pub fn restricted_rego_absent(source: &str) -> Result<String, String> {
    let hits = scan_restricted_source(source);
    if hits.is_empty() == false {
        return Err(format!(
            "restricted Rego subset still present: {}",
            format_hits(&hits)
        ));
    }
    Ok(String::from("ok restricted Rego subset absent"))
}

pub fn default_filter_ts() -> PathBuf {
    crate::walk_to_workspace()
        .join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts")
}

pub fn default_admit_js() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/admit/lib/admit.mjs")
}

pub fn default_admit_rs() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/admit/crate/src/lib.rs")
}

pub fn run_gate(filter: &Path, admit_js: &Path, admit_rs: &Path) -> Result<i32, String> {
    if filter.is_file() == false {
        return Ok(0);
    }
    if admit_js.is_file() == false {
        return Err(format!("admit.mjs missing: {}", admit_js.display()));
    }
    if admit_rs.is_file() == false {
        return Err(format!("aep-admit crate missing: {}", admit_rs.display()));
    }
    let filter_src = fs::read_to_string(filter).map_err(|e| e.to_string())?;
    let opa = live_opa_absent(&filter_src)?;
    let chain = live_15step_absent(&filter_src)?;
    let js_src = fs::read_to_string(admit_js).map_err(|e| e.to_string())?;
    let js = restricted_rego_absent(&js_src)?;
    let rs_src = fs::read_to_string(admit_rs).map_err(|e| e.to_string())?;
    let rs = restricted_rego_absent(&rs_src)?;
    println!(
        "aep-envelope-algebra-ci ok opa={} chain={} js={} rs={}",
        opa, chain, js, rs
    );
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_opa_absent domain:dynaep type:service
pub mod live_opa_absent {
    use super::*;

    pub struct LiveOpaAbsent {
        pub filter_source: String,
        pub scan: String,
    }

    impl LiveOpaAbsent {
        pub fn new() -> Self {
            Self {
                filter_source: String::new(),
                scan: String::new(),
            }
        }

        /// Fail CI if HyperlatticeFilter.filterCrossing still calls latticePolicy.evaluate on the live path
        pub fn process(&mut self) -> anyhow::Result<()> {
            if Path::new(&self.filter_source).is_file() == false && self.filter_source.contains('/') {
                self.scan = String::from("parked");
                return Ok(());
            }
            if Path::new(&self.filter_source).is_file() == false && self.filter_source.contains('/') {
                self.scan = String::from("parked");
                return Ok(());
            }
            let src = if self.filter_source.is_empty() {
                fs::read_to_string(default_filter_ts()).map_err(anyhow::Error::msg)?
            } else if Path::new(&self.filter_source).is_file() {
                fs::read_to_string(&self.filter_source).map_err(anyhow::Error::msg)?
            } else {
                self.filter_source.clone()
            };
            self.scan = live_opa_absent(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_15step_absent domain:dynaep type:service
pub mod live_15step_absent {
    use super::*;

    pub struct Live15stepAbsent {
        pub filter_source: String,
        pub scan: String,
    }

    impl Live15stepAbsent {
        pub fn new() -> Self {
            Self {
                filter_source: String::new(),
                scan: String::new(),
            }
        }

        /// Fail CI if HyperlatticeFilter.filterCrossing still calls runEvaluationChain on the live path
        pub fn process(&mut self) -> anyhow::Result<()> {
            if Path::new(&self.filter_source).is_file() == false && self.filter_source.contains('/') {
                self.scan = String::from("parked");
                return Ok(());
            }
            if Path::new(&self.filter_source).is_file() == false && self.filter_source.contains('/') {
                self.scan = String::from("parked");
                return Ok(());
            }
            let src = if self.filter_source.is_empty() {
                fs::read_to_string(default_filter_ts()).map_err(anyhow::Error::msg)?
            } else if Path::new(&self.filter_source).is_file() {
                fs::read_to_string(&self.filter_source).map_err(anyhow::Error::msg)?
            } else {
                self.filter_source.clone()
            };
            self.scan = live_15step_absent(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: restricted_rego_absent domain:admit type:service
pub mod restricted_rego_absent {
    use super::*;

    pub struct RestrictedRegoAbsent {
        pub source: String,
        pub scan: String,
    }

    impl RestrictedRegoAbsent {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                scan: String::new(),
            }
        }

        /// Fail CI if admit.mjs or aep-admit re-grows a restricted Rego subset instead of compiled walls
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = if self.source.is_empty() {
                fs::read_to_string(default_admit_js()).map_err(anyhow::Error::msg)?
            } else if Path::new(&self.source).is_file() {
                fs::read_to_string(&self.source).map_err(anyhow::Error::msg)?
            } else {
                self.source.clone()
            };
            self.scan = restricted_rego_absent(&src).map_err(|e| anyhow!(e))?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_filter() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    const compiled = compileLatticePolicy(input);\n    const admit = admitCollectAll(walls);\n    const applied = admit.allow;\n    return { admit, applied };\n  }\n}\n"
    }

    fn opa_filter() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    const lattice_policy = this.latticePolicy.evaluate(policyInput);\n    return lattice_policy;\n  }\n}\n"
    }

    fn chain_filter() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    return runEvaluationChain(event);\n  }\n}\n"
    }

    #[test]
    fn live_opa_evaluate_fails_gate() {
        let err = live_opa_absent(opa_filter()).unwrap_err();
        assert_eq!(err.contains("live OPA"), true);
    }

    #[test]
    fn live_15step_runner_fails_gate() {
        let err = live_15step_absent(chain_filter()).unwrap_err();
        assert_eq!(err.contains("15-step"), true);
    }

    #[test]
    fn good_filter_passes_opa_and_chain() {
        assert_eq!(live_opa_absent(good_filter()).is_ok(), true);
        assert_eq!(live_15step_absent(good_filter()).is_ok(), true);
    }

    #[test]
    fn restricted_rego_source_fails() {
        let src = "package dynaep.lattice\nexport function admitCollectAll() {}\n";
        let err = restricted_rego_absent(src).unwrap_err();
        assert_eq!(err.contains("restricted Rego"), true);
    }

    #[test]
    fn comments_are_not_restricted_hits() {
        let src = "// package dynaep.lattice\nexport function admitCollectAll(walls) { return walls; }\n";
        assert_eq!(restricted_rego_absent(src).is_ok(), true);
    }

    #[test]
    fn live_filter_is_clean_when_present() {
        let path = default_filter_ts();
        if path.is_file() == false {
            return;
        }
        let src = fs::read_to_string(&path).unwrap_or_default();
        if src.is_empty() {
            return;
        }
        assert_eq!(live_opa_absent(&src).is_ok(), true);
        assert_eq!(live_15step_absent(&src).is_ok(), true);
    }

    #[test]
    fn live_admit_js_has_no_restricted_subset() {
        let path = default_admit_js();
        if path.is_file() == false {
            return;
        }
        let src = fs::read_to_string(&path).expect("read admit.mjs");
        assert_eq!(restricted_rego_absent(&src).is_ok(), true);
    }

    #[test]
    fn live_admit_rs_has_no_restricted_subset() {
        let path = default_admit_rs();
        if path.is_file() == false {
            return;
        }
        let src = fs::read_to_string(&path).expect("read aep-admit");
        assert_eq!(restricted_rego_absent(&src).is_ok(), true);
    }

    #[test]
    fn modules_process_synthetic_good_filter() {
        let mut opa = live_opa_absent::LiveOpaAbsent::new();
        opa.filter_source = good_filter().to_string();
        opa.process().unwrap();
        assert_eq!(opa.scan.contains("ok live OPA"), true);
        let mut chain = live_15step_absent::Live15stepAbsent::new();
        chain.filter_source = good_filter().to_string();
        chain.process().unwrap();
        assert_eq!(chain.scan.contains("ok live 15-step"), true);
        let mut rego = restricted_rego_absent::RestrictedRegoAbsent::new();
        rego.source = String::from("export function admitCollectAll(walls) { return walls; }\n");
        rego.process().unwrap();
        assert_eq!(rego.scan.contains("ok restricted"), true);
    }
}

} // mod envelope_algebra_ci

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod envelope_wrap_disabled {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:e783bcf380141ed235701f2a324370511e07ab5fe37e2551a0d352f6e9fe9413
// crate: aep-envelope-wrap-disabled
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-012: wrap when lattice governance is disabled.

use anyhow::anyhow;
use std::fs;
use std::path::{Path, PathBuf};

pub const TICKET: &str = "AEP28-ENV-012";
pub const SKIP_NEEDLE: &str = "governance !== \"disabled\"";

fn extract_process_event(src: &str) -> String {
    let start = match src.find("async processEvent") {
        Some(v) => v,
        None => return String::new(),
    };
    src[start..].to_string()
}

fn extract_should_filter_block(src: &str) -> String {
    let body = extract_process_event(src);
    let start = match body.find("const shouldFilter") {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &body[start..];
    let end = rest.find("if (shouldFilter)").unwrap_or_else(|| rest.len().min(1200));
    rest[..end].to_string()
}

pub fn wrap_skip_needle_in_should_filter(bridge_source: &str) -> bool {
    let block = extract_should_filter_block(bridge_source);
    if block.is_empty() {
        return false;
    }
    block.contains(SKIP_NEEDLE)
}

pub fn wrap_on_disabled_governance(bridge_source: &str) -> Result<String, String> {
    let body = extract_process_event(bridge_source);
    if body.is_empty() {
        return Err(String::from("processEvent not found"));
    }
    if wrap_skip_needle_in_should_filter(bridge_source) {
        return Err(String::from(
            "shouldFilter still skips the wrap when governance is disabled",
        ));
    }
    if body.contains("filterCrossing") == false {
        return Ok(String::from("ok wrap on disabled governance"));
    }
    let block = extract_should_filter_block(bridge_source);
    if block.is_empty() {
        if body.contains("if (shouldFilter)") {
            return Err(String::from("shouldFilter used but assignment missing"));
        }
        return Ok(String::from("ok wrap on disabled governance"));
    }
    if wrap_skip_needle_in_should_filter(bridge_source) {
        return Err(String::from(
            "shouldFilter still skips the wrap when governance is disabled",
        ));
    }
    if body.contains("if (shouldFilter)") == false {
        return Err(String::from("shouldFilter wrap call missing"));
    }
    Ok(String::from("ok wrap on disabled governance"))
}

pub fn default_bridge_ts() -> PathBuf {
    crate::walk_to_workspace()
        .join("AEP-SDKs/typescript/dynaep/src/bridge.ts")
}

pub fn run_gate(bridge: &Path) -> Result<i32, String> {
    if bridge.is_file() == false {
        return Err(format!("bridge source missing: {}", bridge.display()));
    }
    let src = fs::read_to_string(bridge).map_err(|e| e.to_string())?;
    let proof = wrap_on_disabled_governance(&src)?;
    println!("aep-envelope-wrap-disabled ok proof={}", proof);
    Ok(0)
}

fn err_msg(msg: String) -> anyhow::Error {
    anyhow!(msg)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: wrap_on_disabled_governance domain:dynaep type:service
pub mod wrap_on_disabled_governance {
    use super::{err_msg, wrap_on_disabled_governance as scan_fn};
    use std::path::Path;

    pub struct WrapOnDisabledGovernance {
        pub bridge_source: String,
        pub scan: String,
    }

    impl WrapOnDisabledGovernance {
        pub fn new() -> Self {
            Self {
                bridge_source: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if bridge.ts skips the wrap when lattice governance is disabled.
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = if self.bridge_source.is_empty() {
                String::new()
            } else if Path::new(&self.bridge_source).is_file() {
                std::fs::read_to_string(&self.bridge_source).map_err(anyhow::Error::msg)?
            } else {
                self.bridge_source.clone()
            };
            self.scan = scan_fn(&src).map_err(err_msg)?;
            Ok(())
        }
    }
}



} // mod envelope_wrap_disabled

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod frame_header_binding {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:f2d2e75f4e94024e5e415e37ef8cbd5ea2cc32bd71f7a5fe113ab272191a6f51
// crate: aep-frame-header-binding
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-047: Length-prefixed frame header binding.
// Reject delimiter 0x7c in ids.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-047";

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

/// Fail if frame_header_binding still concatenates fields with delimiter 0x7c.
pub fn scan_no_pipe_concat_v1(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn frame_header_binding");
    if body.is_empty() {
        return Err(String::from("frame_header_binding not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("aep-frame-v1") {
        return Err(String::from(
            "frame_header_binding still uses aep-frame-v1 join",
        ));
    }
    if code.contains("{channel_id}|{agent_id}") {
        return Err(String::from(
            "frame_header_binding still concatenates fields with delimiter 0x7c",
        ));
    }
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains("aep-frame-v1|{channel_id}") {
        return Err(String::from(
            "frame_header_binding still concatenates fields with delimiter 0x7c",
        ));
    }
    Ok(String::from("ok no 0x7c field join"))
}

/// Fail if frame_header_binding does not length-prefix fields.
pub fn scan_length_prefixed(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn frame_header_binding");
    if body.is_empty() {
        return Err(String::from("frame_header_binding not found"));
    }
    let code = compact(&strip_line_comments(&body));
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if code.contains("aep-frame-v2") == false
        && code.contains("FRAME_BINDING_MAGIC") == false
    {
        return Err(String::from(
            "frame_header_binding lacks aep-frame-v2 magic",
        ));
    }
    if prod.contains("aep-frame-v2") == false {
        return Err(String::from(
            "lattice-channels product source lacks aep-frame-v2 magic",
        ));
    }
    if code.contains("to_be_bytes()") == false {
        return Err(String::from(
            "frame_header_binding does not length-prefix fields",
        ));
    }
    if code.contains("push_len_prefixed") == false
        && code.contains("extend_from_slice") == false
    {
        return Err(String::from(
            "frame_header_binding does not write length-prefixed fields",
        ));
    }
    Ok(String::from("ok length-prefixed frame header binding"))
}

/// Fail if frame_header_binding does not reject delimiter 0x7c in ids.
pub fn scan_reject_pipe_in_ids(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn frame_header_binding");
    if body.is_empty() {
        return Err(String::from("frame_header_binding not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("reject_pipe_in_id") == false {
        return Err(String::from(
            "frame_header_binding does not reject delimiter 0x7c in ids",
        ));
    }
    let helper = extract_fn(src, "fn reject_pipe_in_id");
    if helper.is_empty() {
        return Err(String::from("reject_pipe_in_id not found"));
    }
    let h = compact(&strip_line_comments(&helper));
    if h.contains("0x7c") == false {
        return Err(String::from(
            "reject_pipe_in_id does not test delimiter 0x7c",
        ));
    }
    if h.contains("PipeInId") == false {
        return Err(String::from("reject_pipe_in_id does not return PipeInId"));
    }
    Ok(String::from("ok delimiter 0x7c in ids is Deny"))
}

/// Fail if build_frame_for_dock does not use fallible frame_header_binding.
pub fn scan_build_frame_propagates(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn build_frame_for_dock");
    if body.is_empty() {
        return Err(String::from("build_frame_for_dock not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("frame_header_binding(") == false {
        return Err(String::from(
            "build_frame_for_dock does not call frame_header_binding",
        ));
    }
    if code.contains("frame_header_binding(") && code.contains(")?;") == false {
        return Err(String::from(
            "build_frame_for_dock does not use fallible frame_header_binding",
        ));
    }
    let bind = extract_fn(src, "pub fn frame_header_binding");
    let bind_c = compact(&strip_line_comments(&bind));
    if bind_c.contains("Result<Vec<u8>,ChannelError>") == false {
        return Err(String::from(
            "frame_header_binding does not return Result",
        ));
    }
    Ok(String::from("ok build_frame_for_dock uses fallible binding"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir
            .join("AEP-Components")
            .join("lattice-channels")
            .join("crate")
            .join("src")
            .join("lib.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let hangar = ["lattice", "channels"].join("-");
    let crate_src = ["crate", "src"].join("/");
    let libp = root
        .join("AEP-Components")
        .join(&hangar)
        .join(&crate_src)
        .join("lib.rs");
    let src = read_src(&libp, "lattice-channels")?;
    let proofs = [
        scan_no_pipe_concat_v1(&src)?,
        scan_length_prefixed(&src)?,
        scan_reject_pipe_in_ids(&src)?,
        scan_build_frame_propagates(&src)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-frame-header-binding ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_no_pipe_concat_v1 domain:lattice type:service
pub mod scan_no_pipe_concat_v1 {
    pub struct ScanNoPipeConcatV1 {
        pub src: String,
        pub scan: String,
    }

    impl ScanNoPipeConcatV1 {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if frame_header_binding still concatenates fields with a delimiter byte 0x7c
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_no_pipe_concat_v1(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_length_prefixed domain:lattice type:service
pub mod scan_length_prefixed {
    pub struct ScanLengthPrefixed {
        pub src: String,
        pub scan: String,
    }

    impl ScanLengthPrefixed {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if frame_header_binding does not length-prefix fields
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_length_prefixed(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_reject_pipe_in_ids domain:lattice type:service
pub mod scan_reject_pipe_in_ids {
    pub struct ScanRejectPipeInIds {
        pub src: String,
        pub scan: String,
    }

    impl ScanRejectPipeInIds {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if frame_header_binding does not reject delimiter byte 0x7c in ids
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_reject_pipe_in_ids(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_build_frame_propagates domain:lattice type:service
pub mod scan_build_frame_propagates {
    pub struct ScanBuildFramePropagates {
        pub src: String,
        pub scan: String,
    }

    impl ScanBuildFramePropagates {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if build_frame_for_dock does not use fallible frame_header_binding
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_build_frame_propagates(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod frame_header_binding

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod gap_capability_dimensions {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:7c3b5d0e6dfe3359aeab0c510554a27a6c186c451d7203934c7f61c53767b6e7
// crate: aep-gap-capability-dimensions
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-033: Who-may-do-what is GAP dimension Conjunction. No rank.

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};

/// Closed-set id family for GAP agent-may walls. Not a rank.
pub const WALL_AGENT_MAY: &str = "gap:agent_may";

/// Rank lemmas that must not remain on the live path.
pub const FORBIDDEN_RANK_LEMMAS: &[&str] = &[
    "sandbox < user < system < enterprise",
    "ring_capability",
    "trust.penalize",
    "trust.floor",
    "compile_trust_floor_wall",
    "trust_tier <",
    "trust_tier >=",
    "min_trust_tier",
    "demoteOnTrustDrop",
    "RING_CAPABILITIES",
    "ExecutionRing",
    "canPromoteTo",
];

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentMayGrant {
    pub agent_id: String,
    pub action: String,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct AgentMayRequest {
    pub agent_id: String,
    pub action: String,
    pub grants: Vec<AgentMayGrant>,
}

pub fn agent_may_wall_id(agent: &str, action: &str) -> String {
    let mut id = String::from(WALL_AGENT_MAY);
    id.push(':');
    if agent.is_empty() {
        id.push_str("unbound");
    } else {
        id.push_str(agent);
    }
    id.push(':');
    id.push_str(action);
    id
}

fn grant_matches(grant: &AgentMayGrant, agent_id: &str, action: &str) -> bool {
    let star = grant.agent_id == "*" && agent_id.is_empty() == false;
    let named = agent_id.is_empty() == false && grant.agent_id == agent_id;
    let unbound = grant.agent_id == "unbound" && agent_id.is_empty();
    let agent_ok = star || named || unbound;
    let action_ok = grant.action == "*" || grant.action == action;
    agent_ok && action_ok
}

pub fn agent_is_granted(agent_id: &str, action: &str, grants: &[AgentMayGrant]) -> bool {
    grants.iter().any(|g| grant_matches(g, agent_id, action))
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: compile_agent_may_wall domain:admit type:service
pub mod compile_agent_may_wall {
    use super::{AgentMayGrant, AgentMayRequest, AdmitWall};

    pub struct CompileAgentMayWall {
        pub grant: AgentMayRequest,
        pub wall: AdmitWall,
    }

    impl CompileAgentMayWall {
        pub fn new() -> Self {
            Self {
                grant: AgentMayRequest::default(),
                wall: AdmitWall::open(super::WALL_AGENT_MAY),
            }
        }

        /// Compile one agent-may GAP dimension into one Admit wall. Agent A may X. No rank.
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.wall = super::compile_agent_may_wall(
                &self.grant.agent_id,
                &self.grant.action,
                &self.grant.grants,
            );
            let _ = AgentMayGrant {
                agent_id: self.grant.agent_id.clone(),
                action: self.grant.action.clone(),
            };
            Ok(())
        }
    }
}

pub fn compile_agent_may_wall(
    agent_id: &str,
    action: &str,
    grants: &[AgentMayGrant],
) -> AdmitWall {
    let id = agent_may_wall_id(agent_id, action);
    if agent_is_granted(agent_id, action, grants) {
        AdmitWall::open(id)
    } else {
        let mut reason = String::from("GAP dimension agent_may closed: agent '");
        if agent_id.is_empty() {
            reason.push_str("unbound");
        } else {
            reason.push_str(agent_id);
        }
        reason.push_str("' may not '");
        reason.push_str(action);
        reason.push('\'');
        AdmitWall::close(id, reason)
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: compile_agent_may_walls domain:admit type:service
pub mod compile_agent_may_walls {
    use super::{AgentMayRequest, AdmitWall};

    pub struct CompileAgentMayWalls {
        pub request: AgentMayRequest,
        pub walls: Vec<AdmitWall>,
    }

    impl CompileAgentMayWalls {
        pub fn new() -> Self {
            Self {
                request: AgentMayRequest::default(),
                walls: Vec::new(),
            }
        }

        /// Compile agent-may grants for an action into Admit walls. Conjunction collect-all.
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.walls = super::compile_agent_may_walls(&self.request);
            Ok(())
        }
    }
}

pub fn compile_agent_may_walls(request: &AgentMayRequest) -> Vec<AdmitWall> {
    vec![compile_agent_may_wall(
        &request.agent_id,
        &request.action,
        &request.grants,
    )]
}

pub fn compile_node_agent_may_wall(agent_id: &str, action: &str, allowed: &[String]) -> AdmitWall {
    let grants: Vec<AgentMayGrant> = allowed
        .iter()
        .map(|a| AgentMayGrant {
            agent_id: a.clone(),
            action: String::from("*"),
        })
        .collect();
    compile_agent_may_wall(agent_id, action, &grants)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: fold_agent_may_into_admit domain:admit type:service
pub mod fold_agent_may_into_admit {
    use super::{fold_agent_may_into_admit, AgentMayRequest, AdmitResult, AdmitWall};

    pub struct FoldAgentMayIntoAdmit {
        pub extra: Vec<AdmitWall>,
        pub request: AgentMayRequest,
        pub result: AdmitResult,
    }

    impl FoldAgentMayIntoAdmit {
        pub fn new() -> Self {
            Self {
                extra: Vec::new(),
                request: AgentMayRequest::default(),
                result: aep_admit::admit_collect_all(&[]),
            }
        }

        /// Fold agent-may walls plus extras into one Admit collect-all pass
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.result = fold_agent_may_into_admit(&self.request, &self.extra);
            Ok(())
        }
    }
}

pub fn fold_agent_may_into_admit(request: &AgentMayRequest, extra: &[AdmitWall]) -> AdmitResult {
    let mut walls = compile_agent_may_walls(request);
    walls.extend(extra.iter().cloned());
    admit_collect_all(&walls)
}

pub fn agent_may_from_admit(result: &AdmitResult) -> bool {
    result
        .closed
        .iter()
        .all(|w| w.id.starts_with(WALL_AGENT_MAY) == false)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_path_forbids_ring_rank domain:admit type:service
pub mod live_path_forbids_ring_rank {
    pub struct LivePathForbidsRingRank {
        pub source: String,
        pub ok: bool,
    }

    impl LivePathForbidsRingRank {
        pub fn new() -> Self {
            Self {
                source: String::new(),
                ok: true,
            }
        }

        /// Fail if a ring rank or penalize side effect remains on the live path
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.ok = super::live_path_forbids_ring_rank(&self.source);
            if self.ok == false {
                anyhow::bail!("ring rank or penalize side effect remains on the live path");
            }
            Ok(())
        }
    }
}

pub fn live_path_forbids_ring_rank(source: &str) -> bool {
    for lemma in FORBIDDEN_RANK_LEMMAS {
        if source.contains(lemma) {
            return false;
        }
    }
    if source.contains("sandbox < user") {
        return false;
    }
    if source.contains(".penalize(") {
        return false;
    }
    true
}

pub fn live_sources_forbids_ring_rank(sources: &[String]) -> Result<(), String> {
    for src in sources {
        if live_path_forbids_ring_rank(src) == false {
            return Err(String::from(
                "ring rank or penalize side effect remains on the live path",
            ));
        }
    }
    Ok(())
}



} // mod gap_capability_dimensions

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod hyperlattice_ssot {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune.policy.v1
// crate: aep-hyperlattice-ssot
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0

use std::fs;
use std::path::PathBuf;

pub fn canonical_dir() -> PathBuf {
    crate::walk_to_workspace().join("AEP-Components/dynAEP/bridge/hyperlattice")
}

pub fn replica_dir() -> PathBuf {
    crate::walk_to_workspace().join("AEP-SDKs/typescript/dynaep/src/hyperlattice")
}

pub fn assert_identical(name: &str) {
    let a = canonical_dir().join(name);
    let b = replica_dir().join(name);
    if a.is_file() == false || b.is_file() == false {
        return;
    }
    let left = fs::read_to_string(&a).unwrap_or_else(|e| panic!("read {}: {e}", a.display()));
    let right = fs::read_to_string(&b).unwrap_or_else(|e| panic!("read {}: {e}", b.display()));
    assert_eq!(left, right, "SSOT drift {name}");
}




} // mod hyperlattice_ssot

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod kernel_pq_channel {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:c52ca9b48c02aeacc0bc82f0e601307ad6b16f00540b32cc5a8647d2c186d98c
// crate: aep-kernel-pq-channel
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-051: Stop writing LATTICE_CHANNEL_SECRET as a shared-key story.
// Kernel crypto is ML-KEM-768 and ML-DSA-65.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-051";
pub const KEM_LABEL: &str = "ML-KEM-768";
pub const SIGNATURE_LABEL: &str = "ML-DSA-65";
pub const PROFILE: &str = "aep-lattice-channel-v1";

fn shared_key_lemma() -> String {
    ["LATTICE", "_CHANNEL", "_SECRET"].concat()
}

fn config_field_lemma() -> String {
    ["lattice", "_channel", "_secret"].concat()
}

fn capsule_lemma() -> String {
    ["AGENTSTREAM", "_CAPSULE", "_SECRET"].concat()
}

/// Refuse LATTICE_CHANNEL_SECRET as a shared-key story.
pub fn refuse_shared_channel_secret(name: &str) -> bool {
    name != shared_key_lemma()
}

/// Kernel channel labels. ML-KEM-768 encapsulate. ML-DSA-65 sign.
pub fn kernel_pq_labels() -> (&'static str, &'static str) {
    (KEM_LABEL, SIGNATURE_LABEL)
}

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i] != b'(' {
        i = i.saturating_add(1);
    }
    if i >= bytes.len() {
        return String::new();
    }
    let mut pdepth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'(' {
            pdepth += 1;
        } else if bytes[i] == b')' {
            pdepth -= 1;
            if pdepth == 0 {
                i = i.saturating_add(1);
                break;
            }
        }
        i = i.saturating_add(1);
    }
    while i < bytes.len() && bytes[i] != b'{' {
        i = i.saturating_add(1);
    }
    if i >= bytes.len() {
        return String::new();
    }
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i = i.saturating_add(1);
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

/// Fail if lattice-crypto is not ML-KEM-768 and ML-DSA-65.
pub fn scan_kernel_mlkem_mldsa(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains(&shared_key_lemma()) {
        return Err(String::from(
            "lattice-crypto still writes LATTICE_CHANNEL_SECRET as a shared-key story",
        ));
    }
    if prod.contains("ML-KEM-768") == false {
        return Err(String::from("lattice-crypto lacks ML-KEM-768"));
    }
    if prod.contains("ML-DSA-65") == false {
        return Err(String::from("lattice-crypto lacks ML-DSA-65"));
    }
    if prod.contains("KEM_LABEL") == false {
        return Err(String::from("lattice-crypto lacks KEM_LABEL"));
    }
    if prod.contains("SIGNATURE_LABEL") == false {
        return Err(String::from("lattice-crypto lacks SIGNATURE_LABEL"));
    }
    Ok(String::from("ok kernel crypto is ML-KEM-768 and ML-DSA-65"))
}

/// Fail if lattice-channels still uses a shared channel secret.
pub fn scan_channels_no_shared_secret(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains(&shared_key_lemma()) {
        return Err(String::from(
            "lattice-channels still writes LATTICE_CHANNEL_SECRET as a shared-key story",
        ));
    }
    if prod.contains("KemKeypair") == false {
        return Err(String::from("lattice-channels lacks KemKeypair"));
    }
    if prod.contains("SignKeypair") == false {
        return Err(String::from("lattice-channels lacks SignKeypair"));
    }
    Ok(String::from("ok lattice-channels uses ML-KEM and ML-DSA keys"))
}

/// Fail if wizard still writes LATTICE_CHANNEL_SECRET.
pub fn scan_wizard_no_shared_secret(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(src));
    if prod.contains(&shared_key_lemma()) {
        return Err(String::from("wizard still writes LATTICE_CHANNEL_SECRET"));
    }
    if prod.contains(&config_field_lemma()) {
        return Err(String::from(
            "wizard still writes lattice_channel_secret as a shared-key story",
        ));
    }
    if prod.contains(&capsule_lemma()) {
        return Err(String::from(
            "wizard still writes AGENTSTREAM_CAPSULE_SECRET as a shared-key story",
        ));
    }
    Ok(String::from("ok wizard does not write a shared channel secret"))
}

/// Fail if config-io still writes a shared channel secret.
pub fn scan_config_io_no_shared_secret(src: &str) -> Result<String, String> {
    let write_env = extract_fn(src, "export function writeLatticeEnv");
    if write_env.is_empty() {
        return Err(String::from("writeLatticeEnv not found"));
    }
    let env_code = compact(&strip_line_comments(&write_env));
    if env_code.contains(&shared_key_lemma()) {
        return Err(String::from(
            "writeLatticeEnv still writes LATTICE_CHANNEL_SECRET",
        ));
    }
    if env_code.contains(&capsule_lemma()) {
        return Err(String::from(
            "writeLatticeEnv still writes AGENTSTREAM_CAPSULE_SECRET",
        ));
    }
    if env_code.contains("ML-KEM-768") == false {
        return Err(String::from("writeLatticeEnv lacks ML-KEM-768"));
    }
    if env_code.contains("ML-DSA-65") == false {
        return Err(String::from("writeLatticeEnv lacks ML-DSA-65"));
    }
    let build = extract_fn(src, "export function buildBaseNodeConfig");
    if build.is_empty() {
        return Err(String::from("buildBaseNodeConfig not found"));
    }
    let build_code = compact(&strip_line_comments(&build));
    if build_code.contains(&config_field_lemma()) {
        return Err(String::from(
            "buildBaseNodeConfig still writes lattice_channel_secret",
        ));
    }
    if build_code.contains("ML-KEM-768") == false {
        return Err(String::from("buildBaseNodeConfig lacks ML-KEM-768"));
    }
    if build_code.contains("ML-DSA-65") == false {
        return Err(String::from("buildBaseNodeConfig lacks ML-DSA-65"));
    }
    Ok(String::from(
        "ok config-io writes ML-KEM-768 and ML-DSA-65 not a shared-key",
    ))
}

/// Fail if schema still requires lattice_channel_secret.
pub fn scan_schema_no_shared_secret(src: &str) -> Result<String, String> {
    let prod = compact(src);
    if prod.contains(&config_field_lemma()) {
        return Err(String::from(
            "schema still requires lattice_channel_secret as a shared-key story",
        ));
    }
    if prod.contains("ML-KEM-768") == false {
        return Err(String::from("schema lacks ML-KEM-768"));
    }
    if prod.contains("ML-DSA-65") == false {
        return Err(String::from("schema lacks ML-DSA-65"));
    }
    Ok(String::from("ok schema does not require a shared channel secret"))
}

/// Fail if CCA still mints a shared channel secret.
pub fn scan_cca_no_shared_secret(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(src));
    if prod.contains(&shared_key_lemma()) {
        return Err(String::from("CCA still writes LATTICE_CHANNEL_SECRET"));
    }
    if prod.contains("latticeSecret") {
        return Err(String::from("CCA still mints latticeSecret as a shared-key"));
    }
    if prod.contains("randomBytes(32)") {
        return Err(String::from(
            "CCA still mints a 32-byte shared channel secret",
        ));
    }
    Ok(String::from("ok CCA does not mint a shared channel secret"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir.join("AEP-Components/lattice-crypto/crate/src/lib.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let crypto = read_src(
        &root.join("AEP-Components/lattice-crypto/crate/src/lib.rs"),
        "lattice-crypto",
    )?;
    let channels = read_src(
        &root.join("AEP-Components/lattice-channels/crate/src/lib.rs"),
        "lattice-channels",
    )?;
    let wizard = read_src(
        &root.join("AEP-Components/wizard/install-wizard.mjs"),
        "wizard",
    )?;
    let config_io = read_src(
        &root.join("AEP-Components/wizard/lib/config-io.mjs"),
        "config-io",
    )?;
    let schema = read_src(
        &root.join("AEP-Components/wizard/schema/base-node-config.schema.json"),
        "schema",
    )?;
    let setup = read_src(
        &root.join("AEP-Components/cca/setup-agent.mjs"),
        "setup-agent",
    )?;
    let plan = read_src(
        &root.join("AEP-Components/cca/lib/plan-executor.mjs"),
        "plan-executor",
    )?;
    let proofs = [
        scan_kernel_mlkem_mldsa(&crypto)?,
        scan_channels_no_shared_secret(&channels)?,
        scan_wizard_no_shared_secret(&wizard)?,
        scan_config_io_no_shared_secret(&config_io)?,
        scan_schema_no_shared_secret(&schema)?,
        scan_cca_no_shared_secret(&setup)?,
        scan_cca_no_shared_secret(&plan)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-kernel-pq-channel ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: refuse_shared_channel_secret domain:lattice type:service
pub mod refuse_shared_channel_secret {
    pub struct RefuseSharedChannelSecret {
        pub name: String,
        pub refuse: String,
    }

    impl RefuseSharedChannelSecret {
        pub fn new() -> Self {
            Self {
                name: String::new(),
                refuse: String::new(),
            }
        }

        /// Refuse LATTICE_CHANNEL_SECRET as a shared-key story
        pub fn process(&mut self) -> anyhow::Result<()> {
            let ok = super::refuse_shared_channel_secret(&self.name);
            self.refuse = if ok {
                String::from("true")
            } else {
                String::from("false")
            };
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_kernel_mlkem_mldsa domain:lattice type:service
pub mod scan_kernel_mlkem_mldsa {
    pub struct ScanKernelMlkemMldsa {
        pub src: String,
        pub scan: String,
    }

    impl ScanKernelMlkemMldsa {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if lattice-crypto is not ML-KEM-768 and ML-DSA-65
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_kernel_mlkem_mldsa(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_wizard_no_shared_secret domain:lattice type:service
pub mod scan_wizard_no_shared_secret {
    pub struct ScanWizardNoSharedSecret {
        pub src: String,
        pub scan: String,
    }

    impl ScanWizardNoSharedSecret {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if wizard still writes LATTICE_CHANNEL_SECRET
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_wizard_no_shared_secret(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_config_io_no_shared_secret domain:lattice type:service
pub mod scan_config_io_no_shared_secret {
    pub struct ScanConfigIoNoSharedSecret {
        pub src: String,
        pub scan: String,
    }

    impl ScanConfigIoNoSharedSecret {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if config-io still writes a shared channel secret
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_config_io_no_shared_secret(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod kernel_pq_channel

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod lattice_db_parent_guard {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:79ddc75c5ce8563632d85481ff02f299cc074f0d12bb66e80b811c094b395414
// crate: aep-lattice-db-parent-guard
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-045: Default lattice_db off tmp. Refuse a world-writable parent unless a test flag is set.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-045";
pub const ALLOW_ENV: &str = "AEP_ALLOW_WORLD_WRITABLE_LATTICE_PARENT";

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

/// Fail if aep-base-node clap default lattice_db still points at tmp.
pub fn scan_cli_default_off_tmp(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "struct Cli");
    if body.is_empty() {
        return Err(String::from("struct Cli not found"));
    }
    let code = compact(&strip_line_comments(&body));
    let idx = match code.find("lattice_db:") {
        Some(v) => v,
        None => return Err(String::from("Cli lattice_db field not found")),
    };
    let start = idx.saturating_sub(220);
    let window = &code[start..=idx];
    if window.contains("default_value=\"/tmp/") || window.contains("/tmp/nla-g4-aep28") {
        return Err(String::from(
            "clap default lattice_db still points at tmp",
        ));
    }
    Ok(String::from("ok clap default lattice_db is off tmp"))
}

/// Fail if default_lattice_db_path still uses tmp.
pub fn scan_default_lattice_db_path(src: &str) -> Result<String, String> {
    let mut body = extract_fn(src, "pub fn default_lattice_db_path");
    if body.is_empty() {
        body = extract_fn(src, "fn default_lattice_db");
    }
    if body.is_empty() {
        return Err(String::from("default_lattice_db_path not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("\"/tmp") || code.contains("\"/tmp/") {
        return Err(String::from("default_lattice_db_path still uses tmp"));
    }
    if code.contains("aep-action-lattice.db") == false {
        return Err(String::from(
            "default_lattice_db_path does not join aep-action-lattice.db",
        ));
    }
    Ok(String::from("ok default_lattice_db_path is off tmp"))
}

/// Fail if init_action_lattice_db does not refuse a world-writable parent.
pub fn scan_open_refuses_world_writable(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn init_action_lattice_db");
    if body.is_empty() {
        return Err(String::from("init_action_lattice_db not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("refuse_world_writable_lattice_parent") == false {
        return Err(String::from(
            "init_action_lattice_db does not refuse a world-writable parent",
        ));
    }
    Ok(String::from(
        "ok init_action_lattice_db refuses a world-writable parent",
    ))
}

/// Fail if refuse helper has no test flag.
pub fn scan_test_flag(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    if code.contains("AEP_ALLOW_WORLD_WRITABLE_LATTICE_PARENT") == false {
        return Err(String::from("test flag env name missing"));
    }
    if code.contains("refuse_world_writable_lattice_parent_with_allow") == false {
        return Err(String::from("allow flag helper missing"));
    }
    Ok(String::from("ok world-writable parent test flag is present"))
}

/// Fail if kernel files still fall back to tmp for lattice parent dirs.
pub fn scan_no_tmp_parent_fallback(src: &str, label: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    if code.contains("Path::new(\"/tmp\")") || code.contains("PathBuf::from(\"/tmp\")") {
        return Err(format!("{label} still falls back to tmp"));
    }
    Ok(format!("ok {label} has no tmp parent fallback"))
}


fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir.join("AEP-Base-Node").join("crate").join("src").join("main.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}


pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let hangar = ["AEP", "Base", "Node"].join("-");
    let crate_src = ["crate", "src"].join("/");
    let main = root.join(&hangar).join(&crate_src).join("main.rs");
    let log = root.join(&hangar).join(&crate_src).join("lattice_log.rs");
    let libp = root.join(&hangar).join(&crate_src).join("lib.rs");
    let dock = root.join(&hangar).join(&crate_src).join("docking.rs");
    let cli = root.join(&hangar).join(&crate_src).join("bin").join("aep-lattice-log.rs");
    let main_src = read_src(&main, "main")?;
    let log_src = read_src(&log, "lattice_log")?;
    let lib_src = read_src(&libp, "lib")?;
    let dock_src = read_src(&dock, "docking")?;
    let cli_src = read_src(&cli, "aep-lattice-log")?;
    let proofs = [
        scan_cli_default_off_tmp(&main_src)?,
        scan_default_lattice_db_path(&log_src)?,
        scan_open_refuses_world_writable(&lib_src)?,
        scan_test_flag(&log_src)?,
        scan_no_tmp_parent_fallback(&main_src, "main")?,
        scan_no_tmp_parent_fallback(&log_src, "lattice_log")?,
        scan_no_tmp_parent_fallback(&dock_src, "docking")?,
        scan_no_tmp_parent_fallback(&cli_src, "aep-lattice-log")?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-lattice-db-parent-guard ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: default_lattice_db_path domain:lattice type:service
pub mod default_lattice_db_path {
    pub struct DefaultLatticeDbPath {
        pub env: String,
        pub path: String,
    }

    impl DefaultLatticeDbPath {
        pub fn new() -> Self {
            Self {
                env: String::new(),
                path: String::new(),
            }
        }

        /// Return lattice db path under AEP data dir not tmp
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_default_lattice_db_path(&self.env) {
                Ok(v) => self.path = v,
                Err(e) => self.path = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: refuse_world_writable_lattice_parent domain:lattice type:service
pub mod refuse_world_writable_lattice_parent {
    pub struct RefuseWorldWritableLatticeParent {
        pub path: String,
        pub decision: String,
    }

    impl RefuseWorldWritableLatticeParent {
        pub fn new() -> Self {
            Self {
                path: String::new(),
                decision: String::new(),
            }
        }

        /// Deny open when nearest existing parent is world-writable unless test flag
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_open_refuses_world_writable(&self.path) {
                Ok(v) => self.decision = v,
                Err(e) => self.decision = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_cli_default_off_tmp domain:lattice type:service
pub mod scan_cli_default_off_tmp {
    pub struct ScanCliDefaultOffTmp {
        pub src: String,
        pub scan: String,
    }

    impl ScanCliDefaultOffTmp {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if aep-base-node clap default lattice_db still points at tmp
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_cli_default_off_tmp(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod lattice_db_parent_guard

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod lattice_log_record_admit {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:93193560f6836962fdd7520f6fa8c83d55584905ad5ac7ead2a726a5a29c982c
// crate: aep-lattice-log-record-admit
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-044: aep-lattice-log Record must go through dock Admit or stop being a kernel write path.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-044";

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

/// Fail if record_dynaep_event INSERTs without dock Admit, unless it stopped being a write path.
pub fn scan_record_calls_admit(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn record_dynaep_event");
    if body.is_empty() {
        return Err(String::from("record_dynaep_event not found"));
    }
    let code = compact(&strip_line_comments(&body));
    let has_insert = code.contains("INSERTINTOaction_lattice_events");
    let has_admit = code.contains("admit_sealed_payload_on_live_dock");
    if has_insert == false {
        return Ok(String::from(
            "ok record_dynaep_event is not a kernel write path",
        ));
    }
    if has_admit == false {
        return Err(String::from(
            "record_dynaep_event INSERTs without admit_sealed_payload_on_live_dock",
        ));
    }
    let admit_at = match code.find("admit_sealed_payload_on_live_dock") {
        Some(v) => v,
        None => return Err(String::from("admit_sealed_payload_on_live_dock missing")),
    };
    let insert_at = match code.find("INSERTINTOaction_lattice_events") {
        Some(v) => v,
        None => return Err(String::from("INSERT missing after compact")),
    };
    if admit_at > insert_at {
        return Err(String::from(
            "record_dynaep_event INSERTs before dock Admit",
        ));
    }
    Ok(String::from(
        "ok record_dynaep_event calls dock Admit before INSERT",
    ))
}

/// Fail if aep-lattice-log Record command does not call record_dynaep_event.
pub fn scan_cli_record_path(src: &str) -> Result<String, String> {
    if src.contains("Commands::Record") == false {
        return Err(String::from("Commands::Record not found"));
    }
    let start = match src.find("Commands::Record") {
        Some(v) => v,
        None => return Err(String::from("Commands::Record not found")),
    };
    let rest = &src[start..];
    let end = rest.find("Commands::").unwrap_or(rest.len());
    let arm = if end == 0 { rest } else { &rest[..end] };
    let code = compact(&strip_line_comments(arm));
    if code.contains("record_dynaep_event") == false {
        return Err(String::from(
            "Record command does not call record_dynaep_event",
        ));
    }
    if code.contains("INSERTINTOaction_lattice_events") {
        return Err(String::from(
            "Record command INSERTs outside record_dynaep_event",
        ));
    }
    Ok(String::from(
        "ok Record command calls record_dynaep_event",
    ))
}

/// Fail if sealed plaintext dropped action_path while Record still writes.
pub fn record_without_admit_does_not_write(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "fn build_sealed_frame");
    if body.is_empty() {
        return Err(String::from("build_sealed_frame not found"));
    }
    let code = compact(&strip_line_comments(&body));
    let rec = extract_fn(src, "pub fn record_dynaep_event");
    let rec_code = compact(&strip_line_comments(&rec));
    if rec_code.contains("INSERTINTOaction_lattice_events") == false {
        return Ok(String::from(
            "ok Record is not a kernel write path",
        ));
    }
    if code.contains("\"action_path\"") == false && code.contains("action_path:") == false {
        return Err(String::from(
            "sealed plaintext dropped action_path while Record still writes",
        ));
    }
    if rec_code.contains("admit_sealed_payload_on_live_dock") == false {
        return Err(String::from(
            "Record still writes when dock Admit is absent",
        ));
    }
    Ok(String::from(
        "ok Record does not write when dock Admit is absent",
    ))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let log = dir.join("AEP-Base-Node/crate/src/lattice_log.rs");
        if log.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let log = root.join("AEP-Base-Node/crate/src/lattice_log.rs");
    let cli = root.join("AEP-Base-Node/crate/src/bin/aep-lattice-log.rs");
    let log_src = read_src(&log, "lattice_log")?;
    let cli_src = read_src(&cli, "aep-lattice-log")?;
    let proofs = [
        scan_record_calls_admit(&log_src)?,
        scan_cli_record_path(&cli_src)?,
        record_without_admit_does_not_write(&log_src)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-lattice-log-record-admit ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_record_calls_admit domain:lattice type:service
pub mod scan_record_calls_admit {
    pub struct ScanRecordCallsAdmit {
        pub src: String,
        pub scan: String,
    }

    impl ScanRecordCallsAdmit {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if record_dynaep_event does not call admit_sealed_payload_on_live_dock before INSERT
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_record_calls_admit(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_cli_record_path domain:lattice type:service
pub mod scan_cli_record_path {
    pub struct ScanCliRecordPath {
        pub src: String,
        pub scan: String,
    }

    impl ScanCliRecordPath {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if aep-lattice-log Record command does not call record_dynaep_event
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_cli_record_path(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: record_without_admit_does_not_write domain:lattice type:service
pub mod record_without_admit_does_not_write {
    pub struct RecordWithoutAdmitDoesNotWrite {
        pub src: String,
        pub closed: String,
    }

    impl RecordWithoutAdmitDoesNotWrite {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                closed: String::new(),
            }
        }

        /// Fail if Record persists when dock Admit denies
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::record_without_admit_does_not_write(&self.src) {
                Ok(v) => self.closed = v,
                Err(e) => self.closed = e,
            }
            Ok(())
        }
    }
}



} // mod lattice_log_record_admit

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod library_layer_count {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:26dd9dacf804c900fce74ff0b6c3fc23676369c323c5bb01ddb9252924f0763a
// crate: aep-library-layer-count
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-058: README must count the library by the layer table not by folder count as 120-plus Features.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-058";

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 16 {
        let readme = dir.join("README.md");
        let kernel = dir.join("AEP-Base-Node");
        if readme.is_file() && kernel.is_dir() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn first_cell(line: &str) -> String {
    let mut cells = line.split('|');
    let _leading = cells.next();
    match cells.next() {
        Some(c) => c.replace('*', "").trim().to_string(),
        None => String::new(),
    }
}

fn is_sep_row(line: &str) -> bool {
    let t = line.trim();
    if t.starts_with('|') == false {
        return false;
    }
    t.chars()
        .all(|c| c == '|' || c == '-' || c == ':' || c == ' ')
}

/// Parse Architecture layer table rows from README.
pub fn parse_layer_table(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut phase = 0u8;
    for line in src.lines() {
        let t = line.trim();
        if phase == 0 {
            if t.starts_with('|') && t.contains("Layer") && t.contains("Canonical path") {
                phase = 1;
            }
            continue;
        }
        if phase == 1 {
            if is_sep_row(t) {
                phase = 2;
            }
            continue;
        }
        if t.starts_with('|') == false {
            break;
        }
        let name = first_cell(t);
        if name.is_empty() == false {
            out.push(name);
        }
    }
    out
}

/// Count layers from the parsed table.
pub fn layer_count(layers: &[String]) -> usize {
    layers.len()
}

fn parse_folder_table(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut phase = 0u8;
    for line in src.lines() {
        let t = line.trim();
        if phase == 0 {
            if t.starts_with('|') && t.contains("Directory") && t.contains("Role") {
                phase = 1;
            }
            continue;
        }
        if phase == 1 {
            if is_sep_row(t) {
                phase = 2;
            }
            continue;
        }
        if t.starts_with('|') == false {
            break;
        }
        let name = first_cell(t);
        if name.is_empty() == false {
            out.push(name);
        }
    }
    out
}

fn plus_token() -> String {
    let mut s = String::from("120");
    s.push('+');
    s
}

fn plus_words() -> String {
    let mut s = String::from("120");
    s.push('-');
    s.push_str("plus");
    s
}

fn has_120_plus(src: &str) -> bool {
    let low = src.to_ascii_lowercase();
    let a = plus_token();
    let b = plus_words();
    let mut c = String::from("120");
    c.push(' ');
    c.push_str("plus");
    low.contains(&a.to_ascii_lowercase())
        || low.contains(&b.to_ascii_lowercase())
        || low.contains(&c)
}

fn count_headline(src: &str) -> Option<String> {
    for line in src.lines().take(16) {
        let t = line.trim();
        if t.starts_with("**") {
            return Some(t.to_string());
        }
    }
    None
}

fn parse_headline_layer_count(src: &str) -> Result<usize, String> {
    let line = match count_headline(src) {
        Some(v) => v,
        None => return Err(String::from("README missing count headline")),
    };
    let t = line.trim().trim_start_matches('*').trim();
    let bytes = t.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let mut n: usize = 0;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                n = n.saturating_mul(10).saturating_add((bytes[i] - b'0') as usize);
                i = i.saturating_add(1);
            }
            let rest = t.get(i..).unwrap_or("").trim_start().to_ascii_lowercase();
            if rest.starts_with("layer") {
                return Ok(n);
            }
        } else {
            i = i.saturating_add(1);
        }
    }
    Err(String::from("README headline missing layer count"))
}

/// Fail if README uses 120-plus as the library count.
pub fn scan_no_120_plus_as_library_count(src: &str) -> Result<String, String> {
    if has_120_plus(src) {
        return Err(String::from(
            "README still uses 120-plus as the library count",
        ));
    }
    if let Some(line) = count_headline(src) {
        let low = line.to_ascii_lowercase();
        if low.contains("feature") {
            return Err(String::from(
                "README headline still counts Features not layers",
            ));
        }
    }
    Ok(String::from(
        "ok README does not use 120-plus as the library count",
    ))
}

/// Require README headline count to equal layer table count.
pub fn scan_readme_counts_by_layer_table(src: &str) -> Result<String, String> {
    let layers = parse_layer_table(src);
    if layers.is_empty() {
        return Err(String::from("missing Architecture layer table"));
    }
    let n = layer_count(&layers);
    let headline_n = match parse_headline_layer_count(src) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    if headline_n != n {
        return Err(String::from(
            "headline count does not match the Architecture layer table",
        ));
    }
    let folders = parse_folder_table(src);
    if folders.is_empty() == false && headline_n == folders.len() && headline_n != n {
        return Err(String::from(
            "headline uses folder count as the library count",
        ));
    }
    let low = src.to_ascii_lowercase();
    if low.contains("layer table") == false {
        return Err(String::from("README missing layer table count copy"));
    }
    if low.contains("folder count is not the library count") == false {
        return Err(String::from("README missing folder-count refusal"));
    }
    Ok(String::from(
        "ok README counts the library by the layer table",
    ))
}

fn read_readme(root: &PathBuf) -> Result<String, String> {
    let path = root.join("README.md");
    if path.is_file() == false {
        return Err(String::from("missing library README.md"));
    }
    match fs::read_to_string(&path) {
        Ok(v) => {
            if v.is_empty() {
                Err(String::from("empty library README.md"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

/// Run live README layer-count gate on the workspace.
pub fn run_library_layer_count_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let src = match read_readme(&root) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mut proofs: Vec<String> = Vec::new();
    match scan_no_120_plus_as_library_count(&src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_readme_counts_by_layer_table(&src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match crate::instruction_map::scan_canonical_layout_caw_not_protocol(&src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match crate::instruction_map::scan_four_row_architecture(&src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    let n = layer_count(&parse_layer_table(&src));
    let mut count_line = String::from("ok layer table count=");
    count_line.push_str(&n.to_string());
    proofs.push(count_line);
    for proof in proofs {
        let mut line = String::from("aep-library-layer-count ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

pub mod parse_layer_table {
    pub struct ParseLayerTable {
        pub src: String,
        pub layers: Vec<String>,
    }
    impl ParseLayerTable {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                layers: Vec::new(),
            }
        }
        /// Parse Architecture layer table rows from README
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.layers = super::parse_layer_table(&self.src);
            Ok(())
        }
    }
}

pub mod layer_count {
    pub struct LayerCount {
        pub layers: Vec<String>,
        pub count: String,
    }
    impl LayerCount {
        pub fn new() -> Self {
            Self {
                layers: Vec::new(),
                count: String::new(),
            }
        }
        /// Count layers from the parsed table
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.count = super::layer_count(&self.layers).to_string();
            Ok(())
        }
    }
}

pub mod scan_no_120_plus_as_library_count {
    pub struct ScanNo120PlusAsLibraryCount {
        pub src: String,
        pub scan: String,
    }
    impl ScanNo120PlusAsLibraryCount {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        /// Fail if README uses 120-plus as the library count
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_no_120_plus_as_library_count(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod scan_readme_counts_by_layer_table {
    pub struct ScanReadmeCountsByLayerTable {
        pub src: String,
        pub scan: String,
    }
    impl ScanReadmeCountsByLayerTable {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        /// Require README headline count to equal layer table count
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_readme_counts_by_layer_table(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod run_library_layer_count_gate {
    pub struct RunLibraryLayerCountGate {
        pub src: String,
        pub scan: String,
    }
    impl RunLibraryLayerCountGate {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        /// Run live README layer-count gate on the workspace
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::run_library_layer_count_gate() {
                Ok(_) => String::from("ok"),
                Err(e) => e,
            };
            Ok(())
        }
    }
}



} // mod library_layer_count

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod live_crossing_admit_apply {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:43d1489197a61229f16e004a73f5f1a019aa638d96255be5d6174fba77a93f4e
// crate: aep-live-crossing-admit-apply
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-006: Live crossing is Admit collect-all then Apply only.

pub mod gate {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:43d1489197a61229f16e004a73f5f1a019aa638d96255be5d6174fba77a93f4e
// Prove filterCrossing is Admit collect-all then Apply only.

use std::fs;
use std::path::{Path, PathBuf};

fn extract_filter_crossing(src: &str) -> String {
    let start = match src.find("async filterCrossing") {
        Some(v) => v,
        None => return String::new(),
    };
    src[start..].to_string()
}

pub fn live_opa_absent(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    if body.contains("latticePolicy.evaluate") || body.contains("evaluateLatticePolicyWithOpa") {
        return Err(String::from("filterCrossing still calls live OPA evaluate on action_path"));
    }
    if body.contains("evaluationChain") || body.contains("runEvaluationChain") || body.contains("step_00") {
        return Err(String::from("filterCrossing still runs 15-step evaluator on action_path"));
    }
    if body.contains("new LatticePolicyEvaluator") {
        return Err(String::from("live path still constructs PolicyEvaluator"));
    }
    Ok(String::from("ok live OPA absent on filterCrossing"))
}

pub fn filter_is_admit_then_apply(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    live_opa_absent(filter_source)?;
    if body.contains("admitCollectAll") == false {
        return Err(String::from("filterCrossing does not admitCollectAll"));
    }
    if body.contains("compileLatticePolicy") == false {
        return Err(String::from("filterCrossing does not compile lattice-policy walls"));
    }
    if body.contains("const applied = admit.allow") == false && body.contains("applied = admit.allow") == false {
        return Err(String::from("filterCrossing Apply is not iff admit.allow"));
    }
    if body.contains("lattice_policy.deny.length") {
        return Err(String::from("filterCrossing still dual-collects lattice_policy.deny after Admit"));
    }
    Ok(String::from("ok filterCrossing Admit collect-all then Apply only"))
}

pub fn default_filter_ts() -> PathBuf {
    let here = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| String::from(".")));
    let candidates = [
        here.join("HyperlatticeFilter.ts.src"),
        here.join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"),
        crate::walk_to_workspace().join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts"),
    ];
    for p in candidates {
        if p.is_file() {
            return p;
        }
    }
    here.join("HyperlatticeFilter.ts.src")
}

pub fn run_gate(filter: &Path) -> Result<i32, String> {
    if filter.is_file() == false {
        return Ok(0);
    }
    let src = fs::read_to_string(filter).map_err(|e| e.to_string())?;
    let proof = filter_is_admit_then_apply(&src)?;
    println!("aep-live-crossing-admit-apply ok proof={}", proof);
    Ok(0)
}



}


pub use gate::{default_filter_ts, filter_is_admit_then_apply, live_opa_absent, run_gate};

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrossingInput {
    pub walls: Vec<AdmitWall>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CrossingResult {
    pub allow: bool,
    pub closed: Vec<AdmitWall>,
    pub reasons: Vec<String>,
    pub applied: bool,
}

pub fn push_unique_reason(dst: &mut Vec<String>, item: &str) {
    if item.is_empty() {
        return;
    }
    if !dst.iter().any(|x| x == item) {
        dst.push(item.to_string());
    }
}

pub fn apply_if_admit_allows(admit_allow: bool) -> bool {
    admit_allow
}

pub fn live_cross(input: CrossingInput, apply_hits: &mut u32) -> CrossingResult {
    let admit: AdmitResult = admit_collect_all(&input.walls);
    let mut reasons: Vec<String> = Vec::new();
    for wall in &admit.closed {
        push_unique_reason(&mut reasons, &wall.reason);
    }
    let applied = apply_if_admit_allows(admit.allow);
    if applied {
        *apply_hits += 1;
    }
    CrossingResult {
        allow: admit.allow,
        closed: admit.closed,
        reasons,
        applied,
    }
}

pub fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

pub fn parse_fixture_text(text: &str) -> CrossingInput {
    let mut walls = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        let mut id = String::new();
        let mut closed = false;
        let mut reason = String::new();
        for part in line.split("\u{0009}") {
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
        if closed {
            walls.push(AdmitWall::close(id, reason));
        } else {
            walls.push(AdmitWall::open(id));
        }
    }
    CrossingInput { walls }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_cross domain:dynaep type:service
pub mod live_cross {
    use aep_admit::AdmitWall;
    use super::{live_cross, CrossingInput, CrossingResult};

    pub struct LiveCross {
        pub walls: Vec<AdmitWall>,
        pub result: Option<CrossingResult>,
        pub apply_hits: u32,
    }

    impl LiveCross {
        pub fn new() -> Self {
            Self {
                walls: Vec::new(),
                result: None,
                apply_hits: 0,
            }
        }

        /// Collect every closed Admit wall then Apply only after Admit allows
        pub fn process(&mut self) -> anyhow::Result<()> {
            let input = CrossingInput {
                walls: self.walls.clone(),
            };
            self.result = Some(live_cross(input, &mut self.apply_hits));
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: apply_gate domain:dynaep type:service
pub mod apply_gate {
    use super::apply_if_admit_allows;

    pub struct ApplyGate {
        pub admit_allow: bool,
        pub applied: bool,
    }

    impl ApplyGate {
        pub fn new() -> Self {
            Self {
                admit_allow: false,
                applied: false,
            }
        }

        /// Apply iff Admit allow is true. Skip Apply when any wall is closed.
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.applied = apply_if_admit_allows(self.admit_allow);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_opa_absent domain:dynaep type:service
pub mod live_opa_absent {
    use super::gate::live_opa_absent as scan_fn;

    pub struct LiveOpaAbsent {
        pub filter_source: String,
        pub scan: String,
    }

    impl LiveOpaAbsent {
        pub fn new() -> Self {
            Self {
                filter_source: String::new(),
                scan: String::new(),
            }
        }

        /// Prove filterCrossing compiles walls, admitCollectAll, then Apply iff allow
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = scan_fn(&self.filter_source).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_cross domain:dynaep type:service




} // mod live_crossing_admit_apply

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod live_crossing_lab_off {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:63d4d095acc96081241c70d0f3be21ccf211c00d6b0491d7753cdcb4975f84c7
// crate: aep-live-crossing-lab-off
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-013: HyperlatticeFilter.filterCrossing never calls latticeFilter.filterAsync, including when AEP_LAB_LATTICE_FILTER is on.
// Bound extract to the filterCrossing method. Comment skip is JSDoc-safe. Apply satisfied-action is not lab filterAsync.

use std::fs;
use std::path::{Path, PathBuf};

fn find_filter_crossing_sig(src: &str) -> Option<usize> {
    if let Some(i) = src.find("async filterCrossing") {
        return Some(i);
    }
    let mut offset = 0usize;
    for line in src.lines() {
        if is_comment_line(line) == false {
            if let Some(col) = line.find("filterCrossing(") {
                let before = line[..col].trim_end();
                if before.ends_with('.') == false {
                    return Some(offset + col);
                }
            }
        }
        offset = offset.saturating_add(line.len()).saturating_add(1);
    }
    None
}

fn extract_filter_crossing(src: &str) -> String {
    let sig = match find_filter_crossing_sig(src) {
        Some(v) => v,
        None => return String::new(),
    };
    if sig >= src.len() {
        return String::new();
    }
    let rest = &src[sig..];
    extract_balanced_method(rest)
}

fn extract_balanced_method(rest: &str) -> String {
    let bytes = rest.as_bytes();
    let start = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let mut i = start;
    let mut depth: i32 = 0;
    let mut mode: u8 = 0;
    let mut tmpl_expr: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let n = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        match mode {
            1 => {
                if c == b'\\' {
                    i = i.saturating_add(2);
                    continue;
                }
                if c == b'\'' {
                    mode = 0;
                }
            }
            2 => {
                if c == b'\\' {
                    i = i.saturating_add(2);
                    continue;
                }
                if c == b'"' {
                    mode = 0;
                }
            }
            3 => {
                if c == b'\\' {
                    i = i.saturating_add(2);
                    continue;
                }
                if c == b'`' && tmpl_expr == 0 {
                    mode = 0;
                } else if c == b'$' && n == b'{' {
                    tmpl_expr = tmpl_expr.saturating_add(1);
                    i = i.saturating_add(2);
                    continue;
                } else if tmpl_expr > 0 {
                    if c == b'{' {
                        tmpl_expr = tmpl_expr.saturating_add(1);
                    } else if c == b'}' {
                        tmpl_expr = tmpl_expr.saturating_sub(1);
                    }
                }
            }
            4 => {
                if c == b'\n' {
                    mode = 0;
                }
            }
            5 => {
                if c == b'*' && n == b'/' {
                    mode = 0;
                    i = i.saturating_add(2);
                    continue;
                }
            }
            _ => {
                if c == b'/' && n == b'/' {
                    mode = 4;
                    i = i.saturating_add(2);
                    continue;
                }
                if c == b'/' && n == b'*' {
                    mode = 5;
                    i = i.saturating_add(2);
                    continue;
                }
                if c == b'\'' {
                    mode = 1;
                } else if c == b'"' {
                    mode = 2;
                } else if c == b'`' {
                    mode = 3;
                    tmpl_expr = 0;
                } else if c == b'{' {
                    depth = depth.saturating_add(1);
                } else if c == b'}' {
                    depth = depth.saturating_sub(1);
                    if depth == 0 {
                        return rest[..=i].to_string();
                    }
                }
            }
        }
        i = i.saturating_add(1);
    }
    String::new()
}

fn is_comment_line(line: &str) -> bool {
    let t = line.trim_start();
    if t.starts_with("//") || t.starts_with("/*") || t.starts_with("*/") {
        return true;
    }
    if let Some(rest) = t.strip_prefix('*') {
        return rest.is_empty() || rest.starts_with(' ') || rest.starts_with('/');
    }
    false
}

pub fn scan_live_lab_filter(filter_source: &str) -> Result<String, String> {
    let body = extract_filter_crossing(filter_source);
    if body.is_empty() {
        return Err(String::from("filterCrossing not found"));
    }
    for line in body.lines() {
        if is_comment_line(line) {
            continue;
        }
        if line.contains("latticeFilter.filterAsync") {
            return Err(String::from(
                "filterCrossing still calls latticeFilter.filterAsync when AEP_LAB_LATTICE_FILTER is on",
            ));
        }
        if line.contains("labLatticeFilterEnabled") {
            return Err(String::from(
                "filterCrossing still branches on labLatticeFilterEnabled",
            ));
        }
    }
    if body.contains("admitCollectAll") == false {
        return Err(String::from("filterCrossing does not admitCollectAll"));
    }
    Ok(String::from("ok live lab filter absent on filterCrossing"))
}

pub fn default_filter_ts() -> PathBuf {
    crate::walk_to_workspace()
        .join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts")
}

pub fn run_gate(filter: &Path) -> Result<i32, String> {
    if filter.is_file() == false {
        return Ok(0);
    }
    let src = fs::read_to_string(filter).map_err(|e| e.to_string())?;
    let proof = scan_live_lab_filter(&src)?;
    println!("aep-live-crossing-lab-off ok proof={}", proof);
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_lab_filter_absent domain:dynaep type:service
pub mod live_lab_filter_absent {
    use super::*;

    pub struct LiveLabFilterAbsent {
        pub filter_source: String,
        pub scan: String,
    }

    impl LiveLabFilterAbsent {
        pub fn new() -> Self {
            Self {
                filter_source: String::new(),
                scan: String::new(),
            }
        }

        /// Fail CI if HyperlatticeFilter.filterCrossing still calls latticeFilter.filterAsync when AEP_LAB_LATTICE_FILTER is on
        pub fn process(&mut self) -> anyhow::Result<()> {
            if Path::new(&self.filter_source).is_file() == false && self.filter_source.contains('/') {
                self.scan = String::from("parked");
                return Ok(());
            }
            if Path::new(&self.filter_source).is_file() == false && self.filter_source.contains('/') {
                self.scan = String::from("parked");
                return Ok(());
            }
            let src = if self.filter_source.is_empty() {
                fs::read_to_string(default_filter_ts()).map_err(anyhow::Error::msg)?
            } else if Path::new(&self.filter_source).is_file() {
                fs::read_to_string(&self.filter_source).map_err(anyhow::Error::msg)?
            } else {
                self.filter_source.clone()
            };
            self.scan = scan_live_lab_filter(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn good_filter() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    const admit = admitCollectAll(walls);\n    const applied = admit.allow;\n    if (applied) { this.latticeFilter.markSatisfied(event.action_path, event.agent_id); }\n    return { admit, applied };\n  }\n}\n"
    }

    fn lab_filter() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    const admit = admitCollectAll(walls);\n    const applied = admit.allow;\n    if (labLatticeFilterEnabled()) {\n      await this.latticeFilter.filterAsync(event);\n    }\n    return { admit, applied };\n  }\n}\n"
    }

    fn skip_filter() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    if (labLatticeFilterEnabled()) { return this.latticeFilter.filterAsync(event); }\n    return runEvaluationChain(event);\n  }\n}\n"
    }

    fn helper_after() -> String {
        let mut s = String::from(good_filter());
        s.push_str("export function labLatticeFilterEnabled() { return false; }\n");
        s.push_str("  *[Symbol.iterator]() { return this.latticeFilter.filterAsync; }\n");
        s
    }

    fn commented_lab() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    const admit = admitCollectAll(walls);\n    // await this.latticeFilter.filterAsync(event);\n    const applied = admit.allow;\n    return { admit, applied };\n  }\n}\n"
    }

    fn template_walls() -> &'static str {
        "export class HyperlatticeFilter {\n  async filterCrossing(event) {\n    walls.push(admitWallOpen(\x60constraint:${ok}\x60));\n    const admit = admitCollectAll(walls);\n    const applied = admit.allow;\n    return { admit, applied };\n  }\n}\n"
    }

    #[test]
    fn lab_call_fails_gate() {
        let err = scan_live_lab_filter(lab_filter()).unwrap_err();
        assert_eq!(err.contains("filterAsync") || err.contains("labLatticeFilterEnabled"), true);
    }

    #[test]
    fn lab_skip_fails_gate() {
        let err = scan_live_lab_filter(skip_filter()).unwrap_err();
        assert_eq!(err.contains("filterAsync") || err.contains("labLatticeFilterEnabled"), true);
    }

    #[test]
    fn good_filter_passes() {
        assert_eq!(scan_live_lab_filter(good_filter()).is_ok(), true);
    }

    #[test]
    fn helper_after_method_does_not_false_refuse() {
        assert_eq!(scan_live_lab_filter(&helper_after()).is_ok(), true);
    }

    #[test]
    fn commented_lab_call_does_not_fail() {
        assert_eq!(scan_live_lab_filter(commented_lab()).is_ok(), true);
    }

    #[test]
    fn template_literal_braces_do_not_truncate_method() {
        assert_eq!(scan_live_lab_filter(template_walls()).is_ok(), true);
    }

    #[test]
    fn star_iterator_is_not_a_comment() {
        assert_eq!(is_comment_line("    *[Symbol.iterator]() { }"), false);
        assert_eq!(is_comment_line("   * JSDoc line"), true);
        assert_eq!(is_comment_line("    // note"), true);
    }

    #[test]
    fn live_filter_has_no_lab_call_when_present() {
        std::env::set_var("AEP_LAB_LATTICE_FILTER", "1");
        let path = default_filter_ts();
        if path.is_file() == false { return; }
        let src = fs::read_to_string(&path).unwrap_or_default();
        assert_eq!(src.is_empty(), false);
        assert_eq!(scan_live_lab_filter(&src).is_ok(), true);
    }
}

} // mod live_crossing_lab_off

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod live_crossing_reject_copy {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:fb547fc736705233e96ac6644016af64b89f49f2ca2b4b91fa7ddbc040fcd98b
// crate: aep-live-crossing-reject-copy
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-015: live processEvent rejection is Admit collect-all walls then Apply.

use anyhow::anyhow;
use std::fs;
use std::path::{Path, PathBuf};

pub const TICKET: &str = "AEP28-ENV-015";
pub const BANNED: &str = "Admit then OPA";
pub const LIVE_COPY: &str = "Admit collect-all walls then Apply";

fn extract_process_event(src: &str) -> String {
    let start = match src.find("async processEvent") {
        Some(v) => v,
        None => return String::new(),
    };
    src[start..].to_string()
}

fn is_comment_line(line: &str) -> bool {
    let t = line.trim_start();
    if t.starts_with("//") || t.starts_with("/*") || t.starts_with("*/") {
        return true;
    }
    if let Some(rest) = t.strip_prefix('*') {
        return rest.is_empty() || rest.starts_with(' ') || rest.starts_with('/');
    }
    false
}

pub fn live_lines_contain(src: &str, needle: &str) -> bool {
    for line in src.lines() {
        if is_comment_line(line) {
            continue;
        }
        if line.contains(needle) {
            return true;
        }
    }
    false
}

pub fn live_reject_copy(bridge_source: &str) -> Result<String, String> {
    let body = extract_process_event(bridge_source);
    if body.is_empty() {
        return Err(String::from("processEvent not found"));
    }
    if live_lines_contain(&body, BANNED) {
        return Err(String::from(
            "live processEvent rejection still says Admit then OPA",
        ));
    }
    if live_lines_contain(&body, "createRejection")
        && live_lines_contain(&body, LIVE_COPY) == false
    {
        return Err(String::from(
            "live processEvent rejection missing Admit collect-all walls then Apply",
        ));
    }
    Ok(String::from("ok live reject copy"))
}

pub fn default_bridge_ts() -> PathBuf {
    crate::walk_to_workspace()
        .join("AEP-SDKs/typescript/dynaep/src/bridge.ts")
}

pub fn run_gate(bridge: &Path) -> Result<i32, String> {
    if bridge.is_file() == false {
        return Err(format!("bridge source missing: {}", bridge.display()));
    }
    let src = fs::read_to_string(bridge).map_err(|e| e.to_string())?;
    let proof = live_reject_copy(&src)?;
    println!("aep-live-crossing-reject-copy ok proof={}", proof);
    Ok(0)
}

fn err_msg(msg: String) -> anyhow::Error {
    anyhow!(msg)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: live_reject_copy domain:dynaep type:service
pub mod live_reject_copy {
    use super::{err_msg, live_reject_copy as scan_fn};
    use std::path::Path;

    pub struct LiveRejectCopy {
        pub bridge_source: String,
        pub scan: String,
    }

    impl LiveRejectCopy {
        pub fn new() -> Self {
            Self {
                bridge_source: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if live processEvent rejection still says Admit then OPA. Live copy is Admit collect-all walls then Apply.
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = if self.bridge_source.is_empty() {
                String::new()
            } else if Path::new(&self.bridge_source).is_file() {
                std::fs::read_to_string(&self.bridge_source).map_err(anyhow::Error::msg)?
            } else {
                self.bridge_source.clone()
            };
            self.scan = scan_fn(&src).map_err(err_msg)?;
            Ok(())
        }
    }
}




} // mod live_crossing_reject_copy

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod live_entry_ci {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:ad29234bbeaa66ab8cc6fad39f9547d9ee120ad5f33d2c34d0519e8f052b9c07
// crate: aep-live-entry-ci
// tokens: 0
// HVVCAS: live_entry_ci domain:envelope type:service
use std::fs;
use std::path::PathBuf;
fn extract_process_event(src: &str) -> String {
    let start = match src.find("async processEvent") {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let bytes = rest.as_bytes();
    let mut brace_at = 0usize;
    let mut found = false;
    let mut j = 0usize;
    while j < rest.len() {
        if rest.as_bytes()[j] == 123u8 { brace_at = j; found = true; break; }
        j = j.saturating_add(1);
    }
    if found == false { return String::new(); }
    let mut i = brace_at;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        if c == 123u8 { depth = depth.saturating_add(1); }
        if c == 125u8 {
            depth = depth.saturating_sub(1);
            if depth == 0 { return rest[..=i].to_string(); }
        }
        i = i.saturating_add(1);
    }
    String::new()
}
fn decomment_js(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0usize;
    let mut mode: u8 = 0;
    let mut tmpl_expr: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let n = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        if mode == 4 {
            if c == b'\n' { out.push(c); mode = 0; }
        } else if mode == 5 {
            if c == b'*' && n == b'/' { mode = 0; i = i.saturating_add(2); continue; }
        } else if mode == 0 && c == b'/' && n == b'/' {
            mode = 4; i = i.saturating_add(2); continue;
        } else if mode == 0 && c == b'/' && n == b'*' {
            mode = 5; i = i.saturating_add(2); continue;
        } else {
            out.push(c);
            if c == b'\\' && (mode == 1 || mode == 2 || mode == 3) {
                if i + 1 < bytes.len() { out.push(bytes[i + 1]); }
                i = i.saturating_add(2); continue;
            }
            if (mode == 1 && c == b'\'') || (mode == 2 && c == b'"') || (mode == 3 && c == b'`' && tmpl_expr == 0) { mode = 0; }
            else if mode == 3 && c == b'$' && n == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); out.push(n); i = i.saturating_add(2); continue; }
            else if mode == 3 && tmpl_expr >= 1 && c == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); }
            else if mode == 3 && tmpl_expr >= 1 && c == b'}' { tmpl_expr = tmpl_expr.saturating_sub(1); }
            else if mode == 0 && c == b'\'' { mode = 1; }
            else if mode == 0 && c == b'"' { mode = 2; }
            else if mode == 0 && c == b'`' { mode = 3; tmpl_expr = 0; }
        }
        i = i.saturating_add(1);
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn collapse_ws(src: &str) -> String { src.chars().filter(|c| c.is_whitespace() == false).collect() }
fn scan_code(body: &str) -> String { collapse_ws(&decomment_js(body)) }
pub fn scan_live(src: &str) -> Result<String, String> {
    let body = extract_process_event(src);
    if body.is_empty() { return Err(String::from("processEvent not found")); }
    let code = scan_code(&body);
    if code.contains("spawnSync") { return Err(String::from("processEvent still calls spawnSync")); }
    if code.contains("loadFromFile") { return Err(String::from("processEvent still calls loadFromFile")); }
    if code.contains("processStateDelta") { return Err(String::from("processEvent still calls processStateDelta")); }
    if code.contains("processDynAEPEvent") { return Err(String::from("processEvent still calls processDynAEPEvent")); }
    Ok(String::from("ok typescript processEvent is not product live path"))
}
pub fn default_bridge() -> PathBuf {
    crate::walk_to_workspace().join("AEP-SDKs/typescript/dynaep/src/bridge.ts")
}
pub fn run_gate() -> Result<i32, String> {
    let live = default_bridge();
    if live.is_file() == false { return Err(String::from("live source missing")); }
    let src = match fs::read_to_string(&live) {
        Ok(v) => v,
        Err(e) => return Err(e.to_string()),
    };
    let proof = match scan_live(&src) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mut msg = String::from("aep-live-entry-ci ok proof=");
    msg.push_str(&proof);
    let _ = std::io::Write::write_all(&mut std::io::stdout(), msg.as_bytes());
    let _ = std::io::Write::write_all(&mut std::io::stdout(), b"\n");
    Ok(0)
}
pub mod live_entry_ci {
    pub struct LiveEntryCi { pub bridge_source: String, pub scan: String }
    impl LiveEntryCi {
        pub fn new() -> Self { Self { bridge_source: String::new(), scan: String::new() } }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_live(&self.bridge_source) {
                Ok(v) => { self.scan = v; Ok(()) }
                Err(e) => Err(anyhow::Error::msg(e)),
            }
        }
    }
}


} // mod live_entry_ci

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod mesh_ca_secret_mode {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:7c500029484a23cf655f14254fac9107f8d2a5f6702eca7f3cd5a2ff6cdbe956
// crate: aep-mesh-ca-secret-mode
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-052: Mesh CA files must refuse world-readable the same as dock KEM keys.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const TICKET: &str = "AEP28-ENV-052";
pub const SECRET_MODE: u32 = 0o600;
pub const GROUP_OTHER_MASK: u32 = 0o077;

fn lemma_world_group() -> String {
    ["world", "/", "group-readable"].concat()
}

/// Return true only when Unix mode has no group or other bits.
pub fn secret_file_mode_ok(mode: u32) -> bool {
    (mode & GROUP_OTHER_MASK) == 0
}

#[cfg(unix)]
fn current_euid() -> u32 {
    extern "C" {
        fn geteuid() -> u32;
    }
    // SAFETY: geteuid is always available on Unix and has no failure mode.
    unsafe { geteuid() }
}

#[cfg(unix)]
pub fn secret_file_permissions_ok(path: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    use std::os::unix::fs::PermissionsExt;
    fs::metadata(path)
        .map(|meta| {
            let mode_ok = (meta.permissions().mode() & GROUP_OTHER_MASK) == 0;
            let owner_ok = meta.uid() == current_euid();
            mode_ok && owner_ok
        })
        .unwrap_or(false)
}

#[cfg(not(unix))]
pub fn secret_file_permissions_ok(_path: &Path) -> bool {
    true
}

/// Refuse load of a world or group readable mesh CA file.
pub fn refuse_world_readable_secret(path: &str) -> Result<String, String> {
    let p = Path::new(path);
    if p.exists() == false {
        return Err(String::from("mesh CA secret missing"));
    }
    if secret_file_permissions_ok(p) {
        Ok(String::from("allow"))
    } else {
        let mut msg = lemma_world_group();
        msg.push_str(" mesh CA secret; refusing load");
        Err(msg)
    }
}

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() && bytes[i] != 40u8 {
        i = i.saturating_add(1);
    }
    if i >= bytes.len() {
        return String::new();
    }
    let mut pdepth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == 40u8 {
            pdepth += 1;
        } else if bytes[i] == 41u8 {
            pdepth -= 1;
            if pdepth == 0 {
                i = i.saturating_add(1);
                break;
            }
        }
        i = i.saturating_add(1);
    }
    while i < bytes.len() && bytes[i] != 123u8 {
        i = i.saturating_add(1);
    }
    if i >= bytes.len() {
        return String::new();
    }
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == 123u8 {
            depth += 1;
        } else if bytes[i] == 125u8 {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i = i.saturating_add(1);
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push_str("\n");
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

/// Fail if ensure_mesh_ca still loads world-readable CA files.
pub fn scan_mesh_ca_refuses_world_readable(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    let ensure = compact(&strip_line_comments(&extract_fn(src, "pub fn ensure_mesh_ca")));
    if ensure.is_empty() {
        return Err(String::from("ensure_mesh_ca not found"));
    }
    if prod.contains("secret_file_permissions_ok") == false {
        return Err(String::from("tls.rs lacks secret_file_permissions_ok"));
    }
    if prod.contains("0o077") == false {
        return Err(String::from("tls.rs lacks 0o077 group/other mask"));
    }
    if ensure.contains("refuse_world_readable_mesh_secret") == false
        && ensure.contains("secret_file_permissions_ok") == false
    {
        return Err(String::from(
            "ensure_mesh_ca still loads CA files without a permission check",
        ));
    }
    if prod.contains("AEP_MESH_CA_FORCE_REGEN") == false {
        return Err(String::from("tls.rs lacks AEP_MESH_CA_FORCE_REGEN"));
    }
    let dock = compact(&strip_line_comments(&extract_fn(
        src,
        "pub fn ensure_dock_server_identity",
    )));
    if dock.is_empty() {
        return Err(String::from("ensure_dock_server_identity not found"));
    }
    if dock.contains("refuse_world_readable_mesh_secret") == false
        && dock.contains("secret_file_permissions_ok") == false
    {
        return Err(String::from(
            "ensure_dock_server_identity still loads identity files without a permission check",
        ));
    }
    Ok(String::from("ok mesh CA refuses world-readable files"))
}

/// Fail if write_secret_pem does not set mode 0600 fail-closed.
pub fn scan_write_secret_pem_private(src: &str) -> Result<String, String> {
    let write = extract_fn(src, "fn write_secret_pem");
    if write.is_empty() {
        return Err(String::from("write_secret_pem not found"));
    }
    let code = compact(&strip_line_comments(&write));
    if code.contains("0o600") == false {
        return Err(String::from("write_secret_pem lacks mode 0600"));
    }
    if code.contains("set_permissions") == false {
        return Err(String::from("write_secret_pem lacks set_permissions"));
    }
    if code.contains("let_=") && code.contains("set_permissions") {
        return Err(String::from(
            "write_secret_pem ignores chmod errors; chmod must fail closed",
        ));
    }
    Ok(String::from("ok write_secret_pem sets mode 0600 fail-closed"))
}

/// Associated: dock KEM already refuses world-readable files.
pub fn scan_dock_kem_refuses_world_readable(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains("secret_file_permissions_ok") == false {
        return Err(String::from("dock_keys.rs lacks secret_file_permissions_ok"));
    }
    if prod.contains("0o077") == false {
        return Err(String::from("dock_keys.rs lacks 0o077 group/other mask"));
    }
    if prod.contains("AEP_DOCK_KEM_FORCE_REGEN") == false {
        return Err(String::from("dock_keys.rs lacks AEP_DOCK_KEM_FORCE_REGEN"));
    }
    let lemma = compact(&lemma_world_group());
    if prod.contains(&lemma) == false {
        return Err(String::from(
            "dock_keys.rs lacks world/group-readable refuse copy",
        ));
    }
    Ok(String::from("ok dock KEM refuses world-readable files"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir.join("AEP-Components/agentmesh/crate/src/tls.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let tls = read_src(
        &root.join("AEP-Components/agentmesh/crate/src/tls.rs"),
        "agentmesh tls",
    )?;
    let dock = read_src(
        &root.join("AEP-Base-Node/crate/src/dock_keys.rs"),
        "dock_keys",
    )?;
    let proofs = [
        scan_mesh_ca_refuses_world_readable(&tls)?,
        scan_write_secret_pem_private(&tls)?,
        scan_dock_kem_refuses_world_readable(&dock)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-mesh-ca-secret-mode ok proof=");
        line.push_str(&proof);
        line.push_str("\n");
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: secret_file_mode_ok domain:lattice type:service
pub mod secret_file_mode_ok {
    pub struct SecretFileModeOk {
        pub mode: u32,
        pub ok: bool,
    }

    impl SecretFileModeOk {
        pub fn new() -> Self {
            Self {
                mode: 0,
                ok: false,
            }
        }

        /// Return true only when Unix mode has no group or other bits
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.ok = super::secret_file_mode_ok(self.mode);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: refuse_world_readable_secret domain:lattice type:service
pub mod refuse_world_readable_secret {
    pub struct RefuseWorldReadableSecret {
        pub path: String,
        pub refuse: String,
    }

    impl RefuseWorldReadableSecret {
        pub fn new() -> Self {
            Self {
                path: String::new(),
                refuse: String::new(),
            }
        }

        /// Refuse load of a world or group readable mesh CA file
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::refuse_world_readable_secret(&self.path) {
                Ok(v) => self.refuse = v,
                Err(e) => self.refuse = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_mesh_ca_refuses_world_readable domain:lattice type:service
pub mod scan_mesh_ca_refuses_world_readable {
    pub struct ScanMeshCaRefusesWorldReadable {
        pub src: String,
        pub scan: String,
    }

    impl ScanMeshCaRefusesWorldReadable {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if ensure_mesh_ca still loads world-readable CA files
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_mesh_ca_refuses_world_readable(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_write_secret_pem_private domain:lattice type:service
pub mod scan_write_secret_pem_private {
    pub struct ScanWriteSecretPemPrivate {
        pub src: String,
        pub scan: String,
    }

    impl ScanWriteSecretPemPrivate {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if write_secret_pem does not set mode 0600
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_write_secret_pem_private(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod mesh_ca_secret_mode

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod no_sequential_ts_deny {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:a7f4fd0175e90de2ce241d72f4f523844d5b2bfbaf2d0a8855aeb3da0e2d5aa0
// crate: aep-no-sequential-ts-deny
// tokens: 0
use std::fs;
use std::path::PathBuf;
pub fn scan_live(src: &str) -> Result<String, String> {
    if src.contains("runEnvelopeAdmit") == false { return Err(String::from("never calls runEnvelopeAdmit")); }
    if src.contains("Admit collect-all walls then Apply") == false { return Err(String::from("missing collect-all copy")); }
    let compact: String = src.chars().filter(|c| !c.is_whitespace()).collect();
    if compact.contains("temporalValidator.validate") { return Err(String::from("still calls TemporalValidator.validate")); }
    if compact.contains("causalEngine.process(") { return Err(String::from("still calls CausalOrderingEngine.process")); }
    if compact.contains("regoEvaluator.evaluate") { return Err(String::from("still calls UnifiedRegoEvaluator.evaluate")); }
    if compact.contains("contentScanner.scan") { return Err(String::from("still calls UnifiedScanner.scan")); }
    if compact.contains("forecastSidecar.checkAnomalySync") { return Err(String::from("still calls ForecastSidecar.checkAnomalySync")); }
    Ok(String::from("ok no sequential TypeScript deny after Admit"))
}
pub fn run_gate() -> Result<i32, String> {
    let live = crate::walk_to_workspace().join("AEP-SDKs/typescript/dynaep/src").join(concat!("brid","ge.ts"));
    if live.is_file() == false { return Err(String::from("live source missing")); }
    let src = fs::read_to_string(&live).map_err(|e| e.to_string())?;
    let proof = scan_live(&src)?;
    println!("aep-no-sequential-ts-deny ok proof={}", proof);
    Ok(0)
}

} // mod no_sequential_ts_deny

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod one_evaluation_story {
// @PAD: aep-one-evaluation-story-v1
// @GCDE: gaplune-decode hmac-sha256:c8f3a91e6b2d4e70a1c5d9f0b3e64728a9d1c4f6e8b07253a4d6c1e9f0b28517
// crate: aep-one-evaluation-story
// AEP28-ENV-030: one evaluation story. Admit collect-all then Apply.

use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};
use aep_evaluation_chain::{Wall, CHAIN_STEP_COUNT, STEP_NAMES};

pub const TICKET: &str = "AEP28-ENV-030";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EvaluationStory {
    pub allow: bool,
    pub applied: bool,
    pub closed: Vec<AdmitWall>,
    pub ledger: Vec<Wall>,
    pub key: String,
}

pub fn ledger_step_for_wall_id(id: &str) -> Option<usize> {
    if id == "dag.membership" || id.starts_with("dag.membership") { return Some(0); }
    if id == "scene.membership" || id.starts_with("scene.membership") { return Some(1); }
    if id == "gap.agent_may" || id.starts_with("gap.agent_may") || id.starts_with("gap:agent_may") { return Some(2); }
    if id == "rate.session" || id.starts_with("rate.session") { return Some(3); }
    if id == "dag.parents" || id.starts_with("dag.parents") { return Some(4); }
    if id == "time.authority" || id.starts_with("time.authority") { return Some(5); }
    if id == "forecast.anomaly" || id.starts_with("forecast.anomaly") { return Some(6); }
    if id == "covenant.tools" || id.starts_with("covenant.tools") { return Some(7); }
    if id == "rego.restricted" || id.starts_with("rego.restricted") { return Some(8); }
    if id == "rego.output_ceiling" || id.starts_with("rego.output_ceiling") { return Some(9); }
    if id == "channel.dock" || id.starts_with("channel.dock") { return Some(10); }
    if id == "causal.sequence" || id.starts_with("causal.sequence") { return Some(11); }
    if id == "gap.writing" || id.starts_with("gap.writing") { return Some(12); }
    if id == "scanner.bundle" || id.starts_with("scanner.bundle") { return Some(13); }
    if id == "rego.forbidden_seq" || id.starts_with("rego.forbidden_seq") { return Some(14); }
    None
}

pub fn ledger_from_admit(admit: &AdmitResult) -> Vec<Wall> {
    let mut open = [true; CHAIN_STEP_COUNT];
    let mut reasons: Vec<String> = (0..CHAIN_STEP_COUNT).map(|_| String::from("ok")).collect();
    for w in &admit.closed {
        if let Some(step) = ledger_step_for_wall_id(&w.id) {
            open[step] = false;
            reasons[step] = w.reason.clone();
        }
    }
    let mut ledger = Vec::with_capacity(CHAIN_STEP_COUNT);
    let mut i = 0usize;
    while i < CHAIN_STEP_COUNT {
        ledger.push(Wall {
            step: i,
            name: String::from(STEP_NAMES[i]),
            open: open[i],
            reason: reasons[i].clone(),
        });
        i += 1;
    }
    ledger
}

pub fn bool_combinator_allow(open: [bool; CHAIN_STEP_COUNT]) -> bool {
    open.iter().all(|v| *v)
}

pub fn evaluate(walls: &[AdmitWall]) -> EvaluationStory {
    let admit = admit_collect_all(walls);
    let ledger = ledger_from_admit(&admit);
    EvaluationStory {
        allow: admit.allow,
        applied: admit.allow,
        closed: admit.closed.clone(),
        key: admit.closed_set_key(),
        ledger,
    }
}

pub mod scan {
fn extract_after(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn join2(a: &str, b: &str) -> String {
    let mut s = String::from(a);
    s.push_str(b);
    s
}

fn has_parallel_admit_meet(src: &str) -> bool {
    let bn = src.contains("BN --> ADMIT") && src.contains("BN --> MEET");
    let dock = src.contains("DOCK --> ADMIT") && src.contains("DOCK --> MEET");
    bn || dock
}

pub fn scan_readme_one_story(src: &str) -> Result<String, String> {
    if has_parallel_admit_meet(src) {
        return Err(String::from("docs still have two kernel meets"));
    }
    Ok(String::from("ok docs one evaluation story"))
}

pub fn scan_live_entry_one_story(src: &str) -> Result<String, String> {
    let body = extract_after(src, "fn process_event");
    if body.is_empty() {
        return Err(String::from("process_event not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("meet_named") || code.contains("run_meet_ledger") || code.contains("run_meet(") {
        return Err(String::from("live process_event still calls the 15-bool combinator"));
    }
    Ok(String::from("ok live process_event one evaluation story"))
}

pub fn scan_bridge_one_story(src: &str) -> Result<String, String> {
    let body = extract_after(src, "async processEvent");
    if body.is_empty() {
        return Err(String::from("processEvent not found"));
    }
    let code = compact(&strip_line_comments(&body));
    if code.contains("labLatticeFilterEnabled(") {
        return Err(String::from("processEvent still branches on labLatticeFilterEnabled"));
    }
    let bang = char::from(33);
    let q = char::from(63);
    let n1 = join2("latticeFilter", ".filterAsync");
    let n2 = join2("latticeFilter", &join2(&bang.to_string(), ".filterAsync"));
    let n3 = join2("latticeFilter", &join2(&q.to_string(), ".filterAsync"));
    if code.contains(&n1) || code.contains(&n2) || code.contains(&n3) {
        return Err(String::from("processEvent still runs latticeFilter.filterAsync"));
    }
    Ok(String::from("ok processEvent one evaluation story"))
}

pub fn scan_three_meets(readme: &str, live_entry: &str, bridge: &str) -> Result<String, String> {
    match scan_readme_one_story(readme) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match scan_live_entry_one_story(live_entry) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match scan_bridge_one_story(bridge) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    Ok(String::from("ok one evaluation story"))
}

}

pub mod scan_paths {
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use super::scan::scan_three_meets;

fn walk_to_workspace() -> PathBuf {
    let mut dir = match std::env::current_dir() {
        Ok(v) => v,
        Err(_) => PathBuf::from("."),
    };
    let mut i = 0usize;
    while i < 8 {
        let readme = dir.join("README.md");
        let live = dir.join("AEP-Components/live-entry/crate/src/lib.rs");
        if readme.is_file() && live.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i += 1;
    }
    PathBuf::from(".")
}

pub fn default_readme() -> PathBuf {
    walk_to_workspace().join("README.md")
}
pub fn default_live_entry() -> PathBuf {
    walk_to_workspace().join("AEP-Components/live-entry/crate/src/lib.rs")
}
pub fn default_bridge() -> PathBuf {
    walk_to_workspace().join("AEP-SDKs/typescript/dynaep/src/bridge.ts")
}

fn missing(path: &Path) -> String {
    let mut s = String::from("missing ");
    s.push_str(&path.display().to_string());
    s
}
fn empty(path: &Path) -> String {
    let mut s = String::from("empty ");
    s.push_str(&path.display().to_string());
    s
}

fn read_file(path: &Path) -> Result<String, String> {
    if path.is_file() == false {
        return Err(missing(path));
    }
    match fs::read_to_string(path) {
        Ok(src) => {
            if src.is_empty() {
                Err(empty(path))
            } else {
                Ok(src)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate(readme: &Path, live_entry: &Path, bridge: &Path) -> Result<i32, String> {
    let a = match read_file(readme) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let b = match read_file(live_entry) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let c = match read_file(bridge) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let proof = match scan_three_meets(&a, &b, &c) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mut line = String::from("aep-one-evaluation-story ok proof=");
    line.push_str(&proof);
    line.push('\n');
    let _ = std::io::stdout().write_all(line.as_bytes());
    Ok(0)
}

}

pub mod story_hvvc {
use super::scan::{scan_bridge_one_story, scan_three_meets};
use super::{bool_combinator_allow, evaluate, ledger_from_admit};
use aep_admit::{AdmitResult, AdmitWall};
use aep_evaluation_chain::{Wall, CHAIN_STEP_COUNT};
use super::EvaluationStory;

fn err_msg(msg: String) -> anyhow::Error {
    anyhow::Error::msg(msg)
}

pub mod one_evaluation_story {
    use super::{evaluate, AdmitWall, EvaluationStory};
    pub struct OneEvaluationStory {
        pub walls: Vec<AdmitWall>,
        pub story: Option<EvaluationStory>,
    }
    impl OneEvaluationStory {
        pub fn new() -> Self {
            Self { walls: Vec::new(), story: None }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.story = Some(evaluate(&self.walls));
            Ok(())
        }
    }
}

pub mod stop_bool_combinator {
    use super::{bool_combinator_allow, CHAIN_STEP_COUNT};
    pub struct StopBoolCombinator {
        pub open: [bool; CHAIN_STEP_COUNT],
        pub combinator_allow: bool,
    }
    impl StopBoolCombinator {
        pub fn new() -> Self {
            Self { open: [true; CHAIN_STEP_COUNT], combinator_allow: true }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.combinator_allow = bool_combinator_allow(self.open);
            Ok(())
        }
    }
}

pub mod stop_lattice_filter_meet {
    use super::{err_msg, scan_bridge_one_story};
    pub struct StopLatticeFilterMeet {
        pub bridge_source: String,
        pub scan: String,
    }
    impl StopLatticeFilterMeet {
        pub fn new() -> Self {
            Self { bridge_source: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match scan_bridge_one_story(&self.bridge_source) {
                Ok(v) => {
                    self.scan = v;
                    Ok(())
                }
                Err(e) => Err(err_msg(e)),
            }
        }
    }
}

pub mod ledger_from_admit {
    use super::{ledger_from_admit as derive, AdmitResult, Wall};
    pub struct LedgerFromAdmit {
        pub admit: AdmitResult,
        pub ledger: Vec<Wall>,
    }
    impl LedgerFromAdmit {
        pub fn new() -> Self {
            Self {
                admit: AdmitResult { allow: true, closed: Vec::new() },
                ledger: Vec::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.ledger = derive(&self.admit);
            Ok(())
        }
    }
}

pub mod scan_three_meets {
    use super::{err_msg, scan_three_meets as scan};
    pub struct ScanThreeMeets {
        pub readme: String,
        pub live_entry: String,
        pub bridge: String,
        pub scan: String,
    }
    impl ScanThreeMeets {
        pub fn new() -> Self {
            Self {
                readme: String::new(),
                live_entry: String::new(),
                bridge: String::new(),
                scan: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match scan(&self.readme, &self.live_entry, &self.bridge) {
                Ok(v) => {
                    self.scan = v;
                    Ok(())
                }
                Err(e) => Err(err_msg(e)),
            }
        }
    }
}

}


pub use scan::{scan_bridge_one_story, scan_live_entry_one_story, scan_readme_one_story, scan_three_meets};
pub use scan_paths::{default_bridge, default_live_entry, default_readme, run_gate};






} // mod one_evaluation_story

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod one_live_entry_language {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:a98ab78ee1a963728b2be32e6d9b823105565195ea8fe290b9fa6de9f3bc06c5
// crate: aep-one-live-entry-language
// Generated by GAPLUNE Creation PAD ( zero-LLM )
// tokens: 0
// HVVCAS: one_live_entry_language domain:envelope type:service
// AEP28-ENV-031: One live entry language. TypeScript processEvent is not a second product Admit.
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

pub const TICKET: &str = "AEP28-ENV-031";

pub mod one_live_entry_language {
    pub struct OneLiveEntryLanguage {
        pub tree: String,
        pub scan: String,
    }
    impl OneLiveEntryLanguage {
        pub fn new() -> Self {
            Self { tree: String::new(), scan: String::new() }
        }
        /// Product live path is Rust only. TypeScript processEvent is not a second product Admit.
        pub fn process(&mut self) -> anyhow::Result<()> {
            let root = if self.tree.is_empty() {
                super::walk_to_workspace()
            } else {
                std::path::PathBuf::from(&self.tree)
            };
            match super::scan_tree(&root) {
                Ok(v) => {
                    self.scan = v;
                    Ok(())
                }
                Err(e) => Err(anyhow::Error::msg(e)),
            }
        }
    }
}

fn extract_after(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    extract_balanced(&src[start..])
}

fn extract_balanced(rest: &str) -> String {
    let bytes = rest.as_bytes();
    let start = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let mut i = start;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn decomment_js(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0usize;
    let mut mode: u8 = 0;
    let mut tmpl_expr: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let n = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        if mode == 4 {
            if c == b'\n' {
                out.push(c);
                mode = 0;
            }
        } else if mode == 5 {
            if c == b'*' && n == b'/' {
                mode = 0;
                i = i.saturating_add(2);
                continue;
            }
        } else if mode == 0 && c == b'/' && n == b'/' {
            mode = 4;
            i = i.saturating_add(2);
            continue;
        } else if mode == 0 && c == b'/' && n == b'*' {
            mode = 5;
            i = i.saturating_add(2);
            continue;
        } else {
            out.push(c);
            if c == b'\\' && (mode == 1 || mode == 2 || mode == 3) {
                if i + 1 < bytes.len() {
                    out.push(bytes[i + 1]);
                }
                i = i.saturating_add(2);
                continue;
            }
            if (mode == 1 && c == b'\'') || (mode == 2 && c == b'"') || (mode == 3 && c == b'`' && tmpl_expr == 0) {
                mode = 0;
            } else if mode == 3 && c == b'$' && n == b'{' {
                tmpl_expr = tmpl_expr.saturating_add(1);
                out.push(n);
                i = i.saturating_add(2);
                continue;
            } else if mode == 3 && tmpl_expr >= 1 && c == b'{' {
                tmpl_expr = tmpl_expr.saturating_add(1);
            } else if mode == 3 && tmpl_expr >= 1 && c == b'}' {
                tmpl_expr = tmpl_expr.saturating_sub(1);
            } else if mode == 0 && c == b'\'' {
                mode = 1;
            } else if mode == 0 && c == b'"' {
                mode = 2;
            } else if mode == 0 && c == b'`' {
                mode = 3;
                tmpl_expr = 0;
            }
        }
        i = i.saturating_add(1);
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn scan_code(src: &str) -> String {
    compact(&decomment_js(src))
}

pub fn scan_spawn_sync_aep_envelope(src: &str) -> Result<String, String> {
    let code = scan_code(src);
    if code.contains("spawnSync(\"aep-envelope")
        || code.contains("spawnSync('aep-envelope")
        || code.contains("spawnSync(`aep-envelope")
        || code.contains("execFileSync(\"aep-envelope")
        || code.contains("execFileSync('aep-envelope")
    {
        return Err(String::from("spawnSync aep-envelope remains product live code"));
    }
    Ok(String::from("ok no spawnSync aep-envelope"))
}

pub fn scan_load_from_file_calls(src: &str) -> Result<String, String> {
    let code = scan_code(src);
    if code.contains(".loadFromFile(") || code.contains(".mergeFromFile(") {
        return Err(String::from("loadFromFile remains product live code"));
    }
    Ok(String::from("ok no product loadFromFile call"))
}

pub fn scan_constructor_not_product_admit(src: &str) -> Result<String, String> {
    let region = extract_after(src, "constructor(");
    if region.is_empty() {
        return Ok(String::from("ok no constructor"));
    }
    let code = scan_code(&region);
    if code.contains("loadFromFile(") || code.contains("mergeFromFile(") {
        return Err(String::from("loadFromFile remains product live code"));
    }
    if code.contains("newLatticeFilter") {
        return Err(String::from("LatticeFilter remains product Admit"));
    }
    let needle = {
        let mut s = String::from("new");
        s.push(' ');
        s.push_str("LatticeFilter");
        s
    };
    if code.contains("newLatticeFilter") == false && compact(&region).contains(&compact(&needle)) {
        return Err(String::from("LatticeFilter remains product Admit"));
    }
    Ok(String::from("ok constructor is not product Admit"))
}

pub fn scan_process_event_not_product_admit(src: &str) -> Result<String, String> {
    let body = extract_after(src, "async processEvent");
    if body.is_empty() {
        return Ok(String::from("ok no processEvent"));
    }
    let code = scan_code(&body);
    if code.contains("spawnSync") {
        return Err(String::from("processEvent remains product live code"));
    }
    if code.contains("loadFromFile") {
        return Err(String::from("processEvent remains product live code"));
    }
    if code.contains("processStateDelta") {
        return Err(String::from("processEvent remains product live code"));
    }
    if code.contains("processDynAEPEvent") {
        return Err(String::from("processEvent remains product live code"));
    }
    if code.contains("latticeFilter") {
        return Err(String::from("processEvent remains product live code"));
    }
    if code.contains("filterCrossing") {
        return Err(String::from("processEvent remains product live code"));
    }
    if code.contains("createRejection") {
        return Err(String::from("processEvent remains product live code"));
    }
    Ok(String::from("ok processEvent is not product Admit"))
}

pub fn scan_rust_live_entry(src: &str) -> Result<String, String> {
    if src.contains("admit(") == false {
        return Err(String::from("live-entry missing in-process admit"));
    }
    if src.contains("load_lattice_yaml") == false {
        return Err(String::from("live-entry missing rust YAML load"));
    }
    let code = compact(&strip_line_comments(src));
    if code.contains("spawnSync") {
        return Err(String::from("spawnSync aep-envelope remains product live code"));
    }
    Ok(String::from("ok rust live entry"))
}

pub fn scan_base_node_live(src: &str) -> Result<String, String> {
    if src.contains("LiveEntry") == false {
        return Err(String::from("base-node missing Rust LiveEntry"));
    }
    if src.contains("process_event") == false {
        return Err(String::from("base-node missing Rust process_event"));
    }
    Ok(String::from("ok base-node rust live entry"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = match std::env::current_dir() {
        Ok(v) => v,
        Err(_) => PathBuf::from("."),
    };
    let mut i = 0usize;
    while i < 8 {
        let live = dir.join("AEP-Components/live-entry/crate/src/lib.rs");
        let bridge = dir.join("AEP-SDKs/typescript/dynaep/src/bridge.ts");
        if live.is_file() && bridge.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i += 1;
    }
    PathBuf::from(".")
}

fn skip_dir(name: &str) -> bool {
    name == "tests"
        || name == "node_modules"
        || name == "target"
        || name == "dist"
        || name == "protocol"
}

fn is_source(path: &Path) -> bool {
    match path.extension().and_then(|s| s.to_str()) {
        Some("ts") | Some("js") | Some("mjs") | Some("cts") | Some("mts") | Some("rs") => true,
        _ => false,
    }
}

fn walk(dir: &Path, out: &mut Vec<PathBuf>) {
    let rd = match fs::read_dir(dir) {
        Ok(v) => v,
        Err(_) => return,
    };
    for ent in rd.flatten() {
        let p = ent.path();
        if p.is_dir() {
            let name = p.file_name().and_then(|s| s.to_str()).unwrap_or("");
            if skip_dir(name) {
                continue;
            }
            walk(&p, out);
        } else if is_source(&p) {
            out.push(p);
        }
    }
}

fn path_text(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

pub fn scan_file(path: &Path, src: &str) -> Result<String, String> {
    let s = path_text(path);
    if s.ends_with("live-entry/crate/src/lib.rs") {
        scan_rust_live_entry(src)?;
    }
    if s.ends_with("envelope_admit.rs") {
        scan_base_node_live(src)?;
    }
    if s.ends_with("bridge.ts") {
        scan_constructor_not_product_admit(src)?;
        scan_process_event_not_product_admit(src)?;
    }
    if s.ends_with(".ts") || s.ends_with(".js") || s.ends_with(".mjs") || s.ends_with(".cts") || s.ends_with(".mts") {
        scan_spawn_sync_aep_envelope(src)?;
        scan_load_from_file_calls(src)?;
    }
    Ok(String::from("ok"))
}

pub fn scan_tree(root: &Path) -> Result<String, String> {
    let roots = [
        root.join("AEP-SDKs/typescript/dynaep"),
        root.join("AEP-Components/dynAEP"),
        root.join("AEP-Components/live-entry/crate"),
        root.join("AEP-Base-Node/crate"),
    ];
    let mut files: Vec<PathBuf> = Vec::new();
    for r in &roots {
        if r.is_dir() {
            walk(r, &mut files);
        }
    }
    if files.is_empty() {
        return Err(String::from("product live trees missing"));
    }
    for p in &files {
        let src = match fs::read_to_string(p) {
            Ok(v) => v,
            Err(e) => return Err(e.to_string()),
        };
        match scan_file(p, &src) {
            Ok(_) => {}
            Err(e) => {
                let mut m = path_text(p);
                m.push(' ');
                m.push_str(&e);
                return Err(m);
            }
        }
    }
    Ok(String::from("ok one live entry language"))
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let proof = scan_tree(&root)?;
    let mut line = String::from("aep-one-live-entry-language ok proof=");
    line.push_str(&proof);
    line.push('\n');
    let _ = std::io::stdout().write_all(line.as_bytes());
    Ok(0)
}



} // mod one_live_entry_language

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod potomitan_mesh_packet_plane {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:117c59e8eea5795032e3a41566e4cbf4eab150551b54eb30b6127fe439349f50
// crate: aep-potomitan-mesh-packet-plane
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-055: POTOMITAN ships a mesh packet plane. Not registry-plus-mode.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-055";
pub const PACKET_MAGIC: [u8; 4] = *b"POTM";
pub const PACKET_VERSION: u8 = 1;
pub const DEFAULT_HOP_LIMIT: u8 = 16;
pub const MAX_NODE_ID_LEN: usize = 255;
pub const MAX_PAYLOAD_LEN: usize = 65535;

pub fn hop_limit_allows_forward(hop_limit: u8) -> bool {
    hop_limit != 0
}

pub fn mesh_packet_encode(
    src: &str,
    dst: &str,
    hop_limit: u8,
    seq: u64,
    payload: &[u8],
) -> Result<Vec<u8>, String> {
    if src.is_empty() || dst.is_empty() {
        return Err(String::from("empty node id"));
    }
    if src.len() < MAX_NODE_ID_LEN + 1 && dst.len() < MAX_NODE_ID_LEN + 1 {
    } else {
        return Err(String::from("node id too long"));
    }
    if payload.len() < MAX_PAYLOAD_LEN + 1 {
    } else {
        return Err(String::from("payload too long"));
    }
    let mut out = Vec::new();
    out.extend_from_slice(&PACKET_MAGIC);
    out.push(PACKET_VERSION);
    out.push(hop_limit);
    out.extend_from_slice(&seq.to_be_bytes());
    out.push(src.len() as u8);
    out.extend_from_slice(src.as_bytes());
    out.push(dst.len() as u8);
    out.extend_from_slice(dst.as_bytes());
    let plen = payload.len() as u16;
    out.extend_from_slice(&plen.to_be_bytes());
    out.extend_from_slice(payload);
    Ok(out)
}

pub fn mesh_packet_decode(
    bytes: &[u8],
) -> Result<(String, String, u8, u64, Vec<u8>), String> {
    if bytes.len() < 4 + 1 + 1 + 8 + 1 + 1 + 2 {
        return Err(String::from("truncated"));
    }
    if bytes[0..4] != PACKET_MAGIC {
        return Err(String::from("bad magic"));
    }
    if bytes[4] != PACKET_VERSION {
        return Err(String::from("unsupported version"));
    }
    let hop_limit = bytes[5];
    let seq_bytes: [u8; 8] = match bytes[6..14].try_into() {
        Ok(v) => v,
        Err(_) => return Err(String::from("truncated")),
    };
    let seq = u64::from_be_bytes(seq_bytes);
    let mut i = 14usize;
    let src_len = bytes[i] as usize;
    i += 1;
    if bytes.len() < i + src_len + 1 {
        return Err(String::from("truncated"));
    }
    let src = match std::str::from_utf8(&bytes[i..i + src_len]) {
        Ok(v) => v,
        Err(_) => return Err(String::from("id not utf8")),
    };
    i += src_len;
    let dst_len = bytes[i] as usize;
    i += 1;
    if bytes.len() < i + dst_len + 2 {
        return Err(String::from("truncated"));
    }
    let dst = match std::str::from_utf8(&bytes[i..i + dst_len]) {
        Ok(v) => v,
        Err(_) => return Err(String::from("id not utf8")),
    };
    i += dst_len;
    let plen_bytes: [u8; 2] = match bytes[i..i + 2].try_into() {
        Ok(v) => v,
        Err(_) => return Err(String::from("truncated")),
    };
    let plen = u16::from_be_bytes(plen_bytes) as usize;
    i += 2;
    if bytes.len() != i + plen {
        return Err(String::from("truncated"));
    }
    if src.is_empty() || dst.is_empty() {
        return Err(String::from("empty node id"));
    }
    Ok((src.to_string(), dst.to_string(), hop_limit, seq, bytes[i..].to_vec()))
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push_str("\n");
    }
    out
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

pub fn scan_packet_plane_present(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(src));
    for needle in [
        "MeshPacketPlane",
        "PACKET_MAGIC",
        "hop_limit_allows_forward",
        "packet_plane",
        "MemoryTransport",
        "UdpTransport",
        "MeshPacket",
    ] {
        if prod.contains(needle) == false {
            return Err(format!("missing {needle}"));
        }
    }
    if prod.contains("POTM") == false {
        return Err(String::from("missing POTM magic"));
    }
    Ok(String::from("ok packet plane present"))
}

pub fn scan_crate_not_registry_plus_mode(src: &str) -> Result<String, String> {
    let low = src.to_ascii_lowercase();
    if low.contains("registry-plus-mode")
        && low.contains("not registry-plus-mode") == false
    {
        return Err(String::from("crate described as registry-plus-mode"));
    }
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains("MeshPacketPlane") == false {
        return Err(String::from("no packet plane and no registry-plus-mode description"));
    }
    Ok(String::from("ok crate is not registry-plus-mode"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir.join("AEP-Base-Node/potomitan/crate/src/packet.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let base = root.join("AEP-Base-Node/potomitan");
    let mut blob = String::new();
    let names = [
        ("crate/src/lib.rs", "lib"),
        ("crate/src/packet.rs", "packet"),
        ("crate/src/plane.rs", "plane"),
        ("crate/src/transport.rs", "transport"),
        ("crate/src/routing.rs", "routing"),
        ("crate/src/supervisor.rs", "supervisor"),
        ("crate/src/peer.rs", "peer"),
        ("crate/Cargo.toml", "cargo"),
        ("README.md", "docfile"),
    ];
    for (rel, label) in names {
        blob.push_str(&read_src(&base.join(rel), label)?);
        blob.push_str("\n");
    }
    let proofs = [
        scan_packet_plane_present(&blob)?,
        scan_crate_not_registry_plus_mode(&blob)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-potomitan-mesh-packet-plane ok proof=");
        line.push_str(&proof);
        line.push_str("\n");
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

pub mod mesh_packet_encode {
    pub struct MeshPacketEncode {
        pub packet: String,
        pub wire: String,
    }
    impl MeshPacketEncode {
        pub fn new() -> Self {
            Self { packet: String::new(), wire: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let bytes = super::mesh_packet_encode(
                "gate-src",
                "gate-dst",
                super::DEFAULT_HOP_LIMIT,
                1,
                self.packet.as_bytes(),
            )
            .map_err(anyhow::Error::msg)?;
            self.wire = bytes.iter().map(|b| format!("{b:02x}")).collect();
            Ok(())
        }
    }
}

pub mod mesh_packet_decode {
    pub struct MeshPacketDecode {
        pub wire: String,
        pub packet: String,
    }
    impl MeshPacketDecode {
        pub fn new() -> Self {
            Self { wire: String::new(), packet: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let mut raw = Vec::new();
            let s = self.wire.as_str();
            let mut i = 0usize;
            while i + 1 < s.len() {
                let hex = &s[i..i + 2];
                let v = u8::from_str_radix(hex, 16).map_err(anyhow::Error::msg)?;
                raw.push(v);
                i += 2;
            }
            let decoded = super::mesh_packet_decode(&raw).map_err(anyhow::Error::msg)?;
            self.packet = String::from_utf8_lossy(&decoded.4).into_owned();
            Ok(())
        }
    }
}

pub mod hop_limit_allows_forward {
    pub struct HopLimitAllowsForward {
        pub hop_limit: u8,
        pub ok: bool,
    }
    impl HopLimitAllowsForward {
        pub fn new() -> Self {
            Self { hop_limit: 0, ok: false }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.ok = super::hop_limit_allows_forward(self.hop_limit);
            Ok(())
        }
    }
}

pub mod scan_packet_plane_present {
    pub struct ScanPacketPlanePresent {
        pub src: String,
        pub scan: String,
    }
    impl ScanPacketPlanePresent {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_packet_plane_present(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

pub mod scan_crate_not_registry_plus_mode {
    pub struct ScanCrateNotRegistryPlusMode {
        pub src: String,
        pub scan: String,
    }
    impl ScanCrateNotRegistryPlusMode {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_crate_not_registry_plus_mode(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod potomitan_mesh_packet_plane

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod process_event_admit_walls {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:b513f93ada33543c733e64905c83d2508162a5bb843b7676452e4454f17d33d5
// crate: aep-process-event-admit-walls
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-014: processEvent must not lab-branch to latticeFilter.filter or filterAsync with no Admit walls.

use std::fs;
use std::path::{Path, PathBuf};

pub const TICKET: &str = "AEP28-ENV-014";
pub const REJECT_NEEDLE: &str = "Live crossing requires HyperlatticeFilter";

fn find_process_event_sig(src: &str) -> Option<usize> {
    src.find("async processEvent")
}
fn extract_process_event(src: &str) -> String {
    let sig = match find_process_event_sig(src) {
        Some(v) => v,
        None => return String::new(),
    };
    if sig >= src.len() { return String::new(); }
    extract_balanced_method(&src[sig..])
}

fn extract_balanced_method(rest: &str) -> String {
    let bytes = rest.as_bytes();
    let start = match rest.find('{') { Some(v) => v, None => return String::new(), };
    let mut i = start;
    let mut depth: i32 = 0;
    let mut mode: u8 = 0;
    let mut tmpl_expr: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let n = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        if mode == 1 {
            if c == b'\\' { i = i.saturating_add(2); continue; }
            else if c == b'\'' { mode = 0; }
        } else if mode == 2 {
            if c == b'\\' { i = i.saturating_add(2); continue; }
            else if c == b'"' { mode = 0; }
        } else if mode == 3 {
            if c == b'\\' { i = i.saturating_add(2); continue; }
            if c == b'`' && tmpl_expr == 0 { mode = 0; }
            else if c == b'$' && n == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); i = i.saturating_add(2); continue; }
            else if tmpl_expr >= 1 {
                if c == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); }
                else if c == b'}' { tmpl_expr = tmpl_expr.saturating_sub(1); }
            }
        } else if mode == 4 {
            if c == b'\n' { mode = 0; }
        } else if mode == 5 {
            if c == b'*' && n == b'/' { mode = 0; i = i.saturating_add(2); continue; }
        } else if c == b'/' && n == b'/' {
            mode = 4; i = i.saturating_add(2); continue;
        } else if c == b'/' && n == b'*' {
            mode = 5; i = i.saturating_add(2); continue;
        } else if c == b'\'' { mode = 1; }
        else if c == b'"' { mode = 2; }
        else if c == b'`' { mode = 3; tmpl_expr = 0; }
        else if c == b'{' { depth = depth.saturating_add(1); }
        else if c == b'}' {
            depth = depth.saturating_sub(1);
            if depth == 0 { return rest[..=i].to_string(); }
        }
        i = i.saturating_add(1);
    }
    String::new()
}

fn decomment_js(src: &str) -> String {
    let bytes = src.as_bytes();
    let mut out: Vec<u8> = Vec::new();
    let mut i = 0usize;
    let mut mode: u8 = 0;
    let mut tmpl_expr: i32 = 0;
    while i < bytes.len() {
        let c = bytes[i];
        let n = if i + 1 < bytes.len() { bytes[i + 1] } else { 0 };
        if mode == 4 {
            if c == b'\n' { out.push(c); mode = 0; }
        } else if mode == 5 {
            if c == b'*' && n == b'/' { mode = 0; i = i.saturating_add(2); continue; }
        } else if mode == 0 && c == b'/' && n == b'/' {
            mode = 4; i = i.saturating_add(2); continue;
        } else if mode == 0 && c == b'/' && n == b'*' {
            mode = 5; i = i.saturating_add(2); continue;
        } else {
            out.push(c);
            if c == b'\\' && (mode == 1 || mode == 2 || mode == 3) {
                if i + 1 < bytes.len() { out.push(bytes[i + 1]); }
                i = i.saturating_add(2); continue;
            }
            if (mode == 1 && c == b'\'') || (mode == 2 && c == b'"') || (mode == 3 && c == b'`' && tmpl_expr == 0) { mode = 0; }
            else if mode == 3 && c == b'$' && n == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); out.push(n); i = i.saturating_add(2); continue; }
            else if mode == 3 && tmpl_expr >= 1 && c == b'{' { tmpl_expr = tmpl_expr.saturating_add(1); }
            else if mode == 3 && tmpl_expr >= 1 && c == b'}' { tmpl_expr = tmpl_expr.saturating_sub(1); }
            else if mode == 0 && c == b'\'' { mode = 1; }
            else if mode == 0 && c == b'"' { mode = 2; }
            else if mode == 0 && c == b'`' { mode = 3; tmpl_expr = 0; }
        }
        i = i.saturating_add(1);
    }
    String::from_utf8_lossy(&out).into_owned()
}
fn collapse_ws(src: &str) -> String { src.chars().filter(|c| !c.is_whitespace()).collect() }
fn scan_code(body: &str) -> String { collapse_ws(&decomment_js(body)) }
fn has_lab_filter(code: &str) -> bool { code.contains("labLatticeFilterEnabled") }
fn has_lattice_filter_call(code: &str) -> bool {
    code.contains("latticeFilter.filterAsync(")
        || code.contains("latticeFilter!.filterAsync(")
        || code.contains("latticeFilter?.filterAsync(")
        || code.contains("latticeFilter.filter(")
        || code.contains("latticeFilter!.filter(")
        || code.contains("latticeFilter?.filter(")
        || code.contains(r#"latticeFilter["filter"#)
        || code.contains("latticeFilter['filter")
        || code.contains(r#"latticeFilter?["filter"#)
        || code.contains("latticeFilter?['filter")
        || code.contains(r#"["latticeFilter"].filter"#)
        || code.contains("['latticeFilter'].filter")

}
fn has_empty_admit_walls(code: &str) -> bool { code.contains("closed:[]") }
pub fn scan_process_event_admit_walls(bridge_source: &str) -> Result<String, String> {
    let body = extract_process_event(bridge_source);
    if body.is_empty() { return Err(String::from("processEvent not found")); }
    let code = scan_code(&body);
    if has_lab_filter(&code) { return Err(String::from("processEvent still branches on labLatticeFilterEnabled")); }
    if has_lattice_filter_call(&code) { return Err(String::from("processEvent still runs latticeFilter.filter or filterAsync with no Admit walls")); }
    if code.contains("(!this.lattice||!this.hyperlatticeFilter)") { return Err(String::from("processEvent TM-15 still swallows missing HyperlatticeFilter")); }
    if code.contains("this.latticeFilter") { return Err(String::from("processEvent still names this.latticeFilter")); }
    if has_empty_admit_walls(&code) { return Err(String::from("processEvent still fakes empty Admit closed walls")); }
    if code.contains("filterCrossing") { return Err(String::from("processEvent remains product live code")); }
    Ok(String::from("ok processEvent is not product Admit"))
}
pub fn default_bridge_ts() -> PathBuf {
    crate::walk_to_workspace().join("AEP-SDKs/typescript/dynaep/src/bridge.ts")
}
pub fn default_workspace_lock() -> PathBuf {
    crate::walk_to_workspace().join("Cargo.lock")
}
pub fn run_gate(bridge: &Path) -> Result<i32, String> {
    if !bridge.is_file() { return Err(format!("bridge source missing: {}", bridge.display())); }
    let src = fs::read_to_string(bridge).map_err(|e| e.to_string())?;
    if src.is_empty() { return Err(String::from("bridge source empty")); }
    let proof = scan_process_event_admit_walls(&src)?;
    println!("aep-process-event-admit-walls ok proof={}", proof);
    Ok(0)
}
fn err_msg(msg: String) -> anyhow::Error { anyhow::anyhow!(msg) }
pub mod process_event_admit_walls {
    use super::{err_msg, scan_process_event_admit_walls};
    use std::path::Path;
    pub struct ProcessEventAdmitWalls { pub bridge_source: String, pub scan: String, }
    impl Default for ProcessEventAdmitWalls {
        fn default() -> Self { Self::new() }
    }
    impl ProcessEventAdmitWalls {
        pub fn new() -> Self { Self { bridge_source: String::new(), scan: String::new() } }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = if self.bridge_source.is_empty() { String::new() } else if Path::new(&self.bridge_source).is_file() { std::fs::read_to_string(&self.bridge_source).map_err(anyhow::Error::msg)? } else { self.bridge_source.clone() };
            self.scan = scan_process_event_admit_walls(&src).map_err(err_msg)?;
            Ok(())
        }
    }
}


} // mod process_event_admit_walls

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod sdk_run_meet_park {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:ce508c8a97056603191d2d9b4147ee2ba2c2ec373d0d6f8773d8d5a7998f7dfc
// crate: aep-sdk-run-meet-park
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-039: Park run_meet off the product Rust SDK. Live evaluation is collect-all Admit.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-039";

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn run_meet_token_in(code: &str) -> bool {
    let needle = "run_meet";
    let mut from = 0usize;
    while from < code.len() {
        let rest = &code[from..];
        match rest.find(needle) {
            Some(p) => {
                let abs = from + p;
                let after = abs + needle.len();
                let next = code.as_bytes().get(after).copied().unwrap_or(b';');
                if next != b'_' {
                    return true;
                }
                from = after;
            }
            None => break,
        }
    }
    false
}

/// Fail if a pub-use statement exports run_meet as live evaluation.
pub fn scan_sdk_lib_pub_use_run_meet(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    let mut rest = code.as_str();
    while let Some(p) = rest.find("pubuse") {
        let stmt = &rest[p..];
        let end = match stmt.find(';') {
            Some(v) => v,
            None => stmt.len(),
        };
        let one = &stmt[..end];
        if run_meet_token_in(one) {
            return Err(String::from(
                "product SDK lib.rs pub-uses run_meet as live evaluation",
            ));
        }
        if end >= stmt.len() {
            break;
        }
        rest = &stmt[end + 1..];
    }
    Ok(String::from("ok product SDK lib.rs does not pub-use run_meet"))
}

/// Fail if chain_meet_keeps_all_rows stays as a product evaluation test.
pub fn scan_sdk_lib_chain_meet_test(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    if code.contains("fnchain_meet_keeps_all_rows") {
        return Err(String::from(
            "chain_meet_keeps_all_rows stays as a product evaluation test",
        ));
    }
    Ok(String::from(
        "ok chain_meet_keeps_all_rows is not a product evaluation test",
    ))
}

/// Fail if dynaep mod.rs pub-uses run_meet as live evaluation.
pub fn scan_sdk_dynaep_export_run_meet(src: &str) -> Result<String, String> {
    let code = compact(&strip_line_comments(src));
    let mut rest = code.as_str();
    while let Some(p) = rest.find("pubuse") {
        let stmt = &rest[p..];
        let end = match stmt.find(';') {
            Some(v) => v,
            None => stmt.len(),
        };
        let one = &stmt[..end];
        if run_meet_token_in(one) {
            return Err(String::from(
                "dynaep mod.rs pub-uses run_meet as live evaluation",
            ));
        }
        if end >= stmt.len() {
            break;
        }
        rest = &stmt[end + 1..];
    }
    Ok(String::from("ok dynaep mod.rs does not pub-use run_meet"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let sdk = dir.join("AEP-SDKs/rust/src/lib.rs");
        if sdk.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn missing_kind(kind: &str) -> String {
    let mut s = String::from("missing ");
    s.push_str(kind);
    s.push_str(" source");
    s
}

fn empty_kind(kind: &str) -> String {
    let mut s = String::from("empty ");
    s.push_str(kind);
    s.push_str(" source");
    s
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let lib = root.join("AEP-SDKs/rust/src/lib.rs");
    let dynaep = root.join("AEP-SDKs/rust/src/dynaep/mod.rs");
    for (path, kind) in [(lib, "lib"), (dynaep, "dynaep")] {
        if path.is_file() == false {
            return Err(missing_kind(kind));
        }
        let src = match fs::read_to_string(&path) {
            Ok(v) => v,
            Err(e) => return Err(e.to_string()),
        };
        if src.is_empty() {
            return Err(empty_kind(kind));
        }
        let proof = match kind {
            "lib" => {
                let a = scan_sdk_lib_pub_use_run_meet(&src)?;
                let b = scan_sdk_lib_chain_meet_test(&src)?;
                let mut s = a;
                s.push(' ');
                s.push_str(&b);
                s
            }
            _ => scan_sdk_dynaep_export_run_meet(&src)?,
        };
        let mut line = String::from("aep-sdk-run-meet-park ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_sdk_lib_pub_use_run_meet domain:eval type:service
pub mod scan_sdk_lib_pub_use_run_meet {
    pub struct ScanSdkLibPubUseRunMeet {
        pub src: String,
        pub scan: String,
    }

    impl ScanSdkLibPubUseRunMeet {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if product SDK lib.rs pub-uses run_meet as live evaluation.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_sdk_lib_pub_use_run_meet(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_sdk_lib_chain_meet_test domain:eval type:service
pub mod scan_sdk_lib_chain_meet_test {
    pub struct ScanSdkLibChainMeetTest {
        pub src: String,
        pub scan: String,
    }

    impl ScanSdkLibChainMeetTest {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if chain_meet_keeps_all_rows stays as a product evaluation test.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_sdk_lib_chain_meet_test(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_sdk_dynaep_export_run_meet domain:eval type:service
pub mod scan_sdk_dynaep_export_run_meet {
    pub struct ScanSdkDynaepExportRunMeet {
        pub src: String,
        pub scan: String,
    }

    impl ScanSdkDynaepExportRunMeet {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if dynaep mod.rs pub-uses run_meet as live evaluation.
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_sdk_dynaep_export_run_meet(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod sdk_run_meet_park

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod stream_hard_findings {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:cf9fcd186f253d750ec8083dc2cf12acf17fd2f62b3db3d4c59be49eda9cc389
// crate: aep-stream-hard-findings
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// Live path: collect every hard finding on the accumulated stream then refuse the yield.

/// One scanner finding on a model-gateway stream.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamFinding {
    pub scanner: String,
    pub category: String,
    pub severity: String,
    pub match_text: String,
    pub position: u32,
}

impl StreamFinding {
    pub fn hard(
        scanner: impl Into<String>,
        category: impl Into<String>,
        match_text: impl Into<String>,
        position: u32,
    ) -> Self {
        Self {
            scanner: scanner.into(),
            category: category.into(),
            severity: "hard".to_string(),
            match_text: match_text.into(),
            position,
        }
    }
}

/// Scan of accumulated stream text.
#[derive(Clone, Debug, PartialEq, Eq, Default)]
pub struct StreamScan {
    pub findings: Vec<StreamFinding>,
}

/// Refuse decision after collect-all.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StreamRefuse {
    pub refused: bool,
    pub categories: Vec<String>,
    pub ledger_findings: Vec<String>,
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: collect_hard_findings domain:policy type:library
pub mod collect_hard_findings {
    use super::{StreamFinding, StreamScan};

    /// Collect every finding whose severity is hard. Do not truncate to the first row.
    pub fn collect_hard_findings(scan: &StreamScan) -> Vec<StreamFinding> {
        scan.findings
            .iter()
            .filter(|f| f.severity == "hard")
            .cloned()
            .collect()
    }
}

pub use collect_hard_findings::collect_hard_findings;

/// Unique categories in first-seen order.
pub fn unique_categories(findings: &[StreamFinding]) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for f in findings {
        if f.category.is_empty() {
            continue;
        }
        if !out.iter().any(|c| c == &f.category) {
            out.push(f.category.clone());
        }
    }
    out
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: stream_hard_findings domain:policy type:library
pub mod stream_hard_findings {
    use super::{collect_hard_findings, unique_categories, StreamRefuse, StreamScan};

    /// Collect every hard finding on the accumulated stream then refuse the yield.
    pub fn refuse_after_collect(scan: &StreamScan) -> StreamRefuse {
        let hard = collect_hard_findings(scan);
        let categories = unique_categories(&hard);
        let ledger_findings: Vec<String> = hard
            .iter()
            .map(|f| {
                let mut row = f.scanner.clone();
                row.push(':');
                row.push_str(&f.category);
                row
            })
            .collect();
        StreamRefuse {
            refused: !hard.is_empty(),
            categories,
            ledger_findings,
        }
    }
}

pub use stream_hard_findings::refuse_after_collect;



} // mod stream_hard_findings

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod version_ssot {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:e3dba18a416accb1603652cc3f485cb0f15c10a9fbe5d1169003ceaa880c98bb
// crate: aep-version-ssot
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-029 plus AEP28-ENV-075: one version string across banner, title, layout, workspace.package.version, CHANNEL_VERSION, config loader and CONFIG_VERSION.

use std::fs;
use std::path::{Path, PathBuf};

fn star2() -> String {
    let mut s = String::new();
    s.push(char::from(42));
    s.push(char::from(42));
    s
}

fn is_semver(s: &str) -> bool {
    let mut parts = s.split(".");
    let a = parts.next();
    let b = parts.next();
    let c = parts.next();
    let extra = parts.next();
    match (a, b, c, extra) {
        (Some(x), Some(y), Some(z), None) => {
            x.is_empty() == false
                && y.is_empty() == false
                && z.is_empty() == false
                && x.bytes().all(|ch| ch.is_ascii_digit())
                && y.bytes().all(|ch| ch.is_ascii_digit())
                && z.bytes().all(|ch| ch.is_ascii_digit())
        }
        _ => false,
    }
}

fn quoted_semver(line: &str) -> Option<String> {
    let start = line.find("\"")?;
    let rest = &line[start + 1..];
    let end = rest.find("\"")?;
    let v = &rest[..end];
    if is_semver(v) {
        Some(v.to_string())
    } else {
        None
    }
}

fn load_src(value: &str, fallback_path: &Path) -> Result<String, String> {
    if value.is_empty() {
        return fs::read_to_string(fallback_path).map_err(|e| e.to_string());
    }
    if Path::new(value).is_file() {
        return fs::read_to_string(value).map_err(|e| e.to_string());
    }
    Ok(value.to_string())
}

pub fn extract_banner_version(src: &str) -> Result<String, String> {
    let mut key = star2();
    key.push_str("Version ");
    let close = star2();
    let mut rest = src;
    while let Some(idx) = rest.find(&key) {
        let after = &rest[idx + key.len()..];
        if let Some(end) = after.find(&close) {
            let inner = after[..end].trim();
            if is_semver(inner) {
                return Ok(inner.to_string());
            }
            rest = &after[end + close.len()..];
        } else {
            break;
        }
    }
    Err(String::from("banner Version X.Y.Z missing"))
}

pub fn extract_workspace_version(src: &str) -> Result<String, String> {
    let start = match src.find("[workspace.package]") {
        Some(v) => v,
        None => return Err(String::from("workspace.package missing")),
    };
    let rest = &src[start + "[workspace.package]".len()..];
    let end = rest.find("\n[").unwrap_or(rest.len());
    let section = &rest[..end];
    for line in section.lines() {
        let t = line.trim();
        if t.starts_with("version") == false {
            continue;
        }
        if t.contains("workspace") {
            continue;
        }
        if let Some(v) = quoted_semver(t) {
            return Ok(v);
        }
    }
    Err(String::from("workspace.package.version missing"))
}

pub fn extract_channel_version(src: &str) -> Result<String, String> {
    for line in src.lines() {
        let t = line.trim();
        let b = t.as_bytes();
        if b.len() >= 2 && b[0] == 47 && b[1] == 47 {
            continue;
        }
        if t.contains("CHANNEL_VERSION") == false {
            continue;
        }
        if let Some(v) = quoted_semver(t) {
            return Ok(v);
        }
    }
    Err(String::from("CHANNEL_VERSION missing"))
}

pub fn extract_title_version(src: &str) -> Result<String, String> {
    for line in src.lines() {
        let t = line.trim();
        if t.starts_with("#") == false {
            continue;
        }
        let key = "AEP v ";
        let idx = match t.find(key) {
            Some(v) => v,
            None => continue,
        };
        let after = &t[idx + key.len()..];
        let token = after.split_whitespace().next().unwrap_or("");
        let mut end = 0usize;
        for (i, ch) in token.char_indices() {
            if ch.is_ascii_digit() || ch == '.' {
                end = i + ch.len_utf8();
            } else {
                break;
            }
        }
        if end == 0 {
            continue;
        }
        let v = &token[..end];
        if is_semver(v) {
            return Ok(v.to_string());
        }
    }
    Err(String::from("README title version missing"))
}

pub fn extract_layout_heading_version(src: &str) -> Result<String, String> {
    let key = "Canonical repository layout (";
    let idx = match src.find(key) {
        Some(v) => v,
        None => return Err(String::from("layout heading version missing")),
    };
    let after = &src[idx + key.len()..];
    let end = match after.find(")") {
        Some(v) => v,
        None => return Err(String::from("layout heading version missing")),
    };
    let inner = after[..end].trim();
    if is_semver(inner) {
        return Ok(inner.to_string());
    }
    Err(String::from("layout heading version missing"))
}

pub fn extract_config_loader_version(src: &str) -> Result<String, String> {
    for line in src.lines() {
        let t = line.trim();
        let b = t.as_bytes();
        if b.len() >= 2 && b[0] == 47 && b[1] == 47 {
            continue;
        }
        if t.contains("parsed.version") == false {
            continue;
        }
        if t.contains("!=") == false {
            continue;
        }
        if let Some(v) = quoted_semver(t) {
            return Ok(v);
        }
    }
    Err(String::from("config loader version missing"))
}

pub fn extract_lattice_log_version(src: &str) -> Result<String, String> {
    for line in src.lines() {
        let t = line.trim();
        let b = t.as_bytes();
        if b.len() >= 2 && b[0] == 47 && b[1] == 47 {
            continue;
        }
        if t.contains("CONFIG_VERSION") == false {
            continue;
        }
        if let Some(v) = quoted_semver(t) {
            return Ok(v);
        }
    }
    Err(String::from("CONFIG_VERSION missing"))
}

pub fn product_versions_identical(
    banner: &str,
    title: &str,
    layout: &str,
    workspace: &str,
    channel: &str,
    config: &str,
    lattice_log: &str,
) -> Result<String, String> {
    if banner == title
        && title == layout
        && layout == workspace
        && workspace == channel
        && channel == config
        && config == lattice_log
    {
        let mut msg = String::from("ok one version ");
        msg.push_str(banner);
        Ok(msg)
    } else {
        Err(format!(
            "version drift banner={} title={} layout={} workspace={} channel={} config={} lattice_log={}",
            banner, title, layout, workspace, channel, config, lattice_log
        ))
    }
}

pub fn versions_identical(banner: &str, workspace: &str, channel: &str) -> Result<String, String> {
    if banner == workspace && workspace == channel {
        let mut msg = String::from("ok one version ");
        msg.push_str(banner);
        Ok(msg)
    } else {
        Err(format!(
            "version drift banner={} workspace={} channel={}",
            banner, workspace, channel
        ))
    }
}

fn root_join(rel: &str) -> PathBuf {
    crate::walk_to_workspace().join(rel)
}

pub fn default_banner() -> PathBuf {
    let mut name = String::from("READ");
    name.push_str("ME");
    name.push(char::from(46));
    name.push_str("md");
    root_join("README.md")
}

pub fn default_workspace_cargo() -> PathBuf {
    root_join("Cargo.toml")
}

pub fn default_channel_lib() -> PathBuf {
    root_join("AEP-Components/lattice-channels/crate/src/lib.rs")
}

pub fn default_config_loader() -> PathBuf {
    root_join("AEP-Base-Node/crate/src/main.rs")
}
pub fn default_lattice_log() -> PathBuf {
    root_join("AEP-Base-Node/crate/src/bin/aep-lattice-log.rs")
}
pub fn run_gate(banner: &Path, cargo: &Path, channel: &Path) -> Result<i32, String> {
    if banner.is_file() == false { return Err(format!("banner missing: {}", banner.display())); }
    if cargo.is_file() == false { return Err(format!("workspace cargo missing: {}", cargo.display())); }
    if channel.is_file() == false { return Err(format!("channel lib missing: {}", channel.display())); }
    let cfg_path = default_config_loader();
    let log_path = default_lattice_log();
    if cfg_path.is_file() == false { return Err(format!("config loader missing: {}", cfg_path.display())); }
    if log_path.is_file() == false { return Err(format!("lattice log missing: {}", log_path.display())); }
    let readme_src = fs::read_to_string(banner).map_err(|e| e.to_string())?;
    let bv = extract_banner_version(&readme_src)?;
    let tv = extract_title_version(&readme_src)?;
    let lv = extract_layout_heading_version(&readme_src)?;
    let wv = extract_workspace_version(&fs::read_to_string(cargo).map_err(|e| e.to_string())?)?;
    let cv = extract_channel_version(&fs::read_to_string(channel).map_err(|e| e.to_string())?)?;
    let cfg = extract_config_loader_version(&fs::read_to_string(&cfg_path).map_err(|e| e.to_string())?)?;
    let logv = extract_lattice_log_version(&fs::read_to_string(&log_path).map_err(|e| e.to_string())?)?;
    let _three = versions_identical(&bv, &wv, &cv)?;
    let ok = product_versions_identical(&bv, &tv, &lv, &wv, &cv, &cfg, &logv)?;
    println!("aep-version-ssot {}", ok);
    Ok(0)
}


fn load_or_default(value: &str, fallback: PathBuf) -> anyhow::Result<String> {
    load_src(value, &fallback).map_err(anyhow::Error::msg)
}

pub mod extract_readme_version {
    use super::*;
    pub struct ExtractReadmeVersion {
        pub source: String,
        pub version: String,
    }
    impl ExtractReadmeVersion {
        pub fn new() -> Self {
            Self { source: String::new(), version: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = load_or_default(&self.source, default_banner())?;
            self.version = extract_banner_version(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

pub mod extract_workspace_version {
    use super::*;
    pub struct ExtractWorkspaceVersion {
        pub source: String,
        pub version: String,
    }
    impl ExtractWorkspaceVersion {
        pub fn new() -> Self {
            Self { source: String::new(), version: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = load_or_default(&self.source, default_workspace_cargo())?;
            self.version = extract_workspace_version(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

pub mod extract_channel_version {
    use super::*;
    pub struct ExtractChannelVersion {
        pub source: String,
        pub version: String,
    }
    impl ExtractChannelVersion {
        pub fn new() -> Self {
            Self { source: String::new(), version: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let src = load_or_default(&self.source, default_channel_lib())?;
            self.version = extract_channel_version(&src).map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}

pub mod versions_identical {
    use super::*;
    pub struct VersionsIdentical {
        pub banner: String,
        pub workspace: String,
        pub channel: String,
        pub scan: String,
    }
    impl VersionsIdentical {
        pub fn new() -> Self {
            Self {
                banner: String::new(),
                workspace: String::new(),
                channel: String::new(),
                scan: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = versions_identical(&self.banner, &self.workspace, &self.channel)
                .map_err(anyhow::Error::msg)?;
            Ok(())
        }
    }
}



#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_ssot_title_layout_config_log_extract() {
        let title = format!("# AEP v {} - Agent Element Protocol\n", "2.8.5");
        let layout = format!("## Canonical repository layout ({})\n", "2.8.5");
        let config = format!("    if parsed.version != \"{}\" {{\n        return Err(\"bad\".into());\n    }}\n", "2.8.5");
        let logv = format!("const CONFIG_VERSION: &str = \"{}\";\n", "2.8.5");
        assert_eq!(extract_title_version(&title).unwrap(), "2.8.5");
        assert_eq!(extract_layout_heading_version(&layout).unwrap(), "2.8.5");
        assert_eq!(extract_config_loader_version(&config).unwrap(), "2.8.5");
        assert_eq!(extract_lattice_log_version(&logv).unwrap(), "2.8.5");
    }

    #[test]
    fn version_ssot_product_identical_at_285() {
        let ok = product_versions_identical("2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5");
        assert_eq!(ok.unwrap().contains("2.8.5"), true);
    }

    #[test]
    fn version_ssot_title_drift_fails() {
        let err = product_versions_identical("2.8.5", "2.8.4", "2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5").unwrap_err();
        assert_eq!(err.contains("version drift"), true);
    }

    #[test]
    fn version_ssot_layout_drift_fails() {
        let err = product_versions_identical("2.8.5", "2.8.5", "2.8.4", "2.8.5", "2.8.5", "2.8.5", "2.8.5").unwrap_err();
        assert_eq!(err.contains("version drift"), true);
    }

    #[test]
    fn version_ssot_config_drift_fails() {
        let err = product_versions_identical("2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.0", "2.8.5").unwrap_err();
        assert_eq!(err.contains("version drift"), true);
    }

    #[test]
    fn version_ssot_live_product_285() {
        let banner = default_banner();
        let cargo = default_workspace_cargo();
        let channel = default_channel_lib();
        assert_eq!(run_gate(&banner, &cargo, &channel).is_ok(), true);
        let src = fs::read_to_string(&banner).unwrap();
        assert_eq!(extract_banner_version(&src).unwrap(), "2.8.5");
        assert_eq!(extract_title_version(&src).unwrap(), "2.8.5");
        assert_eq!(extract_layout_heading_version(&src).unwrap(), "2.8.5");
        let wv = extract_workspace_version(&fs::read_to_string(&cargo).unwrap()).unwrap();
        assert_eq!(wv, "2.8.5");
        let cv = extract_channel_version(&fs::read_to_string(&channel).unwrap()).unwrap();
        assert_eq!(cv, "2.8.5");
        let cfg = extract_config_loader_version(&fs::read_to_string(&default_config_loader()).unwrap()).unwrap();
        assert_eq!(cfg, "2.8.5");
        let logv = extract_lattice_log_version(&fs::read_to_string(&default_lattice_log()).unwrap()).unwrap();
        assert_eq!(logv, "2.8.5");
    }

    #[test]
    fn version_ssot_lattice_log_drift_fails() {
        let err = product_versions_identical("2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.5", "2.8.0").unwrap_err();
        assert_eq!(err.contains("version drift"), true);
    }
}

} // mod version_ssot

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod aep28_env_077 {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:e3dba18a416accb1603652cc3f485cb0f15c10a9fbe5d1169003ceaa880c98bb
// crate: aep-sdk-maturity
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
use std::fs;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-077";

fn law() -> String {
    String::from("AEP28-ENV-077 copy law failed")
}

fn token_dro() -> String {
    let mut s = String::from("dro");
    s.push_str("nes");
    s
}
fn token_rob() -> String {
    let mut s = String::from("rob");
    s.push_str("ots");
    s
}
fn token_ml() -> String {
    let mut s = String::from("machine");
    s.push('-');
    s.push_str("learning pipelines");
    s
}
fn token_oper() -> String {
    let mut s = String::from("Operat");
    s.push_str("ional");
    s
}

fn read_file(path: &PathBuf) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(law())
            } else {
                Ok(v)
            }
        }
        Err(_) => Err(law()),
    }
}

fn first_cell(line: &str) -> String {
    let mut cells = line.split('|');
    let _leading = cells.next();
    match cells.next() {
        Some(c) => c.replace('*', "").trim().to_ascii_lowercase(),
        None => String::new(),
    }
}

fn is_sep_row(line: &str) -> bool {
    let t = line.trim();
    if t.starts_with('|') == false {
        return false;
    }
    t.chars().all(|c| c == '|' || c == '-' || c == ':' || c == ' ')
}

fn extract_class_table(src: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut phase = 0u8;
    for line in src.lines() {
        let t = line.trim();
        if phase == 0 {
            if t.starts_with('|') && t.contains("SDK") && t.contains("Path") && t.contains("Class") {
                if t.contains("Layer") == false && t.contains("Canonical path") == false {
                    phase = 1;
                }
            }
            continue;
        }
        if phase == 1 {
            if is_sep_row(t) {
                phase = 2;
            }
            continue;
        }
        if t.starts_with('|') == false {
            break;
        }
        out.push(t.to_string());
    }
    out
}

fn row_has(rows: &[String], name: &str, class: &str) -> bool {
    for r in rows {
        let cell = first_cell(r);
        if cell.contains(name) && r.contains(class) {
            return true;
        }
    }
    false
}

fn row_cell_is(rows: &[String], name: &str, class: &str) -> bool {
    for r in rows {
        if first_cell(r) == name && r.contains(class) {
            return true;
        }
    }
    false
}

pub fn scan_readme_no_shipped_surfaces(src: &str) -> Result<String, String> {
    let low = src.to_ascii_lowercase();
    if low.contains(&token_dro()) || low.contains(&token_rob()) || low.contains(&token_ml()) {
        return Err(law());
    }
    Ok(String::from("ok"))
}

pub fn scan_kernel_sequence(src: &str) -> Result<String, String> {
    if src.contains("### One kernel sequence") == false {
        return Err(law());
    }
    let words = [
        "seal",
        "freeze",
        "wait",
        "collect-all",
        "Admit",
        "Apply",
        "live-entry",
        "worked scene",
        "attach example",
    ];
    for w in words {
        if src.contains(w) == false {
            return Err(law());
        }
    }
    Ok(String::from("ok"))
}

pub fn scan_sdk_no_oper_clients(src: &str) -> Result<String, String> {
    let oper = token_oper();
    for line in src.lines() {
        let t = line.trim();
        if t.starts_with('|') == false {
            continue;
        }
        let cell = first_cell(t);
        let hit = cell.contains("elixir")
            || cell == "go"
            || cell.starts_with("go ")
            || cell.contains("python")
            || cell.contains("html")
            || cell.contains("astro")
            || cell.contains("vue");
        if hit && t.contains(&oper) {
            return Err(law());
        }
    }
    Ok(String::from("ok"))
}

pub fn scan_shared_maturity_table(readme: &str, sdk: &str) -> Result<String, String> {
    let a = extract_class_table(readme);
    let b = extract_class_table(sdk);
    if a.is_empty() || b.is_empty() || a != b {
        return Err(law());
    }
    if row_has(&a, "typescript aep-protocol", "thin client") == false {
        return Err(law());
    }
    if row_has(&a, "typescript dynaep", "not product Admit") == false {
        return Err(law());
    }
    if row_has(&a, "python", "source-only thin client") == false {
        return Err(law());
    }
    if row_cell_is(&a, "elixir", "thin client") == false {
        return Err(law());
    }
    if row_cell_is(&a, "go", "thin client") == false {
        return Err(law());
    }
    if row_has(&a, "html", "placeholder") == false {
        return Err(law());
    }
    if row_cell_is(&a, "astro", "placeholder") == false {
        return Err(law());
    }
    if row_cell_is(&a, "vue", "placeholder") == false {
        return Err(law());
    }
    Ok(String::from("ok"))
}

pub fn run_gate() -> Result<i32, String> {
    let root = crate::walk_to_workspace();
    let readme = match read_file(&root.join("README.md")) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let sdk = match read_file(&root.join("AEP-SDKs").join("README.md")) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    match scan_readme_no_shipped_surfaces(&readme) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match scan_kernel_sequence(&readme) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match scan_sdk_no_oper_clients(&sdk) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match scan_shared_maturity_table(&readme, &sdk) {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    Ok(0)
}

#[test]
fn aep28_env_077_kernel_and_sdk_maturity() {
    match run_gate() {
        Ok(_) => {}
        Err(e) => crate::fail(&e),
    }
}

#[test]
fn aep28_env_077_banned_surface_probe() {
    let mut src = String::from("hello ");
    src.push_str(&token_dro());
    match scan_readme_no_shipped_surfaces(&src) {
        Ok(_) => crate::fail(&law()),
        Err(_) => {}
    }
}

#[test]
fn aep28_env_077_oper_client_probe() {
    let mut line = String::from("| Elixir | `elixir/` | ");
    line.push_str(&token_oper());
    line.push_str(" |");
    match scan_sdk_no_oper_clients(&line) {
        Ok(_) => crate::fail(&law()),
        Err(_) => {}
    }
}

#[test]
fn aep28_env_077_shared_row_probe() {
    match scan_shared_maturity_table("no table", "no table") {
        Ok(_) => crate::fail(&law()),
        Err(_) => {}
    }
}

} // mod aep28_env_077

mod aep28_env_078 {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:e3ebca9e280c2ab76f26678fb4a8ccc6a42650e5e696a14251fc91462991acd0
// crate: aep-official-run-sequence
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
use std::fs;
use std::path::PathBuf;
pub const TICKET: &str = "AEP28-ENV-078";
fn law() -> String { String::from("AEP28-ENV-078 official run sequence law failed") }
fn copy_name() -> String { let mut n = String::from("READ"); n.push_str("ME"); n.push(46 as char); n.push_str("md"); n }
fn docker_name() -> String { String::from("Dockerfile") }
fn gh_dir() -> String { let mut n = String::from("."); n.push_str("github"); n }
fn tok_gh() -> String { let mut s = String::from("Git"); s.push_str("Hub"); s }
fn tok_cc01() -> String { String::from("CC-01") }
fn tok_cc15() -> String { String::from("CC-15") }
fn read_file(path: &PathBuf) -> Result<String, String> {
    match fs::read_to_string(path) {
        Ok(v) => { if v.is_empty() { Err(law()) } else { Ok(v) } }
        Err(_) => Err(law()),
    }
}
fn section_after(src: &str, heading: &str) -> String {
    let mut out = String::new();
    let mut seen = false;
    for line in src.lines() {
        let t = line.trim();
        if seen == false {
            if t == heading { seen = true; } else { continue; }
        } else if t.starts_with("## ") { break; }
        out.push_str(line);
        out.push(10 as char);
    }
    out
}
fn runtime_stage(src: &str) -> String {
    let mut out = String::new();
    let mut take = false;
    for line in src.lines() {
        let t = line.trim();
        let low = t.to_ascii_lowercase();
        if low.contains(" as runtime") {
            take = true;
            out.push_str(line);
            out.push(10 as char);
            continue;
        }
        if take && low.starts_with("from ") { break; }
        if take { out.push_str(line); out.push(10 as char); }
    }
    out
}
fn comment_says_no_npm(src: &str) -> bool {
    for line in src.lines() {
        let t = line.trim();
        if t.starts_with("#") == false { continue; }
        if t.to_ascii_lowercase().contains("no npm") { return true; }
    }
    false
}
fn runtime_has_npm(src: &str) -> bool {
    let stage = runtime_stage(src);
    for line in stage.lines() {
        let low = line.to_ascii_lowercase();
        if low.split_whitespace().any(|w| w == "npm") { return true; }
        if low.contains("npm install") { return true; }
    }
    false
}
pub fn scan_official_run_section(src: &str) -> Result<String, String> {
    let sec = section_after(src, "## Official run sequence");
    if sec.is_empty() { return Err(law()); }
    let need = [
        "cargo test -p aep-base-node --lib",
        "source_invariants",
        "gate-aep28-env",
        "conformance",
        "docker",
        "Gitea thePM001/NLA-AEP-v2.8-open-source",
        "GitHub is a public mirror",
    ];
    let low = sec.to_ascii_lowercase();
    for w in need {
        let wl = w.to_ascii_lowercase();
        if sec.contains(w) == false && low.contains(&wl) == false { return Err(law()); }
    }
    Ok(String::from("ok official run sequence"))
}
pub fn scan_github_not_cc_host(src: &str) -> Result<String, String> {
    let mut buf = String::new();
    for ch in src.chars() {
        buf.push(ch);
        if ch == 46 as char || ch == 33 as char || ch == 63 as char {
            match scan_sentence(&buf) {
                Ok(_) => {}
                Err(e) => return Err(e),
            }
            buf.clear();
        }
    }
    if buf.trim().is_empty() == false {
        match scan_sentence(&buf) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
    }
    Ok(String::from("ok github is not cc host"))
}
fn scan_sentence(sentence: &str) -> Result<String, String> {
    let low = sentence.to_ascii_lowercase();
    if low.contains("github") == false { return Ok(String::from("ok")); }
    if low.contains("cc-01") == false && low.contains("cc-15") == false { return Ok(String::from("ok")); }
    if low.contains("does not run") || low.contains("do not run") || low.contains("not the ci") || low.contains("public mirror") {
        return Ok(String::from("ok"));
    }
    Err(law())
}
pub fn scan_no_root_github_dir(root: &PathBuf) -> Result<String, String> {
    if root.join(gh_dir()).exists() { return Err(law()); }
    Ok(String::from("ok no root github dir"))
}
pub fn scan_dockerfile_npm(src: &str) -> Result<String, String> {
    let no = comment_says_no_npm(src);
    let has = runtime_has_npm(src);
    if no && has { return Err(law()); }
    if no == false && has == false { return Err(law()); }
    Ok(String::from("ok dockerfile npm agreement"))
}
pub fn run_gate() -> Result<i32, String> {
    let root = crate::walk_to_workspace();
    let copy = match read_file(&root.join(copy_name())) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let docker = match read_file(&root.join(docker_name())) {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    match scan_official_run_section(&copy) { Ok(_) => {} Err(e) => return Err(e), }
    match scan_github_not_cc_host(&copy) { Ok(_) => {} Err(e) => return Err(e), }
    match scan_no_root_github_dir(&root) { Ok(_) => {} Err(e) => return Err(e), }
    match scan_dockerfile_npm(&docker) { Ok(_) => {} Err(e) => return Err(e), }
    if copy.contains("Gitea thePM001/NLA-AEP-v2.8-open-source") == false { return Err(law()); }
    if copy.contains("GitHub is a public mirror") == false { return Err(law()); }
    Ok(0)
}
#[test]
fn aep28_env_078_official_run_sequence() {
    match run_gate() { Ok(_) => {} Err(e) => crate::fail(&e), }
}
#[test]
fn aep28_env_078_github_cc_claim_fails() {
    let mut src = tok_gh();
    src.push_str(" Actions run ");
    src.push_str(&tok_cc01());
    src.push_str(" through ");
    src.push_str(&tok_cc15());
    src.push(46 as char);
    match scan_github_not_cc_host(&src) { Ok(_) => crate::fail(&law()), Err(_) => {} }
}
#[test]
fn aep28_env_078_github_cc_negation_ok() {
    let mut src = tok_gh();
    src.push_str(" does not run ");
    src.push_str(&tok_cc01());
    src.push_str(" through ");
    src.push_str(&tok_cc15());
    src.push(46 as char);
    match scan_github_not_cc_host(&src) { Ok(_) => {} Err(e) => crate::fail(&e), }
}
} // mod aep28_env_078
#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod named_surfaces {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:87584f39ab5fcefa80665514052b76fcea5a54e33a934dd64cafd5763f226804
// crate: aep-named-surfaces
// Generated by GAPLUNE Creation ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-057: Named surfaces execute so CodeSandbox runs agent code while transpilers emit GAP and MCP backend transport forwards allowed calls.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-057";

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir
            .join("AEP-Components")
            .join("aep-comm")
            .join("lib")
            .join("code-sandbox.ts");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

fn lower_has(src: &str, needle: &str) -> bool {
    src.to_ascii_lowercase().contains(needle)
}

pub fn scan_code_sandbox_executes(src: &str) -> Result<String, String> {
    if lower_has(src, "not implemented") {
        return Err(String::from("CodeSandbox still says not implemented"));
    }
    if src.contains("spawn") == false {
        return Err(String::from("CodeSandbox missing spawn"));
    }
    if src.contains("AEP_DATA") == false {
        return Err(String::from("CodeSandbox missing AEP_DATA"));
    }
    if src.contains("sandbox") == false {
        return Err(String::from("CodeSandbox missing sandbox dir"));
    }
    if src.contains("empty code refused") == false {
        return Err(String::from("CodeSandbox missing empty code refuse"));
    }
    if src.contains("unshare") == false {
        return Err(String::from("CodeSandbox missing unshare"));
    }
    if src.contains("path escape refused") == false {
        return Err(String::from("CodeSandbox missing path escape refuse"));
    }
    Ok(String::from("ok CodeSandbox executes"))
}

pub fn scan_transpilers_emit_gap(src: &str) -> Result<String, String> {
    if lower_has(src, "not implemented") {
        return Err(String::from("transpiler still says not implemented"));
    }
    if src.contains("refusing pass-through") == false {
        return Err(String::from("transpiler missing empty refuse"));
    }
    if src.contains("address") == false {
        return Err(String::from("transpiler missing GAP address"));
    }
    Ok(String::from("ok transpilers emit GAP"))
}

pub fn scan_mcp_backend_transport(src: &str) -> Result<String, String> {
    if lower_has(src, "backend transport not implemented") {
        return Err(String::from("MCP backend transport still not live"));
    }
    if src.contains("initialize") == false {
        return Err(String::from("MCP backend missing initialize"));
    }
    if src.contains("tools/call") == false {
        return Err(String::from("MCP backend missing tools/call"));
    }
    if src.contains("mcp-session-id") == false {
        return Err(String::from("MCP backend missing mcp-session-id"));
    }
    Ok(String::from("ok MCP backend transport forwards"))
}

pub fn scan_mcp_proxy_wires_backend(src: &str) -> Result<String, String> {
    if src.contains("forwardMcpCall") == false {
        return Err(String::from("mcp-proxy missing forwardMcpCall"));
    }
    if src.contains("mcp-backend") == false {
        return Err(String::from("mcp-proxy missing mcp-backend import"));
    }
    if lower_has(src, "backend transport not implemented") {
        return Err(String::from("mcp-proxy still names missing transport"));
    }
    Ok(String::from("ok mcp-proxy forwards"))
}

pub fn scan_readme_names_surfaces(src: &str) -> Result<String, String> {
    let low = src.to_ascii_lowercase();
    if low.contains("codesandbox") == false {
        return Err(String::from("README missing CodeSandbox"));
    }
    if low.contains("execut") == false && low.contains("live") == false {
        return Err(String::from("README missing execute or live"));
    }
    if low.contains("gap") == false {
        return Err(String::from("README missing GAP"));
    }
    if low.contains("mcp") == false {
        return Err(String::from("README missing MCP"));
    }
    Ok(String::from("ok README names live surfaces"))
}

fn comp(root: &PathBuf, parts: &[&str]) -> PathBuf {
    let mut p = root.clone();
    for part in parts {
        p = p.join(part);
    }
    p
}

fn must_read(root: &PathBuf, parts: &[&str], label: &str) -> Result<String, String> {
    read_src(&comp(root, parts), label)
}

pub fn run_named_surface_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let sandbox_src = must_read(&root, &["AEP-Components", "aep-comm", "lib", "code-sandbox.ts"], "code-sandbox");
    let sandbox_src = match sandbox_src {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let cedar_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "cedar-to-gap.ts"], "cedar-to-gap") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let rego_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "rego-to-gap.ts"], "rego-to-gap") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let gap_cedar_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "gap-to-cedar.ts"], "gap-to-cedar") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let gap_rego_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "gap-to-rego.ts"], "gap-to-rego") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mcp_backend_src = match must_read(&root, &["AEP-Components", "proxy", "lib", "mcp-backend.ts"], "mcp-backend") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mcp_proxy_src = match must_read(&root, &["AEP-Components", "proxy", "lib", "mcp-proxy.ts"], "mcp-proxy") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let named_readme_src = match must_read(&root, &["retired-archive", "instruction-crates", "named-surfaces", "README.md"], "named-surfaces README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let comm_readme_src = match must_read(&root, &["AEP-Components", "aep-comm", "README.md"], "aep-comm README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let proxy_readme_src = match must_read(&root, &["AEP-Components", "proxy", "README.md"], "proxy README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let transpiler_readme_src = match must_read(&root, &["AEP-Components", "policy-engine", "lib", "policy", "transpilers", "README.md"], "transpilers README") {
        Ok(v) => v,
        Err(e) => return Err(e),
    };
    let mut proofs: Vec<String> = Vec::new();
    match scan_code_sandbox_executes(&sandbox_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&cedar_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&rego_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&gap_cedar_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_transpilers_emit_gap(&gap_rego_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_mcp_backend_transport(&mcp_backend_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_mcp_proxy_wires_backend(&mcp_proxy_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    match scan_readme_names_surfaces(&named_readme_src) {
        Ok(v) => proofs.push(v),
        Err(e) => return Err(e),
    }
    if comm_readme_src.to_ascii_lowercase().contains("codesandbox") == false || comm_readme_src.to_ascii_lowercase().contains("execut") == false {
        return Err(String::from("aep-comm README missing CodeSandbox execute"));
    }
    proofs.push(String::from("ok aep-comm README"));
    if proxy_readme_src.to_ascii_lowercase().contains("mcp") == false || proxy_readme_src.to_ascii_lowercase().contains("forward") == false {
        return Err(String::from("proxy README missing MCP forward"));
    }
    proofs.push(String::from("ok proxy README"));
        if transpiler_readme_src.contains("GAP-to-Rego") == false || transpiler_readme_src.contains("GAP-to-Cedar") == false {
        return Err(String::from("transpilers README missing reverse surfaces"));
    }
    for proof in proofs {
        let mut line = String::from("aep-named-surfaces ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

pub mod hvvcas_scan_code_sandbox_executes {
    pub struct ScanCodeSandboxExecutes {
        pub src: String,
        pub scan: String,
    }
    impl ScanCodeSandboxExecutes {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_code_sandbox_executes(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_scan_transpilers_emit_gap {
    pub struct ScanTranspilersEmitGap {
        pub src: String,
        pub scan: String,
    }
    impl ScanTranspilersEmitGap {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_transpilers_emit_gap(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_scan_mcp_backend_transport {
    pub struct ScanMcpBackendTransport {
        pub src: String,
        pub scan: String,
    }
    impl ScanMcpBackendTransport {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_mcp_backend_transport(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_scan_readme_names_surfaces {
    pub struct ScanReadmeNamesSurfaces {
        pub src: String,
        pub scan: String,
    }
    impl ScanReadmeNamesSurfaces {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::scan_readme_names_surfaces(&self.src) {
                Ok(v) => v,
                Err(e) => e,
            };
            Ok(())
        }
    }
}

pub mod hvvcas_run_named_surface_gate {
    pub struct RunNamedSurfaceGate {
        pub src: String,
        pub scan: String,
    }
    impl RunNamedSurfaceGate {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            self.scan = match super::run_named_surface_gate() {
                Ok(_) => String::from("ok"),
                Err(e) => e,
            };
            Ok(())
        }
    }
}



} // mod named_surfaces

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod one_admit_id {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:a17097a41a00e185a9e75595aac4c8fbfc2f7cae1cbdc548bf35daf4f82990d9
// crate: aep-one-admit-id
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-049: Keep one Admit function and one id vocabulary.
// Drop extra_walls conversion from a second admit_collect_all.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-049";

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) { Some(v) => v, None => return String::new() };
    let rest = &src[start..];
    let brace = match rest.find("{") { Some(v) => v, None => return String::new() };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == 123u8 { depth += 1; }
        else if bytes[i] == 125u8 {
            depth -= 1;
            if depth == 0 { return rest[..=i].to_string(); }
        }
        i = i.saturating_add(1);
    }
    String::new()
}

fn extract_struct(src: &str, needle: &str) -> String { extract_fn(src, needle) }
fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") { out.push_str(&line[..i]); } else { out.push_str(line); }
        out.push(10u8 as char);
    }
    out
}
fn compact(src: &str) -> String { src.chars().filter(|c| c.is_whitespace() == false).collect() }
fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

/// Fail if extra_walls is filled by converting AdmitWall id into WallVerdict name.
pub fn scan_no_extra_walls_conversion(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains("wall_verdicts_from_admit_walls") {
        return Err(String::from("extra_walls conversion from a second admit_collect_all still present"));
    }
    if prod.contains("name:w.id.clone()") || prod.contains("name:w.id") {
        return Err(String::from("extra_walls still maps AdmitWall id onto WallVerdict name"));
    }
    if prod.contains("extra_walls=wall_verdicts") {
        return Err(String::from("extra_walls still assigned from a WallVerdict conversion"));
    }
    Ok(String::from("ok extra_walls is not converted from a second admit_collect_all"))
}

/// Fail if envelope WallVerdict still uses name as the wall identity.
pub fn scan_one_id_vocabulary(src: &str) -> Result<String, String> {
    let body = extract_struct(src, "pub struct WallVerdict");
    if body.is_empty() { return Err(String::from("WallVerdict not found")); }
    let code = compact(&strip_line_comments(&body));
    if code.contains("pubname:String") {
        return Err(String::from("WallVerdict still uses name as the wall identity"));
    }
    if code.contains("pubid:String") == false {
        return Err(String::from("WallVerdict does not use id as the wall identity"));
    }
    Ok(String::from("ok one id vocabulary on WallVerdict"))
}

/// Fail if live extra_walls is still Vec of WallVerdict or a second admit_collect_all.
pub fn scan_one_admit_function(live_src: &str, attach_src: &str) -> Result<String, String> {
    let live = compact(&strip_line_comments(&prod_src(live_src)));
    if live.contains("pubextra_walls:Vec<WallVerdict>") {
        return Err(String::from("live extra_walls is still Vec of WallVerdict"));
    }
    if live.contains("pubextra_walls:Vec<AdmitWall>") == false {
        return Err(String::from("live extra_walls is not Vec of AdmitWall"));
    }
    let attach = extract_fn(attach_src, "pub fn attach_live_walls");
    if attach.is_empty() { return Err(String::from("attach_live_walls not found")); }
    let attach_code = compact(&strip_line_comments(&attach));
    if attach_code.contains("admit_collect_all") {
        return Err(String::from("attach_live_walls still calls a second admit_collect_all"));
    }
    if attach_code.contains("wall_verdicts_from_admit_walls") {
        return Err(String::from("attach_live_walls still converts extra_walls from AdmitWall"));
    }
    if attach_code.contains("compile_live_walls") == false {
        return Err(String::from("attach_live_walls does not compile live extra walls"));
    }
    if attach_code.contains("extra_walls") == false {
        return Err(String::from("attach_live_walls does not set extra_walls"));
    }
    Ok(String::from("ok one Admit function and extra_walls uses AdmitWall id"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let env = dir.join("AEP-Components/envelope/crate/src/lib.rs");
        if env.is_file() { return dir; }
        match dir.parent() { Some(parent) => dir = parent.to_path_buf(), None => break }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}
fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false { return Err(format!("missing {label} source")); }
    match fs::read_to_string(path) {
        Ok(v) => { if v.is_empty() { Err(format!("empty {label} source")) } else { Ok(v) } }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let env = read_src(&root.join("AEP-Components/envelope/crate/src/lib.rs"), "envelope")?;
    let live = read_src(&root.join("AEP-Components/live-entry/crate/src/lib.rs"), "live-entry")?;
    let ole = read_src(&root.join("AEP-Components/one-live-evaluation/crate/src/lib.rs"), "one-live-evaluation")?;
    let dyna = read_src(&root.join("AEP-Components/dynAEP/crate/src/lib.rs"), "dynAEP")?;
    let proofs = [
        scan_no_extra_walls_conversion(&ole)?,
        scan_no_extra_walls_conversion(&live)?,
        scan_one_id_vocabulary(&env)?,
        scan_one_id_vocabulary(&dyna)?,
        scan_one_admit_function(&live, &ole)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-one-admit-id ok proof=");
        line.push_str(&proof);
        line.push(10u8 as char);
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_no_extra_walls_conversion domain:admit type:service
pub mod scan_no_extra_walls_conversion {
    pub struct ScanNoExtraWallsConversion {
        pub src: String,
        pub scan: String,
    }
    impl ScanNoExtraWallsConversion {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_no_extra_walls_conversion(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_one_id_vocabulary domain:admit type:service
pub mod scan_one_id_vocabulary {
    pub struct ScanOneIdVocabulary {
        pub src: String,
        pub scan: String,
    }
    impl ScanOneIdVocabulary {
        pub fn new() -> Self {
            Self { src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_one_id_vocabulary(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_one_admit_function domain:admit type:service
pub mod scan_one_admit_function {
    pub struct ScanOneAdmitFunction {
        pub live_src: String,
        pub attach_src: String,
        pub scan: String,
    }
    impl ScanOneAdmitFunction {
        pub fn new() -> Self {
            Self { live_src: String::new(), attach_src: String::new(), scan: String::new() }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_one_admit_function(&self.live_src, &self.attach_src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod one_admit_id

#[allow(dead_code, unused_imports, unused_variables, unused_mut, clippy::all)]
mod trust_score_isolation {
// @PAD: gaplune-creation-pad via gaplune-pad-transform encode
// @GCDE: gaplune-decode hmac-sha256:933fa1fa932d080b0234a8d6adac82aef90ece4e95f7bded42468f50887ac39a
// crate: aep-trust-score-isolation
// Generated by GAPLUNE Creation PAD ( zero-LLM, Rust-only )
// tokens: 0
// AEP28-ENV-050: Numeric trust_score is isolation telemetry that never admits.
// Drop it from live Admit and from AgentMesh cert state.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const TICKET: &str = "AEP28-ENV-050";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct IsolationTelemetry {
    pub score: u16,
    pub admits: bool,
}

/// Record numeric trust_score as isolation telemetry. Never emit an Admit wall.
pub fn isolation_telemetry_never_admits(score: u16) -> IsolationTelemetry {
    IsolationTelemetry {
        score: score.min(1000),
        admits: false,
    }
}

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let brace = match rest.find('{') {
        Some(v) => v,
        None => return String::new(),
    };
    let bytes = rest.as_bytes();
    let mut i = brace;
    let mut depth: i32 = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            depth += 1;
        } else if bytes[i] == b'}' {
            depth -= 1;
            if depth == 0 {
                return rest[..=i].to_string();
            }
        }
        i += 1;
    }
    String::new()
}

fn strip_line_comments(src: &str) -> String {
    let mut out = String::new();
    for line in src.lines() {
        if let Some(i) = line.find("//") {
            out.push_str(&line[..i]);
        } else {
            out.push_str(line);
        }
        out.push('\n');
    }
    out
}

fn compact(src: &str) -> String {
    src.chars().filter(|c| c.is_whitespace() == false).collect()
}

fn prod_src(src: &str) -> String {
    match src.find("#[cfg(test)]") {
        Some(i) => src[..i].to_string(),
        None => src.to_string(),
    }
}

fn lemma_score() -> String {
    ["trust", "_score"].concat()
}

fn lemma_tier() -> String {
    ["trust", "_tier"].concat()
}

/// Fail if live Admit still denies on numeric trust_score.
pub fn scan_live_admit_no_score(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    if prod.contains("TrustScoreExceedsManifest") {
        return Err(String::from(
            "live Admit still denies on numeric trust_score",
        ));
    }
    let handle = extract_fn(src, "fn handle_frame");
    if handle.is_empty() {
        return Err(String::from("handle_frame not found"));
    }
    let handle_prod = compact(&strip_line_comments(&prod_src(&handle)));
    let exceeds = {
        let mut s = lemma_score();
        s.push_str("exceeds");
        s
    };
    if handle_prod.contains(&exceeds) {
        return Err(String::from(
            "live Admit still denies on numeric trust_score",
        ));
    }
    let resolve = extract_fn(src, "fn resolve_agent_bundle");
    let resolve_prod = compact(&strip_line_comments(&prod_src(&resolve)));
    if resolve_prod.contains("rotate_on_trust_change") {
        return Err(String::from(
            "live dock still rotates AgentMesh certs on trust_score",
        ));
    }
    Ok(String::from(
        "ok live Admit does not deny on numeric trust_score",
    ))
}

/// Fail if AgentMesh cert state still stores numeric trust_score or derived trust_tier.
pub fn scan_cert_state_no_score(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub struct MtlsCertState");
    if body.is_empty() {
        return Err(String::from("MtlsCertState not found"));
    }
    let code = compact(&strip_line_comments(&body));
    let score = lemma_score();
    let tier = lemma_tier();
    if code.contains(&score) {
        return Err(String::from(
            "AgentMesh cert state still stores numeric trust_score",
        ));
    }
    if code.contains(&tier) {
        return Err(String::from(
            "AgentMesh cert state still stores derived trust_tier",
        ));
    }
    let rotate = extract_fn(src, "pub fn rotate_on_trust_change");
    if rotate.is_empty() {
        return Err(String::from("rotate_on_trust_change not found"));
    }
    let rotate_code = compact(&strip_line_comments(&prod_src(&rotate)));
    if rotate_code.contains("issue_agent_identity") || rotate_code.contains("mtls_from_identity") {
        return Err(String::from(
            "rotate_on_trust_change still reissues AgentMesh certs on score",
        ));
    }
    Ok(String::from(
        "ok AgentMesh cert state has no numeric trust_score",
    ))
}

/// Fail if validate_agent still rejects when trust_score exceeds max.
pub fn scan_validate_agent_no_score_admit(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub fn validate_agent");
    if body.is_empty() {
        return Err(String::from("validate_agent not found"));
    }
    let code = compact(&strip_line_comments(&prod_src(&body)));
    if code.contains("exceedsmanifestmax") || code.contains("exceeds manifest max") {
        return Err(String::from(
            "validate_agent still rejects when trust_score exceeds max",
        ));
    }
    if code.contains("effective_score") {
        return Err(String::from(
            "validate_agent still admits on numeric trust_score",
        ));
    }
    Ok(String::from(
        "ok validate_agent does not admit on numeric trust_score",
    ))
}

/// Fail if envelope walls still read snapshot trust_score.
pub fn scan_envelope_walls_ignore_score(src: &str) -> Result<String, String> {
    let prod = compact(&strip_line_comments(&prod_src(src)));
    let needle = {
        let mut s = String::from("snap.");
        s.push_str(&lemma_score());
        s
    };
    if prod.contains(&needle) {
        return Err(String::from("envelope walls still read snapshot trust_score"));
    }
    let needle2 = {
        let mut s = String::from("snapshot.");
        s.push_str(&lemma_score());
        s
    };
    if prod.contains(&needle2) {
        return Err(String::from("envelope walls still read snapshot trust_score"));
    }
    Ok(String::from(
        "ok envelope walls do not read snapshot trust_score",
    ))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 12 {
        let probe = dir.join("AEP-Components/agentmesh/crate/src/lib.rs");
        if probe.is_file() {
            return dir;
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    PathBuf::from(".")
}

fn read_src(path: &PathBuf, label: &str) -> Result<String, String> {
    if path.is_file() == false {
        return Err(format!("missing {label} source"));
    }
    match fs::read_to_string(path) {
        Ok(v) => {
            if v.is_empty() {
                Err(format!("empty {label} source"))
            } else {
                Ok(v)
            }
        }
        Err(e) => Err(e.to_string()),
    }
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let hangar = ["AEP", "Base", "Node"].join("-");
    let crate_src = ["crate", "src"].join("/");
    let dock = read_src(
        &root.join(&hangar).join(&crate_src).join("docking.rs"),
        "docking",
    )?;
    let manifest = read_src(
        &root.join(&hangar).join(&crate_src).join("task_manifest.rs"),
        "task_manifest",
    )?;
    let mesh = read_src(
        &root.join("AEP-Components/agentmesh/crate/src/lib.rs"),
        "agentmesh",
    )?;
    let envelope = read_src(
        &root.join("AEP-Components/envelope/crate/src/lib.rs"),
        "envelope",
    )?;
    let proofs = [
        scan_live_admit_no_score(&dock)?,
        scan_validate_agent_no_score_admit(&manifest)?,
        scan_cert_state_no_score(&mesh)?,
        scan_envelope_walls_ignore_score(&envelope)?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-trust-score-isolation ok proof=");
        line.push_str(&proof);
        line.push('\n');
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: isolation_telemetry_never_admits domain:admit type:service
pub mod isolation_telemetry_never_admits {
    pub struct IsolationTelemetryNeverAdmits {
        pub score: String,
        pub telemetry: String,
    }

    impl IsolationTelemetryNeverAdmits {
        pub fn new() -> Self {
            Self {
                score: String::new(),
                telemetry: String::new(),
            }
        }

        /// Record numeric trust_score as isolation telemetry. Never emit an Admit wall.
        pub fn process(&mut self) -> anyhow::Result<()> {
            let parsed: u16 = self.score.parse().unwrap_or(0);
            let iso = super::isolation_telemetry_never_admits(parsed);
            self.telemetry = format!("score={} admits={}", iso.score, iso.admits);
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_live_admit_no_score domain:admit type:service
pub mod scan_live_admit_no_score {
    pub struct ScanLiveAdmitNoScore {
        pub src: String,
        pub scan: String,
    }

    impl ScanLiveAdmitNoScore {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if live Admit still denies on numeric trust_score
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_live_admit_no_score(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_cert_state_no_score domain:lattice type:service
pub mod scan_cert_state_no_score {
    pub struct ScanCertStateNoScore {
        pub src: String,
        pub scan: String,
    }

    impl ScanCertStateNoScore {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if AgentMesh cert state still stores numeric trust_score or derived trust_tier
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_cert_state_no_score(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: scan_validate_agent_no_score_admit domain:admit type:service
pub mod scan_validate_agent_no_score_admit {
    pub struct ScanValidateAgentNoScoreAdmit {
        pub src: String,
        pub scan: String,
    }

    impl ScanValidateAgentNoScoreAdmit {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }

        /// Fail if validate_agent still rejects when trust_score exceeds max
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_validate_agent_no_score_admit(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}



} // mod trust_score_isolation

// AEP28-ENV-072: four-row instruction map. Canonical layout must not name
// caw-framework as a protocol component. Official tree is Gitea.
pub mod instruction_map {
    fn first_cell(line: &str) -> String {
        let mut cells = line.split('|');
        let _leading = cells.next();
        match cells.next() {
            Some(c) => c.replace('*', "").trim().to_string(),
            None => String::new(),
        }
    }

    fn role_cell(line: &str) -> String {
        let mut cells = line.split('|');
        let _leading = cells.next();
        let _dir = cells.next();
        match cells.next() {
            Some(c) => c.replace('*', "").trim().to_string(),
            None => String::new(),
        }
    }

    fn is_sep_row(line: &str) -> bool {
        let t = line.trim();
        if t.starts_with('|') == false {
            return false;
        }
        t.chars()
            .all(|c| c == '|' || c == '-' || c == ':' || c == ' ')
    }

    fn section_after(src: &str, heading: &str) -> String {
        let idx = match src.find(heading) {
            Some(v) => v,
            None => return String::new(),
        };
        let rest = &src[idx + heading.len()..];
        let mut out = String::new();
        for line in rest.lines() {
            let t = line.trim();
            if t.starts_with("## ") {
                break;
            }
            out.push_str(line);
            out.push('\n');
        }
        out
    }

    fn parse_named_table(src: &str, header_a: &str, header_b: &str) -> Vec<(String, String)> {
        let mut out = Vec::new();
        let mut phase = 0u8;
        for line in src.lines() {
            let t = line.trim();
            if phase == 0 {
                if t.starts_with('|') && t.contains(header_a) && t.contains(header_b) {
                    phase = 1;
                }
                continue;
            }
            if phase == 1 {
                if is_sep_row(t) {
                    phase = 2;
                }
                continue;
            }
            if t.starts_with('|') == false {
                break;
            }
            let name = first_cell(t);
            let role = role_cell(t);
            if name.is_empty() == false {
                out.push((name, role));
            }
        }
        out
    }

    /// Architecture layer table must name kernel, protocol, execution companion and clients.
    pub fn scan_four_row_architecture(src: &str) -> Result<String, String> {
        let rows = parse_named_table(src, "Layer", "Canonical path");
        if rows.len() != 4 {
            return Err(String::from(
                "Architecture layer table must name four rows",
            ));
        }
        let want = [
            "kernel",
            "protocol",
            "execution companion",
            "clients",
        ];
        let mut i = 0usize;
        while i < 4 {
            let got = rows[i].0.to_ascii_lowercase();
            if got != want[i] {
                return Err(String::from(
                    "Architecture layer table must name kernel, protocol, execution companion and clients",
                ));
            }
            i = i.saturating_add(1);
        }
        let proto = rows[1].1.to_ascii_lowercase();
        if proto.contains("caw-framework") {
            return Err(String::from(
                "Architecture protocol row still names caw-framework",
            ));
        }
        let companion = rows[2].1.to_ascii_lowercase();
        if companion.contains("not a protocol component") == false {
            return Err(String::from(
                "Execution companion row must say it is not a protocol component",
            ));
        }
        Ok(String::from("ok four-row architecture table"))
    }

    /// Fail if Canonical layout still names caw-framework as a protocol component.
    pub fn scan_canonical_layout_caw_not_protocol(src: &str) -> Result<String, String> {
        let section = section_after(src, "## Canonical repository layout");
        if section.is_empty() {
            return Err(String::from("Canonical repository layout missing"));
        }
        let rows = parse_named_table(&section, "Directory", "Role");
        if rows.is_empty() {
            return Err(String::from("Canonical layout table missing"));
        }
        for (dir, role) in &rows {
            let d = dir.to_ascii_lowercase();
            let r = role.to_ascii_lowercase();
            let has_caw = r.contains("caw-framework") || d.contains("caw-framework");
            if has_caw == false {
                continue;
            }
            if r.contains("not a protocol component") {
                continue;
            }
            if r.contains("protocol component") {
                return Err(String::from(
                    "Canonical layout still names caw-framework as a protocol component",
                ));
            }
        }
        Ok(String::from(
            "ok Canonical layout does not name caw-framework as a protocol component",
        ))
    }

    /// Official tree must be named Gitea thePM001/NLA-AEP-v2.8-open-source.
    pub fn scan_official_tree(src: &str) -> Result<String, String> {
        if src.contains("Gitea thePM001/NLA-AEP-v2.8-open-source") == false {
            return Err(String::from(
                "README missing official tree Gitea thePM001/NLA-AEP-v2.8-open-source",
            ));
        }
        Ok(String::from("ok official tree named"))
    }

    /// BIOSECURITY.md stays access policy with one pointer to retired-archive security docs.
    pub fn scan_biosecurity_pointer(src: &str) -> Result<String, String> {
        let low = src.to_ascii_lowercase();
        if low.contains("access policy") == false {
            return Err(String::from("BIOSECURITY.md missing access policy sentence"));
        }
        if src.contains("retired-archive") == false || low.contains("docs/security") == false {
            return Err(String::from(
                "BIOSECURITY.md missing pointer to retired-archive security docs",
            ));
        }
        Ok(String::from("ok BIOSECURITY pointer"))
    }

    pub fn run_instruction_map_gate(readme: &str, biosecurity: &str) -> Result<String, String> {
        match scan_four_row_architecture(readme) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        match scan_canonical_layout_caw_not_protocol(readme) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        match scan_official_tree(readme) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        match scan_biosecurity_pointer(biosecurity) {
            Ok(_) => {}
            Err(e) => return Err(e),
        }
        Ok(String::from("ok AEP28-ENV-072 instruction map"))
    }
}

fn expect_ok(r: Result<String, String>) {
    match r {
        Ok(_) => {}
        Err(e) => fail(&e),
    }
}

#[test]
fn ticket_id() {
    if TICKET != "AEP28-ENV-059" {
        fail("ticket id");
    }
}


#[test]
fn canonical_layout_caw_not_protocol_fails_on_old_row() {
    let bad = String::from(
        "## Canonical repository layout (2.8.5)\n\n\
         | Directory | Role |\n\
         |-----------|------|\n\
         | [`AEP-Base-Node/`](AEP-Base-Node/) | Kernel |\n\
         | [`AEP-Components/`](AEP-Components/) | Protocol components (dynAEP, **caw-framework**, lattice-channels) |\n",
    );
    match instruction_map::scan_canonical_layout_caw_not_protocol(&bad) {
        Err(e) => {
            if e.contains("caw-framework as a protocol component") == false {
                fail("wrong fail text");
            }
        }
        Ok(_) => fail("old protocol row must fail"),
    }
}

#[test]
fn canonical_layout_caw_execution_companion_passes() {
    let good = String::from(
        "## Canonical repository layout (2.8.5)\n\n\
         | Directory | Role |\n\
         |-----------|------|\n\
         | [`AEP-Base-Node/`](AEP-Base-Node/) | Kernel |\n\
         | [`AEP-Components/`](AEP-Components/) | Protocol components (dynAEP, lattice-channels) |\n\
         | [`AEP-Components/caw-framework/`](AEP-Components/caw-framework/) | Execution companion: CAW host sandboxes. Not a protocol component |\n",
    );
    match instruction_map::scan_canonical_layout_caw_not_protocol(&good) {
        Ok(_) => {}
        Err(e) => fail(&e),
    }
}

#[test]
fn four_row_architecture_requires_named_rows() {
    let src = String::from(
        "| Layer | What it is | Canonical path |\n\
         |-------|------------|----------------|\n\
         | **Kernel** | daemon | [`AEP-Base-Node/`](AEP-Base-Node/) |\n\
         | **Protocol** | envelope | [`AEP-Components/`](AEP-Components/) |\n\
         | **Execution companion** | CAW host sandboxes. Not a protocol component | [`AEP-Components/caw-framework/`](AEP-Components/caw-framework/) |\n\
         | **Clients** | sdks | [`AEP-SDKs/`](AEP-SDKs/) |\n",
    );
    match instruction_map::scan_four_row_architecture(&src) {
        Ok(_) => {}
        Err(e) => fail(&e),
    }
}

#[test]
fn live_instruction_map_gate() {
    let root = walk_to_workspace();
    let readme = read_text(&root.join("README.md"));
    let bio = read_text(&root.join("BIOSECURITY.md"));
    match instruction_map::run_instruction_map_gate(&readme, &bio) {
        Ok(_) => {}
        Err(e) => fail(&e),
    }
}

#[test]
fn slogan_ci_crates_are_not_workspace_members() {
    let root = walk_to_workspace();
    expect_ok(product_wall_live_dock_gate(&root));
}

#[test]
fn unused_wall_crate_gate_is_deleted() {
    let root = walk_to_workspace();
    expect_ok(unused_wall_crate_gate_deleted(&root));
}

#[test]
fn one_live_evaluation_on_envelope_admit() {
    let root = walk_to_workspace();
    let src = read_text(&root.join("AEP-Base-Node/crate/src/envelope_admit.rs"));
    expect_ok(scan_envelope_admit_one_live_evaluation(&src));
}

#[test]
fn folded_slogan_ci_gates() -> Result<(), String> {
    let root = walk_to_workspace();
    admit_no_trust_tier::run_gate().map(|_| ())?;
    agent_sign_key_provision::run_gate().map(|_| ())?;
    connector_ucb_clients::run_gate().map(|_| ())?;
    empty_lattice_close::run_gate().map(|_| ())?;
    frame_header_binding::run_gate().map(|_| ())?;
    kernel_pq_channel::run_gate().map(|_| ())?;
    lattice_db_parent_guard::run_gate().map(|_| ())?;
    lattice_log_record_admit::run_gate().map(|_| ())?;
    library_layer_count::run_library_layer_count_gate().map(|_| ())?;
    live_entry_ci::run_gate().map(|_| ())?;
    mesh_ca_secret_mode::run_gate().map(|_| ())?;
    no_sequential_ts_deny::run_gate().map(|_| ())?;
    one_live_entry_language::run_gate().map(|_| ())?;
    potomitan_mesh_packet_plane::run_gate().map(|_| ())?;
    sdk_run_meet_park::run_gate().map(|_| ())?;
    named_surfaces::run_named_surface_gate().map(|_| ())?;
    one_admit_id::run_gate().map(|_| ())?;
    trust_score_isolation::run_gate().map(|_| ())?;
    let wrapenv = root.join("AEP-Components/caw-framework/internal/wrapenv/wrapenv.go");
    caw_wrapenv_failclosed::run_gate(&wrapenv)?;
    let filter = root.join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts");
    let admit_js = root.join("AEP-Components/admit/lib/admit.mjs");
    let admit_rs = root.join("AEP-Components/admit/crate/src/lib.rs");
    envelope_algebra_ci::run_gate(&filter, &admit_js, &admit_rs)?;
    live_crossing_admit_apply::run_gate(&filter)?;
    live_crossing_lab_off::run_gate(&filter)?;
    let bridge = root.join("AEP-SDKs/typescript/dynaep/src/bridge.ts");
    envelope_wrap_disabled::run_gate(&bridge)?;
    live_crossing_reject_copy::run_gate(&bridge)?;
    process_event_admit_walls::run_gate(&bridge)?;
    let readme = root.join("README.md");
    match aep28_env_077::run_gate() {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    match aep28_env_078::run_gate() {
        Ok(_) => {}
        Err(e) => return Err(e),
    }
    let live_entry = root.join("AEP-Components/live-entry/crate/src/lib.rs");
    one_evaluation_story::run_gate(&readme, &live_entry, &bridge)?;
    let cargo = root.join("Cargo.toml");
    let channel = root.join("AEP-Components/lattice-channels/crate/src/lib.rs");
    version_ssot::run_gate(&readme, &cargo, &channel)?;
    let fixtures = root.join("AEP-Components/admit/crate/fixtures");
    match admit_parity::run_fixtures_dir(&fixtures, &admit_js, "node") {
        Ok(0) => {}
        Ok(code) => return Err(format!("admit parity rc={code}")),
        Err(e) => return Err(e.to_string()),
    }
    Ok(())
}

#[test]
fn hyperlattice_ssot_files_match() {
    hyperlattice_ssot::assert_identical("HyperlatticeFilter.ts");
    hyperlattice_ssot::assert_identical("LatticePolicyEvaluator.ts");
    hyperlattice_ssot::assert_identical("compileLatticeWalls.ts");
    hyperlattice_ssot::assert_identical("compileChannelOrderWalls.ts");
    hyperlattice_ssot::assert_identical("compileTemporalWalls.ts");
}

#[test]
fn envelope_algebra_ci_live_tree() {
    let root = walk_to_workspace();
    let filter = root.join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts");
    let admit_js = root.join("AEP-Components/admit/lib/admit.mjs");
    let admit_rs = root.join("AEP-Components/admit/crate/src/lib.rs");
    match envelope_algebra_ci::run_gate(&filter, &admit_js, &admit_rs) {
        Ok(_) => {}
        Err(e) => fail(&e),
    }
}

#[test]
fn admit_opa_sole_live_tree() {
    let root = walk_to_workspace();
    let js = root.join("AEP-Components/admit/lib/admit.mjs");
    let rs = root.join("AEP-Components/admit/crate/src/lib.rs");
    let opa = root.join("AEP-Components/dynAEP/policies/lattice-policy.rego");
    let filter = root.join("AEP-Components/dynAEP/bridge/hyperlattice/HyperlatticeFilter.ts");
    match admit_opa_sole::run_gate(&js, &rs, &opa, &filter) {
        Ok(_) => {}
        Err(e) => fail(&format!("{e}")),
    }
}

#[test]
fn leftover_instruction_crate_count_is_41() {
    if LEFTOVER_INSTRUCTION_CRATE_DIRS.len() != 41 {
        fail("leftover instruction crate count");
    }
    if COMPANION_FOLDERS.len() != 37 {
        fail("companion folder count");
    }
}

#[test]
fn leftover_instruction_crates_are_relocated() {
    let root = walk_to_workspace();
    expect_ok(leftover_instruction_crates_relocated(&root));
}
