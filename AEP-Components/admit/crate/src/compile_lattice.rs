// HVVCAS: compile_lattice_walls domain:policy type:library
// Compile lattice-policy.rego deny_lattice into Admit walls.
// Live action_path uses these walls. OPA evaluate is lab only.
// AEP28-ENV-033: who-may-do-what is GAP dimension Conjunction. No trust rank.

use super::compile_trust::{agent_is_granted, AgentMayGrant};
use super::AdmitWall;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Clone, Debug, Default)]
pub struct LatticeCompileInput {
    pub action_path: String,
    pub category: String,
    pub agent_id: String,
    pub agent_may: Vec<String>,
    pub satisfied_actions: Vec<String>,
    pub parents_of: Vec<String>,
    pub is_root: bool,
    pub all_actions: Vec<String>,
    pub simultaneous_outputs: u32,
    pub event_rate: f64,
    pub payload_empty: bool,
    pub payload_repeated_violation: bool,
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

fn agent_partition_id(agent_id: &str) -> &str {
    if agent_id.is_empty() {
        "unbound"
    } else {
        agent_id
    }
}

fn agent_record_key(session_id: &str, agent_id: &str, path: &str) -> String {
    let agt = agent_partition_id(agent_id);
    if session_id.is_empty() {
        let mut k = String::from("agt|");
        k.push_str(agt);
        k.push('|');
        k.push_str(path);
        k
    } else {
        let mut k = String::from("ses|");
        k.push_str(session_id);
        k.push_str("|agt|");
        k.push_str(agt);
        k.push('|');
        k.push_str(path);
        k
    }
}

fn parent_recorded(items: &[String], parent: &str, agent_id: &str) -> bool {
    let key = agent_record_key("", agent_id, parent);
    if set_has(items, &key) {
        return true;
    }
    if agent_id.is_empty() == false {
        let mut legacy = String::from(agent_id);
        legacy.push(':');
        legacy.push_str(parent);
        if set_has(items, &legacy) {
            return true;
        }
    }
    let suffix = {
        let mut s = String::from("|");
        s.push_str(parent);
        s
    };
    let agent_scoped = items.iter().any(|s| s.contains("agt|") && s.ends_with(&suffix));
    if agent_scoped {
        return false;
    }
    set_has(items, parent)
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

fn grants_from_allowed(allowed: &[String]) -> Vec<AgentMayGrant> {
    allowed
        .iter()
        .map(|a| AgentMayGrant {
            agent_id: a.clone(),
            action: String::from("*"),
        })
        .collect()
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

    let systemish = input.category == "external_event" || input.category == "system_event";
    if input.agent_may.is_empty() == false || systemish == false {
        let grants = grants_from_allowed(&input.agent_may);
        if agent_is_granted(&input.agent_id, &input.action_path, &grants) == false {
            let mut reason = String::from("GAP dimension agent_may closed: agent '");
            if input.agent_id.is_empty() {
                reason.push_str("unbound");
            } else {
                reason.push_str(&input.agent_id);
            }
            reason.push_str("' may not '");
            reason.push_str(&input.action_path);
            reason.push('\'');
            close_wall("lattice.agent_may", reason, &mut out);
        }
    }

    if input.is_root == false && input.parents_of.is_empty() == false {
        let mut any_parent = false;
        for p in &input.parents_of {
            if parent_recorded(&input.satisfied_actions, p, &input.agent_id) {
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
        if parent_recorded(&input.satisfied_actions, parent, &input.agent_id) && child == &input.action_path {
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
        "agent_may",
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
    let banned = [
        "trust_tier_low",
        "trust_tier_mid",
        "trust_tier_high",
        "requires trust tier",
        "output actions require trust tier",
    ];
    for n in banned {
        if rego.contains(n) {
            let mut msg = String::from("lattice-policy.rego still has rank lemma: ");
            msg.push_str(n);
            return Err(msg);
        }
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
    fn agent_may_denied_closes() -> Result<(), String> {
        let mut input = LatticeCompileInput::default();
        input.action_path = String::from("webhook:incoming");
        input.category = String::from("agent_action");
        input.agent_id = String::from("agent-b");
        input.agent_may.push(String::from("agent-a"));
        input.all_actions.push(String::from("webhook:incoming"));
        input.is_root = true;
        let compiled = compile_lattice_policy(&input, &sample_sets());
        if compiled
            .walls
            .iter()
            .any(|w| w.closed && w.id == "lattice.agent_may")
            == false
        {
            return Err(String::from("expected closed lattice.agent_may wall"));
        }
        if compiled
            .deny
            .iter()
            .any(|d| d.contains("may not"))
            == false
        {
            return Err(String::from("expected GAP dimension deny"));
        }
        Ok(())
    }

    #[test]
    fn granted_agent_does_not_close_agent_may() -> Result<(), String> {
        let mut input = LatticeCompileInput::default();
        input.action_path = String::from("webhook:incoming");
        input.category = String::from("agent_action");
        input.agent_id = String::from("agent-a");
        input.agent_may.push(String::from("agent-a"));
        input.all_actions.push(String::from("webhook:incoming"));
        input.is_root = true;
        let compiled = compile_lattice_policy(&input, &sample_sets());
        if compiled
            .walls
            .iter()
            .any(|w| w.closed && w.id == "lattice.agent_may")
        {
            return Err(String::from("granted agent must not close agent_may"));
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
