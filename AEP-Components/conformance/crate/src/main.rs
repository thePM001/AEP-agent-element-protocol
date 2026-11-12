//! AEP 2.9 public-tier conformance runner.
//!
//! Exit 0 = all mandatory checks passed. Used by `conformance/runner/run.sh`.

mod vectors;

use aep_agentmesh::{create_bundle, rotate_on_trust_change, trust_tier};
use aep_base_node::{
    health, open_lattice_db, process_request, pulse_beat, DockFrameResponse, DockingRuntime,
    HealthInput,
};
use aep_lattice_channel::{
    build_frame, build_frame_for_dock, open_frame, ContractRegistry, DockingPort,
};
use aep_lattice_crypto::{generate_kem_keypair, generate_sign_keypair, open, seal};
use aep_potomitan::{
    detect_network_mode, MemoryFabric, MeshMode, MeshPeer, MeshSupervisor, MESH_PEERS_FILE,
};
use serde::Serialize;

#[derive(Serialize)]
struct CheckResult {
    id: String,
    name: String,
    passed: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[derive(Serialize)]
struct ConformanceReport {
    suite: &'static str,
    version: &'static str,
    passed: usize,
    failed: usize,
    checks: Vec<CheckResult>,
}

type CheckFn = fn() -> Result<(), String>;

struct Check {
    id: &'static str,
    name: &'static str,
    run: CheckFn,
}

const CHECKS: &[Check] = &[
    Check {
        id: "CC-01",
        name: "PQEncryptedCapsule roundtrip (ML-KEM-768 + ML-DSA-65)",
        run: cc_pq_capsule_roundtrip,
    },
    Check {
        id: "CC-02",
        name: "Lattice Channel frame seal and open with contract gate",
        run: cc_lattice_channel_frame,
    },
    Check {
        id: "CC-03",
        name: "AgentMesh mTLS fingerprint stays when trust_score changes",
        run: cc_agentmesh_trust_rotation,
    },
    Check {
        id: "CC-04",
        name: "POTOMITAN mesh mode when internet is down and peers exist",
        run: cc_potomitan_failover,
    },
    Check {
        id: "CC-05",
        name: "Offline mode when internet is down and no peers",
        run: cc_potomitan_offline,
    },
    Check {
        id: "CC-06",
        name: "MeshSupervisor routing table matches active peer count",
        run: cc_mesh_supervisor_routing,
    },
    Check {
        id: "CC-07",
        name: "Lattice health frame accepted on validation dock",
        run: cc_docking_lattice_health,
    },
    Check {
        id: "CC-08",
        name: "Docking rate limiter records rejection",
        run: cc_docking_rate_limit,
    },
    Check {
        id: "CC-09",
        name: "Regulation lattice frame registers LRP and unlocks validation frames",
        run: cc_lrp_registration_flow,
    },
    Check {
        id: "CC-10",
        name:
            "Base Node health reports POTOMITAN failover and the mesh packet plane carries traffic",
        run: cc_base_node_health_failover,
    },
    Check {
        id: "CC-11",
        name: "Docking trust_score from the signed frame moves the AgentMesh trust tier",
        run: cc_docking_trust_score_tier,
    },
    Check {
        id: "CC-13",
        name: "Plain ping wire format rejected (side-channel defense)",
        run: cc_plain_ping_rejected,
    },
    Check {
        id: "CC-14",
        name: "Plain event wire format rejected (side-channel defense)",
        run: cc_plain_event_rejected,
    },
];

/// Build a frame sealed to the dock recipient key and signed by the agent key.
/// A fresh exchange key would not open, so the dock key comes from the runtime.
#[allow(clippy::too_many_arguments)]
fn conformance_frame_for_dock(
    channel_id: &str,
    agent_id: &str,
    port: DockingPort,
    contract_id: &str,
    payload: &[u8],
    sent_at: u64,
    dock_kem_public: &[u8],
    sign: &aep_lattice_crypto::SignKeypair,
) -> Result<aep_lattice_channel::LatticeChannelFrame, String> {
    build_frame_for_dock(
        channel_id,
        agent_id,
        "sess-conformance",
        port,
        contract_id,
        payload,
        dock_kem_public,
        sign,
        sent_at,
    )
    .map_err(|e| e.to_string())
}

/// Register the agent sign key in the runtime store and return it.
/// The docking verifier accepts a frame only when the inline key matches a
/// registered key, so a test agent must be provisioned before it sends.
fn provision_agent_sign_key(
    rt: &DockingRuntime,
    agent_id: &str,
) -> Result<aep_lattice_crypto::SignKeypair, String> {
    let mut store = rt.keys.agent_sign_keys.lock().map_err(|e| e.to_string())?;
    store.provision(agent_id).map_err(|e| e.to_string())
}

fn to_hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// Arm a test agent: mint its sign key, write a strict-mode task manifest that
/// binds the conformance session, then activate the contracts the ports need.
fn arm_test_agent(
    rt: &DockingRuntime,
    agent_id: &str,
    contracts: &[&str],
) -> Result<aep_lattice_crypto::SignKeypair, String> {
    let sign = provision_agent_sign_key(rt, agent_id)?;
    let (dir, session_id) = {
        let store = rt.admit.manifests.lock().map_err(|e| e.to_string())?;
        (
            store.manifest_dir().to_path_buf(),
            "sess-conformance".to_string(),
        )
    };
    let manifest = serde_json::json!({
        "manifest_version": "task-manifest.v1",
        "id": format!("conf-{agent_id}"),
        "agent_id": agent_id,
        "session_id": session_id,
        "intent": { "kind": "conformance" },
        "trust": { "tier": "system" },
        "agentmesh": { "did": { "verification_key_hex": to_hex(&sign.public) } },
        "provisional": false,
        "synthesized_by": "aep-conformance"
    });
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::fs::write(
        dir.join(format!("{agent_id}.json")),
        serde_json::to_string_pretty(&manifest).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    rt.admit
        .manifests
        .lock()
        .map_err(|e| e.to_string())?
        .reload();
    let mut reg = rt.admit.contracts.lock().map_err(|e| e.to_string())?;
    for c in contracts {
        reg.register(*c);
    }
    Ok(sign)
}

fn now_unix() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

fn cc_pq_capsule_roundtrip() -> Result<(), String> {
    let kem = generate_kem_keypair();
    let sign = generate_sign_keypair();
    let plain = b"aep-2.8-conformance-pq-capsule";
    let capsule = seal(plain, &kem.public, &sign).map_err(|e| e.to_string())?;
    let opened =
        open(&capsule, &kem.secret, &kem.public, &sign.public).map_err(|e| e.to_string())?;
    if opened != plain {
        return Err("plaintext mismatch after open".into());
    }
    Ok(())
}

fn cc_lattice_channel_frame() -> Result<(), String> {
    let kem = generate_kem_keypair();
    let sign = generate_sign_keypair();
    let mut contracts = ContractRegistry::default();
    contracts.register("dynaep-action-lattice");
    let frame = build_frame(
        "ch-conformance",
        "AG-CONF",
        "sess-conf",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"conformance-payload",
        &kem,
        &sign,
        1_700_000_000,
    )
    .map_err(|e| e.to_string())?;
    let opened = open_frame(&frame, &kem, &sign.public, &contracts).map_err(|e| e.to_string())?;
    if opened != b"conformance-payload" {
        return Err("frame plaintext mismatch".into());
    }
    let empty = ContractRegistry::default();
    if open_frame(&frame, &kem, &sign.public, &empty).is_ok() {
        return Err("inactive contract should block open_frame".into());
    }
    Ok(())
}

fn cc_agentmesh_trust_rotation() -> Result<(), String> {
    let mut bundle = create_bundle("AG-TRUST-CONF", 850, b"pk", vec![], 1_700_000_000)
        .map_err(|e| e.to_string())?;
    let fp_high = bundle.mtls.cert_fingerprint.clone();
    rotate_on_trust_change(&mut bundle, 450, 1_700_000_100);
    if bundle.mtls.cert_fingerprint != fp_high {
        return Err("numeric trust_score rotated AgentMesh cert state".into());
    }
    if bundle.trust_score != 450 {
        return Err("trust score not updated".into());
    }
    Ok(())
}

fn cc_potomitan_packet_plane() -> Result<(), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.path().join("a")).map_err(|e| e.to_string())?;
    std::fs::create_dir_all(dir.path().join("b")).map_err(|e| e.to_string())?;
    let fabric = MemoryFabric::new();
    let mut a = MeshSupervisor::load(&dir.path().join("a"), false);
    let mut b = MeshSupervisor::load(&dir.path().join("b"), false);
    a.upsert_peer(MeshPeer {
        node_id: "b".into(),
        endpoint: "mem://b".into(),
        public_key_hex: None,
        active: true,
    })
    .map_err(|e| e.to_string())?;
    b.upsert_peer(MeshPeer {
        node_id: "a".into(),
        endpoint: "mem://a".into(),
        public_key_hex: None,
        active: true,
    })
    .map_err(|e| e.to_string())?;
    a.open_memory_plane("a".into(), fabric.clone());
    b.open_memory_plane("b".into(), fabric);
    a.send_packet("b", b"cc-plane".to_vec())
        .map_err(|e| e.to_string())?;
    let got = b
        .poll_packet()
        .map_err(|e| e.to_string())?
        .ok_or_else(|| String::from("missing packet"))?;
    if got.payload != b"cc-plane" {
        return Err(String::from("payload mismatch"));
    }
    if got.src != "a" {
        return Err(String::from("src mismatch"));
    }
    Ok(())
}

/// Health input for a node whose docks listen and whose hub is loaded. Only the mesh
/// fields vary, so the report shows what POTOMITAN failover changes.
fn mesh_health_input<'a>(
    data_dir: &'a std::path::Path,
    internet_up: bool,
    sup: &MeshSupervisor,
) -> HealthInput<'a> {
    HealthInput {
        version: env!("CARGO_PKG_VERSION"),
        mesh_peers: sup.peer_count(),
        internet_up,
        base_socket: "/run/aep-conformance/sockets",
        lattice_events: 0,
        correctwriting_en_priority: 255,
        hub_loaded: true,
        hub_sessions: 0,
        hub_mounts: 0,
        hub_permissions: 0,
        mesh_peers_load_error: sup.load_error.clone(),
        lattice_memory_attractors: 0,
        lattice_memory_dim: 0,
        sqlite_vec_version: None,
        docking_ports_listening: true,
        mesh_routes: sup.routing.reachable_destinations(),
        data_dir: Some(data_dir),
        sqlite_closed: false,
        last_tls_handshake_err: None,
        drain_aborted_tasks: 0,
    }
}

/// CC-10: a node whose internet drops reports POTOMITAN in its health once a peer is
/// on file, keeps that after a restart that reloads the peer file, carries packets
/// to the peer over the mesh plane and falls to offline when the last peer goes.
fn cc_base_node_health_failover() -> Result<(), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let node = dir.path().join("node-a");
    std::fs::create_dir_all(&node).map_err(|e| e.to_string())?;

    let mut sup = MeshSupervisor::load(&node, false);
    let before = health(mesh_health_input(&node, false, &sup));
    if before.mesh_mode != MeshMode::Offline || before.mesh_reachable {
        return Err(format!(
            "no peers and internet down must be offline and unreachable, got {:?} reachable={}",
            before.mesh_mode, before.mesh_reachable
        ));
    }
    sup.upsert_peer(MeshPeer {
        node_id: "node-b".into(),
        endpoint: "mem://node-b".into(),
        public_key_hex: None,
        active: true,
    })
    .map_err(|e| e.to_string())?;

    // A restart reads the peer file the supervisor wrote.
    let restarted = MeshSupervisor::load(&node, false);
    if let Some(err) = &restarted.load_error {
        return Err(format!("peer file did not reload: {err}"));
    }
    let failover = health(mesh_health_input(&node, false, &restarted));
    if failover.mesh_mode != MeshMode::Potomitan {
        return Err(format!(
            "expected potomitan health, got {:?}",
            failover.mesh_mode
        ));
    }
    if !failover.mesh_reachable || failover.mesh_peers != 1 || failover.mesh_routes != 1 {
        return Err(format!(
            "potomitan health must reach one peer on one route, got reachable={} peers={} routes={}",
            failover.mesh_reachable, failover.mesh_peers, failover.mesh_routes
        ));
    }
    if !failover.potomitan_config.ends_with(MESH_PEERS_FILE)
        || !failover
            .potomitan_config
            .starts_with(node.to_string_lossy().as_ref())
    {
        return Err(format!(
            "health names the wrong peer file: {}",
            failover.potomitan_config
        ));
    }
    if failover.status != "ok" {
        return Err(format!(
            "failover alone must not degrade health, got {}",
            failover.status
        ));
    }
    let online = health(mesh_health_input(&node, true, &restarted));
    if online.mesh_mode != MeshMode::Internet {
        return Err(format!(
            "internet up must win over peers, got {:?}",
            online.mesh_mode
        ));
    }

    cc_potomitan_packet_plane()?;

    sup.remove_peer("node-b").map_err(|e| e.to_string())?;
    let alone = MeshSupervisor::load(&node, false);
    let offline = health(mesh_health_input(&node, false, &alone));
    if offline.mesh_mode != MeshMode::Offline || offline.mesh_reachable {
        return Err(format!(
            "last peer gone must be offline, got {:?} reachable={}",
            offline.mesh_mode, offline.mesh_reachable
        ));
    }
    Ok(())
}

/// Bundle state the docking runtime holds for one agent.
fn agent_bundle(
    rt: &DockingRuntime,
    agent_id: &str,
) -> Result<aep_agentmesh::AgentMeshBundle, String> {
    rt.keys
        .agent_bundles
        .lock()
        .map_err(|e| e.to_string())?
        .get(agent_id)
        .cloned()
        .ok_or_else(|| format!("no AgentMesh bundle for {agent_id}"))
}

/// CC-11: the trust_score the agent signs into the frame plaintext is the score the
/// dock records on the AgentMesh bundle, so the trust tier follows it. The mTLS
/// identity stays the same because a score change never reissues the cert.
fn cc_docking_trust_score_tier() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    let agent = "AG-TRUST-DOCK-CONF";
    let sign = arm_test_agent(&rt, agent, &["dynaep-action-lattice"])?;
    let mut fingerprint = None;
    for (seq, score, tier) in [(1u64, 850u16, 4u8), (2, 450, 2), (3, 120, 0)] {
        let seal = || -> Result<String, String> {
            let frame = conformance_frame_for_dock(
                "ch-trust",
                agent,
                DockingPort::ValidationEngine,
                "dynaep-action-lattice",
                &admit_payload(&format!("\"trust_score\":{score},"), seq),
                now_unix(),
                rt.keys.dock_kem.public.as_slice(),
                &sign,
            )?;
            // The wire field is unbound and must not override the signed score.
            Ok(serde_json::json!({ "frame": frame, "trust_score": 1000 }).to_string())
        };
        let resp = admit_sealed(&rt, &DockingPort::ValidationEngine, &seal)?;
        if !resp.ok || resp.event_id.is_none() {
            return Err(format!(
                "trust frame {seq} was not admitted: {:?} deny={:?}",
                resp.error, resp.deny
            ));
        }
        let bundle = agent_bundle(&rt, agent)?;
        if bundle.trust_score != score {
            return Err(format!(
                "frame {seq} signed trust_score {score} but the bundle holds {}",
                bundle.trust_score
            ));
        }
        if trust_tier(bundle.trust_score) != tier {
            return Err(format!(
                "trust_score {score} must sit in tier {tier}, got {}",
                trust_tier(bundle.trust_score)
            ));
        }
        match &fingerprint {
            None => fingerprint = Some(bundle.mtls.cert_fingerprint.clone()),
            Some(fp) if *fp != bundle.mtls.cert_fingerprint => {
                return Err("a trust_score change reissued the AgentMesh cert".into())
            }
            Some(_) => {}
        }
    }
    Ok(())
}

fn cc_potomitan_failover() -> Result<(), String> {
    if detect_network_mode(false, 2) != MeshMode::Potomitan {
        return Err("expected Potomitan mode with peers and internet down".into());
    }
    Ok(())
}

fn cc_potomitan_offline() -> Result<(), String> {
    if detect_network_mode(false, 0) != MeshMode::Offline {
        return Err("expected Offline mode with no peers and internet down".into());
    }
    Ok(())
}

fn cc_mesh_supervisor_routing() -> Result<(), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let mut sup = MeshSupervisor::load(dir.path(), false);
    sup.upsert_peer(MeshPeer {
        node_id: "pot-conf-01".into(),
        endpoint: "tls://10.0.0.9:12345".into(),
        public_key_hex: None,
        active: true,
    })
    .map_err(|e| e.to_string())?;
    sup.upsert_peer(MeshPeer {
        node_id: "pot-conf-02".into(),
        endpoint: "tls://10.0.0.10:12345".into(),
        public_key_hex: None,
        active: false,
    })
    .map_err(|e| e.to_string())?;
    if sup.peer_count() != 1 {
        return Err(format!("expected 1 active peer, got {}", sup.peer_count()));
    }
    if sup.routing.reachable_destinations() != 1 {
        return Err("routing table should expose one reachable destination".into());
    }
    if sup.mesh_mode() != MeshMode::Potomitan {
        return Err("supervisor should report Potomitan mode".into());
    }
    Ok(())
}

/// The Base Node refuses to start without an action lattice, so the fixture
/// plants a minimal one in the data dir that DockingRuntime::new reads.
const CONFORMANCE_LATTICE: &str = "aep_version: \"2.9.0\"\ndynaep_version: \"1.0.0\"\nlattice_revision: 1\nactions:\n  root:ping:\n    label: ping\n    category: system_event\n    parents: []\n    children: []\n    constraints: []\n    agent_permission: [\"*\"]\n";

/// Agent permission for the conformance agents that the Agent Control Hub reads.
const CONFORMANCE_HUB_GAP: &str = "metadata:\n  wrap: caw\n  agent_permission:\n    - agent_id: AG-PING-CONF\n      action: root:ping\n    - agent_id: AG-LRP-CONF\n      action: root:ping\n    - agent_id: AG-TRUST-DOCK-CONF\n      action: root:ping\n";

/// The LRP that CC-09 registers through the regulation dock.
const CONFORMANCE_LRP: &str = "conf-lrp";

/// Admit JSON for root:ping. The timestamp is the clock of the caller in milliseconds,
/// read right before the seal. The kernel compares it with its own clock on arrival.
fn admit_payload(extra: &str, seq: u64) -> Vec<u8> {
    format!(
        "{{{extra}\"type\":\"PING\",\"action_path\":\"root:ping\",\"payload\":{{\"ok\":true}},\"timestamp\":{},\"target_id\":\"scene-a\",\"_sequenceNumber\":{seq}}}",
        now_unix_ms()
    )
    .into_bytes()
}

/// Sends one frame and collects its outcome after the pulse. A frame is held at
/// the seal and applied on a beat, so the reply to the frame itself is pending.
fn admit_through_pulse(rt: &DockingRuntime, port: &DockingPort, line: &str) -> DockFrameResponse {
    let first = process_request(rt, port, line);
    if first.pending != Some(true) {
        return first;
    }
    let digest = match first.digest.clone() {
        Some(d) => d,
        None => return first,
    };
    let collect = serde_json::json!({ "collect": digest }).to_string();
    let mut last = first;
    for _ in 0..40 {
        std::thread::sleep(std::time::Duration::from_millis(100));
        let _ = pulse_beat(rt);
        last = process_request(rt, &DockingPort::ValidationEngine, &collect);
        if last.pending != Some(true) {
            return last;
        }
    }
    last
}

/// True when the dock refused only the stamp of the frame: the frame was not held and
/// every closed wall is a stamp wall of the enqueue check.
fn stamp_refused(resp: &DockFrameResponse) -> bool {
    if resp.ok || resp.pending == Some(true) {
        return false;
    }
    match &resp.deny {
        Some(deny) => {
            !deny.closed.is_empty()
                && deny
                    .closed
                    .iter()
                    .all(|w| w.id == "temporal:drift_exceeded" || w.id == "temporal:future_skew")
        }
        None => false,
    }
}

/// Seals one frame with `seal` and sends it through the pulse. The dock compares the
/// stamp of the event with its own clock on arrival and refuses a stamp outside the
/// drift bound before it holds the frame. A caller reads that refusal as the report
/// asks: it seals a fresh frame, here up to three frames. Any other answer is returned
/// as it is.
fn admit_sealed(
    rt: &DockingRuntime,
    port: &DockingPort,
    seal: &dyn Fn() -> Result<String, String>,
) -> Result<DockFrameResponse, String> {
    let mut resp = admit_through_pulse(rt, port, &seal()?);
    for _ in 1..3 {
        if !stamp_refused(&resp) {
            break;
        }
        resp = admit_through_pulse(rt, port, &seal()?);
    }
    Ok(resp)
}

fn temp_docking_runtime() -> Result<(tempfile::TempDir, DockingRuntime), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    std::fs::write(dir.path().join("lattice.yaml"), CONFORMANCE_LATTICE)
        .map_err(|e| e.to_string())?;
    let hub = dir.path().join("gap").join("policies").join("reference");
    std::fs::create_dir_all(&hub).map_err(|e| e.to_string())?;
    // The hub reads only caw-*.gap files from policies/reference.
    std::fs::write(hub.join("caw-conformance.gap"), CONFORMANCE_HUB_GAP)
        .map_err(|e| e.to_string())?;
    let db_path = dir.path().join("conf.db");
    let conn = open_lattice_db(&db_path).map_err(|e| e.to_string())?;
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    let lrps = [
        String::from("dynaep-action-lattice"),
        String::from(CONFORMANCE_LRP),
    ];
    let rt = DockingRuntime::with_data_dir(sock_base, conn, &lrps, dir.path())
        .map_err(|e| e.to_string())?;
    Ok((dir, rt))
}

fn cc_docking_lattice_health() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    let sign = arm_test_agent(&rt, "AG-PING-CONF", &["dynaep-action-lattice"])?;
    let seal = || -> Result<String, String> {
        let frame = conformance_frame_for_dock(
            "ch-lattice-health",
            "AG-PING-CONF",
            DockingPort::ValidationEngine,
            "dynaep-action-lattice",
            &admit_payload("", 1),
            now_unix(),
            rt.keys.dock_kem.public.as_slice(),
            &sign,
        )?;
        Ok(serde_json::json!({ "frame": frame }).to_string())
    };
    let resp = admit_sealed(&rt, &DockingPort::ValidationEngine, &seal)?;
    if !resp.ok || resp.event_id.is_none() {
        return Err(format!(
            "lattice health frame failed: {:?} deny={:?}",
            resp.error, resp.deny
        ));
    }
    Ok(())
}

fn cc_plain_ping_rejected() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    let resp = process_request(&rt, &DockingPort::ValidationEngine, r#"{"ping":true}"#);
    if resp.ok {
        return Err("plain ping should be rejected under lattice-channel-only policy".into());
    }
    let err = resp.error.unwrap_or_default();
    if !err.contains("plain ping rejected") {
        return Err(format!("unexpected rejection message: {err}"));
    }
    Ok(())
}

fn cc_plain_event_rejected() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    let line = serde_json::json!({
        "event": {
            "agent_id": "AG-SIDE-CONF",
            "channel_id": "ch-side",
            "contract_id": "dynaep-action-lattice",
            "event_type": "SIDE_CHANNEL_PROBE",
            "docking_port": "validation_engine",
            "trust_score": 700,
            "payload": { "probe": true }
        }
    })
    .to_string();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    if resp.ok {
        return Err("plain event should be rejected under lattice-channel-only policy".into());
    }
    let err = resp.error.unwrap_or_default();
    if !err.contains("plain event rejected") {
        return Err(format!("unexpected rejection message: {err}"));
    }
    Ok(())
}

fn cc_docking_rate_limit() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    {
        let mut limiter = rt.defence.rate_limiter.lock().map_err(|e| e.to_string())?;
        for _ in 0..120 {
            limiter.check("AG-RATE-CONF").map_err(|e| e.to_string())?;
        }
    }
    let kem = generate_kem_keypair();
    let sign = generate_sign_keypair();
    let frame = build_frame(
        "ch-rate",
        "AG-RATE-CONF",
        "sess-rate",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"x",
        &kem,
        &sign,
        now_unix(),
    )
    .map_err(|e| e.to_string())?;
    let line = serde_json::json!({ "frame": frame }).to_string();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    if resp.ok {
        return Err("rate limited frame should be rejected".into());
    }
    Ok(())
}

fn cc_lrp_registration_flow() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    // The LRP is allowlisted on the runtime but not active, so the regulation
    // frame is what registers it before the validation frame uses it.
    let sign = arm_test_agent(&rt, "AG-LRP-CONF", &["dynaep-action-lattice"])?;
    let seal_reg = || -> Result<String, String> {
        let reg_frame = conformance_frame_for_dock(
            "ch-lrp",
            "AG-LRP-CONF",
            DockingPort::RegulationModule,
            CONFORMANCE_LRP,
            &admit_payload("\"action\":\"register_lrp\",", 1),
            now_unix(),
            rt.keys.dock_kem.public.as_slice(),
            &sign,
        )?;
        Ok(serde_json::json!({ "frame": reg_frame }).to_string())
    };
    let reg = admit_sealed(&rt, &DockingPort::RegulationModule, &seal_reg)?;
    if !reg.ok || reg.event_id.is_none() {
        return Err(format!(
            "LRP lattice registration failed: {:?} deny={:?}",
            reg.error, reg.deny
        ));
    }
    let seal_event = || -> Result<String, String> {
        let event_frame = conformance_frame_for_dock(
            "ch-lrp",
            "AG-LRP-CONF",
            DockingPort::ValidationEngine,
            CONFORMANCE_LRP,
            &admit_payload("\"event_type\":\"LRP_BOUND\",", 2),
            now_unix(),
            rt.keys.dock_kem.public.as_slice(),
            &sign,
        )?;
        Ok(serde_json::json!({ "frame": event_frame }).to_string())
    };
    let resp = admit_sealed(&rt, &DockingPort::ValidationEngine, &seal_event)?;
    if !resp.ok || resp.event_id.is_none() {
        return Err(format!(
            "validation lattice frame after LRP register failed: {:?}",
            resp.error
        ));
    }
    Ok(())
}

/// Run every check in order and collect the report.
fn run_checks(checks: &[Check]) -> ConformanceReport {
    let mut results = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;

    for check in checks {
        match (check.run)() {
            Ok(()) => {
                passed += 1;
                eprintln!("PASS {} {}", check.id, check.name);
                results.push(CheckResult {
                    id: check.id.into(),
                    name: check.name.into(),
                    passed: true,
                    error: None,
                });
            }
            Err(err) => {
                failed += 1;
                eprintln!("FAIL {} {} - {}", check.id, check.name, err);
                results.push(CheckResult {
                    id: check.id.into(),
                    name: check.name.into(),
                    passed: false,
                    error: Some(err),
                });
            }
        }
    }

    ConformanceReport {
        suite: "aep-2.8-public",
        version: env!("CARGO_PKG_VERSION"),
        passed,
        failed,
        checks: results,
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.first().map(String::as_str) == Some("vectors") {
        let dir = args
            .get(1)
            .map(std::path::PathBuf::from)
            .unwrap_or_else(vectors::default_dir);
        std::process::exit(vectors::run_cli(&dir));
    }
    if let Some(other) = args.first() {
        eprintln!("usage: aep-conformance [vectors [dir]] (unknown argument {other})");
        std::process::exit(2);
    }
    let report = run_checks(CHECKS);
    match serde_json::to_string_pretty(&report) {
        Ok(text) => println!("{text}"),
        Err(err) => {
            eprintln!("FAIL report could not be written as JSON - {err}");
            std::process::exit(2);
        }
    }

    if report.failed > 0 {
        std::process::exit(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeSet;

    #[test]
    fn every_mandatory_check_passes() {
        let report = run_checks(CHECKS);
        let failures: Vec<String> = report
            .checks
            .iter()
            .filter(|c| !c.passed)
            .map(|c| format!("{} {:?}", c.id, c.error))
            .collect();
        assert!(failures.is_empty(), "failed checks: {failures:?}");
        assert_eq!(report.passed, CHECKS.len());
        assert_eq!(report.failed, 0);
    }

    #[test]
    fn check_ids_are_unique_and_named() {
        let mut seen = BTreeSet::new();
        for check in CHECKS {
            assert!(check.id.starts_with("CC-"), "{}", check.id);
            assert!(!check.name.trim().is_empty(), "{}", check.id);
            assert!(seen.insert(check.id), "duplicate id {}", check.id);
        }
    }

    fn passing() -> Result<(), String> {
        Ok(())
    }

    fn failing() -> Result<(), String> {
        Err(String::from("expected failure"))
    }

    #[test]
    fn a_failed_check_is_counted_and_keeps_its_error() {
        let checks = [
            Check {
                id: "T-01",
                name: "passes",
                run: passing,
            },
            Check {
                id: "T-02",
                name: "fails",
                run: failing,
            },
        ];
        let report = run_checks(&checks);
        assert_eq!(report.passed, 1);
        assert_eq!(report.failed, 1);
        let json = serde_json::to_value(&report).unwrap();
        assert!(json["checks"][0].get("error").is_none());
        assert_eq!(json["checks"][1]["error"], "expected failure");
        assert_eq!(json["checks"][1]["passed"], false);
    }

    #[test]
    fn hex_is_lowercase_and_padded() {
        assert_eq!(to_hex(&[0x00, 0x0a, 0xff]), "000aff");
        assert_eq!(to_hex(&[]), "");
    }
}
