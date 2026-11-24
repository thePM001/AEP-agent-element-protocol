//! Source gate and behaviour proof: an unbound scene, channel, time or sequence closes its
//! wall. The behaviour half runs Admit of the envelope on actions with the field missing.
//! The source half reads the wall functions through aep-source-check, so a renamed or
//! missing wall function fails the gate.

use aep_envelope::{admit, closed_names, EnvelopeAction, LatticeNode, Snapshot};
use aep_source_check::{workspace_path, CodeText, RustSource};

/// The wall function `name` must close (false) and never open (true) with `reason`.
fn closes_with(code: &CodeText, name: &str, reason: &str) -> Result<(), String> {
    if code.contains(&format!("true, \"{reason}\"")) {
        return Err(format!("{name} still opens when {reason}"));
    }
    if !code.contains(&format!("false, \"{reason}\"")) {
        return Err(format!("{name} does not close when {reason}"));
    }
    Ok(())
}

fn scan_wall_scene_missing(src: &RustSource) -> Result<(), String> {
    let code = src.function("wall_scene")?;
    closes_with(&code, "wall_scene", "no scene bound")?;
    if !code.contains("proven_scene_ids.is_empty()") {
        return Err(String::from(
            "wall_scene does not close empty proven scene set",
        ));
    }
    Ok(())
}

fn scan_wall_time_missing(src: &RustSource) -> Result<(), String> {
    closes_with(&src.function("wall_time")?, "wall_time", "no timestamps")
}

fn scan_wall_channel_missing(src: &RustSource) -> Result<(), String> {
    let code = src.function("wall_channel")?;
    closes_with(&code, "wall_channel", "no dock bound")?;
    if !code.contains("allowed_docks.is_empty()") {
        return Err(String::from(
            "wall_channel does not close empty allowed docks",
        ));
    }
    Ok(())
}

fn scan_wall_causal_missing(src: &RustSource) -> Result<(), String> {
    closes_with(
        &src.function("wall_causal")?,
        "wall_causal",
        "no sequence bound",
    )
}

fn scan_temporal_unbound(src: &RustSource) -> Result<(), String> {
    let code = src.function("compile_temporal_walls")?;
    if !code.contains("if !input.has_agent_time") && !code.contains("has_agent_time == false") {
        return Err(String::from(
            "compile_temporal_walls does not close when has_agent_time is false",
        ));
    }
    if !code.contains("true, \"no timestamps\"") {
        return Err(String::from(
            "compile_temporal_walls does not close unbound agent time",
        ));
    }
    Ok(())
}

/// The empty lattice Deny at live entry stays.
fn scan_live_entry_empty_lattice(src: &RustSource) -> Result<(), String> {
    let code = src.production();
    if !code.contains("lattice_nodes.is_empty()")
        || !code.contains("Lattice required but Action Lattice is not initialised")
    {
        return Err(String::from("the live entry empty lattice Deny is gone"));
    }
    Ok(())
}

/// An empty lattice closes dag.membership and gap.agent_permission.
fn scan_empty_lattice_walls(src: &RustSource) -> Result<(), String> {
    let dag = src.function("wall_dag")?;
    let may = src.function("wall_agent_permission")?;
    if dag.contains("true, \"no lattice configured\"") {
        return Err(String::from("wall_dag reopened on an empty lattice"));
    }
    if may.contains("true, \"no lattice configured\"") {
        return Err(String::from(
            "wall_agent_permission reopened on an empty lattice",
        ));
    }
    if !dag.contains("is_empty() { return wall(\"dag.membership\", \"dag\", false") {
        return Err(String::from("wall_dag empty close is gone"));
    }
    if !may.contains("is_empty() { return wall(\"gap.agent_permission\", \"gap\", false") {
        return Err(String::from("wall_agent_permission empty close is gone"));
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
fn the_wall_functions_close_unbound_fields() -> Result<(), String> {
    let envelope = read(&["AEP-Components", "envelope", "crate", "src", "lib.rs"])?;
    let seq = read(&["AEP-Components", "envelope", "crate", "src", "seq_walls.rs"])?;
    let dynaep = read(&["AEP-Components", "dynAEP", "crate", "src", "lib.rs"])?;
    let temporal = read(&[
        "AEP-Components",
        "admit-temporal-bounds",
        "crate",
        "src",
        "compile.rs",
    ])?;
    let live = read(&["AEP-Components", "live-entry", "crate", "src", "lib.rs"])?;
    scan_wall_scene_missing(&envelope)?;
    scan_wall_time_missing(&envelope)?;
    scan_wall_channel_missing(&envelope)?;
    scan_wall_causal_missing(&seq)?;
    scan_wall_time_missing(&dynaep)?;
    scan_temporal_unbound(&temporal)?;
    scan_live_entry_empty_lattice(&live)?;
    scan_empty_lattice_walls(&envelope)?;
    Ok(())
}

fn sample_action(action_path: &str) -> EnvelopeAction {
    EnvelopeAction {
        action_path: String::from(action_path),
        agent_id: String::from("agent-a"),
        payload: serde_json::json!({"ok": true}),
        tool: String::new(),
        dest_dock: String::from("inference_engine"),
        scene_id: String::from("scene-a"),
        agent_ts_ms: 1000,
        sequence_number: 1,
        anomaly_score: 0.0,
    }
}

fn bound_snap() -> Snapshot {
    let mut snap = Snapshot {
        bridge_ts_ms: 1000,
        ..Default::default()
    };
    snap.proven_scene_ids.insert(String::from("scene-a"));
    snap.allowed_docks.insert(String::from("inference_engine"));
    snap.lattice_nodes.insert(
        String::from("action:write"),
        LatticeNode {
            action_path: String::from("action:write"),
            parents: Vec::new(),
            agent_permission: vec![String::from("agent-a")],
            category: String::from("agent_action"),
            wrap: String::new(),
        },
    );
    snap
}

#[test]
fn a_bound_action_is_admitted() {
    assert!(admit(&sample_action("action:write"), &bound_snap()).allow);
}

/// A change that unbinds one field of an action with the wall that must close for it.
type Unbind = (fn(&mut EnvelopeAction), &'static str);

#[test]
fn missing_scene_time_sequence_and_dock_deny() {
    let snap = bound_snap();
    let cases: [Unbind; 4] = [
        (|a| a.scene_id.clear(), "scene.membership"),
        (|a| a.agent_ts_ms = 0, "time.authority"),
        (|a| a.sequence_number = 0, "causal.sequence"),
        (|a| a.dest_dock.clear(), "channel.dock"),
    ];
    for (unbind, wall) in cases {
        let mut a = sample_action("action:write");
        unbind(&mut a);
        let r = admit(&a, &snap);
        assert!(!r.allow, "{wall} unbound was allowed");
        assert!(closed_names(&r).contains(wall), "{wall} did not close");
    }
}

#[test]
fn a_wall_that_opens_on_a_missing_scene_fails() {
    let bad = parse("fn wall_scene(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict { if action.scene_id.is_empty() { return wall(\"scene.membership\", \"scene\", true, \"no scene bound\"); } wall(\"scene.membership\", \"scene\", true, \"scene proven\") }");
    match scan_wall_scene_missing(&bad) {
        Err(e) => assert!(e.contains("still opens when no scene bound")),
        Ok(()) => panic!("an open wall_scene passed"),
    }
}

#[test]
fn a_wall_that_closes_on_a_missing_scene_passes() {
    let good = parse("fn wall_scene(action: &EnvelopeAction, snap: &Snapshot) -> WallVerdict { if action.scene_id.is_empty() { return wall(\"scene.membership\", \"scene\", false, \"no scene bound\"); } if snap.proven_scene_ids.is_empty() { return wall(\"scene.membership\", \"scene\", false, \"empty proven scene set closes membership\"); } wall(\"scene.membership\", \"scene\", true, \"scene proven\") }");
    assert_eq!(scan_wall_scene_missing(&good), Ok(()));
}

#[test]
fn a_renamed_wall_function_fails() {
    let renamed = parse("fn wall_scene_v2(action: &EnvelopeAction) -> WallVerdict { wall(\"scene.membership\", \"scene\", false, \"no scene bound\") }");
    match scan_wall_scene_missing(&renamed) {
        Err(e) => assert!(e.contains("fn wall_scene not found")),
        Ok(()) => panic!("a missing wall_scene passed"),
    }
}
