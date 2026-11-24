//! Source gate: a dock Deny carries the closed walls with their class on every path, from
//! the Base Node docking module through the live entry to UCB. This crate never looks
//! up the forensic store. It reads the code through aep-source-check, so a renamed or
//! missing item fails the gate.

use std::path::PathBuf;

use aep_source_check::{workspace_path, CodeText, RustSource};

fn scan_dock_deny_field(dock: &RustSource) -> Result<(), String> {
    if !dock
        .type_item("DockFrameResponse")?
        .contains("pub deny: Option")
    {
        return Err(String::from("DockFrameResponse missing deny field"));
    }
    let prod = dock.production();
    if !prod.contains("admit_sealed_payload_report") {
        return Err(String::from(
            "the docking module does not call admit_sealed_payload_report",
        ));
    }
    if !prod.contains("deny_resp_report") {
        return Err(String::from("the docking module missing deny_resp_report"));
    }
    Ok(())
}

fn scan_live_entry_closed(live: &RustSource) -> Result<(), String> {
    if !live
        .type_item("Rejection")?
        .contains("pub closed: Vec<AdmitWall>")
    {
        return Err(String::from("Rejection missing closed walls"));
    }
    if !live
        .function("process_event")?
        .contains("process_event_recorded(")
    {
        return Err(String::from(
            "process_event does not run the one recorded pass",
        ));
    }
    if !live
        .function("process_event_recorded")?
        .contains("result.closed.clone()")
    {
        return Err(String::from(
            "process_event_recorded does not copy the closed walls onto Rejection",
        ));
    }
    Ok(())
}

fn scan_ucb_deny_field(ucb: &RustSource) -> Result<(), String> {
    if !ucb.type_item("DockResponse")?.contains("pub deny: Option") {
        return Err(String::from("UCB DockResponse missing deny field"));
    }
    if !ucb.production().contains("LatticeDeny") {
        return Err(String::from("UCB missing LatticeDeny"));
    }
    Ok(())
}

/// The crate never looks up, scores or imports the forensic store.
fn scan_no_lookup(code: &CodeText) -> Result<(), String> {
    for (needle, what) in [
        ("attractor", "look up forensic store entries"),
        ("cosine", "score forensic store entries"),
        ("lattice_memory", "import the forensic store"),
    ] {
        if code.contains(needle) {
            return Err(format!("the crate must not {what}"));
        }
    }
    Ok(())
}

fn scan_closed_wall_has_class(kernel_types: &RustSource) -> Result<(), String> {
    if !kernel_types
        .type_item("ClosedWall")?
        .contains("pub class: String")
    {
        return Err(String::from("ClosedWall missing class"));
    }
    Ok(())
}

fn scan_docking_sets_class(code: &CodeText) -> Result<(), String> {
    if !code.contains("ClosedWall") {
        return Err(String::from(
            "the docking module has no ClosedWall construction",
        ));
    }
    for class in [
        "CLASS_WRITING",
        "CLASS_SECURITY",
        "CLASS_TEMPORAL",
        "CLASS_POISON",
    ] {
        if !code.contains(class) {
            return Err(format!(
                "the docking module does not set the ClosedWall class {class}"
            ));
        }
    }
    Ok(())
}

fn scan_admit_sets_class(code: &CodeText) -> Result<(), String> {
    if !code.contains("class:") && !code.contains("classify_wall") && !code.contains("CLASS_") {
        return Err(String::from(
            "envelope_admit.rs does not set ClosedWall class",
        ));
    }
    Ok(())
}

fn read(parts: &[&str]) -> Result<RustSource, String> {
    Ok(RustSource::read(&workspace_path(parts)?)?)
}

fn parse(text: &str) -> RustSource {
    match RustSource::parse("sample.rs", text) {
        Ok(s) => s,
        Err(e) => panic!("sample does not parse: {e}"),
    }
}

#[test]
fn a_dock_deny_carries_classed_closed_walls_on_every_path() -> Result<(), String> {
    let dir = workspace_path(&["AEP-Base-Node", "AEP-Crate", "src", "docking"])?;
    let dock = RustSource::read_module_dir(&dir, &["tests.rs"])?;
    let live = read(&["AEP-Components", "live-entry", "crate", "src", "lib.rs"])?;
    let ucb = read(&[
        "AEP-Base-Node",
        "AEP-Docks",
        "ucb",
        "crate",
        "src",
        "lattice.rs",
    ])?;
    let kernel_types = read(&["AEP-Components", "kernel-types", "crate", "src", "lib.rs"])?;
    let admit = read(&["AEP-Base-Node", "AEP-Crate", "src", "envelope_admit.rs"])?;
    let this_crate = RustSource::read(
        &PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("src")
            .join("lib.rs"),
    )?;
    scan_dock_deny_field(&dock)?;
    scan_live_entry_closed(&live)?;
    scan_ucb_deny_field(&ucb)?;
    scan_no_lookup(&this_crate.production())?;
    scan_closed_wall_has_class(&kernel_types)?;
    scan_docking_sets_class(&dock.production())?;
    scan_admit_sets_class(&admit.production())?;
    Ok(())
}

#[test]
fn a_dock_response_without_deny_fails() {
    let bad = parse("pub struct DockFrameResponse { pub ok: bool }\nfn f() { admit_sealed_payload_report(); deny_resp_report(); }");
    match scan_dock_deny_field(&bad) {
        Err(e) => assert!(e.contains("missing deny field")),
        Ok(()) => panic!("a response without deny passed"),
    }
}

#[test]
fn a_rejection_without_closed_walls_fails() {
    let bad = parse("pub struct Rejection { pub target_id: String, pub error: String }");
    match scan_live_entry_closed(&bad) {
        Err(e) => assert!(e.contains("missing closed walls")),
        Ok(()) => panic!("a rejection without closed walls passed"),
    }
}

#[test]
fn a_forensic_lookup_fails() {
    assert!(
        scan_no_lookup(&parse("fn hint() { store.nearest_attractor(&shape); }").production())
            .is_err()
    );
    assert!(scan_no_lookup(&parse("fn hint() { closed.len(); }").production()).is_ok());
}
