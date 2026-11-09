//! The facade must hand an attach reader the same permission check that runs on
//! the collect-all Admit path. These tests import only through aep_permissions,
//! so a dropped or redirected re-export fails here.

use aep_admit::AdmitWall;
use aep_permissions::{
    agent_has_permission, agent_permission, agent_permission_from_admit, agent_permission_wall_id,
    compile_agent_permission_wall, compile_agent_permission_wall_from,
    compile_node_agent_permission_wall, fold_agent_permission_into_admit, AgentPermission,
    AgentPermissionLookup, DENY_NO_PERMISSION, WALL_AGENT_PERMISSION,
};

fn record(agent: &str, action: &str) -> AgentPermission {
    AgentPermission {
        agent_id: String::from(agent),
        action: String::from(action),
    }
}

#[test]
fn wall_id_names_agent_and_action() {
    assert_eq!(
        agent_permission_wall_id("agent-a", "action:write"),
        format!("{WALL_AGENT_PERMISSION}:agent-a:action:write")
    );
    assert_eq!(
        agent_permission_wall_id("", "action:write"),
        format!("{WALL_AGENT_PERMISSION}:unbound:action:write")
    );
}

#[test]
fn empty_records_refuse_with_deny_text() {
    assert!(!agent_has_permission("agent-a", "action:write", &[]));
    let wall = agent_permission("agent-a", "action:write", &[]);
    assert!(wall.closed);
    assert_eq!(wall.reason, DENY_NO_PERMISSION);
}

#[test]
fn named_record_opens_only_its_agent() {
    let records = vec![record("agent-a", "action:write")];
    assert!(compile_agent_permission_wall("agent-a", "action:write", &records).is_open());
    assert!(compile_agent_permission_wall("agent-b", "action:write", &records).is_closed());
    assert!(compile_agent_permission_wall("agent-a", "action:read", &records).is_closed());
}

#[test]
fn star_agent_needs_a_named_agent() {
    let records = vec![record("*", "action:write")];
    assert!(agent_has_permission("agent-z", "action:write", &records));
    assert!(!agent_has_permission("", "action:write", &records));
}

#[test]
fn unbound_record_matches_only_an_empty_agent() {
    let records = vec![record("unbound", "*")];
    assert!(agent_has_permission("", "webhook:incoming", &records));
    assert!(!agent_has_permission(
        "agent-a",
        "webhook:incoming",
        &records
    ));
}

#[test]
fn lookup_form_matches_list_form() {
    let records = vec![record("agent-a", "*")];
    let lookup = AgentPermissionLookup {
        agent_id: String::from("agent-a"),
        action: String::from("action:any"),
        records: records.clone(),
    };
    assert_eq!(
        compile_agent_permission_wall_from(&lookup),
        compile_agent_permission_wall("agent-a", "action:any", &records)
    );
}

#[test]
fn node_list_grants_every_action_to_listed_agents() {
    let allowed = vec![String::from("agent-a")];
    assert!(compile_node_agent_permission_wall("agent-a", "root:ping", &allowed).is_open());
    let refused = compile_node_agent_permission_wall("agent-b", "root:ping", &allowed);
    assert!(refused.is_closed());
    assert_eq!(refused.reason, DENY_NO_PERMISSION);
}

#[test]
fn fold_reports_permission_and_other_walls_together() {
    let extra = vec![AdmitWall::close("constraint:alpha", "alpha required")];
    let records = vec![record("agent-a", "action:write")];

    let refused = fold_agent_permission_into_admit("agent-b", "action:write", &records, &extra);
    assert!(!refused.allow);
    assert!(!agent_permission_from_admit(&refused));
    assert_eq!(refused.closed.len(), 2);

    let other_only = fold_agent_permission_into_admit("agent-a", "action:write", &records, &extra);
    assert!(!other_only.allow);
    assert!(agent_permission_from_admit(&other_only));

    let allowed = fold_agent_permission_into_admit("agent-a", "action:write", &records, &[]);
    assert!(allowed.allow);
    assert!(agent_permission_from_admit(&allowed));
}
