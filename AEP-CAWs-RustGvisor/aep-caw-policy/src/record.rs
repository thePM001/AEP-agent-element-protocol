//! The resolved profile record, the only policy input of the CAW.
//!
//! The GAP compiler writes one record per profile: the profile with its mount
//! policies, its egress policy and its toolset in one JSON value with a sha256
//! digest. A key the record does not know is refused here, so a newer field never
//! passes unread.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::canonical::digest_without_field;
use crate::error::PolicyError;

/// Kind of the record.
pub const RECORD_KIND: &str = "aep.caw.resolved_profile";
/// Version of the record this engine reads.
pub const RECORD_VERSION: u64 = 1;
/// The only tier the CAW runs.
pub const TIER_GVISOR: &str = "gvisor";

/// One resolved CAW profile.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolvedProfile {
    /// Kind of the record.
    pub record: String,
    /// Version of the record.
    pub version: u64,
    /// Id of the profile.
    pub profile_id: String,
    /// GAP address of the instruction that carries the profile.
    pub gap_address: Option<String>,
    /// Enforcement tier.
    pub enforcement_tier: String,
    /// True when the route to the model gateway is open.
    pub llm_proxy: bool,
    /// True when programs inside the mounts may run.
    pub compiled_runtime: bool,
    /// Rules that hold for the whole session.
    pub base_policy: Policy,
    /// The mounted folder trees.
    pub mounts: Vec<Mount>,
    /// The routes out of the sandbox. `None` means no network at all.
    pub egress_policy: Option<EgressPolicy>,
    /// The programs of the sandbox.
    pub toolset: Toolset,
    /// sha256 over the canonical JSON of the record without this field.
    pub digest: String,
}

/// A named set of file rules and command rules.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Policy {
    /// Name of the policy.
    pub name: String,
    /// Rules on folder trees.
    pub file_rules: Vec<FileRule>,
    /// Rules on program names.
    pub command_rules: Vec<CommandRule>,
}

/// One rule on folder trees.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileRule {
    /// Name of the rule.
    pub name: String,
    /// Patterns, each a folder or a folder with `/**`.
    pub paths: Vec<String>,
    /// Operations the rule covers.
    pub operations: Vec<String>,
    /// `allow` or `deny`.
    pub decision: String,
}

/// One rule on program names.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CommandRule {
    /// Name of the rule.
    pub name: String,
    /// Program names.
    pub commands: Vec<String>,
    /// `allow` or `deny`.
    pub decision: String,
}

/// One mounted folder tree with its policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Mount {
    /// Path of the folder, with variables as written.
    pub path: String,
    /// Policy of the mount. Its rules use the variable `MOUNT_PATH`.
    pub policy: Policy,
}

/// A named list of routes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EgressPolicy {
    /// Name of the policy.
    pub name: String,
    /// What happens to a destination with no route. Always `deny`.
    pub unmatched: String,
    /// The routes.
    pub routes: Vec<Route>,
}

/// One route.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Route {
    /// Name of the route.
    pub name: String,
    /// `http` or `https`.
    pub scheme: String,
    /// Host name, wildcard under one domain or one variable.
    pub host: String,
    /// Port.
    pub port: u16,
    /// `allow` or `deny`.
    pub decision: String,
}

/// A named list of programs.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Toolset {
    /// Name of the toolset.
    pub name: String,
    /// The programs.
    pub programs: Vec<Program>,
}

/// One program of a toolset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Program {
    /// Name of the program.
    pub name: String,
    /// Path of the program on the host.
    pub source: String,
    /// Path of the program inside the sandbox.
    pub path: String,
}

/// Parses a record and checks its digest, its kind, its version and its tier.
pub fn parse_record(text: &str) -> Result<ResolvedProfile, PolicyError> {
    let value: Value = serde_json::from_str(text).map_err(|e| PolicyError::Shape(e.to_string()))?;
    let kind = value.get("record").and_then(Value::as_str).unwrap_or("");
    let version = value.get("version").and_then(Value::as_u64).unwrap_or(0);
    if kind != RECORD_KIND || version != RECORD_VERSION {
        return Err(PolicyError::RecordKind {
            found: format!("{kind:?} version {version}"),
        });
    }
    let stated = value.get("digest").and_then(Value::as_str).unwrap_or("");
    if stated.is_empty() || stated != digest_without_field(&value) {
        return Err(PolicyError::Digest);
    }
    let record: ResolvedProfile =
        serde_json::from_value(value).map_err(|e| PolicyError::Shape(e.to_string()))?;
    if record.enforcement_tier != TIER_GVISOR {
        return Err(PolicyError::Tier(record.enforcement_tier));
    }
    Ok(record)
}
