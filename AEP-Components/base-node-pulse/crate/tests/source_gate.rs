//! Source gate: the Base Node docking module owns the one pulse, dynAEP is not a second
//! pulse owner, no drift bound is set to the pulse length and the live walls measure drift
//! against the frozen time. It reads the code through aep-source-check, so a renamed or
//! missing function fails the gate.

use aep_base_node_pulse::MAX_DRIFT_MS;
use aep_source_check::{workspace_path, CodeText, RustSource};

/// handle_frame enqueues into the pulse and never Admits before the enqueue.
fn scan_docking_pulse_owner(src: &RustSource) -> Result<(), String> {
    let code = src.production();
    if !code.contains("aep_base_node_pulse") {
        return Err(String::from(
            "the docking module is not the Base Node pulse owner",
        ));
    }
    if !code.contains("pulse_beat") {
        return Err(String::from("the docking module has no pulse beat"));
    }
    let handle = src.function("handle_frame")?;
    match (
        handle.find("admit_sealed_payload_on_live_dock"),
        handle.find("pulse_enqueue"),
    ) {
        (Some(a), Some(e)) if a < e => {
            Err(String::from("handle_frame still Admits before enqueue"))
        }
        (Some(_), None) => Err(String::from("handle_frame still Admits immediately")),
        (None, None) => Err(String::from("handle_frame has no pulse enqueue")),
        _ => Ok(()),
    }
}

fn scan_dynaep_not_pulse_owner(code: &CodeText) -> Result<(), String> {
    if code.contains("QUEUE_CAP_CAPSULES")
        || code.contains("QUEUE_CAP_BYTES")
        || code.contains("PulseQueue")
    {
        return Err(String::from("aep-dynaep is a second pulse owner"));
    }
    Ok(())
}

fn scan_drift_not_pulse_length(code: &CodeText) -> Result<(), String> {
    if code.contains("max_drift_ms = 1000")
        || code.contains("max_drift_ms: 1000")
        || code.contains("max_drift_ms = PULSE_MS")
        || code.contains("fn default_drift() -> i64 { 1000 }")
    {
        return Err(String::from("max_drift_ms is set to pulse length"));
    }
    Ok(())
}

fn scan_docking_no_local_wire_clocks(code: &CodeText) -> Result<(), String> {
    if code.contains("const MAX_FRAME_AGE_SECS") {
        return Err(String::from(
            "the docking module keeps local const MAX_FRAME_AGE_SECS",
        ));
    }
    if code.contains("const MAX_FRAME_FUTURE_SKEW_SECS") {
        return Err(String::from(
            "the docking module keeps local const MAX_FRAME_FUTURE_SKEW_SECS",
        ));
    }
    if !code.contains("MAX_FRAME_AGE_SECS") || !code.contains("MAX_FRAME_FUTURE_SKEW_SECS") {
        return Err(String::from(
            "the docking module does not use the pulse crate wire clocks",
        ));
    }
    Ok(())
}

/// The live walls are compiled in compile_live_walls_in_view, which every entry point
/// calls. They measure drift against the frozen time and not against live now.
fn scan_compile_live_walls_freeze(src: &RustSource) -> Result<(), String> {
    if !src
        .function("compile_live_walls")?
        .contains("compile_live_walls_in_view(")
    {
        return Err(String::from(
            "compile_live_walls does not compile in the one view",
        ));
    }
    let code = src.function("compile_live_walls_in_view")?;
    if code.contains("let bridge = live.now_ms()") {
        return Err(String::from(
            "compile_live_walls_in_view still uses live now as pulse bridge",
        ));
    }
    if !code.contains("live.wall_bridge_ts_ms()") {
        return Err(String::from(
            "compile_live_walls_in_view has no freeze bind",
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
fn the_docking_module_owns_the_one_pulse() -> Result<(), String> {
    let dir = workspace_path(&["AEP-Base-Node", "AEP-Crate", "src", "docking"])?;
    let dock = RustSource::read_module_dir(&dir, &["tests.rs"])?;
    let dynaep = read(&["AEP-Components", "dynAEP", "crate", "src", "lib.rs"])?;
    let envelope = read(&["AEP-Components", "envelope", "crate", "src", "lib.rs"])?;
    let live = read(&["AEP-Components", "live-entry", "crate", "src", "lib.rs"])?;
    let temporal = read(&[
        "AEP-Components",
        "admit-temporal-bounds",
        "crate",
        "src",
        "compile.rs",
    ])?;
    let live_dock = read(&[
        "AEP-Components",
        "admit-live-dock",
        "crate",
        "src",
        "lib.rs",
    ])?;
    scan_docking_pulse_owner(&dock)?;
    scan_dynaep_not_pulse_owner(&dynaep.production())?;
    for src in [&envelope, &temporal, &live, &dock, &live_dock] {
        scan_drift_not_pulse_length(&src.production())?;
    }
    scan_compile_live_walls_freeze(&live_dock)?;
    scan_docking_no_local_wire_clocks(&dock.production())?;
    let live_code = live.production();
    if !live_code.contains("freeze_temporal_snapshot") {
        return Err(String::from("live-entry has no freeze_temporal_snapshot"));
    }
    if !live_code.contains("wall_bridge_ts_ms") {
        return Err(String::from("live-entry has no wall_bridge_ts_ms"));
    }
    Ok(())
}

#[test]
fn the_scans_refuse_a_second_owner_and_a_pulse_length_drift() {
    let bad = parse("fn handle_frame() { admit_sealed_payload_on_live_dock(&mut live, &plaintext, &dock); }\nuse aep_base_node_pulse::pulse_beat;");
    assert!(scan_docking_pulse_owner(&bad).is_err());
    let ordered = parse(
        "use aep_base_node_pulse::pulse_beat;\nfn handle_frame() { pulse_enqueue(&rt, cap); }",
    );
    assert_eq!(scan_docking_pulse_owner(&ordered), Ok(()));
    let renamed = parse(
        "use aep_base_node_pulse::pulse_beat;\nfn handle_line() { pulse_enqueue(&rt, cap); }",
    );
    assert!(scan_docking_pulse_owner(&renamed).is_err());
    assert!(scan_dynaep_not_pulse_owner(
        &parse("pub const QUEUE_CAP_CAPSULES: usize = 256; struct PulseQueue {}").production()
    )
    .is_err());
    assert!(
        scan_drift_not_pulse_length(&parse("fn default_drift() -> i64 { 1000 }").production())
            .is_err()
    );
    let entry = "pub fn compile_live_walls() { compile_live_walls_in_view(live, event, dock, &view).walls }";
    assert!(scan_compile_live_walls_freeze(&parse(&format!(
        "{entry}\npub fn compile_live_walls_in_view() {{ let bridge = live.now_ms(); }}"
    )))
    .is_err());
    assert!(scan_compile_live_walls_freeze(&parse(&format!(
        "{entry}\npub fn compile_live_walls_in_view() {{ let bridge = live.wall_bridge_ts_ms(); }}"
    )))
    .is_ok());
    // The prefix match of the old text check took compile_live_walls_in_view for
    // compile_live_walls. A missing view function is now an error.
    assert!(scan_compile_live_walls_freeze(&parse(entry)).is_err());
    assert_ne!(MAX_DRIFT_MS, 1000);
    assert!(scan_docking_no_local_wire_clocks(
        &parse("const MAX_FRAME_AGE_SECS: u64 = 300;\nconst MAX_FRAME_FUTURE_SKEW_SECS: u64 = 60;")
            .production()
    )
    .is_err());
    assert!(scan_docking_no_local_wire_clocks(
        &parse("use aep_base_node_pulse::{MAX_FRAME_AGE_SECS, MAX_FRAME_FUTURE_SKEW_SECS};")
            .production()
    )
    .is_ok());
}
