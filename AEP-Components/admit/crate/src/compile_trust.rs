// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: compile_trust_floor_wall domain:admit type:library
// AEP28-ENV-003: compile per-node trust floor into one Admit wall. Fold onto collect-all.

use super::{admit_collect_all, AdmitResult, AdmitWall};

/// Closed-set id for the per-node trust floor wall.
pub const WALL_TRUST_FLOOR: &str = "trust_floor";

/// Unbound events (empty agent id) cannot raise the floor. Claimed tier is ignored.
pub fn clamp_unbound_trust_tier(agent_id: &str, claimed: u32) -> u32 {
    if agent_id.is_empty() {
        1
    } else if claimed < 1 {
        1
    } else {
        claimed
    }
}

/// Compile node trust floor versus agent trust tier into one Admit wall named trust_floor.
pub fn compile_trust_floor_wall(trust_tier: u32, trust_floor: u32) -> AdmitWall {
    if trust_tier < trust_floor {
        let mut reason = String::from("Insufficient trust: ");
        reason.push_str(&trust_tier.to_string());
        reason.push_str(" < ");
        reason.push_str(&trust_floor.to_string());
        AdmitWall::close(WALL_TRUST_FLOOR, reason)
    } else {
        AdmitWall::open(WALL_TRUST_FLOOR)
    }
}

/// Fold the trust floor wall plus extra walls into one Admit collect-all pass.
pub fn fold_trust_floor_into_admit(
    trust_tier: u32,
    trust_floor: u32,
    extra: &[AdmitWall],
) -> AdmitResult {
    let mut walls = Vec::new();
    walls.push(compile_trust_floor_wall(trust_tier, trust_floor));
    walls.extend(extra.iter().cloned());
    admit_collect_all(&walls)
}

/// Derive trust_sufficient from whether the trust_floor wall is closed.
pub fn trust_sufficient_from_admit(result: &AdmitResult) -> bool {
    result
        .closed
        .iter()
        .all(|w| w.id != WALL_TRUST_FLOOR)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AdmitWall;

    #[test]
    fn below_floor_closes() {
        let wall = compile_trust_floor_wall(2, 5);
        assert_eq!(wall.closed, true);
        assert_eq!(wall.id, WALL_TRUST_FLOOR);
        assert_eq!(wall.reason.contains("2 < 5"), true);
    }

    #[test]
    fn at_floor_opens() {
        let wall = compile_trust_floor_wall(5, 5);
        assert_eq!(wall.closed, false);
        assert_eq!(wall.id, WALL_TRUST_FLOOR);
    }

    #[test]
    fn above_floor_opens() {
        let wall = compile_trust_floor_wall(5, 3);
        assert_eq!(wall.closed, false);
    }

    #[test]
    fn unbound_agent_clamps_to_one() {
        assert_eq!(clamp_unbound_trust_tier("", 9), 1);
        assert_eq!(clamp_unbound_trust_tier("AG-1", 9), 9);
    }

    #[test]
    fn fold_keeps_trust_and_constraint_on_one_pass() {
        let extra = vec![AdmitWall::close(
            "constraint:required_field:alpha",
            "alpha required",
        )];
        let result = fold_trust_floor_into_admit(1, 5, &extra);
        assert_eq!(result.allow, false);
        assert_eq!(trust_sufficient_from_admit(&result), false);
        let ids: Vec<&str> = result.closed.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids.contains(&WALL_TRUST_FLOOR), true);
        assert_eq!(ids.contains(&"constraint:required_field:alpha"), true);
    }

    #[test]
    fn sufficient_when_floor_open() {
        let result = fold_trust_floor_into_admit(3, 2, &[]);
        assert_eq!(result.allow, true);
        assert_eq!(trust_sufficient_from_admit(&result), true);
    }
}
