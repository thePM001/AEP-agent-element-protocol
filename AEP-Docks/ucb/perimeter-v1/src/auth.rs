//! @PAD: gaplune-creation-pad emit ( zero-LLM )
//! @GCDE: gaplune.policy.v1

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Scope {
    Ingest,
    Delegate,
    Egress,
    Rollback,
    ReadDiff,
    ReadManifest,
}

#[derive(Debug, Clone)]
pub struct AgentKey {
    pub agent_id: String,
    pub key_id: String,
    pub key_hash: String,
    pub scopes: Vec<Scope>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AuthIdentity {
    Operator,
    Agent { agent_id: String, key_id: String },
}

#[derive(Debug, thiserror::Error, PartialEq, Eq)]
pub enum AuthError {
    #[error("token refused")]
    Refused,
    #[error("scope {0:?} refused")]
    Scope(Scope),
}

pub struct AuthRegistry {
    operator_hash: String,
    agents: Vec<AgentKey>,
}

impl AuthRegistry {
    pub fn with_operator_key(operator_secret: &str) -> Self {
        Self { operator_hash: Self::hash_key(operator_secret), agents: Vec::new() }
    }

    pub fn from_operator_hash(operator_hash: &str) -> Self {
        Self { operator_hash: operator_hash.to_string(), agents: Vec::new() }
    }

    pub fn insert(&mut self, key: AgentKey) {
        self.agents.push(key);
    }

    pub fn hash_key(key: &str) -> String {
        let mut h = Sha256::new();
        h.update(key.as_bytes());
        hex::encode(h.finalize())
    }

    pub fn authorize(&self, token: &str, needed: Scope, dual_control: bool) -> Result<AuthIdentity, AuthError> {
        if token.is_empty() {
            return Err(AuthError::Refused);
        }
        let hashed = Self::hash_key(token);
        if hashed == self.operator_hash {
            return Ok(AuthIdentity::Operator);
        }
        let Some(agent) = self.agents.iter().find(|a| a.key_hash == hashed) else {
            return Err(AuthError::Refused);
        };
        if needed == Scope::Rollback && !dual_control && !agent.scopes.contains(&Scope::Rollback) {
            return Err(AuthError::Scope(Scope::Rollback));
        }
        if !agent.scopes.contains(&needed) {
            return Err(AuthError::Scope(needed));
        }
        Ok(AuthIdentity::Agent { agent_id: agent.agent_id.clone(), key_id: agent.key_id.clone() })
    }
}
