//! Pinned values of the core.
//!
//! Every value below was computed once and is written here as a constant. The core
//! uses integers and SHA-256 alone for these values, so a build for any target must
//! reproduce them bit for bit. Running this file natively and as `wasm32-wasip2` is
//! the proof that both give the same digest, the same fingerprint and the same score.
use aep_lattice_memory_core::{
    canonical_json, entry_hash, genesis_hash, parse_timestamp_unix, FrameContext, LogEntry,
    MemoKey, Outcome, ProposalShape, QuantizedEmbedding, SimHash, DEFAULT_SIMHASH_MIN_SCORE,
};
use serde_json::json;

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn frame() -> FrameContext<'static> {
    FrameContext {
        agent_id: "agent-a",
        docking_port: "validation_engine",
        contract_id: "PM-DYNAEP-001",
    }
}

fn base() -> ProposalShape {
    ProposalShape::from_event(
        &json!({
            "type": "CUSTOM",
            "action_path": "action:write",
            "target_id": "scene-a",
            "tool": "editor",
            "timestamp": 1_000_000,
            "_sequenceNumber": 7,
            "payload": {
                "note": "rename the parser module and update every caller in the workspace",
                "files": ["src/parser.rs", "src/lexer.rs", "src/lib.rs"],
                "mode": "write",
                "priority": 3
            }
        }),
        &frame(),
    )
}

fn near() -> ProposalShape {
    ProposalShape::from_event(
        &json!({
            "type": "CUSTOM",
            "action_path": "action:write",
            "target_id": "scene-a",
            "tool": "editor",
            "timestamp": 2_000_000,
            "_sequenceNumber": 8,
            "payload": {
                "note": "rename the parser module and update every caller in the repository",
                "files": ["src/parser.rs", "src/lexer.rs", "src/lib.rs"],
                "mode": "write",
                "priority": 3
            }
        }),
        &frame(),
    )
}

fn unrelated() -> ProposalShape {
    ProposalShape::from_event(
        &json!({
            "type": "STATE_DELTA",
            "action_path": "billing:refund",
            "delta": [{"op": "replace", "path": "/registry/CN-7/amount", "value": 4200}],
            "payload": {"reason": "customer asked for a refund after the trial ended"}
        }),
        &FrameContext {
            agent_id: "agent-z",
            docking_port: "inference_engine",
            contract_id: "PM-BILLING-002",
        },
    )
}

#[test]
fn the_shape_digest_is_pinned() {
    assert_eq!(
        base().canonical(),
        r#"{"action_path":"action:write","agent_id":"agent-a","contract_id":"PM-DYNAEP-001","docking_port":"validation_engine","payload":{"files":["src/parser.rs","src/lexer.rs","src/lib.rs"],"mode":"write","note":"rename the parser module and update every caller in the workspace","priority":3},"target_id":"scene-a","tool":"editor","type":"CUSTOM"}"#
    );
    assert_eq!(hex(&base().digest()), GOLDEN_BASE_DIGEST);
    assert_eq!(hex(&near().digest()), GOLDEN_NEAR_DIGEST);
    assert_eq!(hex(&unrelated().digest()), GOLDEN_UNRELATED_DIGEST);
}

#[test]
fn the_simhash_is_pinned() {
    assert_eq!(
        hex(&SimHash::of_shape(&base()).to_bytes()),
        GOLDEN_BASE_SIMHASH
    );
    assert_eq!(
        hex(&SimHash::of_shape(&near()).to_bytes()),
        GOLDEN_NEAR_SIMHASH
    );
    assert_eq!(
        hex(&SimHash::of_shape(&unrelated()).to_bytes()),
        GOLDEN_UNRELATED_SIMHASH
    );
}

#[test]
fn native_and_wasm_scores_bit_identical() {
    let a = SimHash::of_shape(&base());
    let b = SimHash::of_shape(&near());
    let c = SimHash::of_shape(&unrelated());
    // A near duplicate scores above the threshold of 230 and an unrelated shape below.
    assert_eq!(a.score(&b), GOLDEN_NEAR_SCORE);
    assert_eq!(a.score(&c), GOLDEN_UNRELATED_SCORE);
    assert!(a.score(&b) >= DEFAULT_SIMHASH_MIN_SCORE);
    assert!(a.score(&c) < DEFAULT_SIMHASH_MIN_SCORE);
    assert_eq!(a.score(&a), 256);
}

#[test]
fn the_quantized_embedding_is_pinned() {
    let values: Vec<f32> = (0..16).map(|i| (i as f32 * 0.37 - 2.5) / 3.0).collect();
    let quantized = QuantizedEmbedding::quantize(&values, 16).unwrap();
    assert_eq!(quantized.as_slice(), GOLDEN_EMBEDDING);
    let other: Vec<f32> = (0..16).map(|i| (i as f32 * 0.35 - 2.4) / 3.0).collect();
    let other = QuantizedEmbedding::quantize(&other, 16).unwrap();
    assert_eq!(quantized.score(&other), GOLDEN_EMBEDDING_SCORE);
}

#[test]
fn the_log_entry_hash_and_the_memo_key_are_pinned() {
    let entry = LogEntry {
        key: 1,
        entry_id: String::from("frame-1"),
        element_id: String::from("agent-a"),
        accepted: true,
        recorded_at_unix: parse_timestamp_unix("2026-11-20T19:20:40Z").unwrap(),
        shape_digest: base().digest(),
        fingerprint_kind: 1,
        fingerprint: SimHash::of_shape(&base()).to_bytes().to_vec(),
        outcome: Outcome::Form {
            attractor: 1,
            evicted: None,
        },
        attractors_after: 1,
        labels: canonical_json(&json!({"verdict": "allow"})),
        body: None,
        prev_hash: genesis_hash(),
    };
    assert_eq!(hex(&genesis_hash()), GOLDEN_GENESIS);
    assert_eq!(
        hex(&entry_hash("admit.validation_engine", &entry.encode())),
        GOLDEN_ENTRY_HASH
    );
    let key = MemoKey::derive("writing", &base().digest(), &[1; 32], &[2; 32]);
    assert_eq!(hex(key.as_bytes()), GOLDEN_MEMO_KEY);
}

const GOLDEN_BASE_DIGEST: &str = "fde659efeea91c481ee351171a0ce6de72d0bd90c07c995680e35bdf96806c9a";
const GOLDEN_NEAR_DIGEST: &str = "f073a5a22194a26cb6c3d79b62b778c0afa95ce406e462482548bd8920684302";
const GOLDEN_UNRELATED_DIGEST: &str =
    "50cf473d42d0794f6b03c83667e9d023cf71de2d3a50b1546d80405e420ea844";
const GOLDEN_BASE_SIMHASH: &str =
    "c114e24f31136615fbfbad69272b71d50ae8f27733928b03eaca56e4a73d2ef2";
const GOLDEN_NEAR_SIMHASH: &str =
    "c194e24b31136e15fafbad6927ab70d50eecf27733938b83eaca50e4a33d2e72";
const GOLDEN_UNRELATED_SIMHASH: &str =
    "d504a10fa00b42237cdc2b93a13154fb87df1c3b0ba2eea0a95c1417d303c23c";
const GOLDEN_NEAR_SCORE: i32 = 242;
const GOLDEN_UNRELATED_SCORE: i32 = 143;
const GOLDEN_EMBEDDING: &[i8] = &[
    -46, -39, -32, -26, -19, -12, -5, 2, 8, 15, 22, 29, 36, 42, 49, 56,
];
const GOLDEN_EMBEDDING_SCORE: i32 = 16127;
const GOLDEN_GENESIS: &str = "9767d49b22b0f6c373f19c5ef74e865ce435ba148f4ded00530af639f6e0c432";
const GOLDEN_ENTRY_HASH: &str = "62bd0cf7e8ded2d7ff82b4ac5d6d6d1f472e3bc818181d73c538aa34b449950c";
const GOLDEN_MEMO_KEY: &str = "de3740b2ea746fde8817c75225340e7817d22b325c130b8de69c49ea8a434fad";
