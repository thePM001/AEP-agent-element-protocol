//! Conformance source gate: the live dock of the Base Node runs one evaluation. The entry
//! admit_sealed_payload_on_live_dock reaches admit_sealed_payload_report_in_view, which
//! attaches the live walls and runs the one process_event Admit. No production code of
//! envelope_admit.rs runs live_collect_all beside it. It reads the code through
//! aep-source-check, so a renamed or missing function fails the gate. It admits no
//! traffic and decides no verdict.

use aep_source_check::{workspace_path, RustSource};

/// Each entry must call the next one, down to the function that runs Admit.
const ENTRY_CHAIN: [(&str, &str); 3] = [
    (
        "admit_sealed_payload_on_live_dock",
        "admit_sealed_payload_report(",
    ),
    (
        "admit_sealed_payload_report",
        "admit_sealed_payload_report_recorded(",
    ),
    (
        "admit_sealed_payload_report_recorded",
        "admit_sealed_payload_report_in_view(",
    ),
];

fn one_live_evaluation(src: &RustSource) -> Result<(), String> {
    for (caller, callee) in ENTRY_CHAIN {
        if !src.function(caller)?.contains(callee) {
            return Err(format!("{caller} does not call {callee}"));
        }
    }
    let admit = src.function("admit_sealed_payload_report_in_view")?;
    if !admit.contains("attach_live_walls") {
        return Err(String::from("the live dock Admit attaches no live walls"));
    }
    if !admit.contains("process_event") {
        return Err(String::from(
            "the live dock Admit runs no process_event Admit",
        ));
    }
    if src.production().contains("live_collect_all(") {
        return Err(String::from(
            "envelope_admit calls both live_collect_all and process_event Admit on the same plaintext",
        ));
    }
    Ok(())
}

/// The live dock of the Base Node attaches its walls through this crate and the live dock
/// crate. This check moved here from admit-live-dock, so one gate owns it.
fn live_dock_imports(src: &RustSource) -> Result<(), String> {
    let prod = src.production();
    for name in [
        "aep_admit_live_dock",
        "aep_one_live_evaluation",
        "attach_live_walls",
    ] {
        if !prod.contains(name) {
            return Err(format!("envelope_admit missing {name}"));
        }
    }
    Ok(())
}

fn parse(text: &str) -> RustSource {
    match RustSource::parse("sample.rs", text) {
        Ok(s) => s,
        Err(e) => panic!("sample does not parse: {e}"),
    }
}

const CHAIN: &str = "pub fn admit_sealed_payload_on_live_dock() { admit_sealed_payload_report(live, p, dock); }\npub fn admit_sealed_payload_report() { admit_sealed_payload_report_recorded(live, p, dock, r); }\npub fn admit_sealed_payload_report_recorded() { admit_sealed_payload_report_in_view(live, p, dock, r, v); }\n";

#[test]
fn the_live_dock_runs_one_evaluation() -> Result<(), String> {
    let admit = RustSource::read(&workspace_path(&[
        "AEP-Base-Node",
        "AEP-Crate",
        "src",
        "envelope_admit.rs",
    ])?)?;
    live_dock_imports(&admit)?;
    one_live_evaluation(&admit)
}

#[test]
fn a_dual_call_fails() {
    let bad = parse(&format!("{CHAIN}pub fn admit_sealed_payload_report_in_view() {{ attach_live_walls_in_view(live, &value, dock, view); live_collect_all(live, &value, dock)?; match live.process_event_recorded(value, record) {{ _ => {{}} }} }}"));
    match one_live_evaluation(&bad) {
        Err(e) => assert!(e.contains("both live_collect_all and process_event")),
        Ok(()) => panic!("a dual call passed"),
    }
}

#[test]
fn one_admit_then_apply_passes() {
    let good = parse(&format!("{CHAIN}pub fn admit_sealed_payload_report_in_view() {{ attach_live_walls_in_view(live, &value, dock, view); match live.process_event_recorded(value, record) {{ _ => {{}} }} }}"));
    assert_eq!(one_live_evaluation(&good), Ok(()));
}

#[test]
fn a_missing_or_bypassed_function_fails() {
    match one_live_evaluation(&parse("fn other() {}")) {
        Err(e) => assert!(e.contains("fn admit_sealed_payload_on_live_dock not found")),
        Ok(()) => panic!("a missing function passed"),
    }
    // An entry that no longer reaches the Admit function fails, even with a clean body.
    let bypass = parse("pub fn admit_sealed_payload_on_live_dock() { apply_directly(live, p); }");
    match one_live_evaluation(&bypass) {
        Err(e) => assert!(e.contains("does not call admit_sealed_payload_report(")),
        Ok(()) => panic!("a bypassing entry passed"),
    }
}
