// Dock Deny returns closed-wall ids and mechanical repair.
// ClosedWall carries class writing, security, temporal, capability, poison or structural.
// CORRECTWRITING_EN writing walls stay protocol law at priority 255. Writing walls are not transport security.
// Unbound scene, dock, time, sequence and writing.gap get prescribed fixes.
// Grant lists stay off repair.fix. No lattice-memory lookup. Reseal a new capsule.
use std::fs;
use std::io::Write;
use std::path::PathBuf;

pub const KIND_BIND_FIELD: &str = "bind_field";
pub const KIND_REWRITE_WRITING: &str = "rewrite_writing";
pub const KIND_RESEAL_NEW_CAPSULE: &str = "reseal_new_capsule";
pub const KIND_CLOSED_ONLY: &str = "closed_only";
// the dock Deny public type set is defined once in
// aep-kernel-types and re-exported here.
pub use aep_kernel_types::{
    classify_wall, ClosedWall, DenyReport, RepairHint, CLASS_CAPABILITY, CLASS_POISON,
    CLASS_SECURITY, CLASS_STRUCTURAL, CLASS_TEMPORAL, CLASS_WRITING,
};

// the DenyReport constructors live with the type in
// aep-kernel-types.
pub use aep_kernel_types::{
    from_closed, from_error, from_error_and_closed, grant_leaks_in_fix, repairs_for,
};

fn extract_fn(src: &str, needle: &str) -> String {
    let start = match src.find(needle) {
        Some(v) => v,
        None => return String::new(),
    };
    let rest = &src[start..];
    let bytes = rest.as_bytes();
    let mut i = 0usize;
    let mut start_brace = None;
    while i < bytes.len() {
        if bytes[i] == 123 {
            start_brace = Some(i);
            break;
        }
        i = i.saturating_add(1);
    }
    let brace = match start_brace {
        Some(v) => v,
        None => return String::new(),
    };
    let mut depth: i32 = 0;
    i = brace;
    while i < bytes.len() {
        if bytes[i] == 123 {
            depth += 1;
        } else if bytes[i] == 125 {
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
    compact(&strip_line_comments(src))
}

pub fn scan_dock_deny_field(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub struct DockFrameResponse");
    if body.is_empty() {
        return Err(String::from("DockFrameResponse not found"));
    }
    let code = prod_src(&body);
    if code.contains("pubdeny:Option") == false {
        return Err(String::from("DockFrameResponse missing deny field"));
    }
    if src.contains("admit_sealed_payload_report") == false {
        return Err(String::from("docking.rs does not call admit_sealed_payload_report"));
    }
    if src.contains("deny_resp_report") == false {
        return Err(String::from("docking.rs missing deny_resp_report"));
    }
    Ok(String::from("ok DockFrameResponse carries deny"))
}

pub fn scan_live_entry_closed(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub struct Rejection");
    if body.is_empty() {
        return Err(String::from("Rejection not found"));
    }
    let code = prod_src(&body);
    if code.contains("pubclosed:Vec<AdmitWall>") == false {
        return Err(String::from("Rejection missing closed walls"));
    }
    let proc = extract_fn(src, "pub fn process_event");
    let pcode = prod_src(&proc);
    if pcode.contains("closed_walls") == false {
        return Err(String::from("process_event does not copy closed_walls onto Rejection"));
    }
    Ok(String::from("ok Rejection carries closed walls"))
}

pub fn scan_ucb_deny_field(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub struct DockResponse");
    if body.is_empty() {
        return Err(String::from("UCB DockResponse not found"));
    }
    let code = prod_src(&body);
    if code.contains("pubdeny:Option") == false {
        return Err(String::from("UCB DockResponse missing deny field"));
    }
    if src.contains("LatticeDeny") == false {
        return Err(String::from("UCB missing LatticeDeny"));
    }
    Ok(String::from("ok UCB forwards deny"))
}

pub fn scan_no_lookup(src: &str) -> Result<String, String> {
    let a = ["attr", "actor"].concat();
    let b = ["cos", "ine"].concat();
    let c = ["lattice", "-", "memory"].concat();
    let code = prod_src(src);
    if code.contains(&a) {
        return Err(String::from("crate must not look up forensic store entries"));
    }
    if code.contains(&b) {
        return Err(String::from("crate must not score forensic store entries"));
    }
    if code.contains(&c) {
        return Err(String::from("crate must not import the forensic store"));
    }
    Ok(String::from("ok no forensic lookup"))
}

pub fn scan_repairs_have_no_grant_lists() -> Result<String, String> {
    let sample = vec![
        ClosedWall::with_class(
            "scene.membership",
            "empty proven scene set closes membership",
            CLASS_STRUCTURAL,
        ),
        ClosedWall::with_class(
            "channel.dock",
            "empty allowed docks closes channel",
            CLASS_STRUCTURAL,
        ),
        ClosedWall::with_class(
            "gap.agent_permission",
            "GAP dimension closed: empty grants fail closed",
            CLASS_CAPABILITY,
        ),
    ];
    let report = from_closed(&sample);
    for h in &report.repairs {
        if grant_leaks_in_fix(&h.fix) {
            return Err(String::from("repair.fix leaked a grant list field"));
        }
    }
    Ok(String::from("ok repairs omit grant lists"))
}

fn walk_to_workspace() -> PathBuf {
    let mut dir = if let Ok(m) = std::env::var("CARGO_MANIFEST_DIR") {
        PathBuf::from(m)
    } else {
        std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
    };
    let mut i = 0usize;
    while i < 16 {
        let dock = dir.join("AEP-Base-Node/crate/src/docking.rs");
        if dock.is_file() {
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

fn read_text(path: &PathBuf) -> String {
    fs::read_to_string(path).unwrap_or_default()
}

pub fn run_gate() -> Result<i32, String> {
    let root = walk_to_workspace();
    let dock = read_text(&root.join("AEP-Base-Node/crate/src/docking.rs"));
    let live = read_text(&root.join("AEP-Components/live-entry/crate/src/lib.rs"));
    let ucb = read_text(&root.join("AEP-Docks/ucb/crate/src/lattice.rs"));
    let self_src = read_text(&root.join("AEP-Components/wall-set-backpressure/crate/src/lib.rs"));
    let proofs = [
        scan_dock_deny_field(&dock)?,
        scan_live_entry_closed(&live)?,
        scan_ucb_deny_field(&ucb)?,
        scan_no_lookup(&self_src)?,
        scan_repairs_have_no_grant_lists()?,
        scan_closed_wall_has_class(&self_src)?,
        scan_docking_sets_class(&dock)?,
        scan_admit_sets_class(&root.join("AEP-Base-Node/crate/src/envelope_admit.rs"))?,
    ];
    for proof in proofs {
        let mut line = String::from("aep-wall-set-backpressure ok proof=");
        line.push_str(&proof);
        line.push_str("\n");
        let _ = std::io::stdout().write_all(line.as_bytes());
    }
    Ok(0)
}


pub fn scan_closed_wall_has_class(src: &str) -> Result<String, String> {
    let body = extract_fn(src, "pub struct ClosedWall");
    if body.is_empty() {
        return Err(String::from("ClosedWall not found"));
    }
    let code = prod_src(&body);
    if code.contains("pubclass:String") == false {
        return Err(String::from("ClosedWall missing class"));
    }
    Ok(String::from("ok ClosedWall carries class"))
}

pub fn scan_docking_sets_class(src: &str) -> Result<String, String> {
    if src.contains("ClosedWall") == false {
        return Err(String::from("docking.rs has no ClosedWall construction"));
    }
    if src.contains("CLASS_WRITING") == false
        || src.contains("CLASS_SECURITY") == false
        || src.contains("CLASS_TEMPORAL") == false
        || src.contains("CLASS_POISON") == false
    {
        return Err(String::from("docking.rs does not set ClosedWall class"));
    }
    if src.contains("mod docking") {
        return Err(String::from("docking.rs must stay one file"));
    }
    Ok(String::from("ok docking.rs sets ClosedWall class and stays one file"))
}

pub fn scan_admit_sets_class(path: &PathBuf) -> Result<String, String> {
    let src = read_text(path);
    if src.contains("class:") == false && src.contains("classify_wall") == false && src.contains("CLASS_") == false {
        return Err(String::from("envelope_admit.rs does not set ClosedWall class"));
    }
    Ok(String::from("ok envelope_admit.rs sets ClosedWall class"))
}

// HVVCAS: from_closed domain:admit type:library
pub mod from_closed {
    pub struct FromClosed {
        pub src: String,
        pub report: String,
    }
    impl FromClosed {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                report: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let wall = super::ClosedWall::with_class(
                self.src.clone(),
                "no scene bound",
                super::CLASS_STRUCTURAL,
            );
            let r = super::from_closed(&[wall]);
            self.report = r.error.clone();
            Ok(())
        }
    }
}

// HVVCAS: repairs_for domain:admit type:library
pub mod repairs_for {
    pub struct RepairsFor {
        pub src: String,
        pub repairs: String,
    }
    impl RepairsFor {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                repairs: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            let wall = super::ClosedWall::with_class(
                self.src.clone(),
                "no scene bound",
                super::CLASS_STRUCTURAL,
            );
            let r = super::repairs_for(&[wall]);
            self.repairs = r
                .iter()
                .map(|h| h.fix.clone())
                .collect::<Vec<String>>()
                .join("; ");
            Ok(())
        }
    }
}

// HVVCAS: scan_dock_deny_field domain:admit type:service
pub mod scan_dock_deny_field {
    pub struct ScanDockDenyField {
        pub src: String,
        pub scan: String,
    }
    impl ScanDockDenyField {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_dock_deny_field(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// HVVCAS: scan_live_entry_closed domain:admit type:service
pub mod scan_live_entry_closed {
    pub struct ScanLiveEntryClosed {
        pub src: String,
        pub scan: String,
    }
    impl ScanLiveEntryClosed {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_live_entry_closed(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// HVVCAS: scan_ucb_deny_field domain:admit type:service
pub mod scan_ucb_deny_field {
    pub struct ScanUcbDenyField {
        pub src: String,
        pub scan: String,
    }
    impl ScanUcbDenyField {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_ucb_deny_field(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
        }
    }
}

// HVVCAS: scan_no_lookup domain:admit type:service
pub mod scan_no_lookup {
    pub struct ScanNoLookup {
        pub src: String,
        pub scan: String,
    }
    impl ScanNoLookup {
        pub fn new() -> Self {
            Self {
                src: String::new(),
                scan: String::new(),
            }
        }
        pub fn process(&mut self) -> anyhow::Result<()> {
            match super::scan_no_lookup(&self.src) {
                Ok(v) => self.scan = v,
                Err(e) => self.scan = e,
            }
            Ok(())
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
    #[test]
    fn unbound_scene_binds_target_id() {
        let r = from_closed(&[ClosedWall::with_class(
            "scene.membership",
            "no scene bound",
            CLASS_STRUCTURAL,
        )]);
        must(r.reseal_required);
        must(r.closed.iter().any(|w| w.id == "scene.membership"));
        must(r.repairs.iter().any(|h| h.field == "target_id" && h.kind == KIND_BIND_FIELD));
        must(r.repairs.iter().any(|h| h.kind == KIND_RESEAL_NEW_CAPSULE));
    }

    #[test]
    fn unbound_dock_binds_dest_dock() {
        let r = from_closed(&[ClosedWall::with_class(
            "channel.dock",
            "no dock bound",
            CLASS_STRUCTURAL,
        )]);
        must(r.repairs.iter().any(|h| h.field == "dest_dock" && h.kind == KIND_BIND_FIELD));
    }

    #[test]
    fn unbound_time_binds_timestamp() {
        let r = from_closed(&[ClosedWall::with_class(
            "time.authority",
            "no timestamps",
            CLASS_TEMPORAL,
        )]);
        must(r.repairs.iter().any(|h| h.field == "timestamp" && h.kind == KIND_BIND_FIELD));
        must(r.repairs.iter().any(|h| h.fix.contains("50 ms drift")));
    }

    #[test]
    fn unbound_sequence_binds_seq() {
        let r = from_closed(&[ClosedWall::with_class(
            "causal.sequence",
            "no sequence bound",
            CLASS_STRUCTURAL,
        )]);
        must(r.repairs.iter().any(|h| h.field == "_sequenceNumber" && h.kind == KIND_BIND_FIELD));
    }

    #[test]
    fn writing_em_dash_prescribes_hyphen() {
        let r = from_closed(&[ClosedWall::with_class(
            "writing:no_em_dashes",
            "Em dash U+2014 forbidden by writing.gap",
            CLASS_WRITING,
        )]);
        must(r.repairs.iter().any(|h| h.kind == KIND_REWRITE_WRITING && h.fix.contains("U+2014")));
    }

    #[test]
    fn grant_lists_stay_off_repair_fix() {
        match scan_repairs_have_no_grant_lists() {
            Ok(v) => must(v.contains("ok repairs omit grant lists")),
            Err(_) => std::process::abort(),
        }
    }

    #[test]
    fn closed_set_key_ignores_order() {
        let a = from_closed(&[
            ClosedWall::with_class("b", "two", CLASS_STRUCTURAL),
            ClosedWall::with_class("a", "one", CLASS_STRUCTURAL),
        ]);
        let b = from_closed(&[
            ClosedWall::with_class("a", "one", CLASS_STRUCTURAL),
            ClosedWall::with_class("b", "two", CLASS_STRUCTURAL),
        ]);
        must(a.closed_set_key == b.closed_set_key);
    }

    #[test]
    fn from_error_replay_reseals() {
        let r = from_error("frame replay rejected: abc");
        must(r.closed.iter().any(|w| w.id == "digest.replay"));
        must(r.repairs.iter().any(|h| h.kind == KIND_RESEAL_NEW_CAPSULE));
        must(r.error.contains("frame replay rejected"));
    }

    #[test]
    fn scan_dock_missing_deny_fails() {
        let bad = "pub struct DockFrameResponse { pub ok: bool }";
        match scan_dock_deny_field(bad) {
            Err(e) => must(e.contains("missing deny field") || e.contains("does not call")),
            Ok(_) => std::process::abort(),
        }
    }

    #[test]
    fn scan_live_missing_closed_fails() {
        let bad = "pub struct Rejection { pub target_id: String, pub error: String }";
        match scan_live_entry_closed(bad) {
            Err(e) => must(e.contains("missing closed walls")),
            Ok(_) => std::process::abort(),
        }
    }

    #[test]
    fn hvvc_from_closed_process() {
        let mut st = from_closed::FromClosed::new();
        st.src = String::from("scene.membership");
        must(st.process().is_ok());
        must(st.report.contains("Admit collect-all walls then Apply"));
    }

    #[test]
    fn writing_wall_class_is_writing() {
        let r = from_closed(&[ClosedWall::with_class(
            "writing:no_em_dashes",
            "Em dash U+2014 forbidden by writing.gap",
            CLASS_WRITING,
        )]);
        must(r.closed.iter().any(|w| w.id == "writing:no_em_dashes" && w.class == CLASS_WRITING));
        let oxford = from_closed(&[ClosedWall::with_class(
            "writing:no_oxford_comma",
            "Oxford comma forbidden by writing.gap",
            CLASS_WRITING,
        )]);
        must(oxford.closed.iter().any(|w| w.class == CLASS_WRITING));
        let writing = from_error("CORRECTWRITING_EN writing violations remain after enforcement");
        must(writing.closed.iter().any(|w| w.class == CLASS_WRITING && w.id == "writing:correctwriting_en"));
    }

    #[test]
    fn replay_and_kem_class_is_security() {
        let r = from_error("frame replay rejected: abc");
        must(r.closed.iter().any(|w| w.id == "digest.replay" && w.class == CLASS_SECURITY));
        let kem = from_error("decrypt failed: kem secret must be 64-byte seed");
        must(kem.closed.iter().any(|w| w.id == "kem.open" && w.class == CLASS_SECURITY));
        must(classify_wall("kem.open", "signature invalid") == CLASS_SECURITY);
    }

    #[test]
    fn drift_age_freshness_skew_class_is_temporal() {
        let drift = from_closed(&[ClosedWall::with_class(
            "temporal:drift_exceeded",
            "clock drift exceeded 50 ms",
            CLASS_TEMPORAL,
        )]);
        must(drift.closed.iter().any(|w| w.class == CLASS_TEMPORAL));
        let age = from_error("pulse capsule aged out");
        must(age.closed.iter().any(|w| w.class == CLASS_TEMPORAL));
        let fresh = from_error("frame stale: sent_at_unix=1 older than 300s");
        must(fresh.closed.iter().any(|w| w.class == CLASS_TEMPORAL && w.id == "temporal:wire_freshness"));
        let skew = from_error("frame clock skew: sent_at_unix=9 too far in future");
        must(skew.closed.iter().any(|w| w.class == CLASS_TEMPORAL && w.id == "temporal:future_skew"));
    }

    #[test]
    fn agent_permission_class_is_capability() {
        let r = from_error("Lattice required but ActionLattice is not initialised");
        must(r.closed.iter().any(|w| w.id == "gap.agent_permission" && w.class == CLASS_CAPABILITY));
        must(r.closed.iter().any(|w| w.id == "dag.membership" && w.class == CLASS_STRUCTURAL));
    }

    #[test]
    fn mutex_poison_class_is_poison() {
        let r = from_error("poisoned lock: db");
        must(r.closed.iter().any(|w| w.id == "lock.poison" && w.class == CLASS_POISON));
    }

    #[test]
    fn unbound_scene_dock_sequence_class_is_structural() {
        let scene = from_closed(&[ClosedWall::with_class(
            "scene.membership",
            "no scene bound",
            CLASS_STRUCTURAL,
        )]);
        must(scene.closed.iter().any(|w| w.class == CLASS_STRUCTURAL));
        let dock = from_closed(&[ClosedWall::with_class(
            "channel.dock",
            "no dock bound",
            CLASS_STRUCTURAL,
        )]);
        must(dock.closed.iter().any(|w| w.class == CLASS_STRUCTURAL));
        let seq = from_closed(&[ClosedWall::with_class(
            "causal.sequence",
            "no sequence bound",
            CLASS_STRUCTURAL,
        )]);
        must(seq.closed.iter().any(|w| w.class == CLASS_STRUCTURAL));
    }

    #[test]
    fn closed_wall_struct_has_class() {
        match scan_closed_wall_has_class(include_str!("lib.rs")) {
            Ok(v) => must(v.contains("ok ClosedWall carries class")),
            Err(_) => std::process::abort(),
        }
    }

    #[test]
    fn writing_class_is_not_security_class() {
        must(CLASS_WRITING != CLASS_SECURITY);
        let w = ClosedWall::with_class("writing:no_double_hyphen", "double hyphen", CLASS_WRITING);
        must(w.class != CLASS_SECURITY);
    }
}

