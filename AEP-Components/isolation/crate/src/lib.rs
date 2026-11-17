// crate: aep-isolation
// The protocol crate graph carries a process isolation
// package again. Process isolation shipped with CAW only, so this crate returns
// the contract to the AEP 2.9 protocol graph and proves it with a seal test.
//
// The crate owns one job. It records one operating system process against one
// isolation specification and it hands back the public ProcessSealed record.
// A seal binds pid, algorithm and specification digest, so a reused pid with a
// different specification can never satisfy the seal.
//
// This crate is a seal record contract and it is not an enforcer. It applies no
// restriction of its own, because it makes no system call. The Rust CAW in
// AEP-CAWs-RustGvisor confines a process inside gVisor. A seal on its own is a
// record and not confinement.

use aep_kernel_types::{seal_digest, ProcessSealed};
use serde::{Deserialize, Serialize};

pub const COMPONENT_ID: &str = "aep-isolation";
pub const TICKET: &str = "kernel-type-set";
pub const ALGORITHM_SEALED: &str = "sha256";

/// One isolation specification as recorded data. Every field is a mechanical
/// limit and the specification digest is the whole contract. The host sandbox
/// reads those limits and applies them, because this crate applies nothing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct IsolationSpec {
    pub address_space_bytes: u64,
    pub open_files: u32,
    pub processes: u32,
    pub no_new_privs: bool,
    pub seccomp_profile: String,
    pub landlock_ruleset: String,
    pub network_egress_deny: bool,
    /// Name of the sandbox runtime that confines the process, such as
    /// `gvisor-systrap`. Empty when no sandbox plan is bound.
    #[serde(default)]
    pub runtime: String,
    /// Digest of the sandbox plan the process runs under, in the form
    /// `sha256:<hex>`. Empty when no sandbox plan is bound.
    #[serde(default)]
    pub plan_digest: String,
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
            runtime: String::new(),
            plan_digest: String::new(),
        }
    }
}

impl IsolationSpec {
    /// A specification bound to one sandbox plan. A seal over it holds only for
    /// the process that runs under exactly that plan in that runtime.
    pub fn for_sandbox(runtime: &str, plan_digest: &str) -> Self {
        Self {
            seccomp_profile: String::from(runtime),
            landlock_ruleset: String::from(runtime),
            runtime: String::from(runtime),
            plan_digest: String::from(plan_digest),
            ..Self::default()
        }
    }

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
        out.push_str(if self.network_egress_deny {
            "true"
        } else {
            "false"
        });
        out.push('\n');
        // The two sandbox fields are written only when a plan is bound, so the
        // digest of a specification without a plan is the one it always had.
        if !self.runtime.is_empty() || !self.plan_digest.is_empty() {
            out.push_str("runtime=");
            out.push_str(&self.runtime);
            out.push('\n');
            out.push_str("plan_digest=");
            out.push_str(&self.plan_digest);
            out.push('\n');
        }
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
        if !self.no_new_privs {
            return Err(String::from("isolation needs no_new_privs"));
        }
        if self.address_space_bytes == 0 {
            return Err(String::from("isolation needs an address space bound"));
        }
        if self.runtime.is_empty() != self.plan_digest.is_empty() {
            return Err(String::from(
                "a sandbox seal needs the runtime and the plan digest together",
            ));
        }
        if !self.runtime.is_empty() {
            let plain = |text: &str| !text.contains(['\n', '\r', '\u{1f}']);
            let hex = self.plan_digest.strip_prefix("sha256:").unwrap_or("");
            let digest_ok = hex.len() == 64
                && hex
                    .bytes()
                    .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b));
            if !plain(&self.runtime) || !digest_ok {
                return Err(String::from(
                    "a sandbox seal needs a plain runtime name and a sha256 plan digest",
                ));
            }
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

// The tests state the seal record contract. This crate records one seal and it
// does not enforce one. No enforcer ships in this release.
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_seal_is_a_record_and_not_an_enforcement() {
        let spec = IsolationSpec::default();
        let sealed = seal_process(4300, &spec, 2).expect("seal");
        assert_eq!(sealed.pid, 4300);
        assert_eq!(sealed.spec_digest.as_str(), spec.digest().as_str());
        assert!(!sealed.seal.is_empty());
    }

    #[test]
    fn seal_binds_the_process_and_the_specification() {
        let spec = IsolationSpec::default();
        let sealed = seal_process(4242, &spec, 1).expect("seal");
        assert!(sealed.is_sealed());
        assert!(seal_holds(&sealed, 4242, &spec));
        assert_eq!(sealed.algorithm.as_str(), ALGORITHM_SEALED);
    }

    #[test]
    fn a_reused_pid_with_a_looser_specification_fails_the_seal() {
        let spec = IsolationSpec::default();
        let sealed = seal_process(4242, &spec, 1).expect("seal");
        let mut looser = spec.clone();
        looser.network_egress_deny = false;
        assert!(!seal_holds(&sealed, 4242, &looser));
        assert!(!seal_holds(&sealed, 4243, &spec));
    }

    #[test]
    fn the_same_specification_seals_to_the_same_digest() {
        let one = IsolationSpec::default();
        let two = IsolationSpec::default();
        assert_eq!(one.digest(), two.digest());
        let mut other = one.clone();
        other.open_files = 2048;
        assert_ne!(one.digest(), other.digest());
    }

    #[test]
    fn an_unconfined_process_is_refused() {
        let spec = IsolationSpec {
            no_new_privs: false,
            ..Default::default()
        };
        assert!(seal_process(7, &spec, 1).is_err());
        let empty = IsolationSpec {
            seccomp_profile: String::new(),
            ..Default::default()
        };
        assert!(seal_process(7, &empty, 1).is_err());
        assert!(seal_process(0, &IsolationSpec::default(), 1).is_err());
    }

    const PLAN: &str = "sha256:1111111111111111111111111111111111111111111111111111111111111111";
    const OTHER_PLAN: &str =
        "sha256:2222222222222222222222222222222222222222222222222222222222222222";

    #[test]
    fn a_specification_without_a_plan_keeps_its_digest() {
        let spec = IsolationSpec::default();
        assert!(!spec.canonical().contains("runtime="));
        assert!(spec.canonical().ends_with("network_egress_deny=true\n"));
        let old: IsolationSpec = serde_json::from_str(
            r#"{"address_space_bytes":4294967296,"open_files":1024,"processes":256,"no_new_privs":true,"seccomp_profile":"default","landlock_ruleset":"read-only-data","network_egress_deny":true}"#,
        )
        .expect("a record without the two fields still reads");
        assert_eq!(old, spec);
    }

    #[test]
    fn a_seal_binds_the_process_to_the_exact_sandbox_plan() {
        let spec = IsolationSpec::for_sandbox("gvisor-systrap", PLAN);
        assert!(spec
            .canonical()
            .ends_with(&format!("runtime=gvisor-systrap\nplan_digest={PLAN}\n")));
        let sealed = seal_process(900, &spec, 5).expect("seal");
        assert!(seal_holds(&sealed, 900, &spec));
        assert!(!seal_holds(
            &sealed,
            900,
            &IsolationSpec::for_sandbox("gvisor-systrap", OTHER_PLAN)
        ));
        assert!(!seal_holds(
            &sealed,
            900,
            &IsolationSpec::for_sandbox("gvisor-kvm", PLAN)
        ));
        assert!(!seal_holds(&sealed, 900, &IsolationSpec::default()));
        assert_ne!(spec.digest(), IsolationSpec::default().digest());
    }

    #[test]
    fn a_sandbox_seal_needs_both_fields_in_plain_form() {
        let cases = [
            ("gvisor-systrap", ""),
            ("", PLAN),
            ("gvisor-systrap", "sha256:short"),
            (
                "gvisor-systrap",
                "md5:1111111111111111111111111111111111111111111111111111111111111111",
            ),
            ("gvisor\nplan_digest=x", PLAN),
        ];
        for (runtime, plan) in cases {
            let spec = IsolationSpec::for_sandbox(runtime, plan);
            assert!(seal_process(7, &spec, 1).is_err(), "{runtime:?} {plan:?}");
        }
        assert!(seal_process(7, &IsolationSpec::for_sandbox("gvisor-systrap", PLAN), 1).is_ok());
    }

    #[test]
    fn a_process_seals_once() {
        let spec = IsolationSpec::default();
        let mut seen: Vec<ProcessSealed> = Vec::new();
        assert!(seal_once(&mut seen, 99, &spec, 1).is_ok());
        assert!(seal_once(&mut seen, 99, &spec, 2).is_err());
        assert_eq!(seen.len(), 1);
    }
}
