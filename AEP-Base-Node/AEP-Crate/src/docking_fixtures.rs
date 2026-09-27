//! Shared test fixtures for the docking tests and the Data Dock tests.

use crate::docking::{process_request, pulse_beat, DockFrameResponse, DockingRuntime};
use crate::open_lattice_db;
use aep_base_node_pulse::PULSE_MS;
use aep_lattice_channel::{build_frame_for_dock, DockingPort, LatticeChannelFrame};
use std::path::Path;
use std::sync::Arc;

pub(crate) fn build_test_frame(
    runtime: &DockingRuntime,
    channel_id: &str,
    agent_id: &str,
    session_id: &str,
    port: DockingPort,
    contract_id: &str,
    payload: &[u8],
    _seq: u64,
) -> (LatticeChannelFrame, String) {
    let mut keys = runtime.keys.agent_sign_keys.lock().expect("keys lock");
    let sign = keys.provision(agent_id).expect("test key");
    let sign_hex = hex::encode(&sign.public);
    keys.flush().ok();
    drop(keys);
    let sent_at = crate::now_unix();
    let frame = build_frame_for_dock(
        channel_id,
        agent_id,
        session_id,
        port,
        contract_id,
        payload,
        runtime.dock_kem_public(),
        &sign,
        sent_at,
    )
    .unwrap();
    let line = serde_json::json!({
        "frame": frame,
        "signer_public_hex": sign_hex,
    })
    .to_string();
    (frame, line)
}

pub(crate) fn install_agent_manifest(rt: &DockingRuntime, agent_id: &str, session_id: &str) {
    use crate::task_manifest::{TaskManifestTrust, TaskManifestV1};
    let dir = {
        let m = rt.admit.manifests.lock().expect("manifests");
        m.manifest_dir().to_path_buf()
    };
    std::fs::create_dir_all(&dir).expect("manifest dir");
    let manifest = TaskManifestV1 {
        manifest_version: "1".into(),
        id: format!("m-{agent_id}"),
        agent_id: agent_id.into(),
        session_id: Some(session_id.into()),
        intent: serde_json::json!({"op": "dock-test"}),
        trust: TaskManifestTrust {
            tier: "system".into(),
        },
        agentmesh: None,
        provisional: false,
        synthesized_by: "provided".into(),
        promotion_required: vec![],
    };
    let path = dir.join(format!("{agent_id}.json"));
    std::fs::write(path, serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
    rt.admit.manifests.lock().expect("manifests").reload();
}

pub(crate) fn dock_lattice_yaml() -> &'static str {
    "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\", \"AG-DOCK\", \"AG-MESH\", \"AG-PULSE\", \"AG-COL\", \"AG-LRP\", \"AG-SEQ\", \"AG-SOCKC\", \"AG-DRIFT\", \"AG-BOUND\", \"dynaep-bridge\"]\n"
}
pub(crate) fn hub_gap_text() -> &'static str {
    "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: AG-DOCK\n      action: root:ping\n    - agent_id: AG-MESH\n      action: root:ping\n    - agent_id: AG-LRP\n      action: root:ping\n    - agent_id: AG-PULSE\n      action: root:ping\n    - agent_id: AG-COL\n      action: root:ping\n    - agent_id: AG-SEQ\n      action: root:ping\n    - agent_id: AG-SOCKC\n      action: root:ping\n    - agent_id: AG-DRIFT\n      action: root:ping\n    - agent_id: AG-BOUND\n      action: root:ping\n    - agent_id: AG-PING\n      action: root:ping\n    - agent_id: AG-NJ\n      action: root:ping\n    - agent_id: AG-BURST\n      action: root:ping\n    - agent_id: AG-FUT\n      action: root:ping\n    - agent_id: AG-SESSMIS\n      action: root:ping\n    - agent_id: AG-LRP-DENY\n      action: root:ping\n    - agent_id: AG-PING-R\n      action: root:ping\n    - agent_id: AG-TRUST\n      action: root:ping\n    - agent_id: AG-WIRE\n      action: root:ping\n    - agent_id: AG-REPLAY\n      action: root:ping\n    - agent_id: AG-SOCK\n      action: root:ping\n    - agent_id: AG-BADSIG\n      action: root:ping\n    - agent_id: AG-STALE\n      action: root:ping\n    - agent_id: AG-AGE\n      action: root:ping\n    - agent_id: AG-OVF\n      action: root:ping\n    - agent_id: AG-OVB\n      action: root:ping\n    - agent_id: AG-DUP\n      action: root:ping\n    - agent_id: AG-COLD\n      action: root:ping\n    - agent_id: AG-HELD\n      action: root:ping\n    - agent_id: AG-HELDD\n      action: root:ping\n    - agent_id: AG-POISON-KEYS\n      action: root:ping\n    - agent_id: AG-POISON-RATE\n      action: root:ping\n    - agent_id: AG-POISON-LIVE\n      action: root:ping\n    - agent_id: AG-POISON-MAN\n      action: root:ping\n    - agent_id: AG-POISON-RL\n      action: root:ping\n    - agent_id: AG-POISON-CON\n      action: root:ping\n    - agent_id: AG-POISON-REPLAY\n      action: root:ping\n    - agent_id: AG-POISON-TRUST\n      action: root:ping\n    - agent_id: AG-POISON-BUN\n      action: root:ping\n    - agent_id: AG-ENV034-MISS\n      action: root:ping\n    - agent_id: AG-ENV034-PING\n      action: root:ping\n    - agent_id: AG-ENV034-BAD\n      action: root:ping\n    - agent_id: agent-a\n      action: root:ping\n"
}
pub(crate) fn admit_ok_payload() -> &'static [u8] {
    br#"{"type":"PING","action_path":"root:ping","payload":{"ok":true},"timestamp":1000000,"target_id":"scene-a","_sequenceNumber":1}"#
}
pub(crate) fn admit_ok_payload_seq(seq: i64) -> Vec<u8> {
    format!("{{\"type\":\"PING\",\"action_path\":\"root:ping\",\"payload\":{{\"ok\":true}},\"timestamp\":1000000,\"target_id\":\"scene-a\",\"_sequenceNumber\":{seq}}}").into_bytes()
}
pub(crate) fn set_pulse_clock(rt: &DockingRuntime, ms: i64) {
    rt.record.pulse.lock().expect("pulse").clock_ms = Some(ms);
}
pub(crate) fn through_pulse(rt: &DockingRuntime, port: &DockingPort, line: &str) -> DockFrameResponse {
    set_pulse_clock(rt, 1_000_000);
    let enq = process_request(rt, port, line);
    let digest = match enq.digest.clone() {
        Some(d) => d,
        None => return enq,
    };
    if enq.pending == Some(true) {
        set_pulse_clock(rt, 1_000_000 + PULSE_MS);
        let _ = pulse_beat(rt);
        let collect = format!("{{\"collect\":\"{digest}\"}}");
        return process_request(rt, port, &collect);
    }
    enq
}
pub(crate) fn plant_lattice(dir: &std::path::Path) {
    std::fs::write(dir.join("lattice.yaml"), dock_lattice_yaml()).expect("lattice");
}
pub(crate) fn plant_hub_gap(dir: &std::path::Path) {
    std::fs::create_dir_all(dir.join("gap").join("policies").join("reference")).expect("hub dir");
    std::fs::write(dir.join("gap").join("policies").join("reference").join("caw-test.gap"), hub_gap_text()).expect("hub");
}
pub(crate) fn temp_runtime() -> (tempfile::TempDir, DockingRuntime) {
    let dir = tempfile::tempdir().expect("tempdir");
    plant_lattice(dir.path());
    runtime_in(dir)
}
pub(crate) fn runtime_in(dir: tempfile::TempDir) -> (tempfile::TempDir, DockingRuntime) {
    // Identity gate is always strict: tests install real manifests (TASK-A28-H01).
    let db_path = dir.path().join("dock.db");
    let conn = open_lattice_db(&db_path).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    plant_hub_gap(dir.path());
    let rt = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path()).expect("runtime");
    (dir, rt)
}

fn plant_data_dock_lattice(dir: &Path) {
    std::fs::write(
        dir.join("lattice.yaml"),
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n",
    )
    .expect("lattice");
}

pub(crate) fn data_dock_runtime() -> (tempfile::TempDir, Arc<DockingRuntime>) {
    let dir = tempfile::tempdir().expect("tempdir");
    plant_data_dock_lattice(dir.path());
    let gap = dir.path().join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&gap).expect("gap");
    std::fs::write(
        gap.join("data-dock.gap"),
        "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: data-dock\n      action: root:ping\n    - agent_id: AG-BOOT\n      action: root:ping\n",
    )
    .expect("hub");
    let sockets = dir.path().join("sockets");
    std::fs::create_dir_all(&sockets).expect("sockets");
    let db = dir.path().join("aep-action-lattice.db");
    let conn = open_lattice_db(&db).expect("open");
    let runtime = DockingRuntime::with_data_dir(
        sockets.to_string_lossy().into_owned(),
        conn,
        &[],
        dir.path(),
    )
    .expect("runtime");
    (dir, Arc::new(runtime))
}
