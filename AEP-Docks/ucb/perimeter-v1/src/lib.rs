//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1
//!
//! AEP 2.8.5 UCB perimeter-v1 library. Default profile is signed provenance,
//! schema plus byte caps, scanner-backed P_C, replay window, per-agent keys,
//! signed manifests and a hash-chained evidence log. Paper 005 VSA stays off
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
pub use manifest::{digest_canonical, egress_power_allowed, ManifestError, SignedManifest, StrictMode};
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
    fn paper005_stays_off() {
        let p = Provenance::bound("langgraph", "1.0", "sess-1");
        let payload = json!({"subject": "x", "predicate": "y", "object": "z"});
        let view = IngestView {
            provenance: Some(&p),
            payload: &payload,
            content_type: Some("application/json"),
            body_len: 32,
            prior_fingerprints: &[],
        };
        let v = validate_ingest(PredicateProfile::Paper005Vsa, &view, &DefaultScannerPack);
        assert!(!v.ok);
        assert_eq!(v.predicate, Some("profile"));
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

    #[test]
    fn unsigned_manifest_refused() {
        let m = SignedManifest {
            body: json!({"agent_id": "agent-1"}),
            digest: String::new(),
            signature: None,
            provisional: false,
        };
        assert!(matches!(egress_power_allowed(&m, StrictMode::On), Err(ManifestError::Unsigned)));
    }

    #[test]
    fn provisional_cannot_egress() {
        let body = json!({"agent_id": "agent-1"});
        let digest = digest_canonical(&body);
        let m = SignedManifest {
            body,
            digest,
            signature: Some("operator-sig".into()),
            provisional: true,
        };
        assert!(matches!(egress_power_allowed(&m, StrictMode::On), Err(ManifestError::ProvisionalEgress)));
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
        assert!(reg.authorize("agent-secret", Scope::Rollback, false).is_err());
        assert!(reg.authorize("operator-secret", Scope::Rollback, false).is_ok());
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
