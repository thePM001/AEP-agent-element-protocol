//! Confinement for the UCB validator process.
//!
//! The validator binary calls [`confine`] before it reads any input. On Linux
//! x86_64 and aarch64 it sets no_new_privs and installs a seccomp filter that
//! allows only the system calls an in-memory check needs: reading the request,
//! writing the result, memory management and exit. Any other system call kills
//! the whole process, so a check that is subverted cannot open a file, reach the
//! network, start a process or signal another process.
//!
//! On a Linux architecture without an allow list the call returns an error and
//! the validator refuses to run, so validation fails closed. Targets without
//! seccomp (macOS and the other non-Linux targets) run the validator without a
//! filter, which matches what those platforms offer.

#![allow(unsafe_code)]

use std::fmt;

/// Confinement could not be installed. The validator must not run the check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfineError(pub String);

impl fmt::Display for ConfineError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "validator confinement failed: {}", self.0)
    }
}

impl std::error::Error for ConfineError {}

/// Install the validator confinement for the calling process.
///
/// Call it once, early, from the single thread of the validator binary. Never
/// call it from the UCB server or from a test harness thread you want to keep.
pub fn confine() -> Result<(), ConfineError> {
    imp::confine()
}

/// True when [`confine`] installs a seccomp filter on this target.
pub const fn filter_supported() -> bool {
    imp::FILTER_SUPPORTED
}

#[cfg(all(
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
mod imp {
    use super::ConfineError;

    pub const FILTER_SUPPORTED: bool = true;

    #[cfg(target_arch = "x86_64")]
    const AUDIT_ARCH: u32 = 0xC000_003E;
    #[cfg(target_arch = "aarch64")]
    const AUDIT_ARCH: u32 = 0xC000_00B7;

    /// Offsets inside struct seccomp_data: nr is at 0 and arch is at 4.
    const SECCOMP_DATA_NR: u32 = 0;
    const SECCOMP_DATA_ARCH: u32 = 4;

    /// System calls the validator may make after confinement. The list covers
    /// the Rust standard library and the glibc or musl allocator for one thread
    /// that reads stdin, computes, writes stdout and exits.
    const ALLOWED: &[libc::c_long] = &[
        libc::SYS_read,
        libc::SYS_write,
        libc::SYS_close,
        libc::SYS_fstat,
        libc::SYS_newfstatat,
        libc::SYS_statx,
        libc::SYS_brk,
        libc::SYS_mmap,
        libc::SYS_munmap,
        libc::SYS_mremap,
        libc::SYS_madvise,
        libc::SYS_mprotect,
        libc::SYS_futex,
        libc::SYS_sched_yield,
        libc::SYS_getrandom,
        libc::SYS_clock_gettime,
        libc::SYS_rt_sigreturn,
        libc::SYS_rt_sigprocmask,
        libc::SYS_sigaltstack,
        libc::SYS_exit,
        libc::SYS_exit_group,
    ];

    fn stmt(code: u32, k: u32) -> libc::sock_filter {
        libc::sock_filter {
            code: code as u16,
            jt: 0,
            jf: 0,
            k,
        }
    }

    fn jump(code: u32, k: u32, jt: u8, jf: u8) -> libc::sock_filter {
        libc::sock_filter {
            code: code as u16,
            jt,
            jf,
            k,
        }
    }

    /// Build the filter: kill on a foreign architecture, allow the listed
    /// system calls and kill on everything else. x32 system call numbers carry
    /// bit 30 and therefore never equal an allowed number.
    pub fn program() -> Vec<libc::sock_filter> {
        let load = libc::BPF_LD | libc::BPF_W | libc::BPF_ABS;
        let jeq = libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K;
        let ret = libc::BPF_RET | libc::BPF_K;
        let mut prog = vec![
            stmt(load, SECCOMP_DATA_ARCH),
            jump(jeq, AUDIT_ARCH, 1, 0),
            stmt(ret, libc::SECCOMP_RET_KILL_PROCESS),
            stmt(load, SECCOMP_DATA_NR),
        ];
        for nr in ALLOWED {
            prog.push(jump(jeq, *nr as u32, 0, 1));
            prog.push(stmt(ret, libc::SECCOMP_RET_ALLOW));
        }
        prog.push(stmt(ret, libc::SECCOMP_RET_KILL_PROCESS));
        prog
    }

    pub fn confine() -> Result<(), ConfineError> {
        let mut filter = program();
        let len = u16::try_from(filter.len())
            .map_err(|_| ConfineError(String::from("filter too long")))?;
        let fprog = libc::sock_fprog {
            len,
            filter: filter.as_mut_ptr(),
        };
        // SAFETY: prctl with PR_SET_NO_NEW_PRIVS takes four further integer
        // arguments that must be zero apart from the flag value 1. It reads no
        // memory from this process.
        let rc = unsafe {
            libc::prctl(
                libc::PR_SET_NO_NEW_PRIVS,
                1 as libc::c_ulong,
                0 as libc::c_ulong,
                0 as libc::c_ulong,
                0 as libc::c_ulong,
            )
        };
        if rc != 0 {
            return Err(ConfineError(format!(
                "no_new_privs refused: {}",
                std::io::Error::last_os_error()
            )));
        }
        // SAFETY: fprog points at `filter`, which is alive and unmoved until
        // prctl returns. The kernel copies the program during the call and keeps
        // no pointer into this process afterwards.
        let rc = unsafe {
            libc::prctl(
                libc::PR_SET_SECCOMP,
                libc::SECCOMP_MODE_FILTER as libc::c_ulong,
                &fprog as *const libc::sock_fprog as libc::c_ulong,
                0 as libc::c_ulong,
                0 as libc::c_ulong,
            )
        };
        if rc != 0 {
            return Err(ConfineError(format!(
                "seccomp filter refused: {}",
                std::io::Error::last_os_error()
            )));
        }
        Ok(())
    }
}

#[cfg(all(
    target_os = "linux",
    not(any(target_arch = "x86_64", target_arch = "aarch64"))
))]
mod imp {
    use super::ConfineError;

    pub const FILTER_SUPPORTED: bool = false;

    pub fn confine() -> Result<(), ConfineError> {
        Err(ConfineError(format!(
            "no seccomp allow list for {}",
            std::env::consts::ARCH
        )))
    }
}

#[cfg(not(target_os = "linux"))]
mod imp {
    use super::ConfineError;

    pub const FILTER_SUPPORTED: bool = false;

    pub fn confine() -> Result<(), ConfineError> {
        Ok(())
    }
}

#[cfg(all(
    test,
    target_os = "linux",
    any(target_arch = "x86_64", target_arch = "aarch64")
))]
mod tests {
    use super::imp;

    #[test]
    fn filter_checks_arch_first_and_kills_by_default() {
        let prog = imp::program();
        assert_eq!(prog[0].k, 4, "first load reads seccomp_data.arch");
        assert_eq!(prog[2].k, libc::SECCOMP_RET_KILL_PROCESS);
        let last = prog.last().map(|f| f.k);
        assert_eq!(last, Some(libc::SECCOMP_RET_KILL_PROCESS));
    }

    #[test]
    fn filter_never_allows_process_or_network_calls() {
        let prog = imp::program();
        let jeq = (libc::BPF_JMP | libc::BPF_JEQ | libc::BPF_K) as u16;
        let allowed: Vec<u32> = prog
            .iter()
            .skip(4)
            .filter(|f| f.code == jeq)
            .map(|f| f.k)
            .collect();
        for banned in [
            libc::SYS_execve,
            libc::SYS_clone,
            libc::SYS_openat,
            libc::SYS_socket,
            libc::SYS_connect,
            libc::SYS_kill,
            libc::SYS_ptrace,
        ] {
            assert!(
                !allowed.contains(&(banned as u32)),
                "syscall {banned} must remain blocked"
            );
        }
    }
}
