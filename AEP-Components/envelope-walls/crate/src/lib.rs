// Compile lattice-policy.rego into Admit walls and prove the Rego file is their source.

use aep_admit::{
    admit_collect_all, compile_lattice_policy, default_rego_path, load_policy_sets,
    prove_rego_source, AdmitWall, LatticeCompileInput, PolicySets,
};
use std::fs;
use std::path::{Path, PathBuf};

/// Prove the Rego file is the wall source and that an unknown action path closes compiled walls.
pub fn run_gate(rego: &Path) -> Result<i32, String> {
    let text = match fs::read_to_string(rego) {
        Ok(t) => t,
        Err(e) => return Err(e.to_string()),
    };
    let proof = prove_rego_source(&text)?;
    let sets = load_policy_sets(rego)?;
    let mut input = LatticeCompileInput {
        action_path: String::from("bogus:path"),
        category: String::from("agent_action"),
        ..Default::default()
    };
    input.all_actions.push(String::from("webhook:incoming"));
    let compiled = compile_lattice_policy(&input, &sets);
    let admit = admit_collect_all(&compiled.walls);
    if admit.allow {
        return Err(String::from("unknown path must close compiled walls"));
    }
    if !compiled
        .deny
        .iter()
        .any(|d| d.contains("Unknown action path"))
    {
        return Err(String::from("former Rego unknown-path deny missing"));
    }
    println!(
        "aep-envelope-walls ok proof={} closed={}",
        proof,
        admit.closed.len()
    );
    Ok(0)
}

fn empty_policy_sets() -> PolicySets {
    PolicySets {
        critical_actions: Vec::new(),
        output_actions: Vec::new(),
        forbidden_pairs: Vec::new(),
    }
}

fn load_live_policy_sets() -> PolicySets {
    if let Ok(p) = std::env::var("AEP_LATTICE_REGO") {
        if !p.is_empty() {
            if let Ok(sets) = load_policy_sets(Path::new(&p)) {
                return sets;
            }
        }
    }
    if let Ok(sets) = load_policy_sets(&default_rego_path()) {
        return sets;
    }
    let mut dir =
        PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| String::from(".")));
    let mut i = 0usize;
    while i < 8 {
        let p = dir.join("AEP-Components/dynAEP/policies/lattice-policy.rego");
        if p.is_file() {
            if let Ok(sets) = load_policy_sets(&p) {
                return sets;
            }
        }
        match dir.parent() {
            Some(parent) => dir = parent.to_path_buf(),
            None => break,
        }
        i = i.saturating_add(1);
    }
    empty_policy_sets()
}

/// Compile lattice-policy walls for one live collect-all pass.
pub fn compile_live_lattice_walls(input: &LatticeCompileInput) -> Vec<AdmitWall> {
    aep_admit::compile_lattice_walls(input, &load_live_policy_sets())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_path_former_rego_reason_is_closed_wall() -> Result<(), String> {
        let sets = load_policy_sets(&default_rego_path())?;
        let mut input = LatticeCompileInput {
            action_path: String::from("bogus:path"),
            category: String::from("agent_action"),
            ..Default::default()
        };
        input.all_actions.push(String::from("webhook:incoming"));
        let compiled = compile_lattice_policy(&input, &sets);
        let admit = admit_collect_all(&compiled.walls);
        if admit.allow {
            return Err(String::from("expected closed walls"));
        }
        if !admit
            .closed
            .iter()
            .any(|w| w.reason.contains("Unknown action path"))
        {
            return Err(String::from("former Rego deny missing as closed wall"));
        }
        Ok(())
    }

    #[test]
    fn rego_source_proves_at_boot() -> Result<(), String> {
        let text = fs::read_to_string(default_rego_path()).map_err(|e| e.to_string())?;
        prove_rego_source(&text).map(|_| ())
    }

    #[test]
    fn live_lattice_walls_unknown_path_closes() -> Result<(), String> {
        let mut input = LatticeCompileInput {
            action_path: String::from("bogus:path"),
            category: String::from("agent_action"),
            ..Default::default()
        };
        input.all_actions.push(String::from("webhook:incoming"));
        let walls = compile_live_lattice_walls(&input);
        let admit = admit_collect_all(&walls);
        if admit.allow {
            return Err(String::from("expected closed live lattice walls"));
        }
        if !admit
            .closed
            .iter()
            .any(|w| w.reason.contains("Unknown action path"))
        {
            return Err(String::from("live lattice walls missing unknown path"));
        }
        Ok(())
    }

    #[test]
    fn run_gate_on_default_rego_passes() {
        assert_eq!(run_gate(&default_rego_path()), Ok(0));
    }
}
