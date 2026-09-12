// @PAD: aep-ucb-public-contract-2.8.5
// @GCDE: gaplune-decode hmac-sha256:ab54811d1526a0253fdd14253ff4ed74c94aafc36362f2c29fc94a24eef11c06
//! Mandatory task manifest at UCB ingest. Synthesis is refused.

use crate::store::{value_has_trust_fields, ManifestStore, TaskManifestV1};
use aep_ucb_perimeter_v1::{digest_canonical, SignedManifest, StrictMode};
use aep_wall_set_backpressure::{ClosedWall, DenyReport, RepairHint, CLASS_CAPABILITY, CLASS_STRUCTURAL};


pub fn compute_manifest_digest(manifest: &TaskManifestV1) -> String {
    let mut value = serde_json::to_value(manifest).unwrap_or(serde_json::Value::Null);
    if let Some(obj) = value.as_object_mut() {
        obj.remove("manifest_digest");
        obj.remove("signature");
        obj.remove("trust");
    }
    digest_canonical(&value)
}

pub fn signed_from_task(manifest: &TaskManifestV1) -> SignedManifest {
    let digest = if manifest.manifest_digest.is_empty() {
        compute_manifest_digest(manifest)
    } else {
        manifest.manifest_digest.clone()
    };
    SignedManifest {
        body: serde_json::to_value(manifest).unwrap_or(serde_json::json!({})),
        digest,
        signature: manifest.signature.clone(),
        provisional: manifest.provisional,
    }
}

pub fn unsigned_manifest() -> DenyReport {
    closed_report(
        "ManifestUnsigned",
        "ucb.manifest.signature",
        "unsigned task manifest",
        CLASS_CAPABILITY,
        "signature",
        "sign the task manifest then reseal",
    )
}

pub fn egress_refused_unsigned() -> DenyReport {
    closed_report(
        "ManifestUnsigned",
        "ucb.manifest.egress",
        "unsigned or provisional manifest cannot enable egress",
        CLASS_CAPABILITY,
        "signature",
        "sign and promote the task manifest then reseal",
    )
}

pub fn strict_mode_from_env() -> StrictMode {
    if std::env::var("UCB_MANIFEST_STRICT").map(|v| v == "0").unwrap_or(false) {
        StrictMode::Off
    } else {
        StrictMode::On
    }
}

fn closed_report(error: &str, wall_id: &str, reason: &str, class: &str, field: &str, fix: &str) -> DenyReport {
    let closed = vec![ClosedWall::with_class(wall_id, reason, class)];
    let mut report = DenyReport::from_error_and_closed(error, &closed);
    report.repairs = vec![RepairHint {
        wall_id: String::from(wall_id),
        field: String::from(field),
        kind: String::from("bind_field"),
        fix: String::from(fix),
    }];
    report.reseal_required = true;
    report
}

pub fn manifest_missing() -> DenyReport {
    closed_report(
        "ManifestMissing",
        "ucb.manifest",
        "no task manifest for agent_id",
        CLASS_STRUCTURAL,
        "task_manifest",
        "store a non-provisional manifest under AEP_TASK_MANIFEST_DIR or send task_manifest on ingest then reseal",
    )
}

pub fn manifest_provisional() -> DenyReport {
    closed_report(
        "ManifestProvisional",
        "ucb.manifest.provisional",
        "stored manifest is still provisional",
        CLASS_CAPABILITY,
        "provisional",
        "complete promotion_required then store a non-provisional manifest and reseal",
    )
}

pub fn session_missing() -> DenyReport {
    closed_report(
        "SessionMissing",
        "ucb.session",
        "manifest.session_id is missing",
        CLASS_CAPABILITY,
        "session_id",
        "bind session_id on the manifest then reseal the frame with the same session_id",
    )
}

pub fn session_mismatch() -> DenyReport {
    closed_report(
        "SessionMismatch",
        "ucb.session",
        "frame session_id does not match manifest session_id",
        CLASS_CAPABILITY,
        "session_id",
        "bind the same session_id on frame and manifest then reseal",
    )
}

pub fn session_required() -> DenyReport {
    closed_report(
        "SessionRequired",
        "ucb.session",
        "manifest binds session_id and the frame omitted it",
        CLASS_CAPABILITY,
        "session_id",
        "bind session_id on the frame to the manifest value then reseal",
    )
}

pub fn trust_fields_forbidden() -> DenyReport {
    closed_report(
        "trust fields are refused",
        "ucb.trust_fields",
        "UCB forbids trust fields",
        CLASS_STRUCTURAL,
        "trust",
        "remove trust, trust_score, trust_tier, trust_ring and max_trust_score then reseal",
    )
}

pub fn synthesis_forbidden() -> DenyReport {
    closed_report(
        "synthesis is refused",
        "ucb.synthesis",
        "UCB does not synthesize a task manifest",
        CLASS_STRUCTURAL,
        "task_manifest",
        "supply task_manifest on ingest or store a non-provisional manifest",
    )
}

pub fn agent_id_mismatch() -> DenyReport {
    closed_report(
        "provided task_manifest agent_id does not match request agent_id",
        "ucb.agent_id",
        "agent_id mismatch",
        CLASS_STRUCTURAL,
        "agent_id",
        "set task_manifest.agent_id to the ingest agent_id then reseal",
    )
}

pub fn load_or_provided(
    store: &ManifestStore,
    agent_id: &str,
    session_id: &str,
    provided: Option<serde_json::Value>,
) -> Result<TaskManifestV1, DenyReport> {
    if let Some(raw) = provided {
        if value_has_trust_fields(&raw) {
            return Err(trust_fields_forbidden());
        }
        let mut m = if let Some(text) = raw.as_str() {
            crate::gap_manifest::compile_provided(text)?
        } else {
            crate::gap_manifest::compile_provided_json(raw)?
        };
        if !m.agent_id.is_empty() && m.agent_id != agent_id {
            return Err(agent_id_mismatch());
        }
        m.agent_id = agent_id.to_string();
        if m.session_id.is_none() && !session_id.is_empty() {
            m.session_id = Some(session_id.to_string());
        }
        if m.synthesized_by.is_empty() {
            m.synthesized_by = String::from("provided");
        }
        if m.synthesized_by != "provided" {
            return Err(synthesis_forbidden());
        }
        if m.manifest_digest.is_empty() {
            m.manifest_digest = compute_manifest_digest(&m);
        }
        let strict = strict_mode_from_env();
        if matches!(strict, StrictMode::On) && m.signature.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
            return Err(unsigned_manifest());
        }
        store.save(&m).map_err(|_| manifest_missing())?;
        return Ok(m);
    }
    match store.load(agent_id) {
        Some(m) if m.provisional => Err(manifest_provisional()),
        Some(m) => {
            let strict = strict_mode_from_env();
            if matches!(strict, StrictMode::On) && m.signature.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                return Err(unsigned_manifest());
            }
            Ok(m)
        }
        None => Err(manifest_missing()),
    }
}

pub fn bind_session(manifest: &TaskManifestV1, frame_session: &str) -> Result<(), DenyReport> {
    match (manifest.session_id.as_deref(), frame_session) {
        (None, s) if !s.is_empty() => Err(session_missing()),
        (Some(_), s) if s.is_empty() => Err(session_required()),
        (Some(ms), fs) if ms != fs => Err(session_mismatch()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_ucb_perimeter_v1::egress_power_allowed;
    use tempfile::tempdir;

    fn sample_provided(agent: &str) -> serde_json::Value {
        let mut m = serde_json::Map::new();
        m.insert(String::from("manifest_version"), serde_json::Value::String(String::from("1")));
        m.insert(String::from("id"), serde_json::Value::String(String::from("m1")));
        m.insert(String::from("agent_id"), serde_json::Value::String(String::from(agent)));
        m.insert(String::from("intent"), serde_json::Value::Object(serde_json::Map::new()));
        m.insert(String::from("synthesized_by"), serde_json::Value::String(String::from("provided")));
        m.insert(String::from("signature"), serde_json::Value::String(String::from("operator-sig")));
        serde_json::Value::Object(m)
    }

    #[test]
    fn no_manifest_refuses() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let err = load_or_provided(&store, "agent-a", "sess-1", None).unwrap_err();
        assert_eq!(err.error, "ManifestMissing");
        assert_eq!(err.closed[0].class, CLASS_STRUCTURAL);
        assert!(err.reseal_required);
    }

    #[test]
    fn provided_without_trust_loads() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let m = load_or_provided(&store, "agent-a", "sess-1", Some(sample_provided("agent-a"))).unwrap();
        assert_eq!(m.agent_id, "agent-a");
        assert_eq!(m.synthesized_by, "provided");
    }

    #[test]
    fn trust_fields_refuse() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let mut raw = sample_provided("agent-a");
        raw.as_object_mut().unwrap().insert(
            String::from("trust_score"),
            serde_json::Value::from(9u64),
        );
        let err = load_or_provided(&store, "agent-a", "sess-1", Some(raw)).unwrap_err();
        assert!(err.error.contains("trust"));
    }

    #[test]
    fn synthesis_label_refuses() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let mut raw = sample_provided("agent-a");
        raw.as_object_mut().unwrap().insert(
            String::from("synthesized_by"),
            serde_json::Value::String(String::from("llm_structured")),
        );
        let err = load_or_provided(&store, "agent-a", "sess-1", Some(raw)).unwrap_err();
        assert!(err.error.contains("synthesis"));
    }

    #[test]
    fn unsigned_cannot_egress() {
        let m = TaskManifestV1 {
            manifest_version: "1".into(),
            id: "m1".into(),
            agent_id: "agent-a".into(),
            session_id: Some("sess-1".into()),
            intent: serde_json::json!({}),
            agentmesh: None,
            egress: None,
            mcp: None,
            provisional: false,
            synthesized_by: "provided".into(),
            promotion_required: vec![],
            created_at_unix: 0,
            manifest_digest: String::new(),
            signature: None,
        };
        let signed = signed_from_task(&m);
        assert!(egress_power_allowed(&signed, StrictMode::On).is_err());
    }

    #[test]
    fn provisional_cannot_egress() {
        let mut m = TaskManifestV1 {
            manifest_version: "1".into(),
            id: "m1".into(),
            agent_id: "agent-a".into(),
            session_id: Some("sess-1".into()),
            intent: serde_json::json!({}),
            agentmesh: None,
            egress: None,
            mcp: None,
            provisional: true,
            synthesized_by: "provided".into(),
            promotion_required: vec![],
            created_at_unix: 0,
            manifest_digest: String::new(),
            signature: Some("operator-sig".into()),
        };
        m.manifest_digest = compute_manifest_digest(&m);
        let signed = signed_from_task(&m);
        assert!(egress_power_allowed(&signed, StrictMode::On).is_err());
    }

    #[test]
    fn provided_gap_text_compiles_on_ingest() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let text = concat!(
            "manifest_version: 1\n",
            "id: m1\n",
            "agent_id: agent-a\n",
            "intent: {}\n",
            "synthesized_by: provided\n",
            "signature: operator-sig\n",
        );
        let m = load_or_provided(&store, "agent-a", "sess-1", Some(serde_json::Value::String(text.into()))).unwrap();
        assert_eq!(m.synthesized_by, "provided");
        assert_eq!(m.agent_id, "agent-a");
        assert!(!m.manifest_digest.is_empty());
    }

}
