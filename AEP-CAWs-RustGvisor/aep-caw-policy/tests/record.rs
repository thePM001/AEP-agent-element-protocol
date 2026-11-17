//! The record as the GAP compiler writes it. The fixtures are output of the compiler
//! for three reference profiles, so these tests also hold the two digest
//! implementations together.

// Test code may use expect: a failed expect here is a failed test.
#![allow(clippy::expect_used)]

mod common;

use aep_caw_policy::canonical::digest_without_field;
use aep_caw_policy::plan::{compile, MountMode};
use aep_caw_policy::record::parse_record;
use aep_caw_policy::PolicyError;
use common::vars;
use serde_json::Value;

const CODING_AGENT: &str = include_str!("fixtures/coding-agent.json");
const RESTRICTED: &str = include_str!("fixtures/restricted.json");
const COMPILED_RUNTIME: &str = include_str!("fixtures/compiled-runtime.json");

fn resealed(mut value: Value) -> String {
    let digest = digest_without_field(&value);
    value["digest"] = Value::String(digest);
    value.to_string()
}

#[test]
fn the_records_of_the_compiler_parse_and_their_digests_hold() {
    for (text, id) in [
        (CODING_AGENT, "coding-agent"),
        (RESTRICTED, "restricted"),
        (COMPILED_RUNTIME, "compiled-runtime"),
    ] {
        let record = parse_record(text).expect("parses");
        assert_eq!(record.profile_id, id);
        assert_eq!(record.enforcement_tier, "gvisor");
        let value: Value = serde_json::from_str(text).expect("json");
        assert_eq!(record.digest, digest_without_field(&value));
    }
}

#[test]
fn one_changed_character_breaks_the_digest() {
    let changed = RESTRICTED.replacen("\"port\":443", "\"port\":8443", 1);
    assert_ne!(changed, RESTRICTED);
    assert_eq!(parse_record(&changed), Err(PolicyError::Digest));
    let no_digest = RESTRICTED.replacen("\"digest\":\"sha256:", "\"digest\":\"", 1);
    assert_eq!(parse_record(&no_digest), Err(PolicyError::Digest));
    let mut value: Value = serde_json::from_str(RESTRICTED).expect("json");
    value.as_object_mut().expect("object").remove("digest");
    assert_eq!(parse_record(&value.to_string()), Err(PolicyError::Digest));
}

#[test]
fn white_space_and_key_order_do_not_change_the_record() {
    let value: Value = serde_json::from_str(RESTRICTED).expect("json");
    let pretty = serde_json::to_string_pretty(&value).expect("pretty");
    assert_eq!(parse_record(&pretty), parse_record(RESTRICTED));
}

#[test]
fn another_kind_version_or_tier_is_refused() {
    let mut kind: Value = serde_json::from_str(RESTRICTED).expect("json");
    kind["record"] = Value::String("aep.caw.profile".to_string());
    assert!(matches!(
        parse_record(&resealed(kind)),
        Err(PolicyError::RecordKind { .. })
    ));
    let mut version: Value = serde_json::from_str(RESTRICTED).expect("json");
    version["version"] = Value::from(2);
    assert!(matches!(
        parse_record(&resealed(version)),
        Err(PolicyError::RecordKind { .. })
    ));
    let mut tier: Value = serde_json::from_str(RESTRICTED).expect("json");
    tier["enforcement_tier"] = Value::String("seccomp".to_string());
    assert_eq!(
        parse_record(&resealed(tier)),
        Err(PolicyError::Tier("seccomp".to_string()))
    );
}

#[test]
fn text_that_is_not_a_record_is_refused() {
    for text in ["", "not json", "[]", "{}", "null", "{\"record\":1}"] {
        let result = parse_record(text);
        assert!(
            matches!(
                result,
                Err(PolicyError::Shape(_)) | Err(PolicyError::RecordKind { .. })
            ),
            "{text:?}: {result:?}"
        );
    }
    let mut missing: Value = serde_json::from_str(RESTRICTED).expect("json");
    missing.as_object_mut().expect("object").remove("toolset");
    assert!(matches!(
        parse_record(&resealed(missing)),
        Err(PolicyError::Shape(_))
    ));
    let mut wrong: Value = serde_json::from_str(RESTRICTED).expect("json");
    wrong["llm_proxy"] = Value::String("yes".to_string());
    assert!(matches!(
        parse_record(&resealed(wrong)),
        Err(PolicyError::Shape(_))
    ));
}

#[test]
fn the_reference_profiles_compile_into_plans() {
    let session = vars()
        .with("AEP_MODEL_GATEWAY_HOST", "gateway.example.com")
        .with("AEP_AGENT_CONFIG_DIR", "/home/agent/agent-config");

    let coding = compile(&parse_record(CODING_AGENT).expect("parses"), &session).expect("compiles");
    let modes: Vec<(&str, MountMode)> = coding
        .mounts
        .iter()
        .map(|m| (m.path.as_str(), m.mode))
        .collect();
    assert_eq!(
        modes,
        vec![
            ("/home/agent/.config/agent", MountMode::ReadOnly),
            ("/home/agent/.local/share/agent", MountMode::ReadOnly),
            ("/home/agent/agent-config", MountMode::ReadOnly),
            ("/home/agent/project", MountMode::ReadWrite),
        ]
    );
    assert!(coding.mounts.iter().all(|m| !m.exec));
    assert_eq!(coding.routes.len(), 1);
    assert_eq!(coding.routes[0].host, "gateway.example.com");
    assert!(coding.programs.iter().any(|p| p.name == "git"));
    assert!(coding.mount_of("/home/agent/.ssh/id_ed25519").is_none());

    let restricted =
        compile(&parse_record(RESTRICTED).expect("parses"), &session).expect("compiles");
    assert_eq!(restricted.mounts.len(), 1);
    assert_eq!(restricted.mounts[0].mode, MountMode::ReadWrite);
    assert!(!restricted.programs.iter().any(|p| p.name == "git"));

    let runtime =
        compile(&parse_record(COMPILED_RUNTIME).expect("parses"), &vars()).expect("compiles");
    assert!(runtime.routes.is_empty());
    assert!(runtime.mounts.iter().all(|m| m.exec));
}

#[test]
fn a_record_with_trees_parses_and_an_unknown_tree_key_is_refused() {
    let mut value: Value = serde_json::from_str(RESTRICTED).expect("json");
    value["toolset"]["trees"] = serde_json::json!([
        {"name": "rust", "source": "${RUST_TOOLCHAIN}", "path": "/usr/local/rust", "bin": "bin"},
        {"name": "libraries", "source": "/usr/lib/x86_64-linux-gnu", "path": "/usr/lib/x86_64-linux-gnu", "bin": null}
    ]);
    let record = parse_record(&resealed(value.clone())).expect("parses");
    assert_eq!(record.toolset.trees.len(), 2);
    assert_eq!(record.toolset.trees[0].bin.as_deref(), Some("bin"));
    assert_eq!(record.toolset.trees[1].bin, None);
    // A record written before trees existed has none.
    assert!(parse_record(RESTRICTED)
        .expect("parses")
        .toolset
        .trees
        .is_empty());
    value["toolset"]["trees"][0]["sha256"] = Value::String("x".to_string());
    assert!(
        matches!(parse_record(&resealed(value)), Err(PolicyError::Shape(m)) if m.contains("unknown field"))
    );
}

#[test]
fn a_reference_profile_with_no_gateway_host_is_refused() {
    let result = compile(&parse_record(RESTRICTED).expect("parses"), &vars());
    assert!(
        matches!(result, Err(PolicyError::MissingVariable { name, .. }) if name == "AEP_MODEL_GATEWAY_HOST")
    );
}
