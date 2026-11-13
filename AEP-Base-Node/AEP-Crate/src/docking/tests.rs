use super::rate::SIGNER_RATE_LIMIT;
use super::serve::{
    bind_listener, drain_docking_servers, note_tls_handshake_err, prepare_socket_dir,
    run_docking_servers, serve_connection, sockets_exist,
};
use super::*;
use crate::docking_fixtures::*;
use crate::{docking_port_specs, open_lattice_db};
use aep_base_node_pulse::{
    freeze_temporal_snapshot, EnqueueDeny, QueuedCapsule, MAX_AGE_MS, MAX_DRIFT_MS, PULSE_MS,
    QUEUE_CAP_BYTES, QUEUE_CAP_CAPSULES, QUEUE_SIGNER_SHARE_BYTES, QUEUE_SIGNER_SHARE_CAPSULES,
};
use aep_lattice_channel::build_frame_for_dock;
use aep_wall_set_backpressure::CLASS_CAPABILITY;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::UnixStream;

#[test]
fn dock_verdict_reads_answers_like_a_caller() {
    let (_dir, rt) = temp_runtime();
    let refused = process_request(&rt, &DockingPort::ValidationEngine, r#"{"ping":true}"#);
    assert_eq!(refused.verdict(), DockVerdict::Refused);
    let line = serde_json::to_string(&refused).unwrap();
    assert_eq!(
        DockFrameResponse::verdict_of_line(&line),
        DockVerdict::Refused
    );
    assert_eq!(
        pending_held_response(String::from("ab12")).verdict(),
        DockVerdict::Pending
    );
    assert_eq!(
        DockFrameResponse::verdict_of_line(r#"{"ok":true,"event_id":4}"#),
        DockVerdict::Admitted
    );
    assert_eq!(
        DockFrameResponse::verdict_of_line(r#"{"ok":true}"#),
        DockVerdict::Refused
    );
    assert_eq!(
        DockFrameResponse::verdict_of_line(r#"{"ok":false,"pending":true}"#),
        DockVerdict::Refused
    );
    assert_eq!(
        DockFrameResponse::verdict_of_line("{}"),
        DockVerdict::Malformed
    );
    assert_eq!(
        DockFrameResponse::verdict_of_line("OK"),
        DockVerdict::Malformed
    );
}

#[test]
fn plain_ping_is_rejected() {
    let (_dir, rt) = temp_runtime();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, r#"{"ping":true}"#);
    assert!(!resp.ok);
    assert!(resp.error.unwrap().contains("LatticeChannelFrame"));
}

#[test]
fn opened_non_json_is_admit_deny() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-NJ", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-nj",
        "AG-NJ",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"not-json",
        1,
    );
    let resp = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    assert!(resp
        .error
        .unwrap()
        .contains("Admit collect-all walls then Apply"));
}

#[test]
fn opened_ping_without_action_path_is_admit_deny() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-PING", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-ping",
        "AG-PING",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        br#"{"type":"PING"}"#,
        1,
    );
    let resp = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    assert!(resp
        .error
        .unwrap()
        .contains("Admit collect-all walls then Apply"));
}

#[test]
fn opened_ping_without_action_path_returns_deny_report() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-PING-R", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-ping-r",
        "AG-PING-R",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        br#"{"type":"PING"}"#,
        1,
    );
    let resp = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    let deny = resp.deny.expect("deny report");
    assert!(deny.closed.iter().any(|w| w.id == "action.path"));
    assert!(deny.reseal_required);
    assert!(deny.repairs.iter().any(|h| h.kind == "reseal_new_capsule"));
    assert!(deny.repairs.iter().any(|h| h.field == "action_path"));
}

#[test]
fn frame_records_on_validation_port() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-DOCK", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-dock-test",
        "AG-DOCK",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let resp = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(resp.ok, "{:?}", resp.error);
    assert!(resp.digest.is_some());
    assert!(resp.event_id.is_some());
}

#[test]
fn frame_attaches_agentmesh_bundle() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-MESH", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-dock-test",
        "AG-MESH",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let resp = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(resp.ok, "{:?}", resp.error);

    let db = rt.record.db.lock().expect("db lock");
    let exported = crate::export_dynaep_events(&db, Some(1)).expect("export");
    assert_eq!(exported.len(), 1);
    assert_eq!(exported[0].agentmesh["agent_id"], "AG-MESH");
    assert!(exported[0].agentmesh["spiffe"]["spiffe_id"]
        .as_str()
        .is_some());
}

#[test]
fn rate_limit_records_side_channel_anomaly() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-BURST", "sess-1");
    let sign = rt
        .keys
        .agent_sign_keys
        .lock()
        .expect("keys")
        .provision("AG-BURST")
        .expect("burst key");
    let rate_key = signer_rate_key(&sign.public);
    {
        let mut limiter = rt.defence.rate_limiter.lock().expect("lock");
        for _ in 0..SIGNER_RATE_LIMIT {
            limiter.check(&rate_key).unwrap();
        }
    }

    let (_frame, line) = build_test_frame(
        &rt,
        "ch-dock-test",
        "AG-BURST",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"x",
        1,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);

    let db = rt.record.db.lock().expect("db lock");
    let exported = crate::export_dynaep_events(&db, Some(10)).expect("export");
    assert!(exported
        .iter()
        .any(|e| e.event_type == crate::SIDE_CHANNEL_EVENT_TYPE));
}

#[test]
fn regulation_frame_registers_contract_for_validation_frames() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("dock.db");
    let conn = open_lattice_db(&db_path).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    plant_lattice(dir.path());
    plant_hub_gap(dir.path());
    let rt =
        DockingRuntime::with_data_dir(sock_base, conn, &["runtime-lrp".to_string()], dir.path())
            .expect("runtime");
    // Manifest binds sess-reg; both regulation and validation frames use it.
    install_agent_manifest(&rt, "AG-LRP", "sess-reg");
    let (_reg_frame, reg_line) = build_test_frame(
            &rt,
            "ch-lrp",
            "AG-LRP",
            "sess-reg",
            DockingPort::RegulationModule,
            "runtime-lrp",
            br#"{"action":"register_lrp","type":"PING","action_path":"root:ping","payload":{"ok":true},"timestamp":1000000,"target_id":"scene-a","_sequenceNumber":1}"#,
            1,
        );
    let reg = through_pulse(&rt, &DockingPort::RegulationModule, &reg_line);
    assert!(reg.ok, "{:?}", reg.error);
    assert!(reg.event_id.is_some());

    let (_val_frame, line) = build_test_frame(
            &rt,
            "ch-lrp",
            "AG-LRP",
            "sess-reg",
            DockingPort::ValidationEngine,
            "runtime-lrp",
            br#"{"event_type":"LRP_BOUND","type":"PING","action_path":"root:ping","payload":{"ok":true},"timestamp":1000000,"target_id":"scene-a","_sequenceNumber":2}"#,
            2,
        );
    let resp = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(resp.ok, "{:?}", resp.error);
    assert!(resp.event_id.is_some());
}

#[test]
fn plain_register_lrp_is_rejected() {
    let (_dir, rt) = temp_runtime();
    let line = r#"{"register_lrp":{"lrp_id":"custom-lrp","contract_id":"custom-lrp"}}"#;
    let resp = process_request(&rt, &DockingPort::RegulationModule, line);
    assert!(!resp.ok);
    assert!(resp.error.unwrap().contains("LatticeChannelFrame"));
}

#[test]
fn frame_trust_score_does_not_rotate_agentmesh_certs() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-TRUST", "sess-1");
    // BM-07: trust must be inside signed plaintext, not free outer wire field
    let (_frame, line_high) = build_test_frame(
            &rt,
            "ch-trust",
            "AG-TRUST",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            br#"{"trust_score":850,"note":"high","type":"PING","action_path":"root:ping","payload":{"ok":true}}"#,
            1,
        );
    let resp1 = process_request(&rt, &DockingPort::ValidationEngine, &line_high);
    assert!(!resp1.ok);
    assert_eq!(resp1.pending, Some(true));
    let fp1 = rt
        .keys
        .agent_bundles
        .lock()
        .expect("lock")
        .get("AG-TRUST")
        .expect("bundle")
        .mtls
        .cert_fingerprint
        .clone();

    let (_frame2, line_low) = build_test_frame(
            &rt,
            "ch-trust",
            "AG-TRUST",
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            br#"{"trust_score":450,"note":"low","type":"PING","action_path":"root:ping","payload":{"ok":true}}"#,
            2,
        );
    let resp2 = process_request(&rt, &DockingPort::ValidationEngine, &line_low);
    assert!(!resp2.ok);
    assert_eq!(resp2.pending, Some(true));
    let fp2 = rt
        .keys
        .agent_bundles
        .lock()
        .expect("lock")
        .get("AG-TRUST")
        .expect("bundle")
        .mtls
        .cert_fingerprint
        .clone();
    assert_eq!(fp1, fp2);
    let score = rt
        .keys
        .agent_bundles
        .lock()
        .expect("lock")
        .get("AG-TRUST")
        .expect("bundle")
        .trust_score;
    assert_eq!(score, 450);
}

#[test]
fn bm07_wire_trust_score_ignored_without_signed_field() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-WIRE", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-wire",
        "AG-WIRE",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        br#"{"type":"PING","action_path":"root:ping","payload":{"ok":true}}"#,
        1,
    );
    let mut wire = serde_json::from_str::<serde_json::Value>(&line).unwrap();
    wire["trust_score"] = serde_json::json!(999);
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &wire.to_string());
    assert!(!resp.ok);
    assert_eq!(resp.pending, Some(true));
    let score = *rt
        .keys
        .agent_trust
        .lock()
        .expect("lock")
        .get("AG-WIRE")
        .expect("trust");
    // default 0 when no signed trust_score (wire 999 ignored; fail-closed trust)
    assert_eq!(score, 0);
}

#[test]
fn rejects_port_mismatch() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-DOCK", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-dock-test",
        "AG-DOCK",
        "sess-1",
        DockingPort::InferenceEngine,
        "dynaep-action-lattice",
        b"x",
        1,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
}

#[test]
fn rejects_replayed_frame_digest() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-REPLAY", "sess-1");
    // The fixture event is stamped 1000000, so the kernel clock is set to that instant.
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-replay",
        "AG-REPLAY",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let resp1 = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp1.ok);
    assert_eq!(resp1.pending, Some(true));
    let resp2 = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp2.ok);
    assert!(resp2.error.clone().unwrap().contains("replay"));
    let deny = resp2.deny.expect("deny report");
    assert!(deny
        .closed
        .iter()
        .any(|w| w.class == "frame.replay" && w.id == "digest.replay"));
}

#[tokio::test]
async fn socket_roundtrip() {
    let (dir, runtime) = temp_runtime();
    install_agent_manifest(&runtime, "AG-SOCK", "sess-sock");
    // The fixture event is stamped 1000000, so the kernel clock is set to that instant.
    set_pulse_clock(&runtime, 1_000_000);
    let sock_base = runtime.io.socket_base.clone();
    let shared = Arc::new(runtime);
    let spec = docking_port_specs(&sock_base)
        .into_iter()
        .find(|s| s.port == DockingPort::ValidationEngine)
        .unwrap();
    prepare_socket_dir(&sock_base).unwrap();
    let listener = bind_listener(&spec.listen_path).unwrap();
    let rt = shared.clone();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (reader, writer) = stream.into_split();
        serve_connection(rt, DockingPort::ValidationEngine, reader, writer)
            .await
            .unwrap();
    });

    let mut stream = UnixStream::connect(&spec.listen_path).await.unwrap();
    let (_frame, wire) = build_test_frame(
        &shared,
        "ch-sock",
        "AG-SOCK",
        "sess-sock",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    stream
        .write_all(format!("{wire}\n").as_bytes())
        .await
        .unwrap();
    let mut buf = String::new();
    BufReader::new(&mut stream)
        .read_line(&mut buf)
        .await
        .unwrap();
    let resp: DockFrameResponse = serde_json::from_str(buf.trim()).unwrap();
    assert!(!resp.ok);
    assert_eq!(resp.pending, Some(true));
    assert!(resp.digest.is_some());
    let _ = dir;
}

#[tokio::test]
async fn socket_collect_returns_event_id_after_beat() {
    let (dir, runtime) = temp_runtime();
    install_agent_manifest(&runtime, "AG-SOCKC", "sess-sockc");
    set_pulse_clock(&runtime, 1_000_000);
    let sock_base = runtime.io.socket_base.clone();
    let shared = Arc::new(runtime);
    let spec = docking_port_specs(&sock_base)
        .into_iter()
        .find(|s| s.port == DockingPort::ValidationEngine)
        .unwrap();
    prepare_socket_dir(&sock_base).unwrap();
    let listener = bind_listener(&spec.listen_path).unwrap();
    let rt = shared.clone();
    tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let (reader, writer) = stream.into_split();
        serve_connection(rt, DockingPort::ValidationEngine, reader, writer)
            .await
            .unwrap();
    });

    let mut stream = UnixStream::connect(&spec.listen_path).await.unwrap();
    let (_frame, wire) = build_test_frame(
        &shared,
        "ch-sockc",
        "AG-SOCKC",
        "sess-sockc",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    stream
        .write_all(format!("{wire}\n").as_bytes())
        .await
        .unwrap();
    let mut buf = String::new();
    {
        let mut reader = BufReader::new(&mut stream);
        reader.read_line(&mut buf).await.unwrap();
    }
    let enq: DockFrameResponse = serde_json::from_str(buf.trim()).unwrap();
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    assert!(enq.event_id.is_none());
    let digest = enq.digest.clone().unwrap();
    set_pulse_clock(&shared, 1_000_000 + PULSE_MS);
    let collect = format!("{{\"collect\":\"{digest}\"}}\n");
    stream.write_all(collect.as_bytes()).await.unwrap();
    buf.clear();
    {
        let mut reader = BufReader::new(&mut stream);
        reader.read_line(&mut buf).await.unwrap();
    }
    let applied: DockFrameResponse = serde_json::from_str(buf.trim()).unwrap();
    assert!(applied.ok, "{:?}", applied.error);
    assert!(applied.event_id.is_some());
    assert_eq!(applied.digest.as_deref(), Some(digest.as_str()));
    let _ = dir;
}

// --- P0-A28 H02-H06 adversarial docking battery ---

// Test fixture: each argument is one field of the frame under test.
#[allow(clippy::too_many_arguments)]
fn build_test_frame_at(
    runtime: &DockingRuntime,
    channel_id: &str,
    agent_id: &str,
    session_id: &str,
    port: DockingPort,
    contract_id: &str,
    payload: &[u8],
    sent_at: u64,
) -> (LatticeChannelFrame, String) {
    let mut keys = runtime.keys.agent_sign_keys.lock().expect("keys lock");
    let sign = keys.provision(agent_id).expect("test key");
    let sign_hex = hex::encode(&sign.public);
    keys.flush().ok();
    drop(keys);
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

#[test]
fn rejects_tampered_signature() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-BADSIG", "sess-1");
    let (mut frame, line) = build_test_frame(
        &rt,
        "ch-badsig",
        "AG-BADSIG",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"payload",
        1,
    );
    // Flip a signature byte inside the PQ capsule (TASK-A28-H02).
    if let Some(sig) = frame.capsule.signature.as_mut() {
        assert!(!sig.is_empty(), "expected non-empty ML-DSA signature");
        sig[0] ^= 0xff;
    } else {
        panic!("frame capsule missing signature");
    }
    let wire = serde_json::from_str::<serde_json::Value>(&line).unwrap();
    let sign_hex = wire["signer_public_hex"].as_str().unwrap().to_string();
    let tampered = serde_json::json!({
        "frame": frame,
        "signer_public_hex": sign_hex,
    })
    .to_string();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &tampered);
    assert!(!resp.ok, "tampered frame must fail: {:?}", resp);
    let err = resp.error.unwrap_or_default().to_lowercase();
    assert!(
        err.contains("signature")
            || err.contains("verify")
            || err.contains("invalid")
            || err.contains("crypto")
            || err.contains("open")
            || err.contains("failed"),
        "unexpected error: {err}"
    );
}

#[test]
fn rejects_unbound_wire_signer_public_key() {
    // CRITICAL: client-supplied signer_public_hex must not impersonate without registration.
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-BOUND", "sess-1");
    // The fixture event is stamped 1000000, so the kernel clock is set to that instant.
    set_pulse_clock(&rt, 1_000_000);
    let (frame, line) = build_test_frame(
        &rt,
        "ch-bound",
        "AG-BOUND",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    // Impersonation: keep frame for AG-BOUND but present a different wire public key.
    let fake_hex = "11".repeat(32);
    let spoofed = serde_json::json!({
        "frame": frame,
        "signer_public_hex": fake_hex,
    })
    .to_string();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &spoofed);
    assert!(
        !resp.ok,
        "unbound/mismatched wire key must fail: {:?}",
        resp
    );
    let err = resp.error.unwrap_or_default().to_lowercase();
    assert!(
        err.contains("signer public key unknown")
            || err.contains("unknown")
            || err.contains("signer"),
        "expected signer bind failure, got: {err}"
    );
    // Sanity: legitimate bound wire key still works.
    let ok_resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!ok_resp.ok);
    assert_eq!(ok_resp.pending, Some(true));
}

#[test]
fn rejects_stale_frame() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-STALE", "sess-1");
    let now = crate::now_unix();
    let stale_at = now.saturating_sub(MAX_FRAME_AGE_SECS + 30);
    let (_frame, line) = build_test_frame_at(
        &rt,
        "ch-stale",
        "AG-STALE",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"old",
        stale_at,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok, "{:?}", resp.error);
    assert!(
        resp.error.clone().unwrap_or_default().contains("stale"),
        "expected stale error"
    );
    let deny = resp.deny.expect("deny report");
    assert!(deny.closed.iter().any(|w| w.class == "temporal"));
}

#[test]
fn rejects_future_skew_frame() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-FUT", "sess-1");
    let now = crate::now_unix();
    let future_at = now.saturating_add(MAX_FRAME_FUTURE_SKEW_SECS + 120);
    let (_frame, line) = build_test_frame_at(
        &rt,
        "ch-fut",
        "AG-FUT",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"future",
        future_at,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok, "{:?}", resp.error);
    let err = resp.error.unwrap_or_default();
    assert!(
        err.contains("skew") || err.contains("future"),
        "expected skew error: {err}"
    );
    let deny = resp.deny.expect("deny report");
    assert!(deny.closed.iter().any(|w| w.class == "temporal"));
}

#[test]
fn rejects_non_allowlisted_lrp_contract() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("dock.db");
    let conn = open_lattice_db(&db_path).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    // Only "allowed-lrp" is in config; register_lrp uses "evil-lrp" (TASK-A28-H04).
    plant_lattice(dir.path());
    plant_hub_gap(dir.path());
    let rt =
        DockingRuntime::with_data_dir(sock_base, conn, &["allowed-lrp".to_string()], dir.path())
            .expect("runtime");
    install_agent_manifest(&rt, "AG-LRP-DENY", "sess-1");
    let (_frame, line) = build_test_frame(
            &rt,
            "ch-lrp-deny",
            "AG-LRP-DENY",
            "sess-1",
            DockingPort::RegulationModule,
            "evil-lrp",
            br#"{"action":"register_lrp","type":"PING","action_path":"root:ping","payload":{"ok":true}}"#,
            1,
        );
    let resp = process_request(&rt, &DockingPort::RegulationModule, &line);
    assert!(!resp.ok, "{:?}", resp.error);
    let err = resp.error.unwrap_or_default();
    assert!(
        err.contains("not allowlisted") || err.contains("inactive"),
        "expected LRP allowlist deny: {err}"
    );
}

#[test]
fn rejects_session_registration_mismatch_on_dock() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-SESSMIS", "sess-bound");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-sess",
        "AG-SESSMIS",
        "sess-wrong",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok, "{:?}", resp.error);
    assert!(
        resp.error
            .unwrap_or_default()
            .contains("session registration"),
        "expected session registration error"
    );
}

#[test]
fn missing_lattice_opened_state_delta_is_admit_deny() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("dock.db");
    let conn = open_lattice_db(&db_path).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    plant_hub_gap(dir.path());
    let loaded = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path());
    assert!(loaded.is_err());
}

#[test]
fn missing_lattice_opened_ping_is_admit_deny() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("dock.db");
    let conn = open_lattice_db(&db_path).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    plant_hub_gap(dir.path());
    let loaded = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path());
    assert!(loaded.is_err());
}

#[test]
fn unreadable_lattice_opened_frame_is_admit_deny() {
    let dir = tempfile::tempdir().expect("tempdir");
    let db_path = dir.path().join("dock.db");
    let conn = open_lattice_db(&db_path).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    plant_hub_gap(dir.path());
    std::fs::write(dir.path().join("lattice.yaml"), "{{ not a lattice").expect("bad yaml");
    let loaded = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path());
    assert!(loaded.is_err());
}

fn poison_std_mutex<T>(m: &std::sync::Mutex<T>) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _g = m.lock().expect("poison setup");
        panic!("poison dock mutex");
    }));
}

fn poisoned_ok_false_on_frame(
    rt: &DockingRuntime,
    agent_id: &str,
    mutex_name: &str,
    poison: impl FnOnce(&DockingRuntime),
) {
    install_agent_manifest(rt, agent_id, "sess-1");
    let (_frame, line) = build_test_frame(
        rt,
        "ch-dock-test",
        agent_id,
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    poison(rt);
    let resp = process_request(rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    let err = resp.error.unwrap_or_default();
    assert!(
        err.contains("poisoned lock"),
        "expected poisoned lock error on {mutex_name}, got {err}"
    );
    assert!(
        err.contains(mutex_name),
        "expected lock name {mutex_name} in error, got {err}"
    );
    let deny = resp.deny.expect("deny report");
    assert!(deny.closed.iter().any(|w| w.class == "poison"));
}

#[test]
fn poisoned_db_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let _g = rt.record.db.lock().expect("db");
        panic!("poison dock db");
    }));
    let resp = process_request(&rt, &DockingPort::ValidationEngine, r#"{"ping":true}"#);
    assert!(!resp.ok);
    let err = resp.error.unwrap_or_default();
    assert!(
        err.contains("poisoned lock"),
        "expected poisoned lock error, got {err}"
    );
    let deny = resp.deny.expect("deny report");
    assert!(deny.closed.iter().any(|w| w.class == "poison"));
}

#[test]
fn poisoned_sign_keys_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-KEYS", "agent_sign_keys", |rt| {
        poison_std_mutex(&rt.keys.agent_sign_keys);
    });
}

#[test]
fn poisoned_fleet_rate_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-RATE", "fleet_rate", |rt| {
        poison_std_mutex(&rt.defence.global_rate_limiter);
    });
}

#[test]
fn poisoned_live_entry_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-LIVE", "live_entry", |rt| {
        poison_std_mutex(&rt.admit.live_entry);
    });
}

#[test]
fn poisoned_manifests_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-MAN", "manifests", |rt| {
        poison_std_mutex(&rt.admit.manifests);
    });
}

#[test]
fn poisoned_rate_limiter_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-RL", "rate_limiter", |rt| {
        poison_std_mutex(&rt.defence.rate_limiter);
    });
}

#[test]
fn poisoned_contracts_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-CON", "contracts", |rt| {
        poison_std_mutex(&rt.admit.contracts);
    });
}

#[test]
fn poisoned_replay_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-REPLAY", "replay", |rt| {
        poison_std_mutex(&rt.defence.replay_guard);
    });
}

#[test]
fn poisoned_agent_trust_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-TRUST", "agent_trust", |rt| {
        poison_std_mutex(&rt.keys.agent_trust);
    });
}

#[test]
fn poisoned_agent_bundles_lock_returns_ok_false_without_abort() {
    let (_dir, rt) = temp_runtime();
    poisoned_ok_false_on_frame(&rt, "AG-POISON-BUN", "agent_bundles", |rt| {
        poison_std_mutex(&rt.keys.agent_bundles);
    });
}

#[test]
fn pulse_enqueue_has_no_event_id_until_beat() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-PULSE", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-pulse",
        "AG-PULSE",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    assert!(enq.digest.is_some());
    assert!(enq.event_id.is_none());
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let _ = pulse_beat(&rt);
    let digest = enq.digest.clone().unwrap();
    let applied = rt
        .record
        .pulse
        .lock()
        .expect("pulse")
        .last_applied
        .get(&digest)
        .cloned()
        .expect("applied");
    assert!(applied.ok, "{:?}", applied.error);
    assert!(applied.event_id.is_some());
    must_drift_not_pulse();
}

#[test]
fn pulse_collect_by_digest_returns_event_id_after_beat() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-COL", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-col",
        "AG-COL",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    assert!(enq.event_id.is_none());
    let digest = enq.digest.clone().unwrap();
    let pending = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert!(!pending.ok);
    assert_eq!(pending.pending, Some(true));
    assert!(pending.event_id.is_none());
    assert!(pending.deny.is_none());
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let _ = pulse_beat(&rt);
    let applied = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert!(applied.ok, "{:?}", applied.error);
    assert!(applied.event_id.is_some());
    assert_eq!(applied.digest.as_deref(), Some(digest.as_str()));
}

#[test]
fn pulse_collect_by_digest_returns_deny_closed_on_admit_deny() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-COLD", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-cold",
        "AG-COLD",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        br#"{"type":"PING"}"#,
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    assert!(enq.event_id.is_none());
    let digest = enq.digest.clone().unwrap();
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let _ = pulse_beat(&rt);
    let applied = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert!(!applied.ok);
    let deny = applied.deny.expect("deny report");
    assert!(!deny.closed.is_empty());
    assert!(applied.event_id.is_none());
}

#[test]
fn pulse_collect_unknown_digest_is_deny() {
    let (_dir, rt) = temp_runtime();
    let applied = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        r#"{"collect":"missing-digest"}"#,
    );
    assert!(!applied.ok);
    assert!(applied.error.unwrap_or_default().contains("unknown digest"));
    assert!(applied.deny.is_some());
}
#[test]
fn collect_held_is_pending_until_last_applied_allow() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-HELD", "sess-held");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-held",
        "AG-HELD",
        "sess-held",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    assert!(enq.event_id.is_none());
    let digest = enq.digest.clone().unwrap();
    let held = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert!(!held.ok);
    assert_eq!(held.pending, Some(true));
    assert!(held.event_id.is_none());
    assert!(held.deny.is_none());
    assert_eq!(held.digest.as_deref(), Some(digest.as_str()));
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let _ = pulse_beat(&rt);
    let applied = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert_eq!(applied.pending, None);
    assert_eq!(applied.digest.as_deref(), Some(digest.as_str()));
    if applied.ok {
        assert!(applied.event_id.is_some());
    } else {
        let deny = applied.deny.expect("deny report");
        assert!(!deny.closed.is_empty());
        assert!(applied.event_id.is_none());
    }
}

#[test]
fn collect_held_then_deny_names_walls() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-HELDD", "sess-heldd");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-heldd",
        "AG-HELDD",
        "sess-heldd",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        br#"{"type":"PING"}"#,
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    let digest = enq.digest.clone().unwrap();
    let held = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert!(!held.ok);
    assert_eq!(held.pending, Some(true));
    assert!(held.event_id.is_none());
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let _ = pulse_beat(&rt);
    let applied = process_request(
        &rt,
        &DockingPort::ValidationEngine,
        &format!("{{\"collect\":\"{digest}\"}}"),
    );
    assert!(!applied.ok);
    let deny = applied.deny.expect("deny report");
    assert!(!deny.closed.is_empty());
    assert!(applied.event_id.is_none());
    assert_eq!(applied.pending, None);
}

fn collect_line(digest: &str) -> String {
    format!("{{\"collect\":\"{digest}\"}}")
}

fn answer_is_pending(resp: &DockFrameResponse) -> bool {
    resp.pending == Some(true) && resp.event_id.is_none()
}

fn plant_race_agents(dir: &std::path::Path, agents: &[String]) {
    let mut text = String::from("metadata:\n  wrap: caw\n  agent_permission:\n");
    for agent in agents {
        text.push_str(&format!(
            "    - agent_id: {agent}\n      action: root:ping\n"
        ));
    }
    let reference = dir.join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&reference).expect("hub dir");
    std::fs::write(reference.join("caw-race.gap"), text).expect("race hub");
}

#[test]
fn collect_while_admit_runs_reads_pending_never_unknown_digest() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-HELD", "sess-held");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-admit-gap",
        "AG-HELD",
        "sess-held",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert_eq!(enq.pending, Some(true));
    let digest = enq.digest.clone().unwrap();
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    // Holding the live entry parks the apply step inside Admit, which is the
    // gap where another client used to find the digest nowhere.
    let parked = rt.admit.live_entry.lock().expect("live entry");
    let mid_answers = std::thread::scope(|scope| {
        let beat = scope.spawn(|| pulse_beat(&rt));
        let limit = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while !rt.record.pulse.lock().expect("pulse").queue.is_empty() {
            assert!(
                std::time::Instant::now() < limit,
                "the beat never released the capsule"
            );
            std::thread::yield_now();
        }
        std::thread::sleep(std::time::Duration::from_millis(200));
        let mut seen = Vec::new();
        for _ in 0..20 {
            seen.push(process_request(
                &rt,
                &DockingPort::ValidationEngine,
                &collect_line(&digest),
            ));
        }
        drop(parked);
        beat.join().expect("beat");
        seen
    });
    for mid in &mid_answers {
        assert_eq!(
            mid.error, None,
            "collect in the Admit gap answered {:?}",
            mid.error
        );
        assert!(mid.deny.is_none());
        assert!(answer_is_pending(mid));
        assert_eq!(mid.digest.as_deref(), Some(digest.as_str()));
    }
    let applied = process_request(&rt, &DockingPort::ValidationEngine, &collect_line(&digest));
    assert!(applied.ok, "{:?}", applied.error);
    assert!(applied.event_id.is_some());
    assert_eq!(applied.digest.as_deref(), Some(digest.as_str()));
    assert!(rt.record.pulse.lock().expect("pulse").held.is_empty());
}

#[test]
fn held_guard_answers_a_frame_whose_apply_ended_early() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-HELD", "sess-held");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-guard",
        "AG-HELD",
        "sess-held",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    let digest = enq.digest.clone().unwrap();
    {
        let _guard = super::apply::HeldGuard::new(&rt, &digest);
    }
    let answer = process_request(&rt, &DockingPort::ValidationEngine, &collect_line(&digest));
    assert!(!answer.ok);
    assert_eq!(answer.pending, None);
    let deny = answer.deny.expect("deny report");
    assert!(deny.closed.iter().any(|w| w.id == "apply.interrupted"));
    assert!(rt.record.pulse.lock().expect("pulse").held.is_empty());
}

#[test]
fn many_parallel_writers_each_collect_their_admit_answer() {
    const WRITERS: usize = 16;
    const ROUNDS: usize = 8;
    let agents: Vec<String> = (0..WRITERS).map(|i| format!("AG-RACE-{i}")).collect();
    let dir = tempfile::tempdir().expect("tempdir");
    plant_lattice(dir.path());
    plant_race_agents(dir.path(), &agents);
    let (_dir, rt) = runtime_in(dir);
    for (i, agent) in agents.iter().enumerate() {
        install_agent_manifest(&rt, agent, &format!("sess-race-{i}"));
    }
    let port = DockingPort::ValidationEngine;
    for round in 0..ROUNDS {
        set_pulse_clock(&rt, 1_000_000);
        let lines: Vec<String> = agents
            .iter()
            .enumerate()
            .map(|(i, agent)| {
                let payload = admit_ok_payload_seq(round as i64 + 1);
                build_test_frame(
                    &rt,
                    &format!("ch-race-{i}"),
                    agent,
                    &format!("sess-race-{i}"),
                    DockingPort::ValidationEngine,
                    "dynaep-action-lattice",
                    &payload,
                    round as u64 + 1,
                )
                .1
            })
            .collect();
        let start = std::sync::Barrier::new(WRITERS);
        let digests: Vec<String> = std::thread::scope(|scope| {
            let handles: Vec<_> = lines
                .iter()
                .map(|line| {
                    let (rt, start, port) = (&rt, &start, &port);
                    scope.spawn(move || {
                        start.wait();
                        let enq = process_request(rt, port, line);
                        assert_eq!(enq.pending, Some(true), "{:?}", enq.error);
                        enq.digest.expect("digest")
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("writer"))
                .collect()
        });
        set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
        let start = std::sync::Barrier::new(WRITERS);
        let answers: Vec<DockFrameResponse> = std::thread::scope(|scope| {
            let handles: Vec<_> = digests
                .iter()
                .map(|digest| {
                    let (rt, start, port) = (&rt, &start, &port);
                    scope.spawn(move || {
                        start.wait();
                        let request = collect_line(digest);
                        let limit = std::time::Instant::now() + std::time::Duration::from_secs(60);
                        loop {
                            let resp = process_request(rt, port, &request);
                            if !answer_is_pending(&resp) {
                                return resp;
                            }
                            assert!(
                                std::time::Instant::now() < limit,
                                "collect was still pending"
                            );
                            std::thread::yield_now();
                        }
                    })
                })
                .collect();
            handles
                .into_iter()
                .map(|h| h.join().expect("collector"))
                .collect()
        });
        for (digest, answer) in digests.iter().zip(answers.iter()) {
            let error = answer.error.clone().unwrap_or_default();
            assert!(!error.contains("unknown digest"), "round {round}: {error}");
            assert!(answer.ok, "round {round}: {error}");
            assert!(answer.event_id.is_some());
            assert_eq!(answer.digest.as_deref(), Some(digest.as_str()));
        }
        super::pulse::pulse_decay_rate(&rt);
    }
    assert!(rt.record.pulse.lock().expect("pulse").held.is_empty());
}

fn must_drift_not_pulse() {
    assert_ne!(MAX_DRIFT_MS, PULSE_MS);
    assert_eq!(MAX_DRIFT_MS, 50);
    assert_eq!(PULSE_MS, 1000);
    assert_eq!(MAX_AGE_MS, 5000);
    let src = include_str!("mod.rs");
    let compact: String = src.chars().filter(|c| !c.is_whitespace()).collect();
    let n1 = ["max_drift_ms=", "1000"].concat();
    let n2 = ["max_drift_ms:", "1000"].concat();
    assert!(!compact.contains(&n1));
    assert!(!compact.contains(&n2));
}

#[test]
fn pulse_hold_meets_drift_against_freeze() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-DRIFT", "sess-1");
    let body = br#"{"type":"PING","action_path":"root:ping","payload":{"ok":true},"timestamp":1000040,"target_id":"scene-a","_sequenceNumber":1}"#;
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-drift",
        "AG-DRIFT",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        body,
        1,
    );
    set_pulse_clock(&rt, 1_000_000);
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    set_pulse_clock(&rt, 1_001_000);
    let _ = pulse_beat(&rt);
    let digest = enq.digest.clone().unwrap();
    let applied = rt
        .record
        .pulse
        .lock()
        .expect("pulse")
        .last_applied
        .get(&digest)
        .cloned()
        .expect("applied");
    assert!(
        applied.ok,
        "held 1000 ms must still meet 50 ms drift against freeze: {:?}",
        applied.error
    );
    assert!(applied.event_id.is_some());
}

#[test]
fn pulse_age_closes_after_five_pulses() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-AGE", "sess-1");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-age",
        "AG-AGE",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    set_pulse_clock(&rt, 1_000_000);
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_eq!(enq.pending, Some(true));
    set_pulse_clock(&rt, 1_000_000 + MAX_AGE_MS + 1);
    let rel = pulse_beat(&rt);
    assert_eq!(rel.aged.len(), 1);
    let digest = enq.digest.clone().unwrap();
    let applied = rt
        .record
        .pulse
        .lock()
        .expect("pulse")
        .last_applied
        .get(&digest)
        .cloned()
        .expect("aged");
    assert!(!applied.ok);
    assert!(applied.error.unwrap_or_default().contains("aged"));
    let db = rt.record.db.lock().expect("db");
    let exported = crate::export_dynaep_events(&db, Some(10)).expect("export");
    assert!(!exported
        .iter()
        .any(|e| e.event_type.starts_with("docking_")));
}

#[test]
fn pulse_overflow_capsules_is_deny() {
    let (_dir, rt) = temp_runtime();
    {
        let mut pulse = rt.record.pulse.lock().expect("pulse");
        for i in 0..QUEUE_CAP_CAPSULES {
            pulse
                .queue
                .enqueue(QueuedCapsule {
                    digest: format!("pre-{i}"),
                    // One signer holds only its share, so the queue is filled by several.
                    agent_id: format!("ag-{}", i / QUEUE_SIGNER_SHARE_CAPSULES),
                    sequence_number: i as i64 + 1,
                    byte_len: 1,
                    freeze: freeze_temporal_snapshot(1_000_000, 0),
                })
                .expect("prefill");
        }
    }
    install_agent_manifest(&rt, "AG-OVF", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-ovf",
        "AG-OVF",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    assert_eq!(
        resp.error.as_deref(),
        Some(EnqueueDeny::OverflowCapsules.as_str())
    );
}

#[test]
fn pulse_overflow_bytes_is_deny() {
    let (_dir, rt) = temp_runtime();
    {
        let mut pulse = rt.record.pulse.lock().expect("pulse");
        // One signer holds only its share, so the bytes are filled by several signers.
        let signers = QUEUE_CAP_BYTES / QUEUE_SIGNER_SHARE_BYTES;
        for i in 0..signers {
            pulse
                .queue
                .enqueue(QueuedCapsule {
                    digest: format!("big-{i}"),
                    agent_id: format!("ag-{i}"),
                    sequence_number: 1,
                    byte_len: QUEUE_SIGNER_SHARE_BYTES,
                    freeze: freeze_temporal_snapshot(1_000_000, 0),
                })
                .expect("prefill");
        }
    }
    install_agent_manifest(&rt, "AG-OVB", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-ovb",
        "AG-OVB",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    assert_eq!(
        resp.error.as_deref(),
        Some(EnqueueDeny::OverflowBytes.as_str())
    );
}

#[test]
fn pulse_same_agent_sequence_order() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-SEQ", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let body2 = admit_ok_payload_seq(2);
    let body1 = admit_ok_payload_seq(1);
    let (_f2, line2) = build_test_frame(
        &rt,
        "ch-seq",
        "AG-SEQ",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &body2,
        1,
    );
    let (_f1, line1) = build_test_frame(
        &rt,
        "ch-seq",
        "AG-SEQ",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &body1,
        2,
    );
    let e2 = process_request(&rt, &DockingPort::ValidationEngine, &line2);
    let e1 = process_request(&rt, &DockingPort::ValidationEngine, &line1);
    assert!(!e2.ok);
    assert!(!e1.ok);
    assert_eq!(e2.pending, Some(true));
    assert_eq!(e1.pending, Some(true));
    set_pulse_clock(&rt, 1_001_000);
    let rel = pulse_beat(&rt);
    let seqs: Vec<i64> = rel.ready.iter().map(|c| c.sequence_number).collect();
    assert_eq!(seqs, vec![1, 2]);
    let d1 = e1.digest.unwrap();
    let d2 = e2.digest.unwrap();
    let a1 = rt
        .record
        .pulse
        .lock()
        .expect("pulse")
        .last_applied
        .get(&d1)
        .cloned()
        .unwrap();
    let a2 = rt
        .record
        .pulse
        .lock()
        .expect("pulse")
        .last_applied
        .get(&d2)
        .cloned()
        .unwrap();
    assert!(a1.ok && a2.ok, "{:?} {:?}", a1.error, a2.error);
    assert!(a1.event_id.unwrap() < a2.event_id.unwrap());
}

#[test]
fn pulse_duplicate_digest_at_enqueue_is_deny() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-DUP", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-dup",
        "AG-DUP",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let r1 = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!r1.ok);
    assert_eq!(r1.pending, Some(true));
    let r2 = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!r2.ok);
    assert!(r2.error.unwrap_or_default().contains("replay"));
}

#[tokio::test]
async fn stop_drains_dock_tasks_unlinks_sockets_and_closes_sqlite() {
    let (dir, runtime) = temp_runtime();
    let sock_base = runtime.io.socket_base.clone();
    let (shared, handles) = run_docking_servers(runtime).await.expect("bind docks");
    assert!(sockets_exist(&sock_base), "sockets should exist after bind");
    assert!(!shared.sqlite_is_closed());
    drain_docking_servers(&shared, handles).await;
    assert!(shared.is_stopping());
    assert!(!sockets_exist(&sock_base));
    assert!(shared.sqlite_is_closed());
    let _ = dir;
}
#[test]
fn agent_stamp_is_read_and_never_adopted_as_the_kernel_clock() {
    let body = br#"{"type":"PING","action_path":"root:ping","timestamp":1700000000500}"#;
    assert_eq!(super::pulse::agent_stamp_ms(body), Some(1700000000500));
    let none = br#"{"type":"PING","action_path":"root:ping"}"#;
    assert_eq!(super::pulse::agent_stamp_ms(none), None);
    let zero = br#"{"type":"PING","action_path":"root:ping","timestamp":0}"#;
    assert_eq!(super::pulse::agent_stamp_ms(zero), None);
    assert_eq!(super::pulse::agent_stamp_ms(b"not-json"), None);
    // Ahead of the kernel clock the drift bound holds. Behind it the age bound holds,
    // because the seal and the transit always put an agreeing stamp in the past.
    let window = |stamp: i64| {
        super::pulse::stamp_outside_window(stamp, 10_000_000, MAX_DRIFT_MS, MAX_AGE_MS).map(|w| w.0)
    };
    assert_eq!(window(10_000_000), None);
    assert_eq!(window(10_000_000 + MAX_DRIFT_MS), None);
    assert_eq!(
        window(10_000_000 + MAX_DRIFT_MS + 1),
        Some("temporal:future_skew")
    );
    assert_eq!(window(10_000_000 - MAX_DRIFT_MS - 1), None);
    assert_eq!(window(10_000_000 - MAX_AGE_MS), None);
    assert_eq!(
        window(10_000_000 - MAX_AGE_MS - 1),
        Some("temporal:stale_event")
    );
}

// --- AEP-CRV-010 kernel identity, order and clock ---

/// Lattice of the identity and order tests: action:write is granted to agent-a and to
/// AG-HUBLESS only and action:child needs action:write as its parent.
fn crv_lattice_yaml() -> &'static str {
    "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  action:write:\n    category: agent_action\n    parents: [\"root:ping\"]\n    children: []\n    agent_permission: [\"agent-a\", \"AG-HUBLESS\"]\n  action:child:\n    category: agent_action\n    parents: [\"action:write\"]\n    children: []\n    agent_permission: [\"AG-HUBLESS\"]\n"
}

/// Hub of the identity and order tests. agent-b holds a hub row for action:write, so the
/// hub does not hide a frame that names agent-a. AG-HUBLESS holds no hub row for
/// action:write and holds one for its child.
fn crv_hub_gap() -> &'static str {
    "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: agent-a\n      action: root:ping\n    - agent_id: agent-a\n      action: action:write\n    - agent_id: agent-b\n      action: root:ping\n    - agent_id: agent-b\n      action: action:write\n    - agent_id: AG-HUBLESS\n      action: root:ping\n    - agent_id: AG-HUBLESS\n      action: action:child\n    - agent_id: AG-ONTIME\n      action: root:ping\n    - agent_id: AG-AHEAD\n      action: root:ping\n    - agent_id: AG-BEHIND\n      action: root:ping\n    - agent_id: AG-SHARE-A\n      action: root:ping\n    - agent_id: AG-SHARE-B\n      action: root:ping\n    - agent_id: AG-LEDGER\n      action: root:ping\n"
}

fn crv_runtime() -> (tempfile::TempDir, DockingRuntime) {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("lattice.yaml"), crv_lattice_yaml()).expect("lattice");
    let reference = dir.path().join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&reference).expect("hub dir");
    std::fs::write(reference.join("caw-test.gap"), crv_hub_gap()).expect("hub");
    let conn = open_lattice_db(&dir.path().join("dock.db")).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    let rt = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path()).expect("runtime");
    (dir, rt)
}

/// One event body of the identity and order tests. `named` is the agent_id the event
/// text carries. Empty leaves the field out.
fn crv_event(action_path: &str, named: &str, seq: i64, stamp_ms: i64) -> Vec<u8> {
    let mut event = serde_json::json!({
        "type": "CUSTOM",
        "action_path": action_path,
        "payload": {"ok": true},
        "timestamp": stamp_ms,
        "target_id": "scene-a",
        "_sequenceNumber": seq,
    });
    if !named.is_empty() {
        event["agent_id"] = Value::from(named);
    }
    event.to_string().into_bytes()
}

fn crv_send(rt: &DockingRuntime, agent: &str, body: &[u8]) -> DockFrameResponse {
    let (_frame, line) = build_test_frame(
        rt,
        "ch-crv",
        agent,
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        body,
        1,
    );
    through_pulse(rt, &DockingPort::ValidationEngine, &line)
}

/// What Apply writes on the live entry: the satisfied actions, the sequence numbers, the
/// per second rate and the budget spend. The budget ledger is held in its debug form,
/// which lists every scope with its spend.
#[derive(Debug, PartialEq)]
struct AppliedState {
    satisfied: std::collections::BTreeSet<String>,
    sequences: Vec<(String, i64)>,
    event_rate: u32,
    budget: String,
}

fn applied_state(rt: &DockingRuntime) -> AppliedState {
    let live = rt.admit.live_entry.lock().expect("live");
    let mut sequences: Vec<(String, i64)> = live
        .snapshot
        .last_seq_by_agent
        .iter()
        .map(|(k, v)| (k.clone(), *v))
        .collect();
    sequences.sort();
    AppliedState {
        satisfied: live.snapshot.satisfied_actions.clone(),
        sequences,
        event_rate: live.snapshot.event_rate,
        budget: format!("{:?}", live.budget_ledger),
    }
}

/// Ledger rows as (event type, agent) pairs, newest first.
fn ledger_rows(rt: &DockingRuntime) -> Vec<(String, String)> {
    let db = rt.record.db.lock().expect("db");
    crate::export_dynaep_events(&db, Some(1000))
        .expect("export")
        .into_iter()
        .map(|e| (e.event_type, e.agent_id))
        .collect()
}

fn count_rows(rows: &[(String, String)], event_type_prefix: &str, agent: &str) -> usize {
    rows.iter()
        .filter(|(t, a)| t.starts_with(event_type_prefix) && a == agent)
        .count()
}

fn closed_wall<'a>(resp: &'a DockFrameResponse, id: &str) -> Option<&'a ClosedWall> {
    resp.deny
        .as_ref()
        .and_then(|d| d.closed.iter().find(|w| w.id == id))
}

/// Gate test 1. A frame that agent-b signs and that names agent-a is denied by the binding
/// wall. Every agent keyed wall judges the signer and the budget of agent-a does not move.
#[test]
fn frame_of_agent_b_that_names_agent_a_is_denied_by_the_binding_wall() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "agent-a", "sess-1");
    install_agent_manifest(&rt, "agent-b", "sess-1");
    let ping = crv_send(&rt, "agent-a", &crv_event("root:ping", "", 1, 1_000_000));
    assert!(ping.ok, "{:?}", ping.error);
    let before = applied_state(&rt);
    let rows_before = ledger_rows(&rt);

    let forged = crv_send(
        &rt,
        "agent-b",
        &crv_event("action:write", "agent-a", 1, 1_000_000),
    );
    assert!(
        !forged.ok,
        "a frame of agent-b that names agent-a was admitted"
    );
    assert!(forged.event_id.is_none());
    let binding = closed_wall(&forged, "frame.agent_binding").expect("binding wall closed");
    assert_eq!(binding.class, CLASS_SECURITY);
    // The lattice permission wall judged the signer: action:write is not granted to agent-b.
    assert!(closed_wall(&forged, "gap.agent_permission").is_some());
    assert_eq!(
        applied_state(&rt),
        before,
        "a denied frame changed the live entry"
    );
    let rows = ledger_rows(&rt);
    assert_eq!(
        count_rows(&rows, "docking_", "agent-b"),
        0,
        "the forged frame was recorded"
    );
    assert_eq!(
        count_rows(&rows, "docking_", "agent-a"),
        count_rows(&rows_before, "docking_", "agent-a")
    );
    assert_eq!(
        count_rows(&rows, crate::SIDE_CHANNEL_EVENT_TYPE, "agent-b"),
        1,
        "one deny row for the signer"
    );

    // Control: the same action sealed by agent-a with its own name is admitted, so the
    // deny above comes from the binding and not from the fixture.
    let own = crv_send(
        &rt,
        "agent-a",
        &crv_event("action:write", "agent-a", 2, 1_000_000),
    );
    assert!(own.ok, "{:?}", own.error);
    assert!(own.event_id.is_some());
    assert_ne!(applied_state(&rt), before);
}

/// The agent_id of the event text never widens what a signer may do: a frame of agent-b
/// that leaves the field out is judged as agent-b by the lattice.
#[test]
fn unnamed_event_is_judged_as_the_signer_of_the_frame() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "agent-a", "sess-1");
    install_agent_manifest(&rt, "agent-b", "sess-1");
    let ping = crv_send(&rt, "agent-a", &crv_event("root:ping", "", 1, 1_000_000));
    assert!(ping.ok, "{:?}", ping.error);
    let before = applied_state(&rt);
    let resp = crv_send(&rt, "agent-b", &crv_event("action:write", "", 1, 1_000_000));
    assert!(!resp.ok);
    assert!(closed_wall(&resp, "frame.agent_binding").is_none());
    assert!(closed_wall(&resp, "gap.agent_permission").is_some());
    assert_eq!(applied_state(&rt), before);
}

/// Gate test 2. The lattice grants the action and the hub holds no row. The hub wall
/// closes inside Admit, the live entry is unchanged and one deny row exists.
#[test]
fn hub_deny_leaves_the_live_entry_unchanged_with_one_deny_row() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-HUBLESS", "sess-1");
    let ping = crv_send(&rt, "AG-HUBLESS", &crv_event("root:ping", "", 1, 1_000_000));
    assert!(ping.ok, "{:?}", ping.error);
    let before = applied_state(&rt);
    let rows_before = ledger_rows(&rt);
    assert_eq!(count_rows(&rows_before, "docking_", "AG-HUBLESS"), 1);
    assert_eq!(
        count_rows(&rows_before, crate::SIDE_CHANNEL_EVENT_TYPE, "AG-HUBLESS"),
        0
    );

    let denied = crv_send(
        &rt,
        "AG-HUBLESS",
        &crv_event("action:write", "", 2, 1_000_000),
    );
    assert!(!denied.ok);
    assert!(denied.event_id.is_none());
    let hub = closed_wall(&denied, "hub.agent_permission").expect("hub wall closed");
    assert_eq!(hub.class, CLASS_CAPABILITY);
    assert_eq!(hub.reason, "hub permission denied");
    // The hub wall is the only closed wall: the lattice granted the action.
    assert_eq!(denied.deny.as_ref().map(|d| d.closed.len()), Some(1));
    assert_eq!(
        applied_state(&rt),
        before,
        "a hub deny changed the live entry"
    );
    let rows = ledger_rows(&rt);
    assert_eq!(
        count_rows(&rows, crate::SIDE_CHANNEL_EVENT_TYPE, "AG-HUBLESS"),
        1,
        "one deny row"
    );
    assert_eq!(
        count_rows(&rows, "docking_", "AG-HUBLESS"),
        1,
        "the denied frame left no admit row"
    );

    // The denied parent does not unlock its child: the hub grants action:child and the
    // parent closure still closes.
    let child = crv_send(
        &rt,
        "AG-HUBLESS",
        &crv_event("action:child", "", 3, 1_000_000),
    );
    assert!(!child.ok, "a hub denied parent unlocked its child");
    assert!(closed_wall(&child, "dag.parents").is_some());
    assert!(closed_wall(&child, "hub.agent_permission").is_none());
    assert_eq!(applied_state(&rt), before);
}

/// The ledger row is written before Apply. When the ledger refuses the row the answer is
/// a deny and the live entry is unchanged.
#[test]
fn ledger_error_at_the_record_step_applies_nothing() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-LEDGER", "sess-1");
    let before = applied_state(&rt);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-crv",
        "AG-LEDGER",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, 1_000_000),
        1,
    );
    set_pulse_clock(&rt, 1_000_000);
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert_eq!(enq.pending, Some(true), "{:?}", enq.error);
    let digest = enq.digest.clone().expect("digest");
    // The ledger refuses every frame row from here on. Anomaly rows still enter.
    rt.record
        .db
        .lock()
        .expect("db")
        .execute_batch(
            "CREATE TRIGGER refuse_frame_rows BEFORE INSERT ON action_lattice_events \
             WHEN NEW.event_type LIKE 'docking_%' \
             BEGIN SELECT RAISE(ABORT, 'ledger refused the row'); END;",
        )
        .expect("trigger");
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let _ = pulse_beat(&rt);
    let answer = process_request(&rt, &DockingPort::ValidationEngine, &collect_line(&digest));
    assert!(!answer.ok);
    assert!(answer.event_id.is_none());
    assert!(answer
        .error
        .as_deref()
        .unwrap_or_default()
        .contains("ledger unavailable"));
    let wall = closed_wall(&answer, "ledger.unavailable").expect("ledger wall");
    assert_eq!(wall.class, "ledger.unavailable");
    assert_eq!(
        applied_state(&rt),
        before,
        "a frame without a ledger row changed the live entry"
    );
    assert_eq!(count_rows(&ledger_rows(&rt), "docking_", "AG-LEDGER"), 0);
}

/// A failed enqueue leaves no capsule behind. The caller reads a deny and no later beat
/// applies the frame.
#[test]
fn failed_enqueue_record_leaves_no_capsule_for_a_later_beat() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-LEDGER", "sess-1");
    let before = applied_state(&rt);
    rt.record
        .db
        .lock()
        .expect("db")
        .execute_batch(
            "CREATE TRIGGER refuse_held_rows BEFORE INSERT ON held_frame_digests \
             BEGIN SELECT RAISE(ABORT, 'ledger refused the held digest'); END;",
        )
        .expect("trigger");
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-crv",
        "AG-LEDGER",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, 1_000_000),
        1,
    );
    set_pulse_clock(&rt, 1_000_000);
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!enq.ok);
    assert_ne!(enq.pending, Some(true));
    assert!(closed_wall(&enq, "ledger.unavailable").is_some());
    {
        let pulse = rt.record.pulse.lock().expect("pulse");
        assert!(
            pulse.queue.is_empty(),
            "the refused capsule sits in the queue"
        );
        assert!(pulse.held.is_empty(), "the refused capsule is still held");
    }
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let rel = pulse_beat(&rt);
    assert!(rel.ready.is_empty());
    assert_eq!(applied_state(&rt), before);
    assert_eq!(count_rows(&ledger_rows(&rt), "docking_", "AG-LEDGER"), 0);
}

/// Gate test 3. A frame stamped 30 s ahead of the kernel clock is refused at enqueue. It
/// takes no room in the queue and the next agent is served.
#[test]
fn frame_stamped_thirty_seconds_ahead_is_refused_at_enqueue() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-AHEAD", "sess-1");
    install_agent_manifest(&rt, "AG-ONTIME", "sess-1");
    let now_s = crate::now_unix();
    let kernel_ms = (now_s as i64) * 1000;
    set_pulse_clock(&rt, kernel_ms);
    // The frame second and the stamp agree with each other, 30 s ahead of the kernel. The
    // wire window of 60 s lets the frame through, so the stamp is what must refuse it.
    let (_frame, line) = build_test_frame_at(
        &rt,
        "ch-crv",
        "AG-AHEAD",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, kernel_ms + 30_000),
        now_s + 30,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    assert_ne!(resp.pending, Some(true), "a future frame was held");
    let wall = closed_wall(&resp, "temporal:future_skew").expect("future skew wall");
    assert_eq!(wall.class, CLASS_TEMPORAL);
    {
        let pulse = rt.record.pulse.lock().expect("pulse");
        assert!(
            pulse.queue.is_empty(),
            "a refused frame took room in the queue"
        );
        assert!(pulse.held.is_empty());
    }
    assert_eq!(
        count_rows(
            &ledger_rows(&rt),
            crate::SIDE_CHANNEL_EVENT_TYPE,
            "AG-AHEAD"
        ),
        1
    );
    // The queue is free for every other agent in the same instant.
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-crv",
        "AG-ONTIME",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, kernel_ms),
        1,
    );
    let ontime = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert_eq!(ontime.pending, Some(true), "{:?}", ontime.error);
}

/// A stamp older than the age bound of the kernel clock is refused at enqueue.
#[test]
fn stamp_older_than_the_age_bound_is_refused_at_enqueue() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-BEHIND", "sess-1");
    let now_s = crate::now_unix();
    let stamp_ms = (now_s as i64) * 1000;
    set_pulse_clock(&rt, stamp_ms + MAX_AGE_MS + 1);
    let (_frame, line) = build_test_frame_at(
        &rt,
        "ch-crv",
        "AG-BEHIND",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, stamp_ms),
        now_s,
    );
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!resp.ok);
    assert_ne!(resp.pending, Some(true));
    let wall = closed_wall(&resp, "temporal:stale_event").expect("stale wall");
    assert_eq!(wall.class, CLASS_TEMPORAL);
    assert!(rt.record.pulse.lock().expect("pulse").queue.is_empty());
}

/// The time the seal and the transit took is not clock drift. A stamp 900 ms behind the
/// kernel clock is accepted and admitted. It does not shorten the hold: the capsule
/// turns ready one pulse of kernel time after it arrived, not one pulse after its stamp.
#[test]
fn seal_and_transit_time_is_not_drift_and_does_not_shorten_the_hold() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-BEHIND", "sess-1");
    let now_s = crate::now_unix();
    let stamp_ms = (now_s as i64) * 1000;
    let arrival_ms = stamp_ms + 900;
    set_pulse_clock(&rt, arrival_ms);
    let (_frame, line) = build_test_frame_at(
        &rt,
        "ch-crv",
        "AG-BEHIND",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, stamp_ms),
        now_s,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert_eq!(enq.pending, Some(true), "{:?}", enq.error);
    let digest = enq.digest.clone().expect("digest");
    // One pulse after the stamp the capsule still waits: the hold counts from arrival.
    set_pulse_clock(&rt, stamp_ms + PULSE_MS);
    assert!(pulse_beat(&rt).ready.is_empty());
    set_pulse_clock(&rt, arrival_ms + PULSE_MS - 1);
    assert!(pulse_beat(&rt).ready.is_empty());
    set_pulse_clock(&rt, arrival_ms + PULSE_MS);
    let rel = pulse_beat(&rt);
    assert_eq!(rel.ready.len(), 1);
    assert_eq!(rel.ready[0].freeze.bridge_ts_ms, arrival_ms);
    let answer = process_request(&rt, &DockingPort::ValidationEngine, &collect_line(&digest));
    assert!(answer.ok, "{:?}", answer.error);
    assert!(answer.event_id.is_some());
}

/// The capsule is frozen at the kernel clock, so it turns ready one pulse of kernel time
/// after it arrived whatever stamp inside the drift bound the agent wrote.
#[test]
fn freeze_is_the_kernel_clock_and_not_the_stamp_of_the_agent() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-ONTIME", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    let (_frame, line) = build_test_frame(
        &rt,
        "ch-crv",
        "AG-ONTIME",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, 1_000_000 + MAX_DRIFT_MS),
        1,
    );
    let enq = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert_eq!(enq.pending, Some(true), "{:?}", enq.error);
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS - 1);
    assert!(pulse_beat(&rt).ready.is_empty());
    set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
    let rel = pulse_beat(&rt);
    assert_eq!(rel.ready.len(), 1);
    assert_eq!(rel.ready[0].freeze.bridge_ts_ms, 1_000_000);
}

/// One signer holds only its share of the pulse queue, so another signer is still served.
#[test]
fn signer_at_its_queue_share_leaves_room_for_another_signer() {
    let (_dir, rt) = crv_runtime();
    install_agent_manifest(&rt, "AG-SHARE-A", "sess-1");
    install_agent_manifest(&rt, "AG-SHARE-B", "sess-1");
    set_pulse_clock(&rt, 1_000_000);
    {
        let mut pulse = rt.record.pulse.lock().expect("pulse");
        for i in 0..QUEUE_SIGNER_SHARE_CAPSULES {
            pulse
                .queue
                .enqueue(QueuedCapsule {
                    digest: format!("share-a-{i}"),
                    agent_id: String::from("AG-SHARE-A"),
                    sequence_number: i as i64 + 10,
                    byte_len: 1,
                    freeze: freeze_temporal_snapshot(1_000_000, 0),
                })
                .expect("prefill");
        }
    }
    let (_frame, line_a) = build_test_frame(
        &rt,
        "ch-crv",
        "AG-SHARE-A",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, 1_000_000),
        1,
    );
    let over = process_request(&rt, &DockingPort::ValidationEngine, &line_a);
    assert!(!over.ok);
    assert_eq!(
        over.error.as_deref(),
        Some(EnqueueDeny::SignerShareCapsules.as_str())
    );
    let (_frame, line_b) = build_test_frame(
        &rt,
        "ch-crv",
        "AG-SHARE-B",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &crv_event("root:ping", "", 1, 1_000_000),
        1,
    );
    let other = process_request(&rt, &DockingPort::ValidationEngine, &line_b);
    assert_eq!(other.pending, Some(true), "{:?}", other.error);
}
#[test]
fn pulse_decay_rate_clears_the_second_counter() {
    let (_dir, rt) = temp_runtime();
    {
        let mut live = rt.admit.live_entry.lock().expect("live");
        live.snapshot.event_rate = 12;
    }
    super::pulse::pulse_decay_rate(&rt);
    assert_eq!(
        rt.admit
            .live_entry
            .lock()
            .expect("live")
            .snapshot
            .event_rate,
        0
    );
}

#[test]
fn tls_handshake_err_does_not_request_stop() {
    let (_dir, rt) = temp_runtime();
    assert!(!rt.is_stopping());
    assert_eq!(rt.last_tls_handshake_err(), None);
    note_tls_handshake_err(&rt, "refused");
    assert!(!rt.is_stopping());
    assert_eq!(rt.last_tls_handshake_err().as_deref(), Some("refused"));
}

#[test]
fn replay_ram_eviction_still_denied_by_sqlite() {
    let (_dir, rt) = temp_runtime();
    install_agent_manifest(&rt, "AG-REPLAY", "sess-1");
    let (frame, line) = build_test_frame(
        &rt,
        "ch-replay-evict",
        "AG-REPLAY",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        admit_ok_payload(),
        1,
    );
    let admitted = through_pulse(&rt, &DockingPort::ValidationEngine, &line);
    assert!(admitted.ok, "first frame must be admitted: {admitted:?}");
    assert!(admitted.event_id.is_some());
    let digest = aep_lattice_channel::frame_digest(&frame).unwrap();
    // Simulate RAM eviction: the in-memory guard no longer knows the digest.
    *rt.defence.replay_guard.lock().expect("replay") = crate::ReplayGuard::default();
    assert!(rt
        .defence
        .replay_guard
        .lock()
        .expect("replay")
        .check_and_record("probe", 1));
    let replay = process_request(&rt, &DockingPort::ValidationEngine, &line);
    assert!(!replay.ok);
    assert_eq!(replay.pending, None);
    let deny = replay.deny.expect("deny report");
    assert!(
        deny.closed
            .iter()
            .any(|w| w.class == "frame.replay" && w.id == "digest.replay"),
        "{deny:?}"
    );
    let rows: i64 = rt
        .record
        .db
        .lock()
        .expect("db")
        .query_row(
            "SELECT COUNT(*) FROM action_lattice_events WHERE frame_digest = ?1",
            [digest.as_str()],
            |r| r.get(0),
        )
        .expect("count");
    assert_eq!(rows, 1);
}

#[tokio::test]
async fn drain_aborts_and_counts_late_tasks() {
    let (_dir, rt) = temp_runtime();
    let quick = tokio::spawn(async {});
    let stuck = tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    });
    rt.track_task(tokio::spawn(async {
        tokio::time::sleep(std::time::Duration::from_secs(3600)).await;
    }));
    let started = std::time::Instant::now();
    drain_docking_servers(&rt, vec![quick, stuck]).await;
    assert!(started.elapsed() < std::time::Duration::from_secs(4));
    assert_eq!(rt.drain_aborted_tasks(), 2);
    assert!(rt.sqlite_is_closed());
    assert!(rt.is_stopping());
}
#[test]
fn docking_runtime_parts_are_distinct_owners() {
    let (_dir, rt) = temp_runtime();
    let _limiter = rt.defence.rate_limiter.lock().expect("lock");
    let _g = rt.record.db.lock().expect("db");
    let _keys = rt.keys.agent_sign_keys.lock().expect("keys lock");
    let _contracts = rt.admit.contracts.lock().expect("lock");
    assert!(!rt.is_stopping());
}
#[test]
fn tls_handshake_err_still_does_not_request_stop() {
    let (_dir, rt) = temp_runtime();
    assert!(!rt.is_stopping());
    note_tls_handshake_err(&rt, "refused");
    assert!(!rt.is_stopping())
}

// --- AEP-CRV-020 kernel outbound request, stalls and limits ---

/// The one action path on which the kernel sends an outbound request.
const CRV20_GATEWAY: &str = "gateway:outbound_http";

/// Lattice of the outbound tests. The gateway path is granted to the gateway agents only.
/// AG-NOGRANT holds a hub row for it and no lattice grant.
fn crv20_lattice_yaml() -> &'static str {
    "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\"]\n  action:write:\n    category: agent_action\n    parents: []\n    children: []\n    agent_permission: [\"AG-WRITE\"]\n  gateway:outbound_http:\n    category: agent_action\n    parents: []\n    children: []\n    agent_permission: [\"AG-GW\", \"AG-SLOW1\", \"AG-SLOW2\", \"AG-GW-BOUND\"]\n"
}

fn crv20_hub_gap() -> &'static str {
    "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: AG-WRITE\n      action: root:ping\n    - agent_id: AG-WRITE\n      action: action:write\n    - agent_id: AG-GW\n      action: gateway:outbound_http\n    - agent_id: AG-SLOW1\n      action: gateway:outbound_http\n    - agent_id: AG-SLOW2\n      action: gateway:outbound_http\n    - agent_id: AG-GW-BOUND\n      action: gateway:outbound_http\n    - agent_id: AG-NOGRANT\n      action: gateway:outbound_http\n    - agent_id: AG-QUICK\n      action: root:ping\n    - agent_id: AG-QUERY\n      action: root:ping\n    - agent_id: AG-VICTIM\n      action: root:ping\n"
}

/// Operator route list with one route: GET on any path of the local test server.
fn crv20_routes(port: u16) -> String {
    serde_json::json!({
        "routes": [{
            "id": "crv20-local",
            "scheme": "http",
            "host": "127.0.0.1",
            "port": port,
            "path_prefix": "/",
            "methods": ["GET"],
        }]
    })
    .to_string()
}

/// A runtime of the outbound tests. `routes` is the text of the operator route list and
/// an empty text leaves the list out.
fn crv20_runtime(routes: &str) -> (tempfile::TempDir, DockingRuntime) {
    let dir = tempfile::tempdir().expect("tempdir");
    std::fs::write(dir.path().join("lattice.yaml"), crv20_lattice_yaml()).expect("lattice");
    let reference = dir.path().join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&reference).expect("hub dir");
    std::fs::write(reference.join("caw-test.gap"), crv20_hub_gap()).expect("hub");
    if !routes.is_empty() {
        std::fs::write(dir.path().join("gateway-routes.json"), routes).expect("routes");
    }
    let conn = open_lattice_db(&dir.path().join("dock.db")).expect("db");
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    let rt = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path()).expect("runtime");
    (dir, rt)
}

fn crv20_event(action_path: &str, seq: i64, payload: Value) -> Vec<u8> {
    serde_json::json!({
        "type": "CUSTOM",
        "action_path": action_path,
        "payload": payload,
        "timestamp": 1_000_000,
        "target_id": "scene-a",
        "_sequenceNumber": seq,
    })
    .to_string()
    .into_bytes()
}

fn crv20_frame_line(rt: &DockingRuntime, agent: &str, body: &[u8]) -> String {
    build_test_frame(
        rt,
        "ch-crv20",
        agent,
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        body,
        1,
    )
    .1
}

fn crv20_send(rt: &DockingRuntime, agent: &str, body: &[u8]) -> DockFrameResponse {
    let line = crv20_frame_line(rt, agent, body);
    through_pulse(rt, &DockingPort::ValidationEngine, &line)
}

/// Collect a digest until its answer is no longer pending or five seconds pass.
fn crv20_settle(rt: &DockingRuntime, first: DockFrameResponse) -> DockFrameResponse {
    let Some(digest) = first.digest.clone() else {
        return first;
    };
    let mut resp = first;
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    while resp.pending == Some(true) && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(20));
        resp = process_request(
            rt,
            &DockingPort::ValidationEngine,
            &format!("{{\"collect\":\"{digest}\"}}"),
        );
    }
    resp
}

/// The outbound tests send their requests to a server on 127.0.0.1, so the address check
/// of the tests admits loopback. Every other address rule still applies.
fn allow_loopback_outbound() {
    std::env::set_var("AEP_LATTICE_ALLOW_LOOPBACK", "1");
}

/// A plain HTTP server for the outbound tests. Every connection is counted, waits for
/// `delay` and is answered 204 with no body.
struct TestHttp {
    port: u16,
    hits: Arc<std::sync::atomic::AtomicUsize>,
}

impl TestHttp {
    fn start(delay: std::time::Duration) -> Self {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().expect("addr").port();
        let hits = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        let counted = hits.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                let Ok(mut stream) = stream else {
                    break;
                };
                counted.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
                std::thread::spawn(move || {
                    use std::io::{Read, Write};
                    let mut buf = [0u8; 4096];
                    let _ = stream.read(&mut buf);
                    std::thread::sleep(delay);
                    let _ = stream.write_all(
                        b"HTTP/1.1 204 No Content\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    );
                });
            }
        });
        Self { port, hits }
    }

    fn url(&self, path: &str) -> String {
        format!("http://127.0.0.1:{}{path}", self.port)
    }

    fn hits(&self) -> usize {
        self.hits.load(std::sync::atomic::Ordering::SeqCst)
    }
}

/// Gate test 1. An admitted write event with a url field sends no request, and neither
/// does a url at the top level of a ping. Only the granted gateway path sends one.
#[test]
fn admitted_write_with_a_url_field_sends_no_request() {
    allow_loopback_outbound();
    let server = TestHttp::start(std::time::Duration::ZERO);
    let (_dir, rt) = crv20_runtime(&crv20_routes(server.port));
    install_agent_manifest(&rt, "AG-WRITE", "sess-1");

    let write = crv20_event(
        "action:write",
        1,
        serde_json::json!({"url": server.url("/write"), "method": "GET"}),
    );
    let resp = crv20_send(&rt, "AG-WRITE", &write);
    assert!(resp.ok, "{:?}", resp.error);
    assert!(resp.event_id.is_some());
    assert!(resp.http.is_none(), "a write event received an http answer");

    let mut ping: Value = serde_json::from_slice(&crv20_event(
        "root:ping",
        2,
        serde_json::json!({"ok": true}),
    ))
    .expect("ping");
    ping["url"] = Value::from(server.url("/ping"));
    let resp = crv20_send(&rt, "AG-WRITE", ping.to_string().as_bytes());
    assert!(resp.ok, "{:?}", resp.error);
    assert!(resp.http.is_none(), "a ping received an http answer");

    std::thread::sleep(std::time::Duration::from_millis(300));
    assert_eq!(
        server.hits(),
        0,
        "the kernel sent a request for a url field outside the gateway path"
    );
}

/// Control of gate test 1: the granted gateway path on a listed route sends one request
/// and the answer carries the http reply.
#[test]
fn granted_gateway_frame_on_a_listed_route_sends_one_request() {
    allow_loopback_outbound();
    let server = TestHttp::start(std::time::Duration::ZERO);
    let (_dir, rt) = crv20_runtime(&crv20_routes(server.port));
    install_agent_manifest(&rt, "AG-GW", "sess-1");
    let body = crv20_event(
        CRV20_GATEWAY,
        1,
        serde_json::json!({"url": server.url("/ok"), "method": "GET"}),
    );
    let resp = crv20_settle(&rt, crv20_send(&rt, "AG-GW", &body));
    assert!(resp.ok, "{:?}", resp.error);
    assert!(resp.event_id.is_some());
    assert_eq!(resp.http.as_ref().map(|h| h.status), Some(204));
    assert_eq!(server.hits(), 1);
}

/// The gateway path needs the grant of the lattice: a hub row alone sends nothing.
#[test]
fn gateway_frame_without_a_lattice_grant_sends_no_request() {
    allow_loopback_outbound();
    let server = TestHttp::start(std::time::Duration::ZERO);
    let (_dir, rt) = crv20_runtime(&crv20_routes(server.port));
    install_agent_manifest(&rt, "AG-NOGRANT", "sess-1");
    let body = crv20_event(
        CRV20_GATEWAY,
        1,
        serde_json::json!({"url": server.url("/ok"), "method": "GET"}),
    );
    let resp = crv20_settle(&rt, crv20_send(&rt, "AG-NOGRANT", &body));
    assert!(!resp.ok);
    assert!(resp.event_id.is_none());
    assert!(closed_wall(&resp, "gap.agent_permission").is_some());
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert_eq!(server.hits(), 0);
}

/// A destination outside the operator route list closes the route wall inside Admit, so
/// nothing is applied, nothing is recorded and no connection is opened.
#[test]
fn gateway_frame_to_an_unlisted_destination_is_denied_by_the_route_wall() {
    allow_loopback_outbound();
    let listed = TestHttp::start(std::time::Duration::ZERO);
    let unlisted = TestHttp::start(std::time::Duration::ZERO);
    let (_dir, rt) = crv20_runtime(&crv20_routes(listed.port));
    install_agent_manifest(&rt, "AG-GW", "sess-1");
    let before = applied_state(&rt);
    let body = crv20_event(
        CRV20_GATEWAY,
        1,
        serde_json::json!({"url": unlisted.url("/x"), "method": "GET"}),
    );
    let resp = crv20_settle(&rt, crv20_send(&rt, "AG-GW", &body));
    assert!(
        !resp.ok,
        "a request to an unlisted destination was admitted"
    );
    assert!(resp.event_id.is_none());
    let wall = closed_wall(&resp, "gateway.route").expect("route wall closed");
    assert_eq!(wall.class, CLASS_SECURITY);
    assert_eq!(applied_state(&rt), before);
    std::thread::sleep(std::time::Duration::from_millis(200));
    assert_eq!(unlisted.hits() + listed.hits(), 0);
}

/// One agent holds a bounded number of requests in flight. The next gateway frame of the
/// same agent closes the bound wall and is not applied.
#[test]
fn one_agent_holds_a_bounded_number_of_requests_in_flight() {
    allow_loopback_outbound();
    let server = TestHttp::start(std::time::Duration::from_millis(1500));
    let (_dir, rt) = crv20_runtime(&crv20_routes(server.port));
    install_agent_manifest(&rt, "AG-GW-BOUND", "sess-1");
    let mut answers = Vec::new();
    for seq in 1..=3 {
        let body = crv20_event(
            CRV20_GATEWAY,
            seq,
            serde_json::json!({"url": server.url(&format!("/slow/{seq}")), "method": "GET"}),
        );
        answers.push(crv20_send(&rt, "AG-GW-BOUND", &body));
    }
    let third = answers.pop().expect("third");
    assert!(!third.ok, "a third request in flight was admitted");
    assert!(third.event_id.is_none());
    assert!(closed_wall(&third, "gateway.agent_bound").is_some());
    for first in answers {
        let settled = crv20_settle(&rt, first);
        assert!(settled.ok, "{:?}", settled.error);
        assert_eq!(settled.http.as_ref().map(|h| h.status), Some(204));
    }
    assert_eq!(server.hits(), 2);
}

/// Read one answer line within `limit`, or None when the dock stays silent that long.
async fn crv20_answer_within(
    conn: &mut BufReader<UnixStream>,
    limit: std::time::Duration,
) -> Option<DockFrameResponse> {
    let mut buf = String::new();
    match tokio::time::timeout(limit, conn.read_line(&mut buf)).await {
        Ok(Ok(n)) if n > 0 => serde_json::from_str(buf.trim()).ok(),
        _ => None,
    }
}

async fn crv20_send_line(conn: &mut BufReader<UnixStream>, line: &str) {
    conn.get_mut()
        .write_all(format!("{line}\n").as_bytes())
        .await
        .expect("send line");
}

/// Collect a digest on one connection until the answer is no longer pending.
async fn crv20_collect_settled(
    conn: &mut BufReader<UnixStream>,
    digest: &str,
) -> Option<DockFrameResponse> {
    let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        crv20_send_line(conn, &format!("{{\"collect\":\"{digest}\"}}")).await;
        let resp = crv20_answer_within(conn, std::time::Duration::from_secs(10)).await?;
        if resp.pending != Some(true) || tokio::time::Instant::now() >= deadline {
            return Some(resp);
        }
    }
}

async fn crv20_wait_hits(server: &TestHttp, hits: usize) {
    let start = tokio::time::Instant::now();
    while server.hits() < hits && start.elapsed() < std::time::Duration::from_secs(3) {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
    }
}

/// Gate test 2. On two workers a collect answers within 500 ms while two slow fetches run.
/// Each slow fetch starts from its own beat, so each one can hold one worker. The frame of
/// a third agent and its collect must still be answered within 500 ms each.
#[test]
fn collect_answers_within_500_ms_while_two_slow_fetches_run() {
    allow_loopback_outbound();
    let server = TestHttp::start(std::time::Duration::from_millis(2000));
    let (_dir, runtime) = crv20_runtime(&crv20_routes(server.port));
    for agent in ["AG-SLOW1", "AG-SLOW2", "AG-QUICK"] {
        install_agent_manifest(&runtime, agent, "sess-1");
    }
    let t0: i64 = 1_000_000;
    let gateway_body = |seq: i64, stamp: i64, path: &str| {
        let mut v: Value = serde_json::from_slice(&crv20_event(
            CRV20_GATEWAY,
            seq,
            serde_json::json!({"url": server.url(path), "method": "GET"}),
        ))
        .expect("event");
        v["timestamp"] = Value::from(stamp);
        v.to_string().into_bytes()
    };
    let slow1 = crv20_frame_line(&runtime, "AG-SLOW1", &gateway_body(1, t0, "/slow/1"));
    let slow2 = crv20_frame_line(
        &runtime,
        "AG-SLOW2",
        &gateway_body(1, t0 + PULSE_MS, "/slow/2"),
    );
    let quick = {
        let mut v: Value = serde_json::from_slice(&crv20_event(
            "root:ping",
            1,
            serde_json::json!({"ok": true}),
        ))
        .expect("event");
        v["timestamp"] = Value::from(t0 + 2 * PULSE_MS);
        crv20_frame_line(&runtime, "AG-QUICK", v.to_string().as_bytes())
    };
    set_pulse_clock(&runtime, t0);
    let shared = Arc::new(runtime);
    let workers = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("two workers");
    let (quick_frame_ms, quick_collect_ms, slow) = workers.block_on(async {
        let mut conns = Vec::new();
        for _ in 0..3 {
            let (client, server_end) = UnixStream::pair().expect("pair");
            let (r, w) = server_end.into_split();
            let rt = shared.clone();
            tokio::spawn(async move {
                let _ = serve_connection(rt, DockingPort::ValidationEngine, r, w).await;
            });
            conns.push(BufReader::new(client));
        }
        let wait = std::time::Duration::from_secs(10);
        // The first slow fetch starts from the beat of its collect.
        crv20_send_line(&mut conns[0], &slow1).await;
        let a = crv20_answer_within(&mut conns[0], wait)
            .await
            .expect("frame 1");
        assert_eq!(a.pending, Some(true), "{:?}", a.error);
        set_pulse_clock(&shared, t0 + PULSE_MS);
        let digest_a = a.digest.expect("digest a");
        crv20_send_line(&mut conns[0], &format!("{{\"collect\":\"{digest_a}\"}}")).await;
        crv20_wait_hits(&server, 1).await;
        // The second slow fetch starts from the beat of its own collect.
        crv20_send_line(&mut conns[1], &slow2).await;
        let b = crv20_answer_within(&mut conns[1], wait)
            .await
            .expect("frame 2");
        assert_eq!(b.pending, Some(true), "{:?}", b.error);
        set_pulse_clock(&shared, t0 + 2 * PULSE_MS);
        let digest_b = b.digest.expect("digest b");
        crv20_send_line(&mut conns[1], &format!("{{\"collect\":\"{digest_b}\"}}")).await;
        crv20_wait_hits(&server, 2).await;
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
        // Two fetches run. A third agent sends a frame and collects its answer.
        let limit = std::time::Duration::from_millis(500);
        let started = std::time::Instant::now();
        crv20_send_line(&mut conns[2], &quick).await;
        let c = crv20_answer_within(&mut conns[2], limit).await;
        let quick_frame_ms = started.elapsed().as_millis();
        let c = c.expect("the frame of a third agent was not answered within 500 ms");
        assert_eq!(c.pending, Some(true), "{:?}", c.error);
        set_pulse_clock(&shared, t0 + 3 * PULSE_MS);
        let started = std::time::Instant::now();
        let digest_c = c.digest.expect("digest c");
        crv20_send_line(&mut conns[2], &format!("{{\"collect\":\"{digest_c}\"}}")).await;
        let collected = crv20_answer_within(&mut conns[2], limit).await;
        let quick_collect_ms = started.elapsed().as_millis();
        let collected = collected.expect("the collect was not answered within 500 ms");
        assert!(collected.ok, "{:?}", collected.error);
        assert!(collected.event_id.is_some());
        // The two slow collects end with their http answers.
        let mut slow = Vec::new();
        for (conn, digest) in [(0usize, digest_a), (1usize, digest_b)] {
            let mut resp = crv20_answer_within(&mut conns[conn], wait).await;
            if resp.as_ref().is_some_and(|r| r.pending == Some(true)) {
                resp = crv20_collect_settled(&mut conns[conn], &digest).await;
            }
            slow.push(resp);
        }
        (quick_frame_ms, quick_collect_ms, slow)
    });
    assert!(quick_frame_ms < 500, "frame took {quick_frame_ms} ms");
    assert!(quick_collect_ms < 500, "collect took {quick_collect_ms} ms");
    for resp in slow {
        let resp = resp.expect("slow answer");
        assert!(resp.ok, "{:?}", resp.error);
        assert_eq!(resp.http.as_ref().map(|h| h.status), Some(204));
    }
    assert_eq!(server.hits(), 2);
}

/// Gate test 3. A query whose target id starts with a multi byte character is answered
/// without a panic, the live entry lock stays whole and the next frame is admitted.
#[test]
fn query_with_a_multi_byte_target_id_is_answered_without_a_panic() {
    let (_dir, rt) = crv20_runtime("");
    install_agent_manifest(&rt, "AG-QUERY", "sess-1");
    for (seq, target) in [(1, "€€-00001"), (2, "中文"), (3, "é")] {
        let body = serde_json::json!({
            "type": "CUSTOM",
            "dynaep_type": "AEP_QUERY",
            "query": "z_band_of",
            "action_path": "root:ping",
            "payload": {"ok": true},
            "timestamp": 1_000_000,
            "target_id": target,
            "_sequenceNumber": seq,
        })
        .to_string()
        .into_bytes();
        let resp = crv20_send(&rt, "AG-QUERY", &body);
        assert!(resp.ok, "{target}: {:?}", resp.error);
        assert!(resp.event_id.is_some());
    }
    assert!(!rt.admit.live_entry.is_poisoned());
    let next = crv20_send(
        &rt,
        "AG-QUERY",
        &crv20_event("root:ping", 4, serde_json::json!({"ok": true})),
    );
    assert!(next.ok, "{:?}", next.error);
}

/// A frame that names an agent and carries a signature of another key is refused before
/// it spends a rate slot, so the named agent keeps its whole minute.
#[test]
fn frame_with_a_bad_signature_spends_no_rate_slot_of_the_agent_it_names() {
    let (_dir, rt) = crv20_runtime("");
    install_agent_manifest(&rt, "AG-VICTIM", "sess-1");
    let body = crv20_event("root:ping", 1, serde_json::json!({"ok": true}));
    let forger = {
        let mut keys = rt.keys.agent_sign_keys.lock().expect("keys");
        keys.provision("AG-VICTIM").expect("victim key");
        keys.provision("AG-FORGER").expect("forger key")
    };
    let frame = build_frame_for_dock(
        "ch-crv20",
        "AG-VICTIM",
        "sess-1",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        &body,
        rt.dock_kem_public(),
        &forger,
        crate::now_unix(),
    )
    .expect("forged frame");
    let forged = serde_json::json!({ "frame": frame }).to_string();
    for _ in 0..(SIGNER_RATE_LIMIT + 5) {
        let resp = process_request(&rt, &DockingPort::ValidationEngine, &forged);
        assert!(!resp.ok);
    }
    let own = crv20_send(&rt, "AG-VICTIM", &body);
    assert!(
        own.ok,
        "frames with a bad signature spent the rate slots of the agent they name: {:?}",
        own.error
    );
}

fn side_channel_rows(rt: &DockingRuntime) -> usize {
    let db = rt.record.db.lock().expect("db");
    crate::export_dynaep_events(&db, Some(100_000))
        .expect("export")
        .into_iter()
        .filter(|e| e.event_type == crate::SIDE_CHANNEL_EVENT_TYPE)
        .count()
}

/// A peer that sends unreadable lines writes a bounded number of anomaly rows before the
/// dock closes its connection.
#[tokio::test]
async fn one_connection_writes_a_bounded_number_of_anomaly_rows() {
    let (_dir, rt) = temp_runtime();
    let shared = Arc::new(rt);
    let (client, server_end) = UnixStream::pair().expect("pair");
    let (r, w) = server_end.into_split();
    let task = tokio::spawn(serve_connection(
        shared.clone(),
        DockingPort::ValidationEngine,
        r,
        w,
    ));
    let (cr, mut cw) = client.into_split();
    for _ in 0..200 {
        if cw.write_all(b"not json\n").await.is_err() {
            break;
        }
    }
    let _ = cw.shutdown().await;
    let mut lines = BufReader::new(cr).lines();
    let mut answers = 0usize;
    while let Ok(Ok(Some(_))) =
        tokio::time::timeout(std::time::Duration::from_secs(5), lines.next_line()).await
    {
        answers += 1;
    }
    let _ = task.await;
    let rows = side_channel_rows(&shared);
    assert!(
        rows <= super::serve::MAX_REFUSALS_PER_CONNECTION,
        "one connection wrote {rows} anomaly rows"
    );
    assert!(
        answers <= super::serve::MAX_REFUSALS_PER_CONNECTION,
        "the dock answered {answers} unreadable lines"
    );
    assert!(rows > 0, "the refusals wrote no anomaly row");
}

/// A connection that completes no line within the idle timeout is closed by the dock, so
/// a silent peer cannot hold a connection slot for the life of the daemon.
#[tokio::test]
async fn idle_connection_is_closed_after_the_idle_timeout() {
    let (_dir, mut rt) = temp_runtime();
    rt.io.idle_timeout = std::time::Duration::from_millis(300);
    let shared = Arc::new(rt);
    let (client, server_end) = UnixStream::pair().expect("pair");
    let (r, w) = server_end.into_split();
    let task = tokio::spawn(serve_connection(
        shared.clone(),
        DockingPort::ValidationEngine,
        r,
        w,
    ));
    let (cr, mut cw) = client.into_split();
    // A partial line: bytes arrive and no line completes.
    cw.write_all(b"{\"collect\":").await.expect("partial line");
    let ended = tokio::time::timeout(std::time::Duration::from_secs(3), task).await;
    assert!(ended.is_ok(), "the dock kept an idle connection open");
    let mut lines = BufReader::new(cr).lines();
    assert!(matches!(lines.next_line().await, Ok(None)));
}

fn crv20_port_path(base: &str, port: DockingPort) -> String {
    docking_port_specs(base)
        .into_iter()
        .find(|s| s.port == port)
        .expect("port")
        .listen_path
}

/// Connections that hold every slot of one port leave the other ports their own share.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn a_full_port_leaves_slots_for_the_other_ports() {
    let (dir, runtime) = temp_runtime();
    let base = runtime.io.socket_base.clone();
    let (shared, handles) = run_docking_servers(runtime).await.expect("serve");
    let inference = crv20_port_path(&base, DockingPort::InferenceEngine);
    let validation = crv20_port_path(&base, DockingPort::ValidationEngine);
    let mut held = Vec::new();
    for _ in 0..64 {
        held.push(UnixStream::connect(&inference).await.expect("connect"));
    }
    tokio::time::sleep(std::time::Duration::from_millis(200)).await;
    // Two connections to the validation port: the listener of a port waits for its next
    // connection with one slot in hand, so the second connection needs a slot of its own.
    let mut streams = Vec::new();
    for _ in 0..2 {
        let mut stream = UnixStream::connect(&validation).await.expect("connect");
        stream.write_all(b"not json\n").await.expect("write");
        let mut buf = String::new();
        let read = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            BufReader::new(&mut stream).read_line(&mut buf),
        )
        .await;
        assert!(
            read.is_ok(),
            "the validation port found no slot while the inference port held 64 connections"
        );
        streams.push(stream);
    }
    drop(held);
    drop(streams);
    drain_docking_servers(&shared, handles).await;
    let _ = dir;
}

/// The task list of the dock releases the handle of every ended connection.
#[tokio::test(flavor = "multi_thread", worker_threads = 2)]
async fn ended_connection_tasks_are_released() {
    let (dir, runtime) = temp_runtime();
    let base = runtime.io.socket_base.clone();
    let (shared, handles) = run_docking_servers(runtime).await.expect("serve");
    let validation = crv20_port_path(&base, DockingPort::ValidationEngine);
    for _ in 0..11 {
        let mut stream = UnixStream::connect(&validation).await.expect("connect");
        stream.write_all(b"not json\n").await.expect("write");
        let mut buf = String::new();
        BufReader::new(&mut stream)
            .read_line(&mut buf)
            .await
            .expect("answer");
        drop(stream);
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
    }
    let held = shared.io.inflight.lock().expect("inflight").len();
    assert!(held <= 2, "the dock still holds {held} connection handles");
    drain_docking_servers(&shared, handles).await;
    let _ = dir;
}
