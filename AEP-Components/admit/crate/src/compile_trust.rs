// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: compile_agent_may_wall domain:admit type:library
// AEP28-ENV-033: who-may-do-what is GAP dimension Conjunction. No rank.

use super::{admit_collect_all, AdmitResult, AdmitWall};

/// Closed-set id family for GAP agent-may walls. Not a rank.
pub const WALL_AGENT_MAY: &str = "gap:agent_may";

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AgentMayGrant {
    pub agent_id: String,
    pub action: String,
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

/// Compile one agent-may GAP dimension into one Admit wall. Agent A may X. No rank.
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

/// Compile node agent_may list (agents granted this action) into one Admit wall.
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

/// Fold agent-may wall plus extra walls into one Admit collect-all pass.
pub fn fold_agent_may_into_admit(
    agent_id: &str,
    action: &str,
    grants: &[AgentMayGrant],
    extra: &[AdmitWall],
) -> AdmitResult {
    let mut walls = Vec::new();
    walls.push(compile_agent_may_wall(agent_id, action, grants));
    walls.extend(extra.iter().cloned());
    admit_collect_all(&walls)
}

/// True iff no agent-may wall is closed.
pub fn agent_may_from_admit(result: &AdmitResult) -> bool {
    result
        .closed
        .iter()
        .all(|w| w.id.starts_with(WALL_AGENT_MAY) == false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AdmitWall;

    fn grant(agent: &str, action: &str) -> AgentMayGrant {
        AgentMayGrant {
            agent_id: String::from(agent),
            action: String::from(action),
        }
    }

    #[test]
    fn agent_a_may_x_independent_of_agent_b() {
        let grants = vec![grant("agent-a", "action:write")];
        let a = compile_agent_may_wall("agent-a", "action:write", &grants);
        let b = compile_agent_may_wall("agent-b", "action:write", &grants);
        assert_eq!(a.closed, false);
        assert_eq!(b.closed, true);
        assert_eq!(a.reason.contains(" < "), false);
    }

    #[test]
    fn fold_keeps_agent_may_and_constraint_on_one_pass() {
        let extra = vec![AdmitWall::close(
            "constraint:required_field:alpha",
            "alpha required",
        )];
        let grants = vec![grant("agent-a", "action:write")];
        let result = fold_agent_may_into_admit("agent-b", "action:write", &grants, &extra);
        assert_eq!(result.allow, false);
        assert_eq!(agent_may_from_admit(&result), false);
        let ids: Vec<&str> = result.closed.iter().map(|w| w.id.as_str()).collect();
        let may_id = agent_may_wall_id("agent-b", "action:write");
        assert_eq!(ids.iter().any(|id| *id == may_id.as_str()), true);
        assert_eq!(ids.contains(&"constraint:required_field:alpha"), true);
    }

    #[test]
    fn granted_agent_opens() {
        let grants = vec![grant("agent-a", "action:write")];
        let result = fold_agent_may_into_admit("agent-a", "action:write", &grants, &[]);
        assert_eq!(result.allow, true);
        assert_eq!(agent_may_from_admit(&result), true);
    }
}
