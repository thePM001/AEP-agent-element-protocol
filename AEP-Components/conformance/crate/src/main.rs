//! AEP 2.8 public-tier conformance runner.
//!
//! Exit 0 = all mandatory checks passed. Used by `conformance/runner/run.sh`.

use aep_agentmesh::{create_bundle, rotate_on_trust_change};
use aep_base_node::{open_lattice_db, process_request, DockingRuntime};
use aep_lattice_channel::{build_frame, open_frame, ContractRegistry, DockingPort};
use aep_lattice_crypto::{generate_kem_keypair, generate_sign_keypair, open, seal};
use aep_potomitan::{detect_network_mode, MeshMode, MeshPeer, MeshSupervisor};
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
        name: "AgentMesh mTLS fingerprint rotates on trust tier change",
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

fn conformance_frame(
    channel_id: &str,
    agent_id: &str,
    port: DockingPort,
    contract_id: &str,
    payload: &[u8],
    sent_at: u64,
) -> Result<aep_lattice_channel::LatticeChannelFrame, String> {
    let kem = generate_kem_keypair();
    let sign = generate_sign_keypair();
    build_frame(
        channel_id,
        agent_id,
        "sess-conformance",
        port,
        contract_id,
        payload,
        &kem,
        &sign,
        sent_at,
    )
    .map_err(|e| e.to_string())
}

fn cc_pq_capsule_roundtrip() -> Result<(), String> {
    let kem = generate_kem_keypair();
    let sign = generate_sign_keypair();
    let plain = b"aep-2.8-conformance-pq-capsule";
    let capsule = seal(plain, &kem.public, &sign).map_err(|e| e.to_string())?;
    let opened = open(&capsule, &kem.secret, &kem.public, &sign.public)
        .map_err(|e| e.to_string())?;
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
    let mut bundle = create_bundle("AG-TRUST-CONF", 850, b"pk", vec![], 1_700_000_000);
    let fp_high = bundle.mtls.cert_fingerprint.clone();
    rotate_on_trust_change(&mut bundle, 450, 1_700_000_100);
    if bundle.mtls.cert_fingerprint == fp_high {
        return Err("trust tier demotion did not rotate mTLS fingerprint".into());
    }
    if bundle.trust_score != 450 {
        return Err("trust score not updated".into());
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

fn temp_docking_runtime() -> Result<(tempfile::TempDir, DockingRuntime), String> {
    let dir = tempfile::tempdir().map_err(|e| e.to_string())?;
    let db_path = dir.path().join("conf.db");
    let conn = open_lattice_db(&db_path).map_err(|e| e.to_string())?;
    let sock_base = dir.path().join("sockets").to_string_lossy().to_string();
    Ok((
        dir,
        DockingRuntime::new(sock_base, conn, &["dynaep-action-lattice".into()]),
    ))
}

fn cc_docking_lattice_health() -> Result<(), String> {
    let (_dir, rt) = temp_docking_runtime()?;
    let frame = conformance_frame(
        "ch-lattice-health",
        "AG-PING-CONF",
        DockingPort::ValidationEngine,
        "dynaep-action-lattice",
        b"lattice-health-ping",
        1,
    )?;
    let line = serde_json::json!({ "frame": frame }).to_string();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &line);
    if !resp.ok {
        return Err(format!("lattice health frame failed: {:?}", resp.error));
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
        let mut limiter = rt.rate_limiter.lock().expect("rate limiter lock");
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
        1,
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
    let reg_frame = conformance_frame(
        "ch-lrp-reg",
        "AG-LRP-CONF",
        DockingPort::RegulationModule,
        "conf-lrp",
        b"register-lrp",
        1,
    )?;
    let reg_line = serde_json::json!({ "frame": reg_frame }).to_string();
    let reg = process_request(&rt, &DockingPort::RegulationModule, &reg_line);
    if !reg.ok {
        return Err(format!("LRP lattice registration failed: {:?}", reg.error));
    }
    let event_frame = conformance_frame(
        "ch-lrp-conf",
        "AG-LRP-CONF",
        DockingPort::ValidationEngine,
        "conf-lrp",
        b"lrp-bound",
        2,
    )?;
    let event_line = serde_json::json!({ "frame": event_frame }).to_string();
    let resp = process_request(&rt, &DockingPort::ValidationEngine, &event_line);
    if !resp.ok {
        return Err(format!(
            "validation lattice frame after LRP register failed: {:?}",
            resp.error
        ));
    }
    Ok(())
}

fn main() {
    let mut results = Vec::new();
    let mut passed = 0usize;
    let mut failed = 0usize;

    for check in CHECKS {
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

    let report = ConformanceReport {
        suite: "aep-2.8-public",
        version: env!("CARGO_PKG_VERSION"),
        passed,
        failed,
        checks: results,
    };
    println!("{}", serde_json::to_string_pretty(&report).expect("report json"));

    if failed > 0 {
        std::process::exit(1);
    }
}