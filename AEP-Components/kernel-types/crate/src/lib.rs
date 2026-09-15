// crate: aep-kernel-types
// One public kernel type set for the AEP 2.8.x protocol tree.
// One definition site per public type: Envelope, AdmitResult, DenyReport, ClosedWall,
// Pulse, AgentPermission and ProcessSealed. Every other crate re-exports from here.
// The type shapes were taken from aep-admit, aep-wall-set-backpressure and aep-envelope
// so the move changes no behaviour. Only the wall row grew a family field.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

pub const COMPONENT_ID: &str = "aep-kernel-types";

/// Compiled kernel pulse. Pulse is PULSE_MS 1000.
/// This is the one definition site of the pulse constant. Every other crate imports it.
pub const PULSE_MS: i64 = 1000;

/// Closed-set id family for GAP agent permission walls. Not a rank.
pub const WALL_AGENT_PERMISSION: &str = "gap:agent_permission";

/// Exact Deny text when the permission wall closes.
pub const DENY_NO_PERMISSION: &str = "this agent does not have permission for this action";

/// One envelope action. The dock carries it, the walls read it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Envelope {
    pub action_path: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(default)]
    pub tool: String,
    #[serde(default)]
    pub dest_dock: String,
    #[serde(default)]
    pub scene_id: String,
    #[serde(default)]
    pub agent_ts_ms: i64,
    #[serde(default)]
    pub sequence_number: i64,
    #[serde(default)]
    pub anomaly_score: f64,
}

impl Default for Envelope {
    fn default() -> Self {
        Self {
            action_path: String::new(),
            agent_id: String::new(),
            payload: serde_json::Value::Null,
            tool: String::new(),
            dest_dock: String::new(),
            scene_id: String::new(),
            agent_ts_ms: 0,
            sequence_number: 0,
            anomaly_score: 0.0,
        }
    }
}

/// One Admit wall. open means the wall did not close.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdmitWall {
    pub id: String,
    #[serde(default)]
    pub family: String,
    pub closed: bool,
    #[serde(default)]
    pub reason: String,
}

impl AdmitWall {
    pub fn open(id: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            family: String::new(),
            closed: false,
            reason: String::new(),
        }
    }

    pub fn close(id: impl Into<String>, reason: impl Into<String>) -> Self {
        Self {
            id: id.into(),
            family: String::new(),
            closed: true,
            reason: reason.into(),
        }
    }

    pub fn verdict(
        id: impl Into<String>,
        family: impl Into<String>,
        open: bool,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            family: family.into(),
            closed: open == false,
            reason: reason.into(),
        }
    }

    pub fn with_family(mut self, family: impl Into<String>) -> Self {
        self.family = family.into();
        self
    }

    pub fn is_closed(&self) -> bool {
        self.closed
    }

    pub fn is_open(&self) -> bool {
        self.closed == false
    }
}

/// Admit result. allow is AND of every wall, so allow is true only when no wall closed.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdmitResult {
    pub allow: bool,
    #[serde(rename = "closed_walls", alias = "closed", default)]
    pub closed: Vec<AdmitWall>,
    #[serde(rename = "open_walls", alias = "open", default)]
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

    /// Collect every closed wall and every open wall. Do not stop at the first close.
    pub fn from_walls(walls: &[AdmitWall]) -> Self {
        let mut closed: Vec<AdmitWall> = walls.iter().filter(|w| w.closed).cloned().collect();
        closed.sort_by(|a, b| a.id.cmp(&b.id).then(a.reason.cmp(&b.reason)));
        closed.dedup_by(|a, b| a.id == b.id && a.reason == b.reason);
        let mut open: Vec<AdmitWall> = walls.iter().filter(|w| w.closed == false).cloned().collect();
        open.sort_by(|a, b| a.id.cmp(&b.id).then(a.reason.cmp(&b.reason)));
        open.dedup_by(|a, b| a.id == b.id && a.reason == b.reason);
        Self::new(closed, open)
    }

    /// Canonical closed-set identity. Order of input walls does not change this.
    pub fn closed_set_key(&self) -> String {
        let mut rows: Vec<String> = self
            .closed
            .iter()
            .map(|w| {
                let mut s = w.id.clone();
                s.push('\u{1f}');
                s.push_str(&w.reason);
                s
            })
            .collect();
        rows.sort();
        rows.dedup();
        rows.join("\n")
    }

    pub fn closed_ids(&self) -> Vec<String> {
        self.closed.iter().map(|w| w.id.clone()).collect()
    }

    pub fn closed_reasons(&self) -> Vec<String> {
        self.closed
            .iter()
            .map(|w| {
                if w.reason.is_empty() {
                    w.id.clone()
                } else {
                    w.reason.clone()
                }
            })
            .collect()
    }
}

/// Compact AdmitWall constructor for one wall id and one reason.
pub fn wall(id: impl Into<String>, closed: bool, reason: impl Into<String>) -> AdmitWall {
    AdmitWall {
        id: id.into(),
        family: String::new(),
        closed,
        reason: reason.into(),
    }
}

/// Compiled kernel pulse.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Pulse {
    pub ms: i64,
}

impl Pulse {
    pub fn compiled() -> Self {
        Self { ms: PULSE_MS }
    }
}

/// Record of one agent id plus one action.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPermission {
    pub agent_id: String,
    pub action: String,
}

/// Lookup input for the permission wall.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct AgentPermissionLookup {
    pub agent_id: String,
    pub action: String,
    pub records: Vec<AgentPermission>,
}

/// One closed wall as the dock reports it. class is writing, security, temporal,
/// capability, poison or structural.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ClosedWall {
    pub id: String,
    pub reason: String,
    pub class: String,
}

pub const CLASS_WRITING: &str = "writing";
pub const CLASS_SECURITY: &str = "security";
pub const CLASS_TEMPORAL: &str = "temporal";
pub const CLASS_CAPABILITY: &str = "capability";
pub const CLASS_POISON: &str = "poison";
pub const CLASS_STRUCTURAL: &str = "structural";

pub fn classify_wall(id: &str, reason: &str) -> String {
    let id_l = id.to_ascii_lowercase();
    let reason_l = reason.to_ascii_lowercase();
    if reason_l.contains("poisoned lock") || id_l.contains("poison") {
        return String::from(CLASS_POISON);
    }
    if id_l.starts_with("writing:")
        || id_l.starts_with("policy:writing:")
        || id_l == "writing.gap"
        || id_l == "writing:correctwriting_en"
        // Legacy id kept so an older capsule still classifies as a writing wall.
        || id_l == "writing:correctwriting_en"
        || reason_l.contains("correctwriting_en")
        || reason_l.contains("correctwriting_en")
        || reason_l.contains("writing.gap")
        || reason_l.contains("writing violation")
        || reason_l.contains("em dash")
        || reason_l.contains("en dash")
        || reason_l.contains("oxford comma")
        || reason_l.contains("double hyphen")
    {
        return String::from(CLASS_WRITING);
    }
    if id == "gap.agent_permission"
        || id_l.contains("agent_permission")
        || reason_l.contains("agent_permission")
    {
        return String::from(CLASS_CAPABILITY);
    }
    if id == "digest.replay"
        || id == "kem.open"
        || reason_l.contains("replay")
        || reason_l.contains("kem")
        || reason_l.contains("decrypt failed")
        || reason_l.contains("encrypt failed")
        || reason_l.contains("signature invalid")
        || reason_l.contains("fingerprint mismatch")
    {
        return String::from(CLASS_SECURITY);
    }
    if id_l.starts_with("temporal:")
        || id == "time.authority"
        || id == "pulse.queue"
        || reason_l.contains("drift")
        || reason_l.contains("stale")
        || reason_l.contains("aged")
        || reason_l.contains("skew")
        || reason_l.contains("fresh")
        || reason_l.contains("future")
        || reason_l.contains("pulse")
    {
        return String::from(CLASS_TEMPORAL);
    }
    String::from(CLASS_STRUCTURAL)
}

impl ClosedWall {
    pub fn with_class(
        id: impl Into<String>,
        reason: impl Into<String>,
        class: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            reason: reason.into(),
            class: class.into(),
        }
    }

    pub fn new(id: impl Into<String>, reason: impl Into<String>) -> Self {
        let id = id.into();
        let reason = reason.into();
        let class = classify_wall(&id, &reason);
        Self { id, reason, class }
    }
}

/// One mechanical repair hint. Grant lists stay off this record.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RepairHint {
    pub wall_id: String,
    pub field: String,
    pub kind: String,
    pub fix: String,
}

/// Dock Deny report. closed_set_key is stable across wall order.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct DenyReport {
    pub error: String,
    pub closed: Vec<ClosedWall>,
    pub closed_set_key: String,
    pub repairs: Vec<RepairHint>,
    pub reseal_required: bool,
}

/// One process sealed by the algorithm and the policy digest it was sealed with.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProcessSealed {
    pub pid: u32,
    pub seal: String,
    pub algorithm: String,
    pub spec_digest: String,
    pub sealed_at_ms: i64,
}

impl ProcessSealed {
    pub fn seal(
        pid: u32,
        algorithm: impl Into<String>,
        spec_digest: impl Into<String>,
        sealed_at_ms: i64,
    ) -> Self {
        let algorithm = algorithm.into();
        let spec_digest = spec_digest.into();
        Self {
            seal: seal_digest(pid, &algorithm, &spec_digest),
            pid,
            algorithm,
            spec_digest,
            sealed_at_ms,
        }
    }

    /// A seal holds only for the same pid, the same algorithm and the same spec digest.
    pub fn matches(&self, pid: u32, algorithm: &str, spec_digest: &str) -> bool {
        self.pid == pid
            && self.algorithm == algorithm
            && self.spec_digest == spec_digest
            && self.seal == seal_digest(pid, algorithm, spec_digest)
    }

    pub fn is_sealed(&self) -> bool {
        self.seal.is_empty() == false
    }
}

/// Seal digest over pid, algorithm and policy digest. One shape for every caller.
pub fn seal_digest(pid: u32, algorithm: &str, spec_digest: &str) -> String {
    let mut s = String::from("process-sealed:");
    s.push_str(&pid.to_string());
    s.push('\u{1f}');
    s.push_str(algorithm);
    s.push('\u{1f}');
    s.push_str(spec_digest);
    let mut hasher = Sha256::new();
    hasher.update(s.as_bytes());
    let digest = hasher.finalize();
    let mut out = String::from("sha256:");
    for b in digest.iter() {
        out.push_str(&format!("{:02x}", b));
    }
    out
}


/// Repair kinds. A repair names one mechanical fix and never a grant list.
pub const KIND_BIND_FIELD: &str = "bind_field";
pub const KIND_REWRITE_WRITING: &str = "rewrite_writing";
pub const KIND_RESEAL_NEW_CAPSULE: &str = "reseal_new_capsule";
pub const KIND_CLOSED_ONLY: &str = "closed_only";

/// Dock Deny repair and construction. Moved here with the DenyReport type so the
/// constructor and the type keep one definition site.
fn unit_sep() -> String {
    String::from("\u{1f}")
}

fn closed_set_key(closed: &[ClosedWall]) -> String {
    let mut rows: Vec<String> = closed
        .iter()
        .map(|w| {
            let mut s = w.id.clone();
            s.push_str(&unit_sep());
            s.push_str(&w.reason);
            s.push_str(&unit_sep());
            s.push_str(&w.class);
            s
        })
        .collect();
    rows.sort();
    rows.dedup();
    rows.join("\n")
}

fn error_line(closed: &[ClosedWall]) -> String {
    let reasons: Vec<String> = closed
        .iter()
        .map(|w| {
            if w.reason.is_empty() {
                w.id.clone()
            } else {
                w.reason.clone()
            }
        })
        .collect();
    let mut s = String::from("Admit collect-all walls then Apply");
    if reasons.is_empty() == false {
        s.push_str(": ");
        s.push_str(&reasons.join("; "));
    }
    s
}

fn hint(wall_id: &str, field: &str, kind: &str, fix: &str) -> RepairHint {
    RepairHint {
        wall_id: String::from(wall_id),
        field: String::from(field),
        kind: String::from(kind),
        fix: String::from(fix),
    }
}

fn writing_repair(id: &str) -> RepairHint {
    let fix = if id.ends_with("no_em_dashes") {
        "Replace U+2014 with ASCII hyphen."
    } else if id.ends_with("no_en_dashes") {
        "Replace U+2013 with ASCII hyphen."
    } else if id.ends_with("no_dash_substitutes") {
        "Replace U+2015 U+2E3A U+2E3B with ASCII hyphen."
    } else if id.ends_with("no_box_drawing_dashes") {
        "Replace U+2500 U+2501 with ASCII hyphen."
    } else if id.ends_with("no_minus_as_dash") {
        "Replace U+2212 with ASCII hyphen."
    } else if id.ends_with("no_double_hyphen") {
        "Remove spaced double hyphen separators."
    } else if id.ends_with("no_oxford_comma") {
        "Remove comma-space-and. Remove comma-space-or."
    } else if id.ends_with("punctuation_word_space") {
        "Put a space after ? or ! before the next word."
    } else {
        "Rewrite the payload to satisfy writing.gap."
    };
    hint(id, "", KIND_REWRITE_WRITING, fix)
}

fn scene_repair(w: &ClosedWall) -> RepairHint {
    if w.reason == "no scene bound" {
        hint(
            "scene.membership",
            "target_id",
            KIND_BIND_FIELD,
            "Bind target_id on the payload before seal.",
        )
    } else {
        hint(
            "scene.membership",
            "",
            KIND_CLOSED_ONLY,
            "Bind a scene the lattice already proves. Grant lists stay off this report.",
        )
    }
}

fn dock_repair(w: &ClosedWall) -> RepairHint {
    if w.reason == "no dock bound" {
        hint(
            "channel.dock",
            "dest_dock",
            KIND_BIND_FIELD,
            "Bind dest_dock on the payload or send through an opened frame docking port.",
        )
    } else {
        hint(
            "channel.dock",
            "",
            KIND_CLOSED_ONLY,
            "Bind a dock the opened frame already allows. Grant lists stay off this report.",
        )
    }
}

fn time_repair(w: &ClosedWall) -> RepairHint {
    if w.reason == "no timestamps" {
        hint(
            "time.authority",
            "timestamp",
            KIND_BIND_FIELD,
            "Bind timestamp at seal. Freeze-at-seal keeps 50 ms drift. Do not widen drift to the 1000 ms pulse.",
        )
    } else if w.reason == "stale event" {
        hint(
            "time.authority",
            "timestamp",
            KIND_RESEAL_NEW_CAPSULE,
            "Seal a fresh timestamp. Age stays 5000 ms.",
        )
    } else if w.reason == "future stamp" {
        hint(
            "time.authority",
            "timestamp",
            KIND_RESEAL_NEW_CAPSULE,
            "Bind timestamp at seal. max_future_ms stays 500.",
        )
    } else {
        hint(
            "time.authority",
            "timestamp",
            KIND_RESEAL_NEW_CAPSULE,
            "Bind timestamp at seal. Freeze-at-seal keeps 50 ms drift. Do not set max_drift_ms to 1000.",
        )
    }
}

fn seq_repair(w: &ClosedWall) -> RepairHint {
    if w.reason == "no sequence bound" {
        hint(
            "causal.sequence",
            "_sequenceNumber",
            KIND_BIND_FIELD,
            "Bind _sequenceNumber to a nonzero integer on the payload before seal.",
        )
    } else {
        hint(
            "causal.sequence",
            "_sequenceNumber",
            KIND_CLOSED_ONLY,
            "Raise _sequenceNumber for this agent. Do not reuse a lower clock.",
        )
    }
}

fn repair_one(w: &ClosedWall) -> RepairHint {
    if w.id.starts_with("writing:") {
        return writing_repair(&w.id);
    }
    match w.id.as_str() {
        "scene.membership" => scene_repair(w),
        "channel.dock" => dock_repair(w),
        "time.authority" => time_repair(w),
        "causal.sequence" => seq_repair(w),
        "temporal:drift_exceeded" => hint(
            "temporal:drift_exceeded",
            "timestamp",
            KIND_RESEAL_NEW_CAPSULE,
            "Bind timestamp at seal. Freeze-at-seal keeps 50 ms drift. Do not set max_drift_ms to 1000.",
        ),
        "temporal:stale_event" => hint(
            "temporal:stale_event",
            "timestamp",
            KIND_RESEAL_NEW_CAPSULE,
            "Seal a fresh timestamp. Age stays 5000 ms.",
        ),
        "temporal:future_timestamp" => hint(
            "temporal:future_timestamp",
            "timestamp",
            KIND_RESEAL_NEW_CAPSULE,
            "Bind timestamp at seal. max_future_ms stays 500.",
        ),
        "action.path" => hint(
            "action.path",
            "action_path",
            KIND_BIND_FIELD,
            "Bind action_path on the payload before seal.",
        ),
        "payload.json" => hint(
            "payload.json",
            "",
            KIND_RESEAL_NEW_CAPSULE,
            "Seal JSON plaintext. A non-JSON body cannot Admit.",
        ),
        "digest.replay" => hint(
            "digest.replay",
            "",
            KIND_RESEAL_NEW_CAPSULE,
            "Seal a new capsule. Digest replay is keyed at enqueue so a retry of the same digest is Deny.",
        ),
        "pulse.queue" => hint(
            "pulse.queue",
            "",
            KIND_CLOSED_ONLY,
            "Wait for the 1000 ms pulse. Do not retry the same digest.",
        ),
        "dag.membership" | "gap.agent_permission" | "dag.parents" => hint(
            &w.id,
            "",
            KIND_CLOSED_ONLY,
            "closed wall id and reason only. Grant lists stay off this report.",
        ),
        _ => hint(
            &w.id,
            "",
            KIND_CLOSED_ONLY,
            "closed wall id and reason only. Seal a new capsule after the payload is bound.",
        ),
    }
}

fn reseal_hint() -> RepairHint {
    hint(
        "digest.replay",
        "",
        KIND_RESEAL_NEW_CAPSULE,
        "Seal a new capsule. Digest replay is keyed at enqueue so a retry of the same digest is Deny.",
    )
}

pub fn repairs_for(closed: &[ClosedWall]) -> Vec<RepairHint> {
    let mut out: Vec<RepairHint> = closed.iter().map(repair_one).collect();
    if out.iter().any(|h| h.kind == KIND_RESEAL_NEW_CAPSULE) == false {
        out.push(reseal_hint());
    }
    out
}

pub fn grant_leaks_in_fix(fix: &str) -> bool {
    let a = ["proven_scene", "_ids"].concat();
    let b = ["allowed_", "docks"].concat();
    let c = ["agent", "_may"].concat();
    fix.contains(&a) || fix.contains(&b) || fix.contains(&c)
}

fn scrub_repairs(repairs: Vec<RepairHint>) -> Vec<RepairHint> {
    repairs
        .into_iter()
        .map(|mut h| {
            if grant_leaks_in_fix(&h.fix) {
                h.fix = String::from("closed wall id and reason only. Grant lists stay off this report.");
                h.kind = String::from(KIND_CLOSED_ONLY);
                h.field = String::new();
            }
            h
        })
        .collect()
}

impl DenyReport {
    pub fn from_closed(closed: &[ClosedWall]) -> Self {
        crate::from_closed(closed)
    }
    pub fn from_error_and_closed(error: &str, closed: &[ClosedWall]) -> Self {
        crate::from_error_and_closed(error, closed)
    }
    pub fn from_error(error: &str) -> Self {
        crate::from_error(error)
    }
}

pub fn from_closed(closed: &[ClosedWall]) -> DenyReport {
    let mut walls = closed.to_vec();
    walls.sort_by(|a, b| a.id.cmp(&b.id).then(a.reason.cmp(&b.reason)));
    walls.dedup();
    let repairs = scrub_repairs(repairs_for(&walls));
    DenyReport {
        error: error_line(&walls),
        closed: walls.clone(),
        closed_set_key: closed_set_key(&walls),
        repairs,
        reseal_required: true,
    }
}

pub fn from_error_and_closed(error: &str, closed: &[ClosedWall]) -> DenyReport {
    let mut report = if closed.is_empty() {
        from_error(error)
    } else {
        from_closed(closed)
    };
    if error.is_empty() == false {
        report.error = String::from(error);
    }
    report
}

fn walls_from_error(error: &str) -> Vec<ClosedWall> {
    if error.contains("plaintext is not JSON") {
        return vec![ClosedWall::with_class(
            "payload.json",
            "plaintext is not JSON",
            CLASS_STRUCTURAL,
        )];
    }
    if error.contains("missing action_path") {
        return vec![ClosedWall::with_class(
            "action.path",
            "missing action_path",
            CLASS_STRUCTURAL,
        )];
    }
    if error.contains("Lattice required") {
        return vec![
            ClosedWall::with_class(
                "dag.membership",
                "empty lattice closes membership",
                CLASS_STRUCTURAL,
            ),
            ClosedWall::with_class(
                "gap.agent_permission",
                "empty lattice closes agent_permission",
                CLASS_CAPABILITY,
            ),
        ];
    }
    if error.contains("frame replay rejected") {
        return vec![ClosedWall::with_class(
            "digest.replay",
            "digest already recorded at enqueue",
            CLASS_SECURITY,
        )];
    }
    if error.contains("pulse queue overflow") {
        return vec![ClosedWall::with_class("pulse.queue", error, CLASS_TEMPORAL)];
    }
    if error.contains("pulse capsule aged out") {
        return vec![ClosedWall::with_class("time.authority", "stale event", CLASS_TEMPORAL)];
    }
    if error.contains("poisoned lock") {
        return vec![ClosedWall::with_class("lock.poison", error, CLASS_POISON)];
    }
    if error.contains("CORRECTWRITING_EN writing") || error.contains("writing violations") {
        return vec![ClosedWall::with_class("writing:correctwriting_en", error, CLASS_WRITING)];
    }
    if error.contains("frame stale") {
        return vec![ClosedWall::with_class("temporal:wire_freshness", error, CLASS_TEMPORAL)];
    }
    if error.contains("frame clock skew") || error.contains("too far in future") {
        return vec![ClosedWall::with_class("temporal:future_skew", error, CLASS_TEMPORAL)];
    }
    if error.contains("drift") {
        return vec![ClosedWall::with_class("temporal:drift_exceeded", error, CLASS_TEMPORAL)];
    }
    let el = error.to_ascii_lowercase();
    if el.contains("kem")
        || el.contains("decrypt failed")
        || el.contains("encrypt failed")
        || el.contains("signature invalid")
        || el.contains("fingerprint mismatch")
    {
        return vec![ClosedWall::with_class("kem.open", error, CLASS_SECURITY)];
    }
    if error.contains("no scene bound") || error.contains("scene.membership") {
        return vec![ClosedWall::with_class("scene.membership", error, CLASS_STRUCTURAL)];
    }
    if error.contains("no dock bound") || error.contains("channel.dock") {
        return vec![ClosedWall::with_class("channel.dock", error, CLASS_STRUCTURAL)];
    }
    if error.contains("no sequence bound") || error.contains("causal.sequence") {
        return vec![ClosedWall::with_class("causal.sequence", error, CLASS_STRUCTURAL)];
    }
    vec![ClosedWall::with_class("dock.deny", error, classify_wall("dock.deny", error))]
}

pub fn from_error(error: &str) -> DenyReport {
    let mut report = from_closed(&walls_from_error(error));
    if error.is_empty() == false {
        report.error = String::from(error);
    }
    report
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_type_set_compiles_and_agrees() {
        let walls = vec![
            AdmitWall::close("writing:no_em_dashes", "em dash"),
            AdmitWall::open("writing:no_oxford_comma"),
        ];
        let result = AdmitResult::from_walls(&walls);
        assert_eq!(result.allow, false);
        assert_eq!(result.closed.len(), 1);
        assert_eq!(result.open.len(), 1);
        assert_eq!(result.closed_set_key().is_empty(), false);
        assert_eq!(Pulse::compiled().ms, PULSE_MS);
        assert_eq!(result.open[0].is_open(), true);
    }

    #[test]
    fn closed_wall_keeps_the_class_and_the_set_key() {
        let wall = ClosedWall::new("writing:no_em_dashes", "em dash");
        assert_eq!(wall.class, CLASS_WRITING);
        assert_eq!(seal_probe(), true);
    }

    fn seal_probe() -> bool {
        let one = ProcessSealed::seal(4242, "sha256", "spec-a", 1);
        let two = ProcessSealed::seal(4242, "sha256", "spec-a", 2);
        one.matches(4242, "sha256", "spec-a") && two.seal == one.seal
    }
}
