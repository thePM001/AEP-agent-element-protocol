// crate: aep-isolation
// Ticket NOSHIP-286-P1. The protocol crate graph carries a process isolation
// package again. Process isolation shipped with CAW only, so this crate returns
// the contract to the AEP 2.8.x protocol graph and proves it with a seal test.
//
// The crate owns one job. It seals one operating system process against one
// isolation specification and it hands back the public ProcessSealed type.
// A seal binds pid, algorithm and specification digest, so a reused pid with a
// different specification can never satisfy the seal.

use aep_kernel_types::{seal_digest, ProcessSealed};
use serde::{Deserialize, Serialize};

pub const COMPONENT_ID: &str = "aep-isolation";
pub const TICKET: &str = "NOSHIP-286-P1";
pub const ALGORITHM_SEALED: &str = "sha256";

/// One process isolation specification. Every field is a mechanical limit,
/// so the specification digest is the whole contract.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IsolationSpec {
    pub address_space_bytes: u64,
    pub open_files: u32,
    pub processes: u32,
    pub no_new_privs: bool,
    pub seccomp_profile: String,
    pub landlock_ruleset: String,
    pub network_egress_deny: bool,
}

impl Default for IsolationSpec {
    fn default() -> Self {
        Self {
            address_space_bytes: 4 * 1024 * 1024 * 1024,
            open_files: 1024,
            processes: 256,
            no_new_privs: true,
            seccomp_profile: String::from("default"),
            landlock_ruleset: String::from("read-only-data"),
            network_egress_deny: true,
        }
    }
}

impl IsolationSpec {
    /// One canonical line per field, in a fixed order, so the digest is stable.
    pub fn canonical(&self) -> String {
        let mut out = String::new();
        out.push_str("address_space_bytes=");
        out.push_str(&self.address_space_bytes.to_string());
        out.push('\n');
        out.push_str("open_files=");
        out.push_str(&self.open_files.to_string());
        out.push('\n');
        out.push_str("processes=");
        out.push_str(&self.processes.to_string());
        out.push('\n');
        out.push_str("no_new_privs=");
        out.push_str(if self.no_new_privs { "true" } else { "false" });
        out.push('\n');
        out.push_str("seccomp_profile=");
        out.push_str(&self.seccomp_profile);
        out.push('\n');
        out.push_str("landlock_ruleset=");
        out.push_str(&self.landlock_ruleset);
        out.push('\n');
        out.push_str("network_egress_deny=");
        out.push_str(if self.network_egress_deny { "true" } else { "false" });
        out.push('\n');
        out
    }

    pub fn digest(&self) -> String {
        isolation_spec_digest(self)
    }

    /// A specification with an empty seccomp profile or no confinement at all is
    /// refused, because such a process is not isolated.
    pub fn validate(&self) -> Result<(), String> {
        if self.seccomp_profile.trim().is_empty() {
            return Err(String::from("isolation needs a seccomp profile"));
        }
        if self.landlock_ruleset.trim().is_empty() {
            return Err(String::from("isolation needs a landlock ruleset"));
        }
        if self.no_new_privs == false {
            return Err(String::from("isolation needs no_new_privs"));
        }
        if self.address_space_bytes == 0 {
            return Err(String::from("isolation needs an address space bound"));
        }
        Ok(())
    }
}

/// Digest over the canonical specification.
pub fn isolation_spec_digest(spec: &IsolationSpec) -> String {
    seal_digest(0, ALGORITHM_SEALED, &spec.canonical())
}

/// Seal one process against one specification. The seal is the identity of the pair.
pub fn seal_process(
    pid: u32,
    spec: &IsolationSpec,
    sealed_at_ms: i64,
) -> Result<ProcessSealed, String> {
    if pid == 0 {
        return Err(String::from("a seal needs a live process id"));
    }
    spec.validate()?;
    Ok(ProcessSealed::seal(
        pid,
        ALGORITHM_SEALED,
        spec.digest(),
        sealed_at_ms,
    ))
}

/// A seal holds only for the same process and the same specification.
pub fn seal_holds(sealed: &ProcessSealed, pid: u32, spec: &IsolationSpec) -> bool {
    sealed.matches(pid, ALGORITHM_SEALED, &spec.digest())
}

/// One process may be sealed once. A second seal for the same pid is refused,
/// so a caller cannot widen the specification behind a live seal.
pub fn seal_once(
    seen: &mut Vec<ProcessSealed>,
    pid: u32,
    spec: &IsolationSpec,
    sealed_at_ms: i64,
) -> Result<ProcessSealed, String> {
    if seen.iter().any(|s| s.pid == pid) {
        return Err(String::from("process already sealed"));
    }
    let sealed = seal_process(pid, spec, sealed_at_ms)?;
    seen.push(sealed.clone());
    Ok(sealed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn seal_binds_the_process_and_the_specification() {
        let spec = IsolationSpec::default();
        let sealed = seal_process(4242, &spec, 1).expect("seal");
        assert_eq!(sealed.is_sealed(), true);
        assert_eq!(seal_holds(&sealed, 4242, &spec), true);
        assert_eq!(sealed.algorithm.as_str(), ALGORITHM_SEALED);
    }

    #[test]
    fn a_reused_pid_with_a_looser_specification_fails_the_seal() {
        let spec = IsolationSpec::default();
        let sealed = seal_process(4242, &spec, 1).expect("seal");
        let mut looser = spec.clone();
        looser.network_egress_deny = false;
        assert_eq!(seal_holds(&sealed, 4242, &looser), false);
        assert_eq!(seal_holds(&sealed, 4243, &spec), false);
    }

    #[test]
    fn the_same_specification_seals_to_the_same_digest() {
        let one = IsolationSpec::default();
        let two = IsolationSpec::default();
        assert_eq!(one.digest(), two.digest());
        let mut other = one.clone();
        other.open_files = 2048;
        assert_eq!(one.digest() == other.digest(), false);
    }

    #[test]
    fn an_unconfined_process_is_refused() {
        let mut spec = IsolationSpec::default();
        spec.no_new_privs = false;
        assert_eq!(seal_process(7, &spec, 1).is_err(), true);
        let mut empty = IsolationSpec::default();
        empty.seccomp_profile = String::new();
        assert_eq!(seal_process(7, &empty, 1).is_err(), true);
        assert_eq!(seal_process(0, &IsolationSpec::default(), 1).is_err(), true);
    }

    #[test]
    fn a_process_seals_once() {
        let spec = IsolationSpec::default();
        let mut seen: Vec<ProcessSealed> = Vec::new();
        assert_eq!(seal_once(&mut seen, 99, &spec, 1).is_ok(), true);
        assert_eq!(seal_once(&mut seen, 99, &spec, 2).is_err(), true);
        assert_eq!(seen.len(), 1);
    }
}
