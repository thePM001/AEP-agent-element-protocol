    use super::*;
    use super::dock_rate::SIGNER_RATE_LIMIT;
    use super::dock_serve::{bind_listener, drain_docking_servers, prepare_socket_dir, run_docking_servers, serve_connection, sockets_exist};
    use aep_base_node_pulse::{freeze_temporal_snapshot, EnqueueDeny, QueuedCapsule, MAX_AGE_MS, MAX_DRIFT_MS, PULSE_MS, QUEUE_CAP_BYTES, QUEUE_CAP_CAPSULES};
    use aep_lattice_channel::build_frame_for_dock;
    use crate::{docking_port_specs, open_lattice_db};
    use std::sync::Arc;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    use tokio::net::{UnixListener, UnixStream};


    fn build_test_frame(
        runtime: &DockingRuntime,
        channel_id: &str,
        agent_id: &str,
        session_id: &str,
        port: DockingPort,
        contract_id: &str,
        payload: &[u8],
        _seq: u64,
    ) -> (LatticeChannelFrame, String) {
        let mut keys = runtime.agent_sign_keys.lock().expect("keys lock");
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

    fn install_agent_manifest(rt: &DockingRuntime, agent_id: &str, session_id: &str) {
        use crate::task_manifest::{TaskManifestTrust, TaskManifestV1};
        let dir = {
            let m = rt.manifests.lock().expect("manifests");
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
                max_trust_score: 1000,
            },
            agentmesh: None,
            provisional: false,
            synthesized_by: "provided".into(),
            promotion_required: vec![],
        };
        let path = dir.join(format!("{agent_id}.json"));
        std::fs::write(path, serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
        rt.manifests.lock().expect("manifests").reload();
    }

    fn dock_lattice_yaml() -> &'static str {
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_may: []\n"
    }
    fn admit_ok_payload() -> &'static [u8] {
        br#"{"type":"PING","action_path":"root:ping","payload":{"ok":true},"timestamp":1000000,"target_id":"scene-a","_sequenceNumber":1}"#
    }
    fn admit_ok_payload_seq(seq: i64) -> Vec<u8> {
        format!("{{\"type\":\"PING\",\"action_path\":\"root:ping\",\"payload\":{{\"ok\":true}},\"timestamp\":1000000,\"target_id\":\"scene-a\",\"_sequenceNumber\":{seq}}}").into_bytes()
    }
    fn set_pulse_clock(rt: &DockingRuntime, ms: i64) {
        rt.pulse.lock().expect("pulse").clock_ms = Some(ms);
    }
    fn through_pulse(rt: &DockingRuntime, port: &DockingPort, line: &str) -> DockFrameResponse {
        set_pulse_clock(rt, 1_000_000);
        let enq = process_request(rt, port, line);
        if enq.ok == false {
            return enq;
        }
        let digest = enq.digest.clone().unwrap_or_default();
        set_pulse_clock(rt, 1_000_000 + PULSE_MS);
        let _ = pulse_beat(rt);
        let collect = format!("{{\"collect\":\"{digest}\"}}");
        process_request(rt, port, &collect)
    }
    fn plant_lattice(dir: &std::path::Path) {
        std::fs::write(dir.join("lattice.yaml"), dock_lattice_yaml()).expect("lattice");
    }
    fn temp_runtime() -> (tempfile::TempDir, DockingRuntime) {
        let dir = tempfile::tempdir().expect("tempdir");
        plant_lattice(dir.path());
        runtime_in(dir)
    }
    fn runtime_in(dir: tempfile::TempDir) -> (tempfile::TempDir, DockingRuntime) {
        // Identity gate is always strict: tests install real manifests (TASK-A28-H01).
        let db_path = dir.path().join("dock.db");
        let conn = open_lattice_db(&db_path).expect("db");
        let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
        let rt = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path());
        (dir, rt)
    }
    fn temp_runtime_missing_lattice() -> (tempfile::TempDir, DockingRuntime) {
        let dir = tempfile::tempdir().expect("tempdir");
        runtime_in(dir)
    }
    fn temp_runtime_unreadable_lattice() -> (tempfile::TempDir, DockingRuntime) {
        let dir = tempfile::tempdir().expect("tempdir");
        std::fs::write(dir.path().join("lattice.yaml"), "{{ not a lattice").expect("bad yaml");
        runtime_in(dir)
    }
    fn opened_frame_is_admit_deny(rt: &DockingRuntime, agent_id: &str, payload: &[u8]) {
        install_agent_manifest(rt, agent_id, "sess-1");
        let (_frame, line) = build_test_frame(
            rt,
            "ch-env034",
            agent_id,
            "sess-1",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            payload,
            1,
        );
        let resp = through_pulse(rt, &DockingPort::ValidationEngine, &line);
        assert_eq!(resp.ok, false);
        let err = resp.error.unwrap_or_default();
        assert!(
            err.contains("Admit collect-all walls then Apply") || err.contains("Lattice required"),
            "expected Admit Deny, got {err}"
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
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap().contains("Admit collect-all walls then Apply"));
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
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap().contains("Admit collect-all walls then Apply"));
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
        assert_eq!(resp.ok, false);
        let deny = resp.deny.expect("deny report");
        assert!(deny.closed.iter().any(|w| w.id == "action.path"));
        assert_eq!(deny.reseal_required, true);
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

        let db = rt.db.lock().expect("db lock");
        let exported = crate::export_dynaep_events(&db, Some(1)).expect("export");
        assert_eq!(exported.len(), 1);
        assert_eq!(exported[0].agentmesh["agent_id"], "AG-MESH");
        assert!(exported[0].agentmesh["spiffe"]["spiffe_id"].as_str().is_some());
    }

    #[test]
    fn rate_limit_records_side_channel_anomaly() {
        let (_dir, rt) = temp_runtime();
        install_agent_manifest(&rt, "AG-BURST", "sess-1");
        let sign = rt
            .agent_sign_keys
            .lock()
            .expect("keys")
            .provision("AG-BURST").expect("burst key");
        let rate_key = signer_rate_key(&sign.public);
        {
            let mut limiter = rt.rate_limiter.lock().expect("lock");
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

        let db = rt.db.lock().expect("db lock");
        let exported = crate::export_dynaep_events(&db, Some(10)).expect("export");
        assert!(exported.iter().any(|e| e.event_type == crate::SIDE_CHANNEL_EVENT_TYPE));
    }

    #[test]
    fn regulation_frame_registers_contract_for_validation_frames() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("dock.db");
        let conn = open_lattice_db(&db_path).expect("db");
        let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
        plant_lattice(dir.path());
        let rt = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &["runtime-lrp".to_string()],
            dir.path(),
        );
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
        assert!(resp1.ok, "{:?}", resp1.error);
        let fp1 = rt
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
        assert!(resp2.ok, "{:?}", resp2.error);
        let fp2 = rt
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
        assert!(resp.ok, "{:?}", resp.error);
        let score = *rt
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
        assert!(resp1.ok, "{:?}", resp1.error);
        let resp2 = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(!resp2.ok);
        assert!(resp2.error.clone().unwrap().contains("replay"));
        let deny = resp2.deny.expect("deny report");
        assert!(deny.closed.iter().any(|w| w.class == "security" && w.id == "digest.replay"));
    }

    #[tokio::test]
    async fn socket_roundtrip() {
        let (dir, runtime) = temp_runtime();
        install_agent_manifest(&runtime, "AG-SOCK", "sess-sock");
        let sock_base = runtime.socket_base.clone();
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
        stream.write_all(format!("{wire}\n").as_bytes()).await.unwrap();
        let mut buf = String::new();
        BufReader::new(&mut stream)
            .read_line(&mut buf)
            .await
            .unwrap();
        let resp: DockFrameResponse = serde_json::from_str(buf.trim()).unwrap();
        assert!(resp.ok, "{:?}", resp.error);
        assert!(resp.digest.is_some());
        let _ = dir;
    }

    #[tokio::test]
    async fn socket_collect_returns_event_id_after_beat() {
        let (dir, runtime) = temp_runtime();
        install_agent_manifest(&runtime, "AG-SOCKC", "sess-sockc");
        set_pulse_clock(&runtime, 1_000_000);
        let sock_base = runtime.socket_base.clone();
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
        stream.write_all(format!("{wire}\n").as_bytes()).await.unwrap();
        let mut buf = String::new();
        {
            let mut reader = BufReader::new(&mut stream);
            reader.read_line(&mut buf).await.unwrap();
        }
        let enq: DockFrameResponse = serde_json::from_str(buf.trim()).unwrap();
        assert!(enq.ok, "{:?}", enq.error);
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
        let mut keys = runtime.agent_sign_keys.lock().expect("keys lock");
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
        assert!(!resp.ok, "unbound/mismatched wire key must fail: {:?}", resp);
        let err = resp.error.unwrap_or_default().to_lowercase();
        assert!(
            err.contains("signer public key unknown")
                || err.contains("unknown")
                || err.contains("signer"),
            "expected signer bind failure, got: {err}"
        );
        // Sanity: legitimate bound wire key still works.
        let ok_resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(ok_resp.ok, "bound key path must succeed: {:?}", ok_resp.error);
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
        let rt = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &["allowed-lrp".to_string()],
            dir.path(),
        );
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
            err.contains("not allowlisted") || err.contains("allowlist"),
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
        let (_dir, rt) = temp_runtime_missing_lattice();
        opened_frame_is_admit_deny(
            &rt,
            "AG-ENV034-MISS",
            br#"{"type":"STATE_DELTA"}"#,
        );
    }

    #[test]
    fn missing_lattice_opened_ping_is_admit_deny() {
        let (_dir, rt) = temp_runtime_missing_lattice();
        opened_frame_is_admit_deny(&rt, "AG-ENV034-PING", br#"{"type":"PING"}"#);
    }

    #[test]
    fn unreadable_lattice_opened_frame_is_admit_deny() {
        let (_dir, rt) = temp_runtime_unreadable_lattice();
        opened_frame_is_admit_deny(
            &rt,
            "AG-ENV034-BAD",
            br#"{"type":"PING","action_path":"root:ping","payload":{"ok":true}}"#,
        );
    }

    fn poison_std_mutex<T>(m: &std::sync::Mutex<T>) {
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _g = m.lock().expect("poison setup");
            panic!("poison dock mutex");
        }));
    }

    fn poisoned_ok_false_on_frame(rt: &DockingRuntime, agent_id: &str, mutex_name: &str, poison: impl FnOnce(&DockingRuntime)) {
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
        assert_eq!(resp.ok, false);
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
            let _g = rt.db.lock().expect("db");
            panic!("poison dock db");
        }));
        let resp = process_request(&rt, &DockingPort::ValidationEngine, r#"{"ping":true}"#);
        assert_eq!(resp.ok, false);
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
            poison_std_mutex(&rt.agent_sign_keys);
        });
    }

    #[test]
    fn poisoned_fleet_rate_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-RATE", "fleet_rate", |rt| {
            poison_std_mutex(&rt.global_rate_limiter);
        });
    }

    #[test]
    fn poisoned_live_entry_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-LIVE", "live_entry", |rt| {
            poison_std_mutex(&rt.live_entry);
        });
    }

    #[test]
    fn poisoned_manifests_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-MAN", "manifests", |rt| {
            poison_std_mutex(&rt.manifests);
        });
    }

    #[test]
    fn poisoned_rate_limiter_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-RL", "rate_limiter", |rt| {
            poison_std_mutex(&rt.rate_limiter);
        });
    }

    #[test]
    fn poisoned_contracts_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-CON", "contracts", |rt| {
            poison_std_mutex(&rt.contracts);
        });
    }

    #[test]
    fn poisoned_replay_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-REPLAY", "replay", |rt| {
            poison_std_mutex(&rt.replay_guard);
        });
    }

    #[test]
    fn poisoned_agent_trust_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-TRUST", "agent_trust", |rt| {
            poison_std_mutex(&rt.agent_trust);
        });
    }

    #[test]
    fn poisoned_agent_bundles_lock_returns_ok_false_without_abort() {
        let (_dir, rt) = temp_runtime();
        poisoned_ok_false_on_frame(&rt, "AG-POISON-BUN", "agent_bundles", |rt| {
            poison_std_mutex(&rt.agent_bundles);
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
        assert!(enq.ok, "{:?}", enq.error);
        assert!(enq.digest.is_some());
        assert!(enq.event_id.is_none());
        set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
        let _ = pulse_beat(&rt);
        let digest = enq.digest.clone().unwrap();
        let applied = rt.pulse.lock().expect("pulse").last_applied.get(&digest).cloned().expect("applied");
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
        assert!(enq.ok, "{:?}", enq.error);
        assert!(enq.event_id.is_none());
        let digest = enq.digest.clone().unwrap();
        let pending = process_request(
            &rt,
            &DockingPort::ValidationEngine,
            &format!("{{\"collect\":\"{digest}\"}}"),
        );
        assert!(pending.ok);
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
        assert!(enq.ok, "{:?}", enq.error);
        assert!(enq.event_id.is_none());
        let digest = enq.digest.clone().unwrap();
        set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
        let _ = pulse_beat(&rt);
        let applied = process_request(
            &rt,
            &DockingPort::ValidationEngine,
            &format!("{{\"collect\":\"{digest}\"}}"),
        );
        assert_eq!(applied.ok, false);
        let deny = applied.deny.expect("deny report");
        assert_eq!(deny.closed.is_empty(), false);
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
        assert_eq!(applied.ok, false);
        assert!(applied.error.unwrap_or_default().contains("unknown digest"));
        assert!(applied.deny.is_some());
    }

    fn must_drift_not_pulse() {
        assert_ne!(MAX_DRIFT_MS, PULSE_MS);
        assert_eq!(MAX_DRIFT_MS, 50);
        assert_eq!(PULSE_MS, 1000);
        assert_eq!(MAX_AGE_MS, 5000);
        let src = include_str!("docking.rs");
        let compact: String = src.chars().filter(|c| c.is_whitespace() == false).collect();
        let n1 = ["max_drift_ms=", "1000"].concat();
        let n2 = ["max_drift_ms:", "1000"].concat();
        assert_eq!(compact.contains(&n1), false);
        assert_eq!(compact.contains(&n2), false);
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
        assert!(enq.ok, "{:?}", enq.error);
        set_pulse_clock(&rt, 1_001_000);
        let _ = pulse_beat(&rt);
        let digest = enq.digest.clone().unwrap();
        let applied = rt.pulse.lock().expect("pulse").last_applied.get(&digest).cloned().expect("applied");
        assert!(applied.ok, "held 1000 ms must still meet 50 ms drift against freeze: {:?}", applied.error);
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
        assert!(enq.ok, "{:?}", enq.error);
        set_pulse_clock(&rt, 1_000_000 + MAX_AGE_MS + 1);
        let rel = pulse_beat(&rt);
        assert_eq!(rel.aged.len(), 1);
        let digest = enq.digest.clone().unwrap();
        let applied = rt.pulse.lock().expect("pulse").last_applied.get(&digest).cloned().expect("aged");
        assert_eq!(applied.ok, false);
        assert!(applied.error.unwrap_or_default().contains("aged"));
        let db = rt.db.lock().expect("db");
        let exported = crate::export_dynaep_events(&db, Some(10)).expect("export");
        assert_eq!(exported.iter().any(|e| e.event_type.starts_with("docking_")), false);
    }

    #[test]
    fn pulse_overflow_capsules_is_deny() {
        let (_dir, rt) = temp_runtime();
        {
            let mut pulse = rt.pulse.lock().expect("pulse");
            for i in 0..QUEUE_CAP_CAPSULES {
                pulse.queue.enqueue(QueuedCapsule {
                    digest: format!("pre-{i}"),
                    agent_id: String::from("ag"),
                    sequence_number: i as i64 + 1,
                    byte_len: 1,
                    freeze: freeze_temporal_snapshot(1_000_000, 0),
                }).expect("prefill");
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
        assert_eq!(resp.ok, false);
        assert_eq!(resp.error.as_deref(), Some(EnqueueDeny::OverflowCapsules.as_str()));
    }

    #[test]
    fn pulse_overflow_bytes_is_deny() {
        let (_dir, rt) = temp_runtime();
        {
            let mut pulse = rt.pulse.lock().expect("pulse");
            pulse.queue.enqueue(QueuedCapsule {
                digest: String::from("big"),
                agent_id: String::from("ag"),
                sequence_number: 1,
                byte_len: QUEUE_CAP_BYTES,
                freeze: freeze_temporal_snapshot(1_000_000, 0),
            }).expect("prefill");
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
        assert_eq!(resp.ok, false);
        assert_eq!(resp.error.as_deref(), Some(EnqueueDeny::OverflowBytes.as_str()));
    }

    #[test]
    fn pulse_same_agent_sequence_order() {
        let (_dir, rt) = temp_runtime();
        install_agent_manifest(&rt, "AG-SEQ", "sess-1");
        set_pulse_clock(&rt, 1_000_000);
        let body2 = admit_ok_payload_seq(2);
        let body1 = admit_ok_payload_seq(1);
        let (_f2, line2) = build_test_frame(
            &rt, "ch-seq", "AG-SEQ", "sess-1", DockingPort::ValidationEngine,
            "dynaep-action-lattice", &body2, 1,
        );
        let (_f1, line1) = build_test_frame(
            &rt, "ch-seq", "AG-SEQ", "sess-1", DockingPort::ValidationEngine,
            "dynaep-action-lattice", &body1, 2,
        );
        let e2 = process_request(&rt, &DockingPort::ValidationEngine, &line2);
        let e1 = process_request(&rt, &DockingPort::ValidationEngine, &line1);
        assert!(e2.ok && e1.ok, "{:?} {:?}", e2.error, e1.error);
        set_pulse_clock(&rt, 1_001_000);
        let rel = pulse_beat(&rt);
        let seqs: Vec<i64> = rel.ready.iter().map(|c| c.sequence_number).collect();
        assert_eq!(seqs, vec![1, 2]);
        let d1 = e1.digest.unwrap();
        let d2 = e2.digest.unwrap();
        let a1 = rt.pulse.lock().expect("pulse").last_applied.get(&d1).cloned().unwrap();
        let a2 = rt.pulse.lock().expect("pulse").last_applied.get(&d2).cloned().unwrap();
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
        assert!(r1.ok, "{:?}", r1.error);
        let r2 = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert_eq!(r2.ok, false);
        assert!(r2.error.unwrap_or_default().contains("replay"));
    }

    #[tokio::test]
    async fn stop_drains_dock_tasks_unlinks_sockets_and_closes_sqlite() {
        let (dir, runtime) = temp_runtime();
        let sock_base = runtime.socket_base.clone();
        let (shared, handles) = run_docking_servers(runtime).await.expect("bind docks");
        assert!(sockets_exist(&sock_base), "sockets should exist after bind");
        assert_eq!(shared.sqlite_is_closed(), false);
        drain_docking_servers(&shared, handles).await;
        assert_eq!(shared.is_stopping(), true);
        assert_eq!(sockets_exist(&sock_base), false);
        assert_eq!(shared.sqlite_is_closed(), true);
        let _ = dir;
    }
