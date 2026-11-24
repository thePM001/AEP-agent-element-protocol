//! The model check itself. These tests need TLC (java and tla2tools.jar, see
//! src/tlc.rs). The test target is left out of a plain cargo test and runs when
//! it is named:
//!
//!   cargo test -p aep-tla-verify --test model_check
//!
//! Each shipped model must pass with the deadlock check on, and each mutant below
//! breaks one rule of a model and must fail for that reason. A mutant that passes
//! means the property it targets checks nothing. A host without TLC fails here.

use aep_tla_verify::tlc::{self, Outcome};
use std::path::{Path, PathBuf};

fn model_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn work_dir(tag: &str) -> PathBuf {
    let dir =
        std::env::temp_dir().join(format!("aep-tla-model-check-{}-{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    if let Err(e) = std::fs::create_dir_all(&dir) {
        panic!("{}: {e}", dir.display());
    }
    dir
}

fn read(path: &Path) -> String {
    match std::fs::read_to_string(path) {
        Ok(s) => s,
        Err(e) => panic!("{}: {e}", path.display()),
    }
}

fn write(path: &Path, text: &str) {
    if let Err(e) = std::fs::write(path, text) {
        panic!("{}: {e}", path.display());
    }
}

fn require_tlc() {
    assert!(tlc::available(), "TLC is not installed: see src/tlc.rs");
}

#[test]
fn shipped_models_pass() {
    require_tlc();
    for m in [
        "AdmitConjunction",
        "DockPulse",
        "LastApplied",
        "TemporalBounds",
        "WrapComplete",
    ] {
        let out = tlc::check_model(&model_dir().join(format!("{m}.tla")));
        assert_eq!(out, Outcome::Pass, "{m}");
    }
}

/// Copy `base` under the module name `name`, apply each text replacement (each must
/// match exactly once) and model check the copy with the configuration of `base`.
fn mutant(base: &str, name: &str, edits: &[(&str, &str)]) -> Outcome {
    let dir = work_dir(name);
    let mut text = read(&model_dir().join(format!("{base}.tla")));
    text = text.replacen(
        &format!("---- MODULE {base} ----"),
        &format!("---- MODULE {name} ----"),
        1,
    );
    for (from, to) in edits {
        assert_eq!(
            text.matches(from).count(),
            1,
            "{name}: edit target {from:?}"
        );
        text = text.replacen(from, to, 1);
    }
    write(&dir.join(format!("{name}.tla")), &text);
    write(
        &dir.join(format!("{name}.cfg")),
        &read(&model_dir().join(format!("{base}.cfg"))),
    );
    let out = tlc::check_model(&dir.join(format!("{name}.tla")));
    let _ = std::fs::remove_dir_all(&dir);
    out
}

/// One mutant: the model it starts from, its module name, its text edits and the class
/// of failure the model check must report.
type Mutant = (
    &'static str,
    &'static str,
    Vec<(&'static str, &'static str)>,
    &'static str,
);

#[test]
fn mutants_fail_for_their_reason() {
    require_tlc();
    let cases: Vec<Mutant> = vec![
        // Without fairness a pulse may stall after the seal.
        (
            "DockPulse",
            "DockPulseUnfair",
            vec![(
                "Spec == Init /\\ [][Next]_vars /\\ WF_vars(Next)",
                "Spec == Init /\\ [][Next]_vars",
            )],
            "tlc-liveness",
        ),
        // Apply after a deny.
        (
            "DockPulse",
            "DockPulseApplyOnDeny",
            vec![(
                "phase' = IF ok THEN \"apply\" ELSE \"refuse\"",
                "phase' = \"apply\"",
            )],
            "tlc-safety",
        ),
        // A dock that takes no next pulse.
        (
            "DockPulse",
            "DockPulseStops",
            vec![("  \\/ NextPulse\n", "")],
            "tlc-deadlock",
        ),
        // A verdict before every wall was read.
        (
            "AdmitConjunction",
            "AdmitEarly",
            vec![("  /\\ checked = Walls\n", "")],
            "tlc-safety",
        ),
        // A wrap that passes with a part missing.
        (
            "WrapComplete",
            "WrapLoose",
            vec![(
                "IF present = Parts THEN \"ok\"",
                "IF present # {} THEN \"ok\"",
            )],
            "tlc-safety",
        ),
        // A drift window one step wider than the bound.
        (
            "TemporalBounds",
            "TemporalWide",
            vec![(
                "IF stamp = \"valid\" /\\ offset > MaxDrift\n",
                "IF stamp = \"valid\" /\\ offset > MaxDrift + 1\n",
            )],
            "tlc-safety",
        ),
        // A book that never evicts.
        (
            "LastApplied",
            "LastUnbounded",
            vec![("IF Len(order) >= Cap", "IF FALSE")],
            "tlc-safety",
        ),
        // A held digest that expires without an answer.
        (
            "LastApplied",
            "LastLosesHeld",
            vec![(
                "Expire(d) ==\n  /\\ st[d] = \"settled\"",
                "Expire(d) ==\n  /\\ st[d] \\in {\"held\", \"settled\"}",
            )],
            "tlc-safety",
        ),
    ];
    for (base, name, edits, reason) in cases {
        assert_eq!(mutant(base, name, &edits), Outcome::Fail(reason), "{name}");
    }
}
