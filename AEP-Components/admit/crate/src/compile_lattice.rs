// @PAD: gaplune-creation-pad emit ( zero-LLM )
// HVVCAS: compile_lattice_walls domain:policy type:library
// Compile lattice-policy.rego deny_lattice into Admit walls.
// Live action_path uses these walls. OPA evaluate is lab only.

use super::AdmitWall;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub struct LatticeCompileInput {
    pub action_path: String,
    pub trust_tier: u32,
    pub category: String,
    pub agent_id: String,
    pub satisfied_actions: Vec<String>,
    pub parents_of: Vec<String>,
    pub is_root: bool,
    pub all_actions: Vec<String>,
    pub simultaneous_outputs: u32,
    pub event_rate: f64,
    pub payload_empty: bool,
    pub payload_repeated_violation: bool,
    pub payload_trust_tier_history: String,
}

#[derive(Clone, Debug, Default)]
pub struct CompiledPolicy {
    pub walls: Vec<AdmitWall>,
    pub deny: Vec<String>,
    pub warn: Vec<String>,
    pub escalate: Vec<String>,
}

pub struct PolicySets {
    pub critical_actions: Vec<String>,
    pub output_actions: Vec<String>,
    pub forbidden_pairs: Vec<(String, String)>,
}

fn quoted_strings(block: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = block.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'"' {
            i += 1;
            let start = i;
            while i < bytes.len() && bytes[i] != b'"' {
                i += 1;
            }
            if i <= bytes.len() && start <= i {
                if let Ok(s) = std::str::from_utf8(&bytes[start..i]) {
                    out.push(s.to_string());
                }
            }
            i += 1;
        } else {
            i += 1;
        }
    }
    out
}

fn slice_named_block(src: &str, key: &str) -> String {
    let start_key = match src.find(key) {
        Some(v) => v,
        None => return String::new(),
    };
    let brace = match src[start_key..].find('{') {
        Some(v) => start_key + v,
        None => return String::new(),
    };
    let mut depth = 0;
    let mut end = brace;
    for (idx, ch) in src[brace..].char_indices() {
        if ch == '{' {
            depth += 1;
        } else if ch == '}' {
            depth -= 1;
            if depth == 0 {
                end = brace + idx + 1;
                break;
            }
        }
    }
    if end <= brace {
        return String::new();
    }
    src[brace..end].to_string()
}

pub fn parse_policy_sets(rego: &str) -> PolicySets {
    let critical = quoted_strings(&slice_named_block(rego, "critical_actions"));
    let outputs = quoted_strings(&slice_named_block(rego, "output_actions"));
    let forbidden_block = slice_named_block(rego, "forbidden_sequences");
    let names = quoted_strings(&forbidden_block);
    let mut pairs = Vec::new();
    let mut i = 0;
    while i + 1 < names.len() {
        pairs.push((names[i].clone(), names[i + 1].clone()));
        i += 2;
    }
    PolicySets {
        critical_actions: critical,
        output_actions: outputs,
        forbidden_pairs: pairs,
    }
}

pub fn load_policy_sets(path: &Path) -> Result<PolicySets, String> {
    match fs::read_to_string(path) {
        Ok(text) => Ok(parse_policy_sets(&text)),
        Err(err) => Err(err.to_string()),
    }
}

fn set_has(items: &[String], needle: &str) -> bool {
    items.iter().any(|s| s == needle)
}

fn trust_tier_low(t: u32) -> bool {
    t >= 1 && t <= 2
}

fn trust_tier_mid(t: u32) -> bool {
    t >= 3 && t <= 4
}

fn trust_tier_high(t: u32) -> bool {
    t == 5
}

fn rate_text(rate: f64) -> String {
    if rate.fract() == 0.0 {
        (rate as u64).to_string()
    } else {
        rate.to_string()
    }
}

fn close_wall(id: &str, reason: String, out: &mut CompiledPolicy) {
    out.deny.push(reason.clone());
    out.walls.push(AdmitWall::close(id, reason));
}

pub fn compile_lattice_policy(input: &LatticeCompileInput, sets: &PolicySets) -> CompiledPolicy {
    let mut out = CompiledPolicy::default();
    let known = set_has(&input.all_actions, &input.action_path);

    if known == false {
        let mut reason = String::from("Unknown action path: '");
        reason.push_str(&input.action_path);
        reason.push_str("' - not found in lattice registry");
        close_wall("lattice.unknown_path", reason, &mut out);
    }

    if trust_tier_low(input.trust_tier) {
        if input.category != "external_event" && input.category != "system_event" {
            let mut reason = String::from("Trust tier ");
            reason.push_str(&input.trust_tier.to_string());
            reason.push_str(
                " denied: tier 1-2 agents may only handle external_event or system_event (got '",
            );
            reason.push_str(&input.category);
            reason.push_str("')");
            close_wall("lattice.trust_tier_low_category", reason, &mut out);
        }
        if input.category == "agent_action" {
            let mut reason = String::from("Trust tier ");
            reason.push_str(&input.trust_tier.to_string());
            reason.push_str(" denied: agent_action category requires trust tier >= 3");
            close_wall("lattice.trust_tier_low_agent_action", reason, &mut out);
        }
    }

    if trust_tier_mid(input.trust_tier) && set_has(&sets.critical_actions, &input.action_path) {
        let mut reason = String::from("Trust tier ");
        reason.push_str(&input.trust_tier.to_string());
        reason.push_str(" denied: critical action '");
        reason.push_str(&input.action_path);
        reason.push_str("' requires trust tier 5");
        close_wall("lattice.trust_tier_mid_critical", reason, &mut out);
    }

    if input.is_root == false && input.parents_of.is_empty() == false {
        let mut any_parent = false;
        for p in &input.parents_of {
            if set_has(&input.satisfied_actions, p) {
                any_parent = true;
            }
        }
        if any_parent == false {
            let mut reason =
                String::from("Partial-order violation: none of the parent actions for '");
            reason.push_str(&input.action_path);
            reason.push_str("' have been satisfied (parents: ");
            reason.push_str(&input.parents_of.join(", "));
            reason.push(')');
            close_wall("lattice.partial_order", reason, &mut out);
        }
    }

    for (parent, child) in &sets.forbidden_pairs {
        if set_has(&input.satisfied_actions, parent) && child == &input.action_path {
            let mut reason = String::from("Forbidden sequence: '");
            reason.push_str(&input.action_path);
            reason.push_str("' must not follow '");
            reason.push_str(parent);
            reason.push('\'');
            close_wall("lattice.forbidden_sequence", reason, &mut out);
        }
    }

    if input.category == "agent_action" && input.event_rate > 10.0 {
        let mut reason = String::from("Rate limit exceeded: agent '");
        reason.push_str(&input.agent_id);
        reason.push_str("' at ");
        reason.push_str(&rate_text(input.event_rate));
        reason.push_str(" events/sec for agent_action category (max: 10)");
        close_wall("lattice.rate_limit", reason, &mut out);
    }

    if set_has(&sets.output_actions, &input.action_path) && input.simultaneous_outputs > 3 {
        let mut reason = String::from("Cross-modality ceiling exceeded: ");
        reason.push_str(&input.simultaneous_outputs.to_string());
        reason.push_str(" simultaneous outputs active (max: 3) for action '");
        reason.push_str(&input.action_path);
        reason.push('\'');
        close_wall("lattice.cross_modality", reason, &mut out);
    }

    if input.category == "output" && input.trust_tier < 2 {
        let mut reason = String::from("Trust tier ");
        reason.push_str(&input.trust_tier.to_string());
        reason.push_str(" denied: output actions require trust tier >= 2");
        close_wall("lattice.output_trust", reason, &mut out);
    }

    if trust_tier_mid(input.trust_tier) && input.category == "agent_action" && input.payload_empty {
        let mut msg = String::from("Trust tier ");
        msg.push_str(&input.trust_tier.to_string());
        msg.push_str(" agent_action has empty payload - recommend supplying action context");
        out.warn.push(msg);
    }

    if input.category == "agent_action" && input.event_rate > 7.0 && input.event_rate <= 10.0 {
        let mut msg = String::from("Agent '");
        msg.push_str(&input.agent_id);
        msg.push_str("' approaching rate limit: ");
        msg.push_str(&rate_text(input.event_rate));
        msg.push_str(" events/sec (limit: 10)");
        out.warn.push(msg);
    }

    if set_has(&sets.output_actions, &input.action_path) && input.simultaneous_outputs == 3 {
        out.warn
            .push(String::from("Cross-modality at ceiling: 3 simultaneous outputs active"));
    }

    if trust_tier_mid(input.trust_tier) && input.category == "agent_action" {
        let n_sat = input.satisfied_actions.len();
        if n_sat > 0 && n_sat < 2 {
            let mut msg = String::from("Trust tier ");
            msg.push_str(&input.trust_tier.to_string());
            msg.push_str(" has only ");
            msg.push_str(&n_sat.to_string());
            msg.push_str(" satisfied parent(s) - low trust-buffer for action '");
            msg.push_str(&input.action_path);
            msg.push('\'');
            out.warn.push(msg);
        }
    }

    if trust_tier_high(input.trust_tier) && set_has(&sets.critical_actions, &input.action_path) {
        let has_review = input
            .satisfied_actions
            .iter()
            .any(|a| a.contains("validate") || a.contains("review"));
        if has_review == false {
            let mut msg = String::from("Critical action '");
            msg.push_str(&input.action_path);
            msg.push_str("' executed by trust tier ");
            msg.push_str(&input.trust_tier.to_string());
            msg.push_str(" without any prior validation or review step in satisfied actions");
            out.warn.push(msg);
        }
        if input.satisfied_actions.is_empty() {
            let mut msg = String::from("Critical action '");
            msg.push_str(&input.action_path);
            msg.push_str("' attempted by trust tier ");
            msg.push_str(&input.trust_tier.to_string());
            msg.push_str(" with no satisfied parent actions - human approval required");
            out.escalate.push(msg);
        }
    }

    if input.payload_repeated_violation && input.event_rate > 10.0 {
        let mut msg = String::from("Repeated rate-limit violation by agent '");
        msg.push_str(&input.agent_id);
        msg.push_str("' at ");
        msg.push_str(&rate_text(input.event_rate));
        msg.push_str(" events/sec - human review recommended");
        out.escalate.push(msg);
    }

    if known == false && input.action_path.is_empty() == false {
        let mut msg = String::from("Unknown action path '");
        msg.push_str(&input.action_path);
        msg.push_str("' detected - possible agent hallucination, manual review recommended");
        out.escalate.push(msg);
    }

    if trust_tier_high(input.trust_tier)
        && input.category == "agent_action"
        && input.payload_trust_tier_history == "direct_jump"
    {
        let mut msg = String::from("Trust tier jump detected: agent '");
        msg.push_str(&input.agent_id);
        msg.push_str("' escalated directly to tier ");
        msg.push_str(&input.trust_tier.to_string());
        msg.push_str(" without mid-level validation steps");
        out.escalate.push(msg);
    }

    out
}

pub fn compile_lattice_walls(input: &LatticeCompileInput, sets: &PolicySets) -> Vec<AdmitWall> {
    compile_lattice_policy(input, sets).walls
}

pub fn prove_rego_source(rego: &str) -> Result<String, String> {
    let needles = [
        "package dynaep",
        "deny_lattice[",
        "critical_actions",
        "forbidden_sequences",
        "Unknown action path",
        "Partial-order violation",
        "Rate limit exceeded",
        "Cross-modality ceiling",
        "output actions require trust tier",
    ];
    let mut missing = Vec::new();
    for n in needles {
        if rego.contains(n) == false {
            missing.push(n);
        }
    }
    if missing.is_empty() == false {
        let mut msg = String::from("lattice-policy.rego missing compiled-wall source: ");
        msg.push_str(&missing.join(","));
        return Err(msg);
    }
    let sets = parse_policy_sets(rego);
    if sets.critical_actions.is_empty()
        || sets.output_actions.is_empty()
        || sets.forbidden_pairs.is_empty()
    {
        return Err(String::from(
            "lattice-policy.rego did not yield critical, output or forbidden sets",
        ));
    }
    let mut proof = String::from("ok critical=");
    proof.push_str(&sets.critical_actions.len().to_string());
    proof.push_str(" output=");
    proof.push_str(&sets.output_actions.len().to_string());
    proof.push_str(" forbidden=");
    proof.push_str(&sets.forbidden_pairs.len().to_string());
    Ok(proof)
}

pub fn default_rego_path() -> PathBuf {
    let mut p = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| String::from(".")),
    );
    p.push("../../dynAEP/policies/lattice-policy.rego");
    p
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_sets() -> PolicySets {
        let path = default_rego_path();
        load_policy_sets(&path).unwrap_or_else(|_| {
            let mut critical_actions = Vec::new();
            critical_actions.push(String::from("agent:email:send"));
            let mut output_actions = Vec::new();
            output_actions.push(String::from("output:notify"));
            let mut forbidden_pairs = Vec::new();
            forbidden_pairs.push((
                String::from("system:shutdown"),
                String::from("agent:register"),
            ));
            PolicySets {
                critical_actions,
                output_actions,
                forbidden_pairs,
            }
        })
    }

    #[test]
    fn unknown_path_reason_is_a_closed_wall() -> Result<(), String> {
        let mut input = LatticeCompileInput::default();
        input.action_path = String::from("bogus:path");
        input.trust_tier = 3;
        input.category = String::from("agent_action");
        input.all_actions.push(String::from("webhook:incoming"));
        let compiled = compile_lattice_policy(&input, &sample_sets());
        if compiled.deny.iter().any(|d| d.contains("Unknown action path")) == false {
            return Err(String::from("expected unknown path deny"));
        }
        if compiled
            .walls
            .iter()
            .any(|w| w.closed && w.id == "lattice.unknown_path")
            == false
        {
            return Err(String::from("expected closed lattice.unknown_path wall"));
        }
        Ok(())
    }

    #[test]
    fn trust_tier_one_agent_action_closes() -> Result<(), String> {
        let mut input = LatticeCompileInput::default();
        input.action_path = String::from("webhook:incoming");
        input.trust_tier = 1;
        input.category = String::from("agent_action");
        input.all_actions.push(String::from("webhook:incoming"));
        input.is_root = true;
        let compiled = compile_lattice_policy(&input, &sample_sets());
        if compiled
            .deny
            .iter()
            .any(|d| d.contains("agent_action category requires"))
            == false
        {
            return Err(String::from("expected trust deny for agent_action"));
        }
        Ok(())
    }

    #[test]
    fn live_rego_source_proves() -> Result<(), String> {
        let path = default_rego_path();
        if path.is_file() == false {
            return Ok(());
        }
        match fs::read_to_string(&path) {
            Ok(text) => match prove_rego_source(&text) {
                Ok(_) => Ok(()),
                Err(e) => Err(e),
            },
            Err(e) => Err(e.to_string()),
        }
    }
}
