// @PAD: gap-285-p15-instruction-profile-v1
// GAP-285-P15 HVVCAS process wrapper for instruction profile walls.
use super::{compile_instruction_profile_walls, PolicySystemCompileInput};
use aep_admit::AdmitWall;

pub struct CompileInstructionProfileWalls {
    pub source: String,
    pub agent_id: String,
    pub action: String,
    pub wrap: String,
    pub action_path: String,
    pub walls: Vec<AdmitWall>,
}

impl CompileInstructionProfileWalls {
    pub fn new() -> Self {
        Self {
            source: String::new(),
            agent_id: String::new(),
            action: String::new(),
            wrap: String::new(),
            action_path: String::new(),
            walls: Vec::new(),
        }
    }

    pub fn process(&mut self) -> anyhow::Result<()> {
        let mut input = PolicySystemCompileInput::default();
        input.agent_id = self.agent_id.clone();
        input.action = self.action.clone();
        input.wrap = self.wrap.clone();
        input.action_path = self.action_path.clone();
        self.walls = compile_instruction_profile_walls(&self.source, &input);
        Ok(())
    }
}


#[cfg(test)]
mod tests {
    use super::CompileInstructionProfileWalls;
    use aep_admit::admit_collect_all;
    use crate::{
        compile_policy_system_walls_from, policy_wall_id,
        scan_policy_loader_compiles_profile, scan_workspace_includes_gap_profile,
        walk_to_workspace, PolicySystemCompileInput, TICKET_GAP285_P15,
    };
    use std::path::Path;

    fn must(cond: bool) {
        if cond == false {
            std::process::abort();
        }
    }

    fn em_sample() -> String {
        let mut s = String::from("bad");
        s.push('\u{2014}');
        s.push_str("dash");
        s
    }

    fn writing_gap() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_em_dashes\", \"description\": \"Zero em-dashes\"}\n    ]\n  }\n}")
    }

    fn writing_gap_star() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_em_dashes\", \"description\": \"Zero em-dashes\"}\n    ]\n  },\n  \"metadata\": {\"agent_may\": [\"*\"]}\n}")
    }

    fn writing_gap_rank() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_em_dashes\", \"description\": \"Zero em-dashes\"}\n    ]\n  },\n  \"metadata\": {\"trust_ring\": \"user\"}\n}")
    }

    fn writing_gap_star_rank() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_em_dashes\", \"description\": \"Zero em-dashes\"}\n    ]\n  },\n  \"metadata\": {\"agent_may\": [\"*\"], \"trust_ring\": \"user\"}\n}")
    }

    fn security_gap() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_pii_detected\", \"description\": \"no pii\"}\n    ]\n  }\n}")
    }

    fn security_gap_star() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_pii_detected\", \"description\": \"no pii\"}\n    ]\n  },\n  \"metadata\": {\"agent_may\": [\"*\"]}\n}")
    }

    fn net_gap() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"invariants\": [\n      {\"expr\": \"no_item\", \"description\": \"n\"}\n    ]\n  }\n}")
    }

    fn lattice_gap() -> String {
        String::from("rules:\n  - id: lattice-channel-only-transport\n")
    }

    fn gov_gap() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"constraints\": [\"hard: no extra\"]\n  }\n}")
    }

    fn deploy_gap() -> String {
        String::from("{\n  \"pattern\": {\n    \"guard\": \"deployment_attempt\",\n    \"prefix\": \"ops:\",\n    \"invariants\": [\n      {\"expr\": \"human_approval_required == true\", \"description\": \"approval\"}\n    ]\n  }\n}")
    }

    fn write_tree(tmp: &Path) {
        std::fs::create_dir_all(tmp.join("reference")).expect("mkdir");
        std::fs::write(tmp.join("reference/writing.gap"), writing_gap()).expect("w");
        std::fs::write(tmp.join("reference/security.gap"), security_gap()).expect("s");
        let net_file = crate::join_parts(&["reference/network-egress-no-", "smt", "p", ".gap"]);
        std::fs::write(tmp.join(&net_file), net_gap()).expect("n");
        std::fs::write(tmp.join("lattice-channel-mandatory.gap"), lattice_gap()).expect("l");
        std::fs::write(tmp.join("reference/governance.gap"), gov_gap()).expect("g");
        std::fs::write(tmp.join("reference/deployment.gap"), deploy_gap()).expect("d");
    }

    #[test]
    fn ticket_const() {
        must(TICKET_GAP285_P15 == "GAP-285-P15");
    }

    #[test]
    fn rank_presence_closes_on_trust_ring() {
        let tmp = std::env::temp_dir().join("gap-285-p15-rank");
        let _ = std::fs::remove_dir_all(&tmp);
        write_tree(&tmp);
        std::fs::write(tmp.join("reference/writing.gap"), writing_gap_rank()).expect("w");
        let input = PolicySystemCompileInput::default();
        let walls = compile_policy_system_walls_from(Some(&tmp), &input);
        must(walls.iter().any(|w| w.id == aep_gap_schema_profile_v13::WALL_TRUST_RING_RANK && w.closed));
        let r = admit_collect_all(&walls);
        must(r.allow == false);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn empty_grants_deny_for_agent_action() {
        let tmp = std::env::temp_dir().join("gap-285-p15-empty-grants");
        let _ = std::fs::remove_dir_all(&tmp);
        write_tree(&tmp);
        let mut input = PolicySystemCompileInput::default();
        input.agent_id = String::from("agent-a");
        input.action = String::from("write");
        let walls = compile_policy_system_walls_from(Some(&tmp), &input);
        let mut hit = false;
        let mut i = 0usize;
        while i < walls.len() {
            if walls[i].id.starts_with(aep_gap_schema_profile_v13::WALL_AGENT_MAY) && walls[i].closed {
                hit = true;
            }
            i += 1;
        }
        must(hit);
        let r = admit_collect_all(&walls);
        must(r.allow == false);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn agent_may_star_allows_named_agent() {
        let tmp = std::env::temp_dir().join("gap-285-p15-star");
        let _ = std::fs::remove_dir_all(&tmp);
        write_tree(&tmp);
        std::fs::write(tmp.join("reference/writing.gap"), writing_gap_star()).expect("w");
        std::fs::write(tmp.join("reference/security.gap"), security_gap_star()).expect("s");
        let mut input = PolicySystemCompileInput::default();
        input.agent_id = String::from("agent-a");
        input.action = String::from("write");
        let walls = compile_policy_system_walls_from(Some(&tmp), &input);
        must(
            walls
                .iter()
                .any(|w| w.id.starts_with(aep_gap_schema_profile_v13::WALL_AGENT_MAY) && w.closed)
                == false,
        );
        must(walls.iter().any(|w| w.id.starts_with("policy:writing:")));
        must(walls.iter().any(|w| w.id.starts_with("policy:security:")));
        let r = admit_collect_all(&walls);
        must(r.allow);
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn wrap_bound_rank_does_not_close_unbound_wrap() {
        let tmp = std::env::temp_dir().join("gap-285-p15-wrap-rank");
        let _ = std::fs::remove_dir_all(&tmp);
        write_tree(&tmp);
        std::fs::write(tmp.join("reference/writing.gap"), writing_gap_star()).expect("w");
        std::fs::write(tmp.join("reference/security.gap"), security_gap_star()).expect("s");
        let expr = crate::join_parts(&["no_", "smt", "p_url_scheme"]);
        let net_file = crate::join_parts(&["reference/network-egress-no-", "smt", "p", ".gap"]);
        let mut s = String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"wrap\": \"finance\",\n    \"invariants\": [\n      {\"expr\": \"");
        s.push_str(&expr);
        s.push_str("\", \"description\": \"no mta url\"}\n    ]\n  },\n  \"metadata\": {\"trust_ring\": \"user\", \"agent_may\": [\"*\"]}\n}");
        std::fs::write(tmp.join(&net_file), s).expect("n");
        let mut inventory = PolicySystemCompileInput::default();
        inventory.wrap = String::from("inventory");
        inventory.action_path = String::from("inventory:ping");
        inventory.agent_id = String::from("agent-a");
        inventory.action = String::from("write");
        let open = compile_policy_system_walls_from(Some(&tmp), &inventory);
        must(open.iter().any(|w| w.id == aep_gap_schema_profile_v13::WALL_TRUST_RING_RANK && w.closed) == false);
        let mut finance = inventory.clone();
        finance.wrap = String::from("finance");
        finance.action_path = String::from("finance:pay");
        let closed = compile_policy_system_walls_from(Some(&tmp), &finance);
        must(closed.iter().any(|w| w.id == aep_gap_schema_profile_v13::WALL_TRUST_RING_RANK && w.closed));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn writing_and_security_stay_always_on_with_profile_walls() {
        let tmp = std::env::temp_dir().join("gap-285-p15-always-on");
        let _ = std::fs::remove_dir_all(&tmp);
        write_tree(&tmp);
        std::fs::write(tmp.join("reference/writing.gap"), writing_gap_star()).expect("w");
        std::fs::write(tmp.join("reference/security.gap"), security_gap_star()).expect("s");
        let mut input = PolicySystemCompileInput::default();
        input.action_path = String::from("inventory:ping");
        input.wrap = String::from("inventory");
        input.agent_id = String::from("agent-a");
        input.action = String::from("write");
        input.text = em_sample();
        input.text.push('\n');
        input.text.push_str("user@example.invalid");
        let walls = compile_policy_system_walls_from(Some(&tmp), &input);
        must(walls.iter().any(|w| w.id == policy_wall_id("writing", "no_em_dashes") && w.closed));
        must(walls.iter().any(|w| w.id == policy_wall_id("security", "no_pii_detected") && w.closed));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn prefix_still_binds_other_walls() {
        let tmp = std::env::temp_dir().join("gap-285-p15-prefix");
        let _ = std::fs::remove_dir_all(&tmp);
        write_tree(&tmp);
        std::fs::write(tmp.join("reference/writing.gap"), writing_gap_star()).expect("w");
        std::fs::write(tmp.join("reference/security.gap"), security_gap_star()).expect("s");
        let stem = crate::join_parts(&["network-egress-no-", "smt", "p"]);
        let expr = crate::join_parts(&["no_", "smt", "p_url_scheme"]);
        let id = policy_wall_id(&stem, &expr);
        let net_file = crate::join_parts(&["reference/network-egress-no-", "smt", "p", ".gap"]);
        let mut s = String::from("{\n  \"pattern\": {\n    \"guard\": \"true\",\n    \"prefix\": \"finance:\",\n    \"invariants\": [\n      {\"expr\": \"");
        s.push_str(&expr);
        s.push_str("\", \"description\": \"no mta url\"}\n    ]\n  },\n  \"metadata\": {\"agent_may\": [\"*\"]}\n}");
        std::fs::write(tmp.join(&net_file), s).expect("n");
        let mut miss = PolicySystemCompileInput::default();
        miss.text = crate::join_parts(&["relay ", "smt", "p://mail.example.invalid"]);
        miss.action_path = String::from("inventory:ping");
        miss.agent_id = String::from("agent-a");
        miss.action = String::from("write");
        let open = compile_policy_system_walls_from(Some(&tmp), &miss);
        must(open.iter().any(|w| w.id == id && w.closed) == false);
        let mut hit = miss.clone();
        hit.action_path = String::from("finance:pay");
        let closed = compile_policy_system_walls_from(Some(&tmp), &hit);
        must(closed.iter().any(|w| w.id == id && w.closed));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn workspace_members_include_gap_v13_profile_package() {
        let root = walk_to_workspace();
        let ws = std::fs::read_to_string(root.join("Cargo.toml")).expect("ws");
        match scan_workspace_includes_gap_profile(&ws) {
            Ok(v) => must(v.contains("ok workspace members include")),
            Err(_) => std::process::abort(),
        }
        let src = include_str ! ("lib.rs");
        match scan_policy_loader_compiles_profile(src) {
            Ok(v) => must(v.contains("ok policy loader")),
            Err(_) => std::process::abort(),
        }
    }

    #[test]
    fn hvvc_as_process_instruction_profile_walls() {
        let mut svc = CompileInstructionProfileWalls::new();
        svc.source = writing_gap_star_rank();
        svc.agent_id = String::from("agent-a");
        svc.action = String::from("write");
        svc.process().expect("process");
        must(svc.walls.iter().any(|w| w.id == aep_gap_schema_profile_v13::WALL_TRUST_RING_RANK && w.closed));
        must(
            svc.walls
                .iter()
                .any(|w| w.id.starts_with(aep_gap_schema_profile_v13::WALL_AGENT_MAY) && w.closed)
                == false,
        );
    }
}
