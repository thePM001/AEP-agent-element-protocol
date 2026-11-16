//! The identity of the calling agent.
//!
//! An agent proves who it is with a sealed frame, the same proof the dock of the Base
//! Node asks of an agent: the frame names the agent, the verb, the draft, the
//! repository and the second, and carries an ML-DSA-65 signature. aep-ede checks the
//! signature against the public key the operator registered for that agent in
//! agents/<agent>.pub of the operator folder. A claim without a key, a key that is not
//! the registered one or an agent the operator never registered is refused.
//!
//! The agent names itself in AEP_AGENT_ID and its secret signing seed (32 bytes, hex) in
//! the file AEP_AGENT_KEY. Neither is a control: a wrong value only fails the proof.

use crate::operator::Operator;
use crate::privilege;
use aep_lattice_crypto::{
    mldsa65_public_from_secret, mldsa65_sign_detached, mldsa65_verify_detached, SignKeypair,
};
use std::fs;

pub const FRAME_KIND: &str = "aep-ede-frame-v1";

/// The canonical bytes of a frame: each field as its length, a colon and the bytes.
pub fn frame(agent: &str, verb: &str, draft: &str, repo: &str, now: u64) -> Vec<u8> {
    let mut out = Vec::new();
    for v in [FRAME_KIND, agent, verb, draft, repo, &now.to_string()] {
        out.extend_from_slice(v.len().to_string().as_bytes());
        out.push(b':');
        out.extend_from_slice(v.as_bytes());
    }
    out
}

/// The registered public key of an agent.
pub fn registered(op: &Operator, agent: &str) -> Result<Vec<u8>, String> {
    if !crate::ident::agent_ok(agent) {
        return Err("the agent id is outside its grammar".into());
    }
    let text = {
        let _r = privilege::raise();
        fs::read_to_string(op.agents_dir().join(format!("{}.pub", agent)))
    }
    .map_err(|_| format!("the operator registered no key for the agent {}", agent))?;
    hex::decode(text.trim()).map_err(|_| format!("the registered key of {} is not hex", agent))
}

/// Read a secret seed file: 64 hex characters.
pub fn read_secret(path: &str) -> Result<Vec<u8>, String> {
    let text = fs::read_to_string(path).map_err(|e| format!("AEP_AGENT_KEY {}: {}", path, e))?;
    let seed =
        hex::decode(text.trim()).map_err(|_| "AEP_AGENT_KEY does not hold hex".to_string())?;
    if seed.len() != 32 {
        return Err("AEP_AGENT_KEY must hold a 32 byte ML-DSA-65 seed".into());
    }
    Ok(seed)
}

/// Seal a frame with the secret seed of the agent and check it against the registered
/// key. Ok carries the agent id the frame proves.
pub fn prove(
    op: &Operator,
    agent: &str,
    secret: &[u8],
    verb: &str,
    draft: &str,
    repo: &str,
    now: u64,
) -> Result<String, String> {
    let public = mldsa65_public_from_secret(secret).map_err(|e| e.to_string())?;
    let msg = frame(agent, verb, draft, repo, now);
    let sig = mldsa65_sign_detached(
        &msg,
        &SignKeypair {
            public,
            secret: secret.to_vec(),
        },
    )
    .map_err(|e| e.to_string())?;
    let want = registered(op, agent)?;
    mldsa65_verify_detached(&msg, &sig, &want).map_err(|_| {
        format!(
            "the frame of {} does not verify under its registered key",
            agent
        )
    })?;
    Ok(agent.to_string())
}

/// The agent of this process for one verb.
pub fn caller(
    op: &Operator,
    verb: &str,
    draft: &str,
    repo: &str,
    now: u64,
) -> Result<String, String> {
    let agent = std::env::var("AEP_AGENT_ID").unwrap_or_default();
    if agent.is_empty() {
        return Err(
            "AEP_AGENT_ID is empty: every agent works in the EDE under its own registered key"
                .into(),
        );
    }
    let key = std::env::var("AEP_AGENT_KEY").unwrap_or_default();
    if key.is_empty() {
        return Err(
            "AEP_AGENT_KEY is empty: name the file of the signing seed of the agent".into(),
        );
    }
    let secret = read_secret(&key)?;
    prove(op, &agent, &secret, verb, draft, repo, now)
}

/// A new signing seed and its public key, both in hex.
pub fn keygen() -> (String, String) {
    let kp = aep_lattice_crypto::generate_sign_keypair();
    (hex::encode(&kp.secret), hex::encode(&kp.public))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_is_length_prefixed() {
        assert_eq!(
            String::from_utf8(frame("a", "scan", "d", "o/r", 7)).unwrap_or_default(),
            "16:aep-ede-frame-v11:a4:scan1:d3:o/r1:7"
        );
    }
}
