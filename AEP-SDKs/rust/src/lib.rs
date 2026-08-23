//! AEP 2.8 Rust SDK. Lattice-gated transport plus dynAEP bridge.
//! Interpreter SDKs are retired.
//! @PAD: aep28-eval-chain-rust-meet-v1
//! @GCDE: gaplune-decode hmac-sha256:06827ec2297b2ec9bca467d50b93f689790ce1832e3b65da038e8113b6beff8c

pub mod aep;
pub mod dynaep;
pub mod lattice;

pub use aep::{cosine_similarity, BasicResolver, InMemoryFabric, MemoryEntry, ResolveRequest};
pub use dynaep::{
    DynAepBridge, DynAepBridgeConfig, DynAepRejection, ProcessOut, RegoConfig, ToolCallResult,
    UnifiedRegoEvaluator,
};
pub use lattice::{build_lattice_frame, lattice_gated_fetch_url, GatewayMeta};

#[cfg(test)]
mod tests {
    use super::*;
    use dynaep::{CausalEvent, CausalOrderingEngine};
    use serde_json::json;

    #[test]
    fn mint_ids_are_bridge_owned() {
        let mut b = DynAepBridge::new(json!({"aep_version": "2.8.0"}), DynAepBridgeConfig::default());
        assert_eq!(b.mint_element_id("component").unwrap(), "CP-00001");
        assert_eq!(b.mint_element_id("component").unwrap(), "CP-00002");
    }

    #[test]
    fn add_element_enforces_z_band() {
        let scene = json!({"aep_version":"2.8.0","SH-00001":{"z":1,"type":"shell","children":[]}});
        let mut b = DynAepBridge::new(scene, DynAepBridgeConfig::default());
        assert!(!b.handle_tool_call("aep_add_element", &json!({"type":"component","parent":"SH-00001","z":1})).success);
        let good = b.handle_tool_call("aep_add_element", &json!({"type":"component","parent":"SH-00001","z":26}));
        assert!(good.success);
    }

    #[test]
    fn causal_rejects_duplicate() {
        let mut e = CausalOrderingEngine::new(8);
        let ev = CausalEvent { event_id: "1".into(), agent_id: "ag".into(), sequence_number: 1, target_element_id: "CP-00001".into() };
        assert!(e.process(ev.clone()).ordered);
        assert!(!e.process(ev).ordered);
    }

    #[test]
    fn chain_meet_keeps_all_rows() {
        let names = ["a"; 15];
        let r = dynaep::run_meet(&names, &[3, 8]);
        assert_eq!(r.verdict, "reject");
        assert_eq!(r.ledger.len(), 15);
        let closed = r.ledger.iter().filter(|s| s.verdict == "reject").count();
        assert_eq!(closed, 2);
        assert!(r.ledger.iter().all(|s| s.reason != "skip" && s.reason != "prior reject"));
    }

    #[test]
    fn cosine_identical_vectors() {
        assert!((cosine_similarity(&[1.0, 0.0], &[1.0, 0.0]).unwrap() - 1.0).abs() < 1e-9);
    }

    #[test]
    fn live_admit_unknown_path_collect_all() {
        let mut b = DynAepBridge::new(json!({"aep_version": "2.8.0"}), DynAepBridgeConfig::default());
        let yaml = "actions:\n  root:ping:\n    category: system_event\n    parents: []\n    children: []\n    trust_floor: 1\n";
        b.load_lattice_yaml(yaml).expect("yaml");
        let ev = json!({"type":"CUSTOM","action_path":"bogus:path","trust_tier":3,"payload":{"ok":true},"timestamp":1000000});
        match b.process_event(ev) {
            ProcessOut::Reject(r) => assert!(r.error.contains("Admit collect-all walls then Apply")),
            ProcessOut::Event(_) => panic!("expected reject"),
        }
    }
}
