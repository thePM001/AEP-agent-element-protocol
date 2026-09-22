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
        "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    agent_permission: [\"*\", \"AG-DOCK\", \"AG-MESH\", \"AG-PULSE\", \"AG-COL\", \"AG-LRP\", \"AG-SEQ\", \"AG-SOCKC\", \"AG-DRIFT\", \"AG-BOUND\", \"dynaep-bridge\"]\n"
    }
    fn hub_gap_text() -> &'static str {
        "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: AG-DOCK\n      action: root:ping\n    - agent_id: AG-MESH\n      action: root:ping\n    - agent_id: AG-LRP\n      action: root:ping\n    - agent_id: AG-PULSE\n      action: root:ping\n    - agent_id: AG-COL\n      action: root:ping\n    - agent_id: AG-SEQ\n      action: root:ping\n    - agent_id: AG-SOCKC\n      action: root:ping\n    - agent_id: AG-DRIFT\n      action: root:ping\n    - agent_id: AG-BOUND\n      action: root:ping\n    - agent_id: AG-PING\n      action: root:ping\n    - agent_id: AG-NJ\n      action: root:ping\n    - agent_id: AG-BURST\n      action: root:ping\n    - agent_id: AG-FUT\n      action: root:ping\n    - agent_id: AG-SESSMIS\n      action: root:ping\n    - agent_id: AG-LRP-DENY\n      action: root:ping\n    - agent_id: AG-PING-R\n      action: root:ping\n    - agent_id: AG-TRUST\n      action: root:ping\n    - agent_id: AG-WIRE\n      action: root:ping\n    - agent_id: AG-REPLAY\n      action: root:ping\n    - agent_id: AG-SOCK\n      action: root:ping\n    - agent_id: AG-BADSIG\n      action: root:ping\n    - agent_id: AG-STALE\n      action: root:ping\n    - agent_id: AG-AGE\n      action: root:ping\n    - agent_id: AG-OVF\n      action: root:ping\n    - agent_id: AG-OVB\n      action: root:ping\n    - agent_id: AG-DUP\n      action: root:ping\n    - agent_id: AG-COLD\n      action: root:ping\n    - agent_id: AG-HELD\n      action: root:ping\n    - agent_id: AG-HELDD\n      action: root:ping\n    - agent_id: AG-POISON-KEYS\n      action: root:ping\n    - agent_id: AG-POISON-RATE\n      action: root:ping\n    - agent_id: AG-POISON-LIVE\n      action: root:ping\n    - agent_id: AG-POISON-MAN\n      action: root:ping\n    - agent_id: AG-POISON-RL\n      action: root:ping\n    - agent_id: AG-POISON-CON\n      action: root:ping\n    - agent_id: AG-POISON-REPLAY\n      action: root:ping\n    - agent_id: AG-POISON-TRUST\n      action: root:ping\n    - agent_id: AG-POISON-BUN\n      action: root:ping\n    - agent_id: AG-ENV034-MISS\n      action: root:ping\n    - agent_id: AG-ENV034-PING\n      action: root:ping\n    - agent_id: AG-ENV034-BAD\n      action: root:ping\n    - agent_id: agent-a\n      action: root:ping\n    - agent_id: agent-a\n      action: display-api:source:ingest\n    - agent_id: agent-a\n      action: display-api:view:project\n    - agent_id: agent-a\n      action: display-api:sector:stage\n    - agent_id: agent-a\n      action: display-api:view:request\n"
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
    fn plant_lattice(dir: &std::path::Path) {
        std::fs::write(dir.join("lattice.yaml"), dock_lattice_yaml()).expect("lattice");
    }
    fn plant_hub_gap(dir: &std::path::Path) {
        std::fs::create_dir_all(dir.join("gap").join("policies").join("reference")).expect("hub dir");
        let extra = "    - agent_id: agent-a\n      action: display-api:catalog:list\n    - agent_id: display-client\n      action: root:ping\n    - agent_id: display-client\n      action: display-api:attach\n    - agent_id: display-client\n      action: display-api:source:ingest\n    - agent_id: display-client\n      action: display-api:view:project\n    - agent_id: display-client\n      action: display-api:sector:stage\n    - agent_id: display-client\n      action: display-api:view:request\n    - agent_id: display-client\n      action: display-api:catalog:list\n";
        std::fs::write(dir.join("gap").join("policies").join("reference").join("caw-test.gap"), format!("{}{}", hub_gap_text(), extra)).expect("hub");
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
        plant_hub_gap(dir.path());
        if dir.path().join("display-grants.gap").is_file()==false {
            drop(std::fs::write(dir.path().join("display-grants.gap"), "grants:"))
        }
        let rt = DockingRuntime::with_data_dir(sock_base, conn, &[], dir.path()).expect("runtime");
        (dir, rt)
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
        plant_hub_gap(dir.path());
        if dir.path().join("display-grants.gap").is_file()==false {
            drop(std::fs::write(dir.path().join("display-grants.gap"), "grants:"))
        }
        let rt = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &["runtime-lrp".to_string()],
            dir.path()).expect("runtime")
         ;
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
        assert_eq!(resp1.ok, false);
        assert_eq!(resp1.pending, Some(true));
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
        assert_eq!(resp2.ok, false);
        assert_eq!(resp2.pending, Some(true));
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
        assert_eq!(resp.ok, false);
        assert_eq!(resp.pending, Some(true));
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
        assert_eq!(resp1.ok, false);
        assert_eq!(resp1.pending, Some(true));
        let resp2 = process_request(&rt, &DockingPort::ValidationEngine, &line);
        assert!(!resp2.ok);
        assert!(resp2.error.clone().unwrap().contains("replay"));
        let deny = resp2.deny.expect("deny report");
        assert!(deny.closed.iter().any(|w| w.class == "frame.replay" && w.id == "digest.replay"));
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
        assert_eq!(resp.ok, false);
        assert_eq!(resp.pending, Some(true));
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
        assert_eq!(enq.ok, false);
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
        assert_eq!(ok_resp.ok, false);
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
        if dir.path().join("display-grants.gap").is_file()==false {
            drop(std::fs::write(dir.path().join("display-grants.gap"), "grants:"))
        }
        let rt = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &["allowed-lrp".to_string()],
            dir.path()).expect("runtime")
         ;
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
        let loaded = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &[],
            dir.path())
         ;
        assert_eq!(loaded.is_err(), true);
    }

    #[test]
    fn missing_lattice_opened_ping_is_admit_deny() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("dock.db");
        let conn = open_lattice_db(&db_path).expect("db");
        let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
        plant_hub_gap(dir.path());
        let loaded = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &[],
            dir.path())
         ;
        assert_eq!(loaded.is_err(), true);
    }

    #[test]
    fn unreadable_lattice_opened_frame_is_admit_deny() {
        let dir = tempfile::tempdir().expect("tempdir");
        let db_path = dir.path().join("dock.db");
        let conn = open_lattice_db(&db_path).expect("db");
        let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
        plant_hub_gap(dir.path());
        std::fs::write(dir.path().join("lattice.yaml"), "{{ not a lattice").expect("bad yaml");
        let loaded = DockingRuntime::with_data_dir(
            sock_base,
            conn,
            &[],
            dir.path())
         ;
        assert_eq!(loaded.is_err(), true);
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
        assert_eq!(enq.ok, false);
        assert_eq!(enq.pending, Some(true));
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
        assert_eq!(enq.ok, false);
        assert_eq!(enq.pending, Some(true));
        assert!(enq.event_id.is_none());
        let digest = enq.digest.clone().unwrap();
        let pending = process_request(
            &rt,
            &DockingPort::ValidationEngine,
            &format!("{{\"collect\":\"{digest}\"}}"),
        );
        assert_eq!(pending.ok, false);
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
        assert_eq!(enq.ok, false);
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
        assert_eq!(enq.ok, false);
        assert_eq!(enq.pending, Some(true));
        assert!(enq.event_id.is_none());
        let digest = enq.digest.clone().unwrap();
        let held = process_request(
            &rt,
            &DockingPort::ValidationEngine,
            &format!("{{\"collect\":\"{digest}\"}}"),
        );
        assert_eq!(held.ok, false);
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
            assert_eq!(deny.closed.is_empty(), false);
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
        assert_eq!(enq.ok, false);
        assert_eq!(enq.pending, Some(true));
        let digest = enq.digest.clone().unwrap();
        let held = process_request(
            &rt,
            &DockingPort::ValidationEngine,
            &format!("{{\"collect\":\"{digest}\"}}"),
        );
        assert_eq!(held.ok, false);
        assert_eq!(held.pending, Some(true));
        assert!(held.event_id.is_none());
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
        assert_eq!(applied.pending, None);
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
        assert_eq!(enq.ok, false);
        assert_eq!(enq.pending, Some(true));
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
        assert_eq!(enq.ok, false);
        assert_eq!(enq.pending, Some(true));
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
        assert_eq!(e2.ok, false);
        assert_eq!(e1.ok, false);
        assert_eq!(e2.pending, Some(true));
        assert_eq!(e1.pending, Some(true));
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
        assert_eq!(r1.ok, false);
        assert_eq!(r1.pending, Some(true));
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
    fn plant_display_lattice(dir: &std::path::Path) {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../AEP-Components/display-api");
        std::fs::copy(root.join("lattice.yaml"), dir.join("lattice.yaml")).expect("display lattice");
        std::fs::copy(root.join("display-grants.gap"), dir.join("display-grants.gap")).expect("display grants");
        std::fs::copy(root.join("source.alpha.json"), dir.join("source.alpha.json")).expect("source alpha");
        std::fs::copy(root.join("source.beta.json"), dir.join("source.beta.json")).expect("source beta");
    }
    fn seed_display_parents(rt: &DockingRuntime) {
        let mut live = rt.live_entry.lock().expect("live");
        live.snapshot.satisfied_actions.insert(String::from("root:ping"));
        live.snapshot.satisfied_actions.insert(String::from("agt|agent-a|root:ping"));
        live.snapshot.satisfied_actions.insert(String::from("agt|agent-a|display-api:attach"));
        live.snapshot.satisfied_actions.insert(String::from("agt|agent-a|display-api:source:ingest"));
        live.snapshot.satisfied_actions.insert(String::from("agt|agent-a|display-api:sector:stage"));
        live.snapshot.satisfied_actions.insert(String::from("agt|agent-a|display-api:view:request"));
        live.snapshot.satisfied_actions.insert(String::from("agt|agent-a|display-api:catalog:list"));
        live.snapshot.satisfied_actions.insert(String::from("agt|display-client|root:ping"));
        live.snapshot.satisfied_actions.insert(String::from("agt|display-client|display-api:attach"));
        live.snapshot.satisfied_actions.insert(String::from("agt|display-client|display-api:source:ingest"));
        live.snapshot.satisfied_actions.insert(String::from("agt|display-client|display-api:sector:stage"));
        live.snapshot.satisfied_actions.insert(String::from("agt|display-client|display-api:view:request"));
        live.snapshot.satisfied_actions.insert(String::from("agt|display-client|display-api:catalog:list"));
    }
    fn temp_display_runtime() -> (tempfile::TempDir, DockingRuntime) {
        let dir = tempfile::tempdir().expect("tempdir");
        plant_display_lattice(dir.path());
        let (dir, rt) = runtime_in(dir);
        {
            let mut contracts = rt.contracts.lock().expect("contracts");
            contracts.register("aep-display-api");
        }
        seed_display_parents(&rt);
        (dir, rt)
    }
    fn display_payload(action: &str, view: &str, source: &str, sector: &str, payload: &str, seq: i64) -> Vec<u8> {
        format!("{{\"kind\":\"display\",\"type\":\"PING\",\"agent_id\":\"agent-a\",\"action_path\":\"{action}\",\"view\":\"{view}\",\"source\":\"{source}\",\"sector\":\"{sector}\",\"payload\":{payload},\"timestamp\":1000000,\"target_id\":\"scene-a\",\"_sequenceNumber\":{seq}}}").into_bytes()
    }
    fn grant_alpha(rt: &DockingRuntime) {
        let mut d = rt.display.lock().expect("display");
        d.add_grant("agent-a", "source.alpha", "sector.one");
        d.add_grant("agent-a", "source.alpha", "sector.two");
    }
    fn display_line(rt: &DockingRuntime, payload: &[u8]) -> String {
        install_agent_manifest(rt, "agent-a", "sess-1");
        let (_f, line) = build_test_frame(rt, "ch-disp", "agent-a", "sess-1", DockingPort::DisplayApi, "aep-display-api", payload, 1);
        line
    }
    #[test]
    fn unknown_view_denies_on_miss() {
        let (_dir, rt) = temp_display_runtime();
        let line = display_line(&rt, &display_payload("display-api:view:project", "view.unknown", "source.alpha", "sector.one", "{}", 1));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &line);
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("unknown view DENY on miss"));
    }
    #[test]
    fn unknown_source_denies_on_miss() {
        let (_dir, rt) = temp_display_runtime();
        let line = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.unknown", "sector.one", "{}", 1));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &line);
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("unknown source DENY on miss"));
    }
    #[test]
    fn unknown_sector_denies_on_miss() {
        let (_dir, rt) = temp_display_runtime();
        let line = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.unknown", "{}", 1));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &line);
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("unknown sector DENY on miss"));
    }
    fn temp_display_runtime_empty_grants() -> (tempfile::TempDir, DockingRuntime) {
        let dir = tempfile::tempdir().expect("tempdir");
        plant_display_lattice(dir.path());
        std::fs::write(dir.path().join("display-grants.gap"), "grants:").expect("empty grants");
        let (dir, rt) = runtime_in(dir);
        {
            let mut contracts = rt.contracts.lock().expect("contracts");
            contracts.register("aep-display-api");
        }
        seed_display_parents(&rt);
        (dir, rt)
    }
    #[test]
    fn empty_grant_list_refuses() {
        let (_dir, rt) = temp_display_runtime_empty_grants();
        let line = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{}", 1));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &line);
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("empty grant list refuses"));
    }
    #[test]
    fn display_json_roundtrip_returns_projection_after_admit() {
        let (_dir, rt) = temp_display_runtime();
        let ingest = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"n\":1}", 1));
        let ing = through_pulse(&rt, &DockingPort::DisplayApi, &ingest);
        assert!(ing.ok, "{:?}", ing.error);
        let proj = display_line(&rt, &display_payload("display-api:view:project", "view.alpha", "source.alpha", "sector.one", "{}", 2));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &proj);
        assert!(resp.ok, "{:?}", resp.error);
        assert_eq!(resp.projection, Some(serde_json::json!({"n":1})));
    }
    #[test]
    fn pre_staging_holds_two_sectors() {
        let (_dir, rt) = temp_display_runtime();
        let one = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"k\":1}", 1));
        assert!(through_pulse(&rt, &DockingPort::DisplayApi, &one).ok);
        let two = display_line(&rt, &display_payload("display-api:source:ingest", "view.beta", "source.alpha", "sector.two", "{\"k\":2}", 2));
        assert!(through_pulse(&rt, &DockingPort::DisplayApi, &two).ok);
        let p1 = display_line(&rt, &display_payload("display-api:view:project", "view.alpha", "source.alpha", "sector.one", "{}", 3));
        let r1 = through_pulse(&rt, &DockingPort::DisplayApi, &p1);
        let p2 = display_line(&rt, &display_payload("display-api:view:project", "view.beta", "source.alpha", "sector.two", "{}", 4));
        let r2 = through_pulse(&rt, &DockingPort::DisplayApi, &p2);
        assert_eq!(r1.projection, Some(serde_json::json!({"k":1})));
        assert_eq!(r2.projection, Some(serde_json::json!({"k":2})));
    }
    #[test]
    fn json_body_without_sealed_frame_is_refused() {
        let (_dir, rt) = temp_display_runtime();
        let resp = process_request(&rt, &DockingPort::DisplayApi, "{\"kind\":\"display\"}");
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("JSON body that skips the sealed frame is refused"));
    }
    #[test]
    fn http_json_without_frame_is_refused() {
        let (_dir, rt) = temp_display_runtime();
        let raw = "POST /display HTTP/1.1\r\n\r\n{\"kind\":\"display\"}";
        let resp = process_request(&rt, &DockingPort::DisplayApi, raw);
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("JSON body that skips the sealed frame is refused"));
    }
    #[test]
    fn boot_loads_gap_grants() {
        let (_dir, rt) = temp_display_runtime();
        assert!(rt.display.lock().expect("display").grant_len() > 0);
    }
    #[test]
    fn missing_staged_json_denies_on_miss() {
        let (_dir, rt) = temp_display_runtime();
        rt.display.lock().expect("display").clear_staged();
        let line = display_line(&rt, &display_payload("display-api:view:project", "view.alpha", "source.alpha", "sector.one", "{}", 1));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &line);
        assert_eq!(resp.ok, false);
        assert!(resp.error.unwrap_or_default().contains("missing staged JSON DENY on miss"));
    }
    #[test]
    fn unknown_action_denies_on_miss() {
        let (_dir, rt) = temp_display_runtime();
        let err = rt.display.lock().expect("display").apply("agent-a", "display:view:unknown", "view.alpha", Some("source.alpha"), Some("sector.one"), None).expect_err("unknown action");
        assert!(err.contains("unknown action DENY on miss"));
    }
    #[test]
    fn persist_under_aep_data_dir() {
        let (dir, rt) = temp_display_runtime();
        let ingest = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"n\":1}", 1));
        assert!(through_pulse(&rt, &DockingPort::DisplayApi, &ingest).ok);
        let path = dir.path().join("display-staging").join("source.alpha__sector.one.json");
        assert!(path.exists());
    }
    #[test]
    fn http_json_with_sealed_frame_is_accepted() {
        let (_dir, rt) = temp_display_runtime();
        let ingest = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"n\":1}", 1));
        let raw = format!("POST /display HTTP/1.1\r\n\r\n{ingest}");
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &raw);
        assert!(resp.ok, "{:?}", resp.error);
    }

    fn display_payload_for(agent: &str, action: &str, view: &str, source: &str, sector: &str, payload: &str, seq: i64) -> Vec<u8> {
        format!("{{\"kind\":\"display\",\"type\":\"PING\",\"agent_id\":\"{agent}\",\"action_path\":\"{action}\",\"view\":\"{view}\",\"source\":\"{source}\",\"sector\":\"{sector}\",\"payload\":{payload},\"timestamp\":1000000,\"target_id\":\"scene-a\",\"_sequenceNumber\":{seq}}}").into_bytes()
    }
    fn display_line_for(rt: &DockingRuntime, agent: &str, payload: &[u8], seq: u64) -> String {
        install_agent_manifest(rt, agent, "sess-1");
        let (_f, line) = build_test_frame(rt, "ch-disp", agent, "sess-1", DockingPort::DisplayApi, "aep-display-api", payload, seq);
        line
    }
    #[test]
    fn catalog_locator_loads_two_sectors_without_client_ingest() {
        let (_dir, rt) = temp_display_runtime();
        assert_eq!(rt.display.lock().expect("display").staged_len(), 2);
        let one = display_line_for(&rt, "agent-a", &display_payload_for("agent-a", "display-api:view:project", "view.alpha", "source.alpha", "sector.one", "{}", 1), 1);
        let r1 = through_pulse(&rt, &DockingPort::DisplayApi, &one);
        assert!(r1.ok, "{:?}", r1.error);
        assert_eq!(r1.projection, Some(serde_json::json!({"label":"one"})));
        let two = display_line_for(&rt, "agent-a", &display_payload_for("agent-a", "display-api:view:project", "view.beta", "source.alpha", "sector.two", "{}", 2), 2);
        let r2 = through_pulse(&rt, &DockingPort::DisplayApi, &two);
        assert!(r2.ok, "{:?}", r2.error);
        assert_eq!(r2.projection, Some(serde_json::json!({"label":"two"})));
    }
    #[test]
    fn catalog_list_returns_granted_views() {
        let (_dir, rt) = temp_display_runtime();
        let line = display_line_for(&rt, "display-client", &display_payload_for("display-client", "display-api:catalog:list", "view.alpha", "", "", "{}", 1), 1);
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &line);
        assert!(resp.ok, "{:?}", resp.error);
        let body = resp.projection.expect("catalog body");
        let views = body.get("views").and_then(|v| v.as_array()).expect("views");
        let names: Vec<String> = views.iter().filter_map(|v| v.as_str()).map(|s| s.to_string()).collect();
        assert!(names.contains(&String::from("view.alpha")), "{:?}", names);
        assert!(names.contains(&String::from("view.beta")), "{:?}", names);
        let sources = body.get("sources").and_then(|v| v.as_array()).expect("sources");
        assert!(sources.iter().any(|v| v.as_str() == Some("source.alpha")), "{:?}", sources);
    }
    #[test]
    fn missing_locator_denies_at_boot() {
        match tempfile::tempdir() {
            Err(_) => panic!("tempdir"),
            Ok(dir) => {
                let catalog = "display_views:\n  view.alpha:\n    source: source.alpha\n    sector: sector.one\ndisplay_sources:\n  - id: source.alpha\n    locator: absent.json\n    sectors:\n      - sector.one\ndisplay_sectors:\n  - sector.one\n";
                std::fs::write(dir.path().join("lattice.yaml"), catalog).expect("lattice");
                std::fs::write(dir.path().join("display-grants.gap"), "grants:\n  - agent_id: agent-a\n    source_id: source.alpha\n    sector_id: sector.one\n").expect("grants");
                plant_hub_gap(dir.path());
                match open_lattice_db(&dir.path().join("dock.db")) {
                    Err(_) => panic!("db"),
                    Ok(conn) => match DockingRuntime::with_data_dir(dir.path().join("sockets").to_string_lossy().to_string(), conn, &[], dir.path()) {
                        Ok(_) => panic!("missing locator must DENY on miss"),
                        Err(e) => assert!(e.to_string().contains("missing locator DENY on miss")),
                    },
                }
            }
        }
    }

    #[test]
    fn boot_seeds_pre_staged_actions_for_granted_agents() {
        let dir = tempfile::tempdir().expect("tempdir");
        plant_display_lattice(dir.path());
        let staging = crate::dock_display::DisplayStaging::load(dir.path()).expect("staging");
        let mut live = crate::envelope_admit::load_live_entry(dir.path()).expect("live");
        crate::dock_display::seed_pre_staged_display_actions(&mut live, &staging);
        let keys = live.snapshot.satisfied_actions.clone();
        assert!(keys.contains("agt|display-client|display-api:attach"), "{:?}", keys);
        assert!(keys.contains("agt|display-client|display-api:source:ingest"), "{:?}", keys);
        assert!(keys.contains("agt|display-client|display-api:sector:stage"), "{:?}", keys);
        assert!(keys.contains("agt|agent-a|display-api:sector:stage"), "{:?}", keys);
        assert_eq!(keys.contains("agt|display-client|display-api:view:project"), false);
        let _ = dir;
    }
    #[test]
    fn seal_stamp_is_adopted_only_within_the_frame_second() {
        let body = br#"{"kind":"display","action_path":"display-api:catalog:list","view":"view.alpha","timestamp":1700000000500}"#;
        assert_eq!(super::dock_pulse::seal_stamp_in_second(1700000000, body), Some(1700000000500));
        let far = br#"{"kind":"display","action_path":"display-api:catalog:list","view":"view.alpha","timestamp":1600000000000}"#;
        assert_eq!(super::dock_pulse::seal_stamp_in_second(1700000000, far), None);
        let none = br#"{"kind":"display","action_path":"display-api:catalog:list","view":"view.alpha"}"#;
        assert_eq!(super::dock_pulse::seal_stamp_in_second(1700000000, none), None);
    }
    #[test]
    fn pulse_decay_rate_clears_the_second_counter() {
        let (_dir, rt) = temp_display_runtime();
        {
            let mut live = rt.live_entry.lock().expect("live");
            live.snapshot.event_rate = 12;
        }
        super::dock_pulse::pulse_decay_rate(&rt);
        assert_eq!(rt.live_entry.lock().expect("live").snapshot.event_rate, 0);
    }
    #[test]
    fn http_json_reply_is_http_json() {
        let body = "{\"ok\":true,\"projection\":{\"n\":1}}";
        let reply = crate::dock_display::http_json_reply(true, body);
        assert!(reply.starts_with("HTTP/1.1 200 OK\r\n"));
        assert!(reply.contains("Content-Type: application/json"));
        assert!(reply.ends_with(body));
        let refused = crate::dock_display::http_json_reply(false, "{\"ok\":false}");
        assert!(refused.starts_with("HTTP/1.1 403 Forbidden\r\n"));
    }
    #[test]
    fn apply_does_not_mutate_display() {
        let (dir, rt) = temp_display_runtime();
        let line = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"n\":1}", 1));
        set_pulse_clock(&rt, 1_000_000);
        let enq = process_request(&rt, &DockingPort::DisplayApi, &line);
        let digest = enq.digest.clone().expect("digest");
        let cap = {
            let pulse = rt.pulse.lock().expect("pulse");
            let held = pulse.held.get(&digest).expect("held");
            QueuedCapsule {
                digest: digest.clone(),
                agent_id: held.frame.agent_id.clone(),
                sequence_number: 1,
                byte_len: held.plaintext.len(),
                freeze: freeze_temporal_snapshot(1_000_000, 0),
            }
        };
        let before = rt.display.lock().expect("display").staged_len();
        super::dock_apply::apply_held_capsule(&rt, &cap);
        assert_eq!(rt.display.lock().expect("display").staged_len(), before);
        super::dock_apply::apply_display_after_admit(&rt, &digest);
        let path = dir.path().join("display-staging").join("source.alpha__sector.one.json");
        let text = std::fs::read_to_string(&path).expect("staged file");
        assert!(text.contains(r#""n":1"#));
    }
    #[test]
    fn request_returns_json_body() {
        let (_dir, rt) = temp_display_runtime();
        let ingest = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"n\":1}", 1));
        assert!(through_pulse(&rt, &DockingPort::DisplayApi, &ingest).ok);
        let req = display_line(&rt, &display_payload("display-api:view:request", "view.alpha", "source.alpha", "sector.one", "{}", 2));
        let resp = through_pulse(&rt, &DockingPort::DisplayApi, &req);
        assert!(resp.ok, "{:?}", resp.error);
        assert_eq!(resp.projection, Some(serde_json::json!({"n":1})));
    }
    #[test]
    fn tls_display_port_is_28429() {
        assert_eq!(super::dock_serve::tls_dock_port(DockingPort::DisplayApi), 28429);
    }
    #[test]
    fn display_client_tls_json_wire() {
        assert_eq!(super::dock_serve::tls_dock_port(DockingPort::DisplayApi), 28429);
        let (_dir, rt) = temp_display_runtime();
        let denied = process_request(&rt, &DockingPort::DisplayApi, "{\"kind\":\"display\"}");
        assert!(denied.error.unwrap_or_default().contains("JSON body that skips the sealed frame is refused"));
    }
    #[test]
    fn pulse_beat_ready_loop_does_not_apply_display() {
        let (dir, rt) = temp_display_runtime();
        let line = display_line(&rt, &display_payload("display-api:source:ingest", "view.alpha", "source.alpha", "sector.one", "{\"n\":1}", 1));
        set_pulse_clock(&rt, 1_000_000);
        let enq = process_request(&rt, &DockingPort::DisplayApi, &line);
        let digest = enq.digest.clone().expect("digest");
        set_pulse_clock(&rt, 1_000_000 + PULSE_MS);
        let _cap = {
            let pulse = rt.pulse.lock().expect("pulse");
            let held = pulse.held.get(&digest).expect("held");
            QueuedCapsule {
                digest: digest.clone(),
                agent_id: held.frame.agent_id.clone(),
                sequence_number: 1,
                byte_len: held.plaintext.len(),
                freeze: freeze_temporal_snapshot(1_000_000, 0),
            }
        };
        let before = rt.display.lock().expect("display").staged_len();
        let _ = pulse_beat(&rt);
        assert_eq!(rt.display.lock().expect("display").staged_len(), before);
        let _ = collect_applied(&rt, &digest);
        let path = dir.path().join("display-staging").join("source.alpha__sector.one.json");
        let text = std::fs::read_to_string(&path).expect("staged file");
        assert!(text.contains(r#""n":1"#));
    }
    #[test]
    fn missing_grant_file_denies_at_boot() {
        match tempfile::tempdir() {
            Ok(dir) => match (plant_lattice(dir.path()), plant_hub_gap(dir.path()), open_lattice_db(&dir.path().join("dock.db"))) {
                ((), (), Ok(conn)) => match DockingRuntime::with_data_dir(dir.path().join("sockets").to_string_lossy().to_string(), conn, &[], dir.path()) {
                    Ok(_) => panic!("missing grant must DENY on miss"),
                    Err(e) => assert!(e.to_string().contains("display grant wall missing"))
                },
                _ => panic!("db")
            },
            Err(_) => panic!("tempdir")
        }
    }
    #[test]
    fn missing_lattice_file_denies_at_runtime_boot() {
        match tempfile::tempdir() {
            Ok(dir) => match (plant_hub_gap(dir.path()), std::fs::write(dir.path().join("display-grants.gap"), "grants:"), open_lattice_db(&dir.path().join("dock.db"))) {
                ((), Ok(()), Ok(conn)) => match DockingRuntime::with_data_dir(dir.path().join("sockets").to_string_lossy().to_string(), conn, &[], dir.path()) {
                    Ok(_) => panic!("missing lattice must DENY on miss"),
                    Err(e) => assert!(e.to_string().contains("lattice yaml missing"))
                },
                _ => panic!("setup")
            },
            Err(_) => panic!("tempdir")
        }
    }
    #[tokio::test]
    async fn display_client_opens_tls_json_wire() {
        match rustls::crypto::ring::default_provider().install_default() {
            _ => match tempfile::tempdir() {
                Err(_) => panic!("tmp"),
                Ok(dir) => match aep_agentmesh::tls::ensure_mesh_ca(dir.path()) {
                    Err(_) => panic!("ca"),
                    Ok((ca_pem, ca_key)) => match aep_agentmesh::tls::ensure_dock_server_identity(dir.path()) {
                        Err(_) => panic!("server"),
                        Ok(server) => match aep_agentmesh::tls::issue_signed_identity(&ca_pem, &ca_key, "display-client") {
                            Err(_) => panic!("client"),
                            Ok(client) => match aep_agentmesh::tls::build_server_config(&ca_pem, &server.cert_pem, &server.key_pem) {
                                Err(_) => panic!("server cfg"),
                                Ok(server_cfg) => match aep_agentmesh::tls::build_client_config(&ca_pem, &client.cert_pem, &client.key_pem) {
                                    Err(_) => panic!("client cfg"),
                                    Ok(client_cfg) => match tokio::net::TcpListener::bind("127.0.0.1:0").await {
                                        Err(_) => panic!("bind"),
                                        Ok(listener) => match listener.local_addr() {
                                            Err(_) => panic!("addr"),
                                            Ok(addr) => match tokio::spawn(async move {
                                                match listener.accept().await {
                                                    Err(_) => panic!("accept"),
                                                    Ok((tcp, _)) => match tokio_rustls::TlsAcceptor::from(server_cfg).accept(tcp).await {
                                                        Err(_) => panic!("tls accept"),
                                                        Ok(mut tls) => match tokio::io::AsyncWriteExt::write_all(&mut tls, b"{\"ok\":true,\"projection\":{\"tls\":true}}\n").await {
                                                            Err(_) => panic!("server write"),
                                                            Ok(()) => true
                                                        }
                                                    }
                                                }
                                            }) {
                                                server_task => match tokio::net::TcpStream::connect(addr).await {
                                                    Err(_) => panic!("connect"),
                                                    Ok(tcp) => match rustls::pki_types::ServerName::try_from("aep-dock-server") {
                                                        Err(_) => panic!("sni"),
                                                        Ok(name) => match tokio_rustls::TlsConnector::from(client_cfg).connect(name, tcp).await {
                                                            Err(_) => panic!("tls connect"),
                                                            Ok(mut tls) => match String::from("x").repeat(512).into_bytes() {
                                                                mut buf => match tokio::io::AsyncReadExt::read(&mut tls, &mut buf).await {
                                                                    Err(_) => panic!("client read"),
                                                                    Ok(n) => match (n > 0, String::from_utf8_lossy(&buf[..n]).contains("tls"), server_task.await) {
                                                                        (true, true, Ok(_)) => assert_eq!(super::dock_serve::tls_dock_port(DockingPort::DisplayApi), 28429),
                                                                        _ => panic!("tls json roundtrip failed")
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
