// HVVCAS: compile_agent_permission_wall domain:admit type:library
// AEP 2.9: agent permission is agent id plus action. No rank. No score.

use super::{admit_collect_all, AdmitResult, AdmitWall};

// the agent permission public type set is defined once in
// aep-kernel-types and re-exported here.
pub use aep_kernel_types::{
    AgentPermission, AgentPermissionLookup, DENY_NO_PERMISSION, WALL_AGENT_PERMISSION,
};

pub fn agent_permission_wall_id(agent: &str, action: &str) -> String {
    let mut id = String::from(WALL_AGENT_PERMISSION);
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

fn permission_matches(record: &AgentPermission, agent_id: &str, action: &str) -> bool {
    let star = record.agent_id == "*" && !agent_id.is_empty();
    let named = !agent_id.is_empty() && record.agent_id == agent_id;
    let unbound = record.agent_id == "unbound" && agent_id.is_empty();
    let agent_ok = star || named || unbound;
    let action_ok = record.action == "*" || record.action == action;
    agent_ok && action_ok
}

pub fn agent_has_permission(agent_id: &str, action: &str, records: &[AgentPermission]) -> bool {
    if records.is_empty() {
        return false;
    }
    records
        .iter()
        .any(|r| permission_matches(r, agent_id, action))
}

/// Compile one agent permission GAP dimension into one Admit wall.
/// Empty list refuses. Miss writes DENY. The permission wall always runs.
pub fn compile_agent_permission_wall(
    agent_id: &str,
    action: &str,
    records: &[AgentPermission],
) -> AdmitWall {
    let lookup = AgentPermissionLookup {
        agent_id: String::from(agent_id),
        action: String::from(action),
        records: records.to_vec(),
    };
    compile_agent_permission_wall_from(&lookup)
}

pub fn compile_agent_permission_wall_from(lookup: &AgentPermissionLookup) -> AdmitWall {
    let id = agent_permission_wall_id(&lookup.agent_id, &lookup.action);
    if agent_has_permission(&lookup.agent_id, &lookup.action, &lookup.records) {
        AdmitWall::open(id)
    } else {
        AdmitWall::close(id, DENY_NO_PERMISSION)
    }
}

/// Compile node agent_permission list (agents written for this action) into one Admit wall.
pub fn compile_node_agent_permission_wall(
    agent_id: &str,
    action: &str,
    allowed: &[String],
) -> AdmitWall {
    let records: Vec<AgentPermission> = allowed
        .iter()
        .map(|a| AgentPermission {
            agent_id: a.clone(),
            action: String::from("*"),
        })
        .collect();
    compile_agent_permission_wall(agent_id, action, &records)
}

/// Fold agent permission wall plus extra walls into one Admit collect-all pass.
pub fn fold_agent_permission_into_admit(
    agent_id: &str,
    action: &str,
    records: &[AgentPermission],
    extra: &[AdmitWall],
) -> AdmitResult {
    let mut walls = Vec::new();
    walls.push(compile_agent_permission_wall(agent_id, action, records));
    walls.extend(extra.iter().cloned());
    admit_collect_all(&walls)
}

/// True iff no agent permission wall is closed.
pub fn agent_permission_from_admit(result: &AdmitResult) -> bool {
    result
        .closed
        .iter()
        .all(|w| !w.id.starts_with(WALL_AGENT_PERMISSION))
}

/// Public lookup used by every bind.
pub fn agent_permission(agent_id: &str, action: &str, records: &[AgentPermission]) -> AdmitWall {
    compile_agent_permission_wall(agent_id, action, records)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AdmitWall;

    fn record(agent: &str, action: &str) -> AgentPermission {
        AgentPermission {
            agent_id: String::from(agent),
            action: String::from(action),
        }
    }

    #[test]
    fn empty_list_refuses() {
        let wall = compile_agent_permission_wall("agent-a", "action:write", &[]);
        assert!(wall.closed);
        assert_eq!(wall.reason, DENY_NO_PERMISSION);
        assert!(!agent_has_permission("agent-a", "action:write", &[]));
    }

    #[test]
    fn empty_list_refuses_system_event_action() {
        let wall = compile_node_agent_permission_wall("agent-a", "root:ping", &[]);
        assert!(wall.closed);
        assert_eq!(wall.reason, DENY_NO_PERMISSION);
    }

    #[test]
    fn empty_list_refuses_external_event_action() {
        let wall = compile_node_agent_permission_wall("", "webhook:incoming", &[]);
        assert!(wall.closed);
        assert_eq!(wall.reason, DENY_NO_PERMISSION);
    }

    #[test]
    fn agent_a_write_does_not_give_agent_b_write() {
        let records = vec![record("agent-a", "action:write")];
        let a = compile_agent_permission_wall("agent-a", "action:write", &records);
        let b = compile_agent_permission_wall("agent-b", "action:write", &records);
        assert!(!a.closed);
        assert!(b.closed);
        assert_eq!(b.reason, DENY_NO_PERMISSION);
        assert!(!a.reason.contains(" < "));
    }

    #[test]
    fn miss_writes_deny_text() {
        let records = vec![record("agent-a", "action:read")];
        let wall = compile_agent_permission_wall("agent-a", "action:write", &records);
        assert!(wall.closed);
        assert_eq!(wall.reason, DENY_NO_PERMISSION);
    }

    #[test]
    fn fold_keeps_permission_and_constraint_on_one_pass() {
        let extra = vec![AdmitWall::close(
            "constraint:required_field:alpha",
            "alpha required",
        )];
        let records = vec![record("agent-a", "action:write")];
        let result = fold_agent_permission_into_admit("agent-b", "action:write", &records, &extra);
        assert!(!result.allow);
        assert!(!agent_permission_from_admit(&result));
        let ids: Vec<&str> = result.closed.iter().map(|w| w.id.as_str()).collect();
        let perm_id = agent_permission_wall_id("agent-b", "action:write");
        assert!(ids.contains(&perm_id.as_str()));
        assert!(ids.contains(&"constraint:required_field:alpha"));
        assert!(result
            .closed
            .iter()
            .any(|w| w.id == perm_id && w.reason == DENY_NO_PERMISSION));
    }

    #[test]
    fn listed_agent_opens() {
        let records = vec![record("agent-a", "action:write")];
        let result = fold_agent_permission_into_admit("agent-a", "action:write", &records, &[]);
        assert!(result.allow);
        assert!(agent_permission_from_admit(&result));
    }

    #[test]
    fn no_numeric_score_on_permission_wall() {
        let src = include_str!("compile_permission.rs");
        let prod = match src.find("#[cfg(test)]") {
            Some(i) => &src[..i],
            None => src,
        };
        assert!(!prod.contains("trust_score"));
        assert!(!prod.contains("trust_tier"));
        assert!(!prod.contains("trust_ring"));
        assert!(!prod.contains("score >"));
        assert!(!prod.contains("score >="));
    }
}
