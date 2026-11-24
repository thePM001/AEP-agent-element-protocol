//! Mandatory task manifest at UCB ingest. Synthesis is refused.

use crate::store::{ManifestStore, TaskManifestV1};
use aep_ucb_perimeter_v1::{
    digest_canonical, verify_manifest_signature, ManifestError, ManifestSigners, SignedManifest,
    StrictMode,
};
use aep_wall_set_backpressure::{
    ClosedWall, DenyReport, RepairHint, CLASS_CAPABILITY, CLASS_STRUCTURAL,
};

/// The one serialization of a manifest that is digested and signed: the manifest
/// without its digest and its signature.
pub fn digest_view(manifest: &TaskManifestV1) -> serde_json::Value {
    let mut value = serde_json::to_value(manifest).unwrap_or(serde_json::Value::Null);
    if let Some(obj) = value.as_object_mut() {
        obj.remove("manifest_digest");
        obj.remove("signature");
    }
    value
}

pub fn compute_manifest_digest(manifest: &TaskManifestV1) -> String {
    digest_canonical(&digest_view(manifest))
}

/// The egress view of a manifest. Its body is the digest view, so the egress check
/// hashes the same serialization that the stored digest and the signature cover.
pub fn signed_from_task(manifest: &TaskManifestV1) -> SignedManifest {
    let digest = if manifest.manifest_digest.is_empty() {
        compute_manifest_digest(manifest)
    } else {
        manifest.manifest_digest.clone()
    };
    SignedManifest {
        body: digest_view(manifest),
        digest,
        signature: manifest.signature.clone(),
        provisional: manifest.provisional,
    }
}

pub fn strict_mode(manifest_strict: bool) -> StrictMode {
    if manifest_strict {
        StrictMode::On
    } else {
        StrictMode::Off
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

pub fn signer_missing() -> DenyReport {
    closed_report(
        "ManifestSignerMissing",
        "ucb.manifest.signature",
        "no manifest signer key is registered for agent_id",
        CLASS_CAPABILITY,
        "signature",
        "register manifest_signer_public_hex for the agent in ucb-agent-keys.json then reseal",
    )
}

pub fn signature_invalid() -> DenyReport {
    closed_report(
        "ManifestSignatureInvalid",
        "ucb.manifest.signature",
        "manifest signature does not verify against the registered signer key",
        CLASS_CAPABILITY,
        "signature",
        "sign aep-ucb-task-manifest-v1: followed by the manifest digest with the registered ML-DSA-65 key then reseal",
    )
}

pub fn digest_mismatch() -> DenyReport {
    closed_report(
        "ManifestDigestMismatch",
        "ucb.manifest.digest",
        "manifest_digest does not match the manifest",
        CLASS_STRUCTURAL,
        "manifest_digest",
        "recompute manifest_digest over the manifest then sign and reseal",
    )
}

pub fn replace_unsigned() -> DenyReport {
    closed_report(
        "ManifestReplaceUnsigned",
        "ucb.manifest.replace",
        "a manifest without a verified signature cannot replace the stored manifest of the agent",
        CLASS_CAPABILITY,
        "signature",
        "sign the replacement manifest with the registered key then reseal",
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

/// The deny report of a manifest error.
pub fn manifest_error_report(error: &ManifestError) -> DenyReport {
    match error {
        ManifestError::Unsigned | ManifestError::ProvisionalEgress => egress_refused_unsigned(),
        ManifestError::NoSigner => signer_missing(),
        ManifestError::SignatureInvalid => signature_invalid(),
        ManifestError::DigestMismatch => digest_mismatch(),
    }
}

fn signature_report(error: &ManifestError) -> DenyReport {
    match error {
        ManifestError::Unsigned => unsigned_manifest(),
        other => manifest_error_report(other),
    }
}

/// Check the signature of `manifest` over its digest view with the signer of its agent.
pub fn verify_task_signature(
    manifest: &TaskManifestV1,
    signers: &ManifestSigners,
) -> Result<(), ManifestError> {
    verify_manifest_signature(
        &compute_manifest_digest(manifest),
        manifest.signature.as_deref(),
        signers.get(&manifest.agent_id),
    )
}

fn closed_report(
    error: &str,
    wall_id: &str,
    reason: &str,
    class: &str,
    field: &str,
    fix: &str,
) -> DenyReport {
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

/// The task manifest of an ingest: the provided one, or else the stored one.
///
/// A provided manifest is digested after UCB has filled agent_id, session_id and
/// synthesized_by, so a signer signs the complete manifest. In strict mode its
/// signature must verify against the signer key registered for the agent. In
/// either mode a manifest without a verified signature never replaces a stored one.
pub fn load_or_provided(
    store: &ManifestStore,
    signers: &ManifestSigners,
    strict: StrictMode,
    agent_id: &str,
    session_id: &str,
    provided: Option<serde_json::Value>,
) -> Result<TaskManifestV1, DenyReport> {
    if let Some(raw) = provided {
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
        m.manifest_digest = compute_manifest_digest(&m);
        let verified = verify_task_signature(&m, signers);
        if let (StrictMode::On, Err(e)) = (strict, &verified) {
            return Err(signature_report(e));
        }
        if verified.is_err() && store.load(agent_id).is_some() {
            return Err(replace_unsigned());
        }
        store.save(&m).map_err(|_| manifest_missing())?;
        return Ok(m);
    }
    match store.load(agent_id) {
        Some(m) if m.provisional => Err(manifest_provisional()),
        Some(m) => {
            if m.manifest_digest != compute_manifest_digest(&m) {
                return Err(digest_mismatch());
            }
            if matches!(strict, StrictMode::On) {
                verify_task_signature(&m, signers).map_err(|e| signature_report(&e))?;
            }
            Ok(m)
        }
        None => Err(manifest_missing()),
    }
}

pub fn bind_session(manifest: &TaskManifestV1, frame_session: &str) -> Result<(), DenyReport> {
    match (manifest.session_id.as_deref(), frame_session) {
        (None, s) if !s.is_empty() => Err(session_missing()),
        (Some(_), "") => Err(session_required()),
        (Some(ms), fs) if ms != fs => Err(session_mismatch()),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{sign_provided, sign_task, signers_for};
    use aep_ucb_perimeter_v1::egress_power_allowed;
    use tempfile::tempdir;

    fn sample_provided(agent: &str) -> serde_json::Value {
        serde_json::json!({
            "manifest_version": "1",
            "id": "m1",
            "agent_id": agent,
            "session_id": "sess-1",
            "intent": {},
            "synthesized_by": "provided",
        })
    }

    fn signed_provided(agent: &str, key: &aep_lattice_crypto::SignKeypair) -> serde_json::Value {
        let mut raw = sample_provided(agent);
        sign_provided(&mut raw, key);
        raw
    }

    fn task(signature: Option<String>, provisional: bool) -> TaskManifestV1 {
        TaskManifestV1 {
            manifest_version: "1".into(),
            id: "m1".into(),
            agent_id: "agent-a".into(),
            session_id: Some("sess-1".into()),
            intent: serde_json::json!({"goal": "fetch"}),
            agentmesh: None,
            egress: Some(serde_json::json!({"routes": []})),
            mcp: None,
            provisional,
            synthesized_by: "provided".into(),
            promotion_required: vec![],
            created_at_unix: 0,
            manifest_digest: String::new(),
            signature,
            computed_fields: vec![],
        }
    }

    #[test]
    fn no_manifest_refuses() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, _) = signers_for("agent-a");
        let err = load_or_provided(&store, &signers, StrictMode::On, "agent-a", "sess-1", None)
            .unwrap_err();
        assert_eq!(err.error, "ManifestMissing");
        assert_eq!(err.closed[0].class, CLASS_STRUCTURAL);
        assert!(err.reseal_required);
    }

    #[test]
    fn provided_manifest_loads() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, key) = signers_for("agent-a");
        let m = load_or_provided(
            &store,
            &signers,
            StrictMode::On,
            "agent-a",
            "sess-1",
            Some(signed_provided("agent-a", &key)),
        )
        .unwrap();
        assert_eq!(m.agent_id, "agent-a");
        assert_eq!(m.synthesized_by, "provided");
        assert!(store.load("agent-a").is_some());
    }

    #[test]
    fn synthesis_label_refuses() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, key) = signers_for("agent-a");
        let mut raw = signed_provided("agent-a", &key);
        raw.as_object_mut().unwrap().insert(
            String::from("synthesized_by"),
            serde_json::Value::String(String::from("llm_structured")),
        );
        let err = load_or_provided(
            &store,
            &signers,
            StrictMode::On,
            "agent-a",
            "sess-1",
            Some(raw),
        )
        .unwrap_err();
        assert!(err.error.contains("synthesis"));
    }

    #[test]
    fn unsigned_cannot_egress() {
        let (signers, _) = signers_for("agent-a");
        let signed = signed_from_task(&task(None, false));
        assert!(egress_power_allowed(&signed, StrictMode::On, signers.get("agent-a")).is_err());
    }

    #[test]
    fn provisional_cannot_egress() {
        let (signers, key) = signers_for("agent-a");
        let mut m = task(None, true);
        m.signature = Some(sign_task(&m, &key));
        m.manifest_digest = compute_manifest_digest(&m);
        let signed = signed_from_task(&m);
        assert_eq!(
            egress_power_allowed(&signed, StrictMode::On, signers.get("agent-a")),
            Err(ManifestError::ProvisionalEgress)
        );
    }

    /// UCB 02: a signature field that no registered key verifies does not count.
    #[test]
    fn forged_signature_is_refused() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, _) = signers_for("agent-a");
        let mut raw = sample_provided("agent-a");
        raw.as_object_mut().unwrap().insert(
            String::from("signature"),
            serde_json::Value::String(String::from("forged")),
        );
        let err = load_or_provided(
            &store,
            &signers,
            StrictMode::On,
            "agent-a",
            "sess-1",
            Some(raw),
        );
        assert_eq!(
            err.map(|_| ()).unwrap_err().error,
            "ManifestSignatureInvalid"
        );
        assert!(store.load("agent-a").is_none());
    }

    /// UCB 02: a signature by another key and a manifest of an agent with no
    /// registered signer are refused in strict mode.
    #[test]
    fn signature_of_another_key_or_no_signer_is_refused() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, _) = signers_for("agent-a");
        let stranger = aep_lattice_crypto::generate_sign_keypair();
        let raw = signed_provided("agent-a", &stranger);
        let err = load_or_provided(
            &store,
            &signers,
            StrictMode::On,
            "agent-a",
            "sess-1",
            Some(raw),
        )
        .unwrap_err();
        assert_eq!(err.error, "ManifestSignatureInvalid");
        let raw = signed_provided("agent-b", &stranger);
        let err = load_or_provided(
            &store,
            &signers,
            StrictMode::On,
            "agent-b",
            "sess-1",
            Some(raw),
        )
        .unwrap_err();
        assert_eq!(err.error, "ManifestSignerMissing");
    }

    /// UCB 02: with strict mode off an unsigned manifest may start an agent, but it
    /// never replaces the stored manifest of the agent.
    #[test]
    fn unsigned_replacement_manifest_is_refused() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, key) = signers_for("agent-a");
        let first = load_or_provided(
            &store,
            &signers,
            StrictMode::Off,
            "agent-a",
            "sess-1",
            Some(signed_provided("agent-a", &key)),
        )
        .unwrap();
        let mut replacement = sample_provided("agent-a");
        replacement["intent"] = serde_json::json!({"goal": "widen"});
        let err = load_or_provided(
            &store,
            &signers,
            StrictMode::Off,
            "agent-a",
            "sess-1",
            Some(replacement),
        )
        .unwrap_err();
        assert_eq!(err.error, "ManifestReplaceUnsigned");
        assert_eq!(
            store.load("agent-a").map(|m| m.manifest_digest),
            Some(first.manifest_digest)
        );
        let mut signed_replacement = sample_provided("agent-a");
        signed_replacement["intent"] = serde_json::json!({"goal": "widen"});
        sign_provided(&mut signed_replacement, &key);
        assert!(load_or_provided(
            &store,
            &signers,
            StrictMode::Off,
            "agent-a",
            "sess-1",
            Some(signed_replacement),
        )
        .is_ok());
    }

    /// UCB 02: a stored manifest is checked again on load in strict mode.
    #[test]
    fn stored_manifest_signature_is_checked_on_load() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, key) = signers_for("agent-a");
        let mut planted = task(Some(String::from("operator-sig")), false);
        store.save(&planted).unwrap();
        let err = load_or_provided(&store, &signers, StrictMode::On, "agent-a", "sess-1", None)
            .unwrap_err();
        assert_eq!(err.error, "ManifestSignatureInvalid");
        planted.signature = Some(sign_task(&planted, &key));
        store.save(&planted).unwrap();
        assert!(
            load_or_provided(&store, &signers, StrictMode::On, "agent-a", "sess-1", None).is_ok()
        );
    }

    /// UCB 03: the egress check hashes the same serialization the store digested.
    #[test]
    fn stored_manifest_digest_matches_on_egress() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, key) = signers_for("agent-a");
        let mut m = task(None, false);
        m.signature = Some(sign_task(&m, &key));
        store.save(&m).unwrap();
        let loaded = store.load("agent-a").unwrap();
        let signed = signed_from_task(&loaded);
        assert_eq!(
            egress_power_allowed(&signed, StrictMode::Off, None),
            Ok(()),
            "the digest of a stored manifest must match on egress"
        );
        assert_eq!(
            egress_power_allowed(&signed, StrictMode::On, signers.get("agent-a")),
            Ok(())
        );
    }

    #[test]
    fn provided_gap_text_compiles_on_ingest() {
        let dir = tempdir().unwrap();
        let store = ManifestStore::new(dir.path().to_path_buf()).unwrap();
        let (signers, key) = signers_for("agent-a");
        let base = concat!(
            "manifest_version: 1\n",
            "id: m1\n",
            "agent_id: agent-a\n",
            "session_id: sess-1\n",
            "intent: {}\n",
            "synthesized_by: provided\n",
        );
        let draft = crate::gap_manifest::compile_provided(&format!("{base}signature: pending\n"))
            .expect("compile");
        let text = format!("{base}signature: {}\n", sign_task(&draft, &key));
        let m = load_or_provided(
            &store,
            &signers,
            StrictMode::On,
            "agent-a",
            "sess-1",
            Some(serde_json::Value::String(text)),
        )
        .unwrap();
        assert_eq!(m.synthesized_by, "provided");
        assert_eq!(m.agent_id, "agent-a");
        assert!(!m.manifest_digest.is_empty());
    }
}
