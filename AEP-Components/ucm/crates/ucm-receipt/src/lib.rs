//! Signed UCM receipts. A receipt is a JSON object that validates against
//! AEP-Base-Node/AEP-Registry/schemas/ucm-receipt-v1.json. It carries the program, the
//! inputs, the result and an ML-DSA-65 signature over the JCS bytes of every other field,
//! so anyone holding the receipt can check the signature and replay the calculation.

#![forbid(unsafe_code)]

use aep_lattice_crypto::{generate_sign_keypair, mldsa65_public_from_secret, mldsa65_sign_detached, mldsa65_verify_detached, SignKeypair};
use aep_ucm_core::{canon, evaluate, input_digest, program_hash, Library, Limits, Outcome, Program};
use serde_json::{json, Map, Value as J};
use std::path::Path;
use thiserror::Error;

pub const RECEIPT_SCHEMA: &str = "ucm-receipt-v1";
pub const KEY_SCHEMA: &str = "ucm-node-key-v1";

#[derive(Debug, Error)]
pub enum ReceiptError {
    #[error("receipt form: {0}")]
    Form(String),
    #[error("receipt id does not match its body")]
    IdMismatch,
    #[error("signature invalid")]
    BadSignature,
    #[error("signer key is not trusted")]
    Untrusted,
    #[error("replay gave a different result digest")]
    ResultMismatch,
    #[error("replay failed: {0}")]
    Replay(String),
    #[error("key store: {0}")]
    Key(String),
    #[error(transparent)]
    Ucm(#[from] aep_ucm_core::UcmError),
}

impl ReceiptError {
    /// Stable code, used by Admit deny kinds and the HTTP API.
    pub fn code(&self) -> &'static str {
        match self {
            ReceiptError::Form(_) => "receipt_form",
            ReceiptError::IdMismatch => "receipt_id_mismatch",
            ReceiptError::BadSignature => "receipt_bad_signature",
            ReceiptError::Untrusted => "receipt_untrusted_signer",
            ReceiptError::ResultMismatch => "result_mismatch",
            ReceiptError::Replay(_) => "replay_failed",
            ReceiptError::Key(_) => "key_store",
            ReceiptError::Ucm(e) => e.code(),
        }
    }
}

pub type Result<T> = std::result::Result<T, ReceiptError>;

/// The signing key of one UCM node.
#[derive(Clone)]
pub struct NodeKey {
    keypair: SignKeypair,
    pub node_id: String,
    pub public_hex: String,
}

impl std::fmt::Debug for NodeKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("NodeKey").field("node_id", &self.node_id).finish_non_exhaustive()
    }
}

pub fn node_id_for(public_hex: &str) -> String {
    format!("ucm-node-{}", &canon::sha3_hex(public_hex.as_bytes())[..16])
}

impl NodeKey {
    pub fn generate() -> NodeKey {
        Self::from_keypair(generate_sign_keypair())
    }

    fn from_keypair(keypair: SignKeypair) -> NodeKey {
        let public_hex = hex::encode(&keypair.public);
        NodeKey {
            node_id: node_id_for(&public_hex),
            public_hex,
            keypair,
        }
    }

    pub fn from_secret_hex(secret_hex: &str) -> Result<NodeKey> {
        let secret = hex::decode(secret_hex.trim()).map_err(|_| ReceiptError::Key("secret is not hex".into()))?;
        let public = mldsa65_public_from_secret(&secret).map_err(|e| ReceiptError::Key(e.to_string()))?;
        Ok(Self::from_keypair(SignKeypair { public, secret }))
    }

    /// Load the key file. Create it with mode 0600 when it does not exist.
    pub fn load_or_create(path: &Path) -> Result<NodeKey> {
        if path.exists() {
            let raw = std::fs::read_to_string(path).map_err(|e| ReceiptError::Key(format!("{}: {e}", path.display())))?;
            let v: J = serde_json::from_str(&raw).map_err(|e| ReceiptError::Key(format!("key file is not JSON: {e}")))?;
            if v.get("ucm").and_then(|x| x.as_str()) != Some(KEY_SCHEMA) {
                return Err(ReceiptError::Key(format!("key file field ucm must be {KEY_SCHEMA}")));
            }
            let secret = v
                .get("secret")
                .and_then(|x| x.as_str())
                .ok_or_else(|| ReceiptError::Key("key file has no secret".into()))?;
            return Self::from_secret_hex(secret);
        }
        if let Some(dir) = path.parent() {
            std::fs::create_dir_all(dir).map_err(|e| ReceiptError::Key(format!("{}: {e}", dir.display())))?;
        }
        let k = Self::generate();
        let body = json!({ "ucm": KEY_SCHEMA, "node_id": k.node_id, "public": k.public_hex, "secret": hex::encode(&k.keypair.secret) });
        write_private(path, &serde_json::to_string_pretty(&body).unwrap_or_default())?;
        let pub_path = path.with_extension("pub");
        std::fs::write(&pub_path, format!("{}\n", k.public_hex)).map_err(|e| ReceiptError::Key(format!("{}: {e}", pub_path.display())))?;
        Ok(k)
    }

    fn sign(&self, msg: &[u8]) -> Result<String> {
        Ok(hex::encode(
            mldsa65_sign_detached(msg, &self.keypair).map_err(|e| ReceiptError::Key(e.to_string()))?,
        ))
    }
}

#[cfg(unix)]
fn write_private(path: &Path, text: &str) -> Result<()> {
    use std::io::Write;
    use std::os::unix::fs::OpenOptionsExt;
    let mut f = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(path)
        .map_err(|e| ReceiptError::Key(format!("{}: {e}", path.display())))?;
    f.write_all(text.as_bytes()).map_err(|e| ReceiptError::Key(e.to_string()))
}

#[cfg(not(unix))]
fn write_private(path: &Path, text: &str) -> Result<()> {
    std::fs::write(path, text).map_err(|e| ReceiptError::Key(e.to_string()))
}

/// Who wrote the program: the agent itself or a reviewed library formula it copied.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProgramSource {
    Agent,
    Library,
}

impl ProgramSource {
    pub fn as_str(self) -> &'static str {
        match self {
            ProgramSource::Agent => "agent",
            ProgramSource::Library => "library",
        }
    }

    pub fn parse(s: &str) -> Result<ProgramSource> {
        match s {
            "agent" => Ok(ProgramSource::Agent),
            "library" => Ok(ProgramSource::Library),
            other => Err(ReceiptError::Form(format!("program_source must be agent or library, got {other}"))),
        }
    }
}

fn bool_text(b: bool) -> J {
    J::String(if b { "true" } else { "false" }.into())
}

/// Fields that the receipt id and the signature cover.
fn body_of(r: &Map<String, J>) -> Map<String, J> {
    let mut b = r.clone();
    b.remove("receipt_id");
    b.remove("signature");
    b
}

/// Build and sign a receipt for an evaluation that already ran.
pub fn issue(key: &NodeKey, program: &Program, inputs: &J, outcome: &Outcome, lib: &Library, source: ProgramSource) -> Result<J> {
    let result = outcome.result_json();
    let mut body = Map::new();
    body.insert("ucm".into(), J::String(RECEIPT_SCHEMA.into()));
    body.insert("program".into(), program.to_json());
    body.insert("program_hash".into(), J::String(program_hash(program)?));
    body.insert("inputs".into(), if inputs.is_null() { json!({}) } else { inputs.clone() });
    body.insert("input_digest".into(), J::String(input_digest(inputs)?));
    body.insert(
        "library_digests".into(),
        J::Array(if outcome.library_used {
            vec![J::String(lib.digest.clone())]
        } else {
            Vec::new()
        }),
    );
    body.insert("engine_build".into(), J::String(aep_ucm_core::engine_build()));
    body.insert("budget_limits".into(), outcome.limits.to_json());
    body.insert("budget_used".into(), outcome.budget_used.clone());
    body.insert("float_used".into(), bool_text(outcome.float_used));
    body.insert("program_source".into(), J::String(source.as_str().into()));
    body.insert("result".into(), result.clone());
    body.insert("result_digest".into(), J::String(canon::digest(&result)?));
    body.insert("node_id".into(), J::String(key.node_id.clone()));
    body.insert("public_key".into(), J::String(key.public_hex.clone()));
    body.insert(
        "issued_at".into(),
        J::String(chrono::Utc::now().format("%Y-%m-%dT%H:%M:%SZ").to_string()),
    );
    let id_digest = canon::digest(&J::Object(body.clone()))?;
    let receipt_id = format!("ucmr_{}", &id_digest[..32]);
    let mut signed = body;
    signed.insert("receipt_id".into(), J::String(receipt_id));
    let sig = key.sign(canon::canonical(&J::Object(signed.clone()))?.as_bytes())?;
    signed.insert("signature".into(), J::String(sig));
    Ok(J::Object(signed))
}

fn field<'a>(r: &'a Map<String, J>, k: &str) -> Result<&'a str> {
    r.get(k)
        .and_then(|x| x.as_str())
        .ok_or_else(|| ReceiptError::Form(format!("field {k} must be a string")))
}

const FIELDS: [&str; 18] = [
    "ucm",
    "program",
    "program_hash",
    "inputs",
    "input_digest",
    "library_digests",
    "engine_build",
    "budget_limits",
    "budget_used",
    "float_used",
    "program_source",
    "result",
    "result_digest",
    "node_id",
    "public_key",
    "issued_at",
    "receipt_id",
    "signature",
];

/// What a signature check found.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignatureCheck {
    pub receipt_id: String,
    pub node_id: String,
    pub trusted: bool,
}

/// Check form, receipt id, internal digests and the ML-DSA-65 signature. `trusted_keys` holds
/// the hex public keys whose receipts count; an empty set reports trusted = false.
pub fn verify_signature(receipt: &J, trusted_keys: &[String]) -> Result<SignatureCheck> {
    let r = receipt
        .as_object()
        .ok_or_else(|| ReceiptError::Form("receipt must be an object".into()))?;
    if field(r, "ucm")? != RECEIPT_SCHEMA {
        return Err(ReceiptError::Form(format!("field ucm must be {RECEIPT_SCHEMA}")));
    }
    for k in r.keys() {
        if !FIELDS.contains(&k.as_str()) {
            return Err(ReceiptError::Form(format!("unknown field {k}")));
        }
    }
    let receipt_id = field(r, "receipt_id")?.to_string();
    let body = body_of(r);
    let id_digest = canon::digest(&J::Object(body.clone()))?;
    if receipt_id != format!("ucmr_{}", &id_digest[..32]) {
        return Err(ReceiptError::IdMismatch);
    }
    let program = Program::from_json(r.get("program").ok_or_else(|| ReceiptError::Form("missing program".into()))?)?;
    if program_hash(&program)? != field(r, "program_hash")? {
        return Err(ReceiptError::Form("program_hash does not match program".into()));
    }
    if input_digest(r.get("inputs").ok_or_else(|| ReceiptError::Form("missing inputs".into()))?)? != field(r, "input_digest")? {
        return Err(ReceiptError::Form("input_digest does not match inputs".into()));
    }
    if canon::digest(r.get("result").ok_or_else(|| ReceiptError::Form("missing result".into()))?)? != field(r, "result_digest")? {
        return Err(ReceiptError::Form("result_digest does not match result".into()));
    }
    ProgramSource::parse(field(r, "program_source")?)?;
    let public_hex = field(r, "public_key")?;
    if node_id_for(public_hex) != field(r, "node_id")? {
        return Err(ReceiptError::Form("node_id does not match public_key".into()));
    }
    let public = hex::decode(public_hex).map_err(|_| ReceiptError::Form("public_key is not hex".into()))?;
    let sig = hex::decode(field(r, "signature")?).map_err(|_| ReceiptError::Form("signature is not hex".into()))?;
    let mut signed = body;
    signed.insert("receipt_id".into(), J::String(receipt_id.clone()));
    let msg = canon::canonical(&J::Object(signed))?;
    mldsa65_verify_detached(msg.as_bytes(), &sig, &public).map_err(|_| ReceiptError::BadSignature)?;
    let trusted = trusted_keys.iter().any(|k| k.trim().eq_ignore_ascii_case(public_hex));
    Ok(SignatureCheck {
        receipt_id,
        node_id: field(r, "node_id")?.to_string(),
        trusted,
    })
}

fn limits_from(v: &J) -> Result<Limits> {
    let g = |k: &str| -> Result<u64> {
        v.get(k)
            .and_then(|x| x.as_str())
            .and_then(|x| x.parse().ok())
            .ok_or_else(|| ReceiptError::Form(format!("budget_limits.{k}")))
    };
    Ok(Limits {
        steps: g("steps")?,
        bits: g("bits")?,
        len: g("len")?,
        millis: g("millis")?,
    })
}

/// Check the signature, then run the program again on this engine and compare result digests.
/// The replay refuses when this engine build differs from the one that issued the receipt.
pub fn verify_replay(receipt: &J, trusted_keys: &[String], lib: &Library) -> Result<SignatureCheck> {
    let check = verify_signature(receipt, trusted_keys)?;
    let r = receipt
        .as_object()
        .ok_or_else(|| ReceiptError::Form("receipt must be an object".into()))?;
    let build = field(r, "engine_build")?;
    if build != aep_ucm_core::engine_build() {
        return Err(ReceiptError::Replay(format!(
            "receipt engine {build} differs from this engine {}",
            aep_ucm_core::engine_build()
        )));
    }
    let digests = r
        .get("library_digests")
        .and_then(|x| x.as_array())
        .ok_or_else(|| ReceiptError::Form("library_digests".into()))?;
    if digests.iter().any(|d| d.as_str() != Some(lib.digest.as_str())) {
        return Err(ReceiptError::Replay("receipt used a different library".into()));
    }
    let program = Program::from_json(&r["program"])?;
    // Wall time may differ between hosts, so the replay keeps the step, bit and length limits
    // and allows the ceiling for time.
    let mut limits = limits_from(&r["budget_limits"])?;
    limits.millis = Limits::CEILING.millis;
    let outcome = evaluate(&program, &r["inputs"], limits, lib).map_err(|e| ReceiptError::Replay(e.to_string()))?;
    if canon::digest(&outcome.result_json())? != field(r, "result_digest")? {
        return Err(ReceiptError::ResultMismatch);
    }
    Ok(check)
}

/// Digest that a ledger chains: SHA3-256 over the JCS bytes of the whole signed receipt.
pub fn receipt_digest(receipt: &J) -> Result<String> {
    Ok(canon::digest(receipt)?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_ucm_core::load_program;

    fn sample(key: &NodeKey, lib: &Library) -> J {
        let p = load_program(Some("input p: money[EUR];\nround(p * 1.081, 2, \"half_even\")"), None).expect("p");
        let inputs = json!({ "p": "19.90 EUR" });
        let o = evaluate(&p, &inputs, Limits::DEFAULT, lib).expect("eval");
        issue(key, &p, &inputs, &o, lib, ProgramSource::Agent).expect("issue")
    }

    #[test]
    fn issue_verify_replay() {
        let lib = Library::builtin().expect("lib");
        let key = NodeKey::generate();
        let r = sample(&key, &lib);
        let trusted = vec![key.public_hex.clone()];
        let c = verify_signature(&r, &trusted).expect("sig");
        assert!(c.trusted);
        assert!(!verify_signature(&r, &[]).expect("sig").trusted);
        verify_replay(&r, &trusted, &lib).expect("replay");
        assert_eq!(r["result"]["decimal"], "21.51");
    }

    #[test]
    fn tampering_is_refused() {
        let lib = Library::builtin().expect("lib");
        let key = NodeKey::generate();
        let r = sample(&key, &lib);
        let trusted = vec![key.public_hex.clone()];

        let mut a = r.clone();
        a["result"]["value"] = J::String("2200/100".into());
        assert!(verify_signature(&a, &trusted).is_err());

        let mut b = r.clone();
        b["inputs"]["p"] = J::String("1.00 EUR".into());
        assert!(verify_signature(&b, &trusted).is_err());

        // A forger who recomputes every digest and the id still cannot sign.
        let mut c = r.clone();
        c["result"] = json!({"type": "money", "currency": "EUR", "value": "22", "decimal": "22"});
        c["result_digest"] = J::String(canon::digest(&c["result"]).expect("d"));
        let id = canon::digest(&J::Object(body_of(c.as_object().expect("o")))).expect("d");
        c["receipt_id"] = J::String(format!("ucmr_{}", &id[..32]));
        assert!(matches!(verify_signature(&c, &trusted), Err(ReceiptError::BadSignature)));

        // A receipt from another key verifies as a signature but is not trusted.
        let other = NodeKey::generate();
        let d = sample(&other, &lib);
        assert!(!verify_signature(&d, &trusted).expect("sig").trusted);
    }

    #[test]
    fn key_file_round_trip() {
        let dir = std::env::temp_dir().join(format!("ucm-key-test-{}", std::process::id()));
        let path = dir.join("ucm-sign.key");
        let _ = std::fs::remove_dir_all(&dir);
        let a = NodeKey::load_or_create(&path).expect("create");
        let b = NodeKey::load_or_create(&path).expect("load");
        assert_eq!(a.public_hex, b.public_hex);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mode = std::fs::metadata(&path).expect("meta").permissions().mode() & 0o777;
            assert_eq!(mode, 0o600);
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}
