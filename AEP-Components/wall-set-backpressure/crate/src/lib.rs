// Dock Deny returns closed-wall ids and mechanical repair.
// ClosedWall carries class writing, security, temporal, capability, poison or structural.
// CORRECTWRITING_EN writing walls stay protocol law at priority 255. Writing walls are not transport security.
// Unbound scene, dock, time, sequence and writing.gap get prescribed fixes.
// Grant lists stay off repair.fix. No lattice-memory lookup. Reseal a new capsule.

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

#[cfg(test)]
mod tests {
    use super::*;

    fn must(cond: bool) {
        if !cond {
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
        must(
            r.repairs
                .iter()
                .any(|h| h.field == "target_id" && h.kind == KIND_BIND_FIELD),
        );
        must(r.repairs.iter().any(|h| h.kind == KIND_RESEAL_NEW_CAPSULE));
    }

    #[test]
    fn unbound_dock_binds_dest_dock() {
        let r = from_closed(&[ClosedWall::with_class(
            "channel.dock",
            "no dock bound",
            CLASS_STRUCTURAL,
        )]);
        must(
            r.repairs
                .iter()
                .any(|h| h.field == "dest_dock" && h.kind == KIND_BIND_FIELD),
        );
    }

    #[test]
    fn unbound_time_binds_timestamp() {
        let r = from_closed(&[ClosedWall::with_class(
            "time.authority",
            "no timestamps",
            CLASS_TEMPORAL,
        )]);
        must(
            r.repairs
                .iter()
                .any(|h| h.field == "timestamp" && h.kind == KIND_BIND_FIELD),
        );
        must(r.repairs.iter().any(|h| h.fix.contains("50 ms drift")));
    }

    #[test]
    fn unbound_sequence_binds_seq() {
        let r = from_closed(&[ClosedWall::with_class(
            "causal.sequence",
            "no sequence bound",
            CLASS_STRUCTURAL,
        )]);
        must(
            r.repairs
                .iter()
                .any(|h| h.field == "_sequenceNumber" && h.kind == KIND_BIND_FIELD),
        );
    }

    #[test]
    fn writing_em_dash_prescribes_hyphen() {
        let r = from_closed(&[ClosedWall::with_class(
            "writing:no_em_dashes",
            "Em dash U+2014 forbidden by writing.gap",
            CLASS_WRITING,
        )]);
        must(
            r.repairs
                .iter()
                .any(|h| h.kind == KIND_REWRITE_WRITING && h.fix.contains("U+2014")),
        );
    }

    #[test]
    fn grant_lists_stay_off_repair_fix() {
        let report = from_closed(&[
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
        ]);
        must(!report.repairs.is_empty());
        for h in &report.repairs {
            must(!grant_leaks_in_fix(&h.fix));
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
    fn from_closed_names_the_collect_all_pass() {
        let r = from_closed(&[ClosedWall::with_class(
            "scene.membership",
            "no scene bound",
            CLASS_STRUCTURAL,
        )]);
        must(r.error.contains("Admit collect-all walls then Apply"));
        must(r.closed.iter().any(|w| w.id == "scene.membership"));
    }

    #[test]
    fn writing_wall_class_is_writing() {
        let r = from_closed(&[ClosedWall::with_class(
            "writing:no_em_dashes",
            "Em dash U+2014 forbidden by writing.gap",
            CLASS_WRITING,
        )]);
        must(
            r.closed
                .iter()
                .any(|w| w.id == "writing:no_em_dashes" && w.class == CLASS_WRITING),
        );
        let oxford = from_closed(&[ClosedWall::with_class(
            "writing:no_oxford_comma",
            "Oxford comma forbidden by writing.gap",
            CLASS_WRITING,
        )]);
        must(oxford.closed.iter().any(|w| w.class == CLASS_WRITING));
        let writing = from_error("CORRECTWRITING_EN writing violations remain after enforcement");
        must(
            writing
                .closed
                .iter()
                .any(|w| w.class == CLASS_WRITING && w.id == "writing:correctwriting_en"),
        );
    }

    #[test]
    fn replay_and_kem_class_is_security() {
        let r = from_error("frame replay rejected: abc");
        must(
            r.closed
                .iter()
                .any(|w| w.id == "digest.replay" && w.class == CLASS_SECURITY),
        );
        let kem = from_error("decrypt failed: kem secret must be 64-byte seed");
        must(
            kem.closed
                .iter()
                .any(|w| w.id == "kem.open" && w.class == CLASS_SECURITY),
        );
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
        must(
            fresh
                .closed
                .iter()
                .any(|w| w.class == CLASS_TEMPORAL && w.id == "temporal:wire_freshness"),
        );
        let skew = from_error("frame clock skew: sent_at_unix=9 too far in future");
        must(
            skew.closed
                .iter()
                .any(|w| w.class == CLASS_TEMPORAL && w.id == "temporal:future_skew"),
        );
    }

    #[test]
    fn agent_permission_class_is_capability() {
        let r = from_error("Lattice required but ActionLattice is not initialised");
        must(
            r.closed
                .iter()
                .any(|w| w.id == "gap.agent_permission" && w.class == CLASS_CAPABILITY),
        );
        must(
            r.closed
                .iter()
                .any(|w| w.id == "dag.membership" && w.class == CLASS_STRUCTURAL),
        );
    }

    #[test]
    fn mutex_poison_class_is_poison() {
        let r = from_error("poisoned lock: db");
        must(
            r.closed
                .iter()
                .any(|w| w.id == "lock.poison" && w.class == CLASS_POISON),
        );
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
    fn writing_class_is_not_security_class() {
        must(CLASS_WRITING != CLASS_SECURITY);
        let w = ClosedWall::with_class("writing:no_double_hyphen", "double hyphen", CLASS_WRITING);
        must(w.class != CLASS_SECURITY);
    }
}
