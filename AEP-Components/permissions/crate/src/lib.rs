//! Kernel agent permission facade for AEP 2.8.6.
//! The permission check lives in the admit crate on the collect-all Admit path.
//! This crate re-exports the public permission names so an attach reader imports
//! one crate, and the field name is agent_permission everywhere.
pub use aep_admit::{
    agent_has_permission, agent_permission, agent_permission_from_admit,
    agent_permission_wall_id, compile_agent_permission_wall, compile_agent_permission_wall_from,
    compile_node_agent_permission_wall, fold_agent_permission_into_admit, AgentPermission,
    AgentPermissionLookup, DENY_NO_PERMISSION, WALL_AGENT_PERMISSION,
};
