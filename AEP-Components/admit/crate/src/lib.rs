// Live evaluator: Admit (AND of compiled walls, collect every closed wall)
// then OPA deny_lattice collect-all then Apply.
// Writing.gap rules compile into Admit walls on the same collect-all pass.
// LatticeFilter and PolicyEvaluator sequential stacks are lab-only.

// the public kernel type set lives in aep-kernel-types,
// so this crate re-exports the one definition site of every public type.
pub use aep_kernel_types::{
    AgentPermission, AgentPermissionLookup, AdmitResult, AdmitWall, Pulse, DENY_NO_PERMISSION,
    PULSE_MS, WALL_AGENT_PERMISSION,
};

// HVVCAS: admit_wall domain:policy type:library
pub mod admit_wall {
    pub use super::AdmitWall;
}

// HVVCAS: admit_collect_all domain:policy type:library
pub mod admit_collect_all {
    use super::{AdmitResult, AdmitWall};

    /// AND of compiled walls. Collect every closed wall. Do not stop at the first close.
    pub fn admit_collect_all(walls: &[AdmitWall]) -> AdmitResult {
        // one collect-all shape for every caller.
        AdmitResult::from_walls(walls)
    }
}

// HVVCAS: compile_writing_walls domain:admit type:library
pub mod compile_writing_walls {
    use super::AdmitWall;

    pub const RULE_NO_EM_DASHES: &str = "no_em_dashes";
    pub const RULE_NO_EN_DASHES: &str = "no_en_dashes";
    pub const RULE_NO_DASH_SUBSTITUTES: &str = "no_dash_substitutes";
    pub const RULE_NO_BOX_DRAWING_DASHES: &str = "no_box_drawing_dashes";
    pub const RULE_NO_MINUS_AS_DASH: &str = "no_minus_as_dash";
    pub const RULE_NO_DOUBLE_HYPHEN: &str = "no_double_hyphen";
    pub const RULE_NO_OXFORD_COMMA: &str = "no_oxford_comma";
    pub const RULE_PUNCTUATION_WORD_SPACE: &str = "punctuation_word_space";

    pub fn writing_wall_id(rule: &str) -> String {
        let mut id = String::from("writing:");
        id.push_str(rule);
        id
    }

    fn wall(rule: &str, closed: bool, reason: &str) -> AdmitWall {
        let id = writing_wall_id(rule);
        if closed {
            AdmitWall::close(id, reason)
        } else {
            AdmitWall::open(id)
        }
    }

    fn contains_char(text: &str, ch: char) -> bool {
        text.chars().any(|c| c == ch)
    }

    fn oxford_and_pattern() -> String {
        let mut p = String::from(",");
        p.push(' ');
        p.push_str("and ");
        p
    }

    fn oxford_or_pattern() -> String {
        let mut p = String::from(",");
        p.push(' ');
        p.push_str("or ");
        p
    }

    fn has_oxford_comma(text: &str) -> bool {
        text.contains(&oxford_and_pattern()) || text.contains(&oxford_or_pattern())
    }

    fn has_double_hyphen_prose(text: &str) -> bool {
        let sep: String = [' ', '-', '-', ' '].iter().collect();
        text.contains(&sep)
    }

    fn has_punct_word_space_fail(text: &str) -> bool {
        let chars: Vec<char> = text.chars().collect();
        for i in 0..chars.len().saturating_sub(1) {
            let ch = chars[i];
            let next = chars[i + 1];
            if (ch == '?' || ch == '!') && next.is_ascii_alphanumeric() {
                return true;
            }
        }
        false
    }

    /// Compile writing.gap denies into Admit walls. One wall per rule. Collect-all later.
    pub fn compile_writing_walls(text: &str) -> Vec<AdmitWall> {
        let mut walls = Vec::new();
        walls.push(wall(
            RULE_NO_EM_DASHES,
            contains_char(text, '\u{2014}'),
            "Em dash U+2014 forbidden by writing.gap",
        ));
        walls.push(wall(
            RULE_NO_EN_DASHES,
            contains_char(text, '\u{2013}'),
            "En dash U+2013 forbidden by writing.gap",
        ));
        let subst = contains_char(text, '\u{2015}')
            || contains_char(text, '\u{2e3a}')
            || contains_char(text, '\u{2e3b}');
        walls.push(wall(
            RULE_NO_DASH_SUBSTITUTES,
            subst,
            "Dash substitute U+2015 U+2E3A U+2E3B forbidden by writing.gap",
        ));
        let boxd = contains_char(text, '\u{2500}') || contains_char(text, '\u{2501}');
        walls.push(wall(
            RULE_NO_BOX_DRAWING_DASHES,
            boxd,
            "Box drawing dash U+2500 U+2501 forbidden by writing.gap",
        ));
        walls.push(wall(
            RULE_NO_MINUS_AS_DASH,
            contains_char(text, '\u{2212}'),
            "Minus sign U+2212 used as dash forbidden by writing.gap",
        ));
        walls.push(wall(
            RULE_NO_DOUBLE_HYPHEN,
            has_double_hyphen_prose(text),
            "Double hyphen prose separator forbidden by writing.gap",
        ));
        walls.push(wall(
            RULE_NO_OXFORD_COMMA,
            has_oxford_comma(text),
            "Oxford comma forbidden by writing.gap",
        ));
        walls.push(wall(
            RULE_PUNCTUATION_WORD_SPACE,
            has_punct_word_space_fail(text),
            "Space after ? or ! before the next word required by writing.gap",
        ));
        walls
    }

    /// Join payload strings then compile. Same closed set as compiling the join.
    pub fn compile_writing_walls_for_strings(strings: &[String]) -> Vec<AdmitWall> {
        compile_writing_walls(&strings.join("\n"))
    }

    /// Split payload text on newlines. Empty lines dropped.
    pub fn collect_payload_strings(payload: &str) -> Vec<String> {
        payload
            .lines()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    }
}

pub use admit_collect_all::admit_collect_all;
pub use compile_writing_walls::{
    collect_payload_strings, compile_writing_walls, compile_writing_walls_for_strings,
    writing_wall_id, RULE_NO_EM_DASHES, RULE_NO_OXFORD_COMMA,
};

pub mod compile_lattice;
pub use compile_lattice::{
    compile_lattice_policy, compile_lattice_walls, default_rego_path,
    load_policy_sets, parse_policy_sets, prove_rego_source, CompiledPolicy,
    LatticeCompileInput, PolicySets,
};

pub mod compile_permission;
pub use compile_permission::{
    compile_agent_permission_wall, compile_agent_permission_wall_from, compile_node_agent_permission_wall, fold_agent_permission_into_admit,
    agent_permission_from_admit, agent_permission_wall_id, agent_has_permission, agent_permission,
};

/// Wave 4 kernel facade. ClosedWall and DenyReport are the dock Deny types.
/// Envelope and process_sealed live on envelope and base-node binds.
pub use aep_wall_set_backpressure::{ClosedWall, DenyReport};

#[cfg(test)]
mod kernel_facade_tests {
    #[test]
    fn pulse_is_compiled_1000() {
        assert_eq!(crate::Pulse::compiled().ms, crate::PULSE_MS);
        assert_eq!(crate::PULSE_MS, 1000);
    }

    #[test]
    fn closed_wall_and_deny_report_are_public() {
        let wall = crate::ClosedWall::new("gap.agent_permission", crate::DENY_NO_PERMISSION);
        assert_eq!(wall.id.as_str(), "gap.agent_permission");
        let _n = std::any::type_name::<crate::DenyReport>();
        let _a = std::any::type_name::<crate::AdmitResult>();
        let closed = crate::agent_permission("agent-a", "action:write", &[]);
        assert_eq!(closed.closed, true);
        assert_eq!(closed.reason, crate::DENY_NO_PERMISSION);
    }
}
