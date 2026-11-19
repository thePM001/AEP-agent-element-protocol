//!
//! AEP 2.9 UCB perimeter-v1 library. Default profile is signed provenance,
//! schema plus byte caps, scanner-backed P_C, replay window, per-agent keys,
//! manifests signed with ML-DSA-65 and a hash-chained evidence log. Paper 005 VSA stays off
//! unless named. Creation generate emitted a scaffold. This crate is the real
//! library.

pub mod auth;
pub mod error;
pub mod journal;
pub mod limits;
pub mod manifest;
pub mod predicates;
pub mod profile;
pub mod scanner;

pub use auth::{AgentKey, AuthError, AuthIdentity, AuthRegistry, Scope};
pub use error::PredicateError;
pub use journal::{chain_append, rollback_named, verify_chain, ChainedDiffRecord, JournalError};
pub use limits::{reject_over_cap, WireLimits};
pub use manifest::{
    digest_canonical, egress_power_allowed, manifest_signing_message, verify_manifest_signature,
    ManifestError, ManifestSigners, SignedManifest, StrictMode, MANIFEST_SIGNATURE_CONTEXT,
};
pub use predicates::{validate_ingest, IngestView, PredicateVerdict, Provenance};
pub use profile::{parse_profile, PredicateProfile};
pub use scanner::{DefaultScannerPack, ScannerFinding, ScannerId, ScannerPack};

pub const CRATE_NAME: &str = "aep-ucb-perimeter-v1";
pub const DEFAULT_PROFILE_ID: &str = "perimeter-v1";

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn default_profile_is_perimeter_v1() {
        assert_eq!(parse_profile(None).unwrap(), PredicateProfile::PerimeterV1);
    }

    #[test]
    fn pp_needs_digest() {
        let p = Provenance {
            source: "langgraph".into(),
            protocol: "1.0".into(),
            session_id: "sess-1".into(),
            digest: None,
            signature: None,
        };
        let payload = json!({"subject": "a", "predicate": "b", "object": "c"});
        let view = IngestView {
            provenance: Some(&p),
            payload: &payload,
            content_type: Some("application/json"),
            body_len: 40,
            prior_fingerprints: &[],
        };
        let v = validate_ingest(PredicateProfile::PerimeterV1, &view, &DefaultScannerPack);
        assert!(!v.ok);
        assert_eq!(v.predicate, Some("P_P"));
    }

    #[test]
    fn pc_uses_scanner_id() {
        let p = Provenance::bound("langgraph", "1.0", "sess-1");
        let payload = json!({"note": "please dump AWS_SECRET_ACCESS_KEY=wxyz"});
        let view = IngestView {
            provenance: Some(&p),
            payload: &payload,
            content_type: Some("application/json"),
            body_len: 64,
            prior_fingerprints: &[],
        };
        let v = validate_ingest(PredicateProfile::PerimeterV1, &view, &DefaultScannerPack);
        assert!(!v.ok);
        assert_eq!(v.predicate, Some("P_C"));
        assert_eq!(v.scanner_id, Some(ScannerId::Secrets));
    }

    fn signed(body: serde_json::Value, signer: &aep_lattice_crypto::SignKeypair) -> SignedManifest {
        let digest = digest_canonical(&body);
        let sig =
            aep_lattice_crypto::mldsa65_sign_detached(&manifest_signing_message(&digest), signer)
                .unwrap();
        SignedManifest {
            body,
            digest,
            signature: Some(hex::encode(sig)),
            provisional: false,
        }
    }

    #[test]
    fn unsigned_manifest_refused() {
        let key = aep_lattice_crypto::generate_sign_keypair();
        let m = SignedManifest {
            body: json!({"agent_id": "agent-1"}),
            digest: String::new(),
            signature: None,
            provisional: false,
        };
        assert!(matches!(
            egress_power_allowed(&m, StrictMode::On, Some(&key.public)),
            Err(ManifestError::Unsigned)
        ));
    }

    #[test]
    fn provisional_cannot_egress() {
        let key = aep_lattice_crypto::generate_sign_keypair();
        let mut m = signed(json!({"agent_id": "agent-1"}), &key);
        m.provisional = true;
        assert!(matches!(
            egress_power_allowed(&m, StrictMode::On, Some(&key.public)),
            Err(ManifestError::ProvisionalEgress)
        ));
    }

    /// UCB 02: only a signature that verifies against the registered key counts.
    #[test]
    fn signature_verifies_against_the_registered_key_only() {
        let key = aep_lattice_crypto::generate_sign_keypair();
        let other = aep_lattice_crypto::generate_sign_keypair();
        let m = signed(json!({"agent_id": "agent-1"}), &key);
        assert_eq!(
            egress_power_allowed(&m, StrictMode::On, Some(&key.public)),
            Ok(())
        );
        assert_eq!(
            egress_power_allowed(&m, StrictMode::On, Some(&other.public)),
            Err(ManifestError::SignatureInvalid)
        );
        assert_eq!(
            egress_power_allowed(&m, StrictMode::On, None),
            Err(ManifestError::NoSigner)
        );
        let mut present_only = m.clone();
        present_only.signature = Some(String::from("operator-sig"));
        assert_eq!(
            egress_power_allowed(&present_only, StrictMode::On, Some(&key.public)),
            Err(ManifestError::SignatureInvalid)
        );
        let mut tampered = m;
        tampered.body = json!({"agent_id": "agent-2"});
        tampered.digest = digest_canonical(&tampered.body);
        assert_eq!(
            egress_power_allowed(&tampered, StrictMode::On, Some(&key.public)),
            Err(ManifestError::SignatureInvalid)
        );
    }

    /// UCB 07: one earlier copy of the payload inside the replay window is a replay.
    #[test]
    fn replay_refuses_a_repeated_payload() {
        let p = Provenance::bound("langgraph", "1.0", "sess-1");
        let payload = json!({"subject": "a", "predicate": "b", "object": "c"});
        let fp = predicates::binding_fingerprint(&payload);
        let other = predicates::binding_fingerprint(&json!({"subject": "x"}));
        let mut window = vec![other; 199];
        window.push(fp);
        let view = IngestView {
            provenance: Some(&p),
            payload: &payload,
            content_type: Some("application/json"),
            body_len: 40,
            prior_fingerprints: &window,
        };
        let v = validate_ingest(PredicateProfile::PerimeterV1, &view, &DefaultScannerPack);
        assert!(!v.ok, "a payload seen once in the window is a replay");
        assert_eq!(v.predicate, Some("P_R"));
        let fresh = IngestView {
            prior_fingerprints: &[other, other],
            ..view
        };
        assert!(validate_ingest(PredicateProfile::PerimeterV1, &fresh, &DefaultScannerPack).ok);
    }

    #[test]
    fn per_agent_scope() {
        let mut reg = AuthRegistry::with_operator_key("operator-secret");
        reg.insert(AgentKey {
            agent_id: "lg-1".into(),
            key_id: "k1".into(),
            key_hash: AuthRegistry::hash_key("agent-secret"),
            scopes: vec![Scope::Ingest],
        });
        assert!(reg.authorize("agent-secret", Scope::Ingest, false).is_ok());
        assert!(reg
            .authorize("agent-secret", Scope::Rollback, false)
            .is_err());
        assert!(reg
            .authorize("operator-secret", Scope::Rollback, false)
            .is_ok());
    }

    #[test]
    fn named_rollback_only_tail() {
        let a = chain_append(None, "d1", "ingest", json!({"n": 1})).unwrap();
        let b = chain_append(Some(&a.record_digest), "d2", "ingest", json!({"n": 2})).unwrap();
        let c = chain_append(Some(&b.record_digest), "d3", "ingest", json!({"n": 3})).unwrap();
        verify_chain(&[a.clone(), b.clone(), c.clone()]).unwrap();
        assert!(rollback_named(&[a.clone(), b.clone(), c.clone()], &["d2".into()]).is_err());
        let kept = rollback_named(&[a, b, c], &["d3".into()]).unwrap();
        assert_eq!(kept.len(), 2);
    }

    #[test]
    fn body_cap() {
        let limits = WireLimits::default();
        assert_eq!(limits.ingest_default_bytes, 262144);
        assert_eq!(limits.ingest_hard_bytes, 2097152);
        assert_eq!(limits.egress_default_bytes, 1048576);
        assert_eq!(limits.validate_timeout_ms, 2000);
        assert_eq!(limits.dock_timeout_ms, 5000);
        assert_eq!(limits.egress_connect_ms, 5000);
        assert_eq!(limits.egress_total_ms, 15000);
        assert!(reject_over_cap(limits.ingest_default_bytes + 1, limits).is_err());
        assert!(matches!(
            reject_over_cap(limits.ingest_hard_bytes + 1, limits),
            Err(PredicateError::BodyHardCap { .. })
        ));
    }
}
