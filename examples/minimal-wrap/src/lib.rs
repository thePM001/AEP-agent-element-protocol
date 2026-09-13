//! AEP 2.8.6 minimal wrap. Uses public kernel names from Base Node.
//! Base Node is the only live evaluator. This wrap is not a second evaluator.
use aep_base_node::{agent_permission, AgentPermission, DENY_NO_PERMISSION, PULSE_MS};

pub fn wrap_allow(agent_id: &str, action: &str) -> bool {
    if agent_id.is_empty() {
        return false;
    }
    let records = vec![AgentPermission {
        agent_id: String::from(agent_id),
        action: String::from(action),
    }];
    let wall = agent_permission(agent_id, action, &records);
    wall.closed == false && PULSE_MS == 1000
}

pub fn wrap_empty_refuses() -> bool {
    let wall = agent_permission("agent-a", "action:write", &[]);
    wall.closed && wall.reason == DENY_NO_PERMISSION
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn documented_wrap_returns_allow_true() {
        assert!(wrap_allow("agent-a", "action:write"));
    }
    #[test]
    fn empty_permission_refuses() {
        assert!(wrap_empty_refuses());
    }
}
