//! The privilege boundary of aep-ede.
//!
//! A deployed binary belongs to the EDE user of the operator and carries the set user id
//! bit. At start it lowers itself to the user of its caller and keeps the EDE user
//! only as its saved user id. It raises itself to the EDE user for the reads and
//! writes of the operator folder and of the protected record root (records, ledger,
//! locks, the EDE key) and lowers itself again at once. It never starts a child process while raised,
//! so no program of the agent ever runs as the EDE user.
//!
//! A binary without the set user id bit (every test build, a host without the EDE
//! user) runs as its caller and raise and lower do nothing.
//!
//! The boundary holds while agents run as a user other than the EDE user and
//! other than root: the sandbox that runs the agent carries that side.

// The real, effective and saved user ids need two calls of the C library that std
// does not wrap. Both are plain integer calls without pointers to Rust memory
// except the three out values of getresuid.
#![allow(unsafe_code)]

use std::sync::{Condvar, Mutex, MutexGuard, OnceLock};
use std::thread::{self, ThreadId};

extern "C" {
    fn getresuid(ruid: *mut u32, euid: *mut u32, suid: *mut u32) -> i32;
    fn setresuid(ruid: u32, euid: u32, suid: u32) -> i32;
}

const KEEP: u32 = u32::MAX;

#[derive(Clone, Copy, Debug)]
struct Ids {
    caller: u32,
    ede: Option<u32>,
}

static IDS: OnceLock<Ids> = OnceLock::new();

/// The C library changes the user ids of every thread of the process at once, so the
/// raised state is one state of the process: one thread holds it at a time (nested
/// raises of that thread count up) and no thread starts a child while it is held.
struct Hold {
    owner: Option<ThreadId>,
    depth: u32,
}

static HOLD: Mutex<Hold> = Mutex::new(Hold {
    owner: None,
    depth: 0,
});
static FREED: Condvar = Condvar::new();

fn hold() -> MutexGuard<'static, Hold> {
    HOLD.lock().unwrap_or_else(|e| e.into_inner())
}

fn resuid() -> (u32, u32, u32) {
    let (mut r, mut e, mut s) = (0u32, 0u32, 0u32);
    // SAFETY: the three pointers are valid for the duration of the call.
    let rc = unsafe { getresuid(&mut r, &mut e, &mut s) };
    if rc != 0 {
        let u = r;
        return (u, u, u);
    }
    (r, e, s)
}

/// Read the user ids once and lower to the caller. Every verb calls this first.
pub fn init() {
    IDS.get_or_init(|| {
        let (r, e, _) = resuid();
        if r == e {
            return Ids {
                caller: r,
                ede: None,
            };
        }
        // Real and effective remain with the caller, the saved id keeps the EDE user.
        // SAFETY: integer arguments only.
        let rc = unsafe { setresuid(r, r, e) };
        if rc != 0 {
            // Without a lowered start the binary must not run at all.
            eprintln!("aep-ede: cannot lower to the caller, refusing to run");
            std::process::exit(3);
        }
        Ids {
            caller: r,
            ede: Some(e),
        }
    });
}

/// The user id of the caller.
pub fn caller_uid() -> u32 {
    init();
    IDS.get().map(|i| i.caller).unwrap_or_else(|| resuid().0)
}

/// True while this binary runs with the set user id bit of the EDE user.
pub fn is_split() -> bool {
    init();
    IDS.get().and_then(|i| i.ede).is_some()
}

/// True while any thread of the process holds the EDE user.
pub fn raised() -> bool {
    hold().depth > 0
}

/// A scope that holds the EDE user. Dropping it lowers again.
pub struct Raised {
    _private: (),
}

impl Drop for Raised {
    fn drop(&mut self) {
        let mut h = hold();
        h.depth = h.depth.saturating_sub(1);
        if h.depth == 0 {
            if let Some(Ids {
                caller,
                ede: Some(_),
            }) = IDS.get().copied()
            {
                // SAFETY: integer arguments only.
                let rc = unsafe { setresuid(KEEP, caller, KEEP) };
                if rc != 0 {
                    eprintln!("aep-ede: cannot lower to the caller, stopping");
                    std::process::exit(3);
                }
            }
            h.owner = None;
            FREED.notify_all();
        }
    }
}

/// Hold the EDE user for the reads and writes of the protected record root. Another
/// thread that holds it is waited for.
pub fn raise() -> Raised {
    init();
    let me = thread::current().id();
    let mut h = hold();
    while matches!(h.owner, Some(o) if o != me) {
        h = FREED.wait(h).unwrap_or_else(|e| e.into_inner());
    }
    h.owner = Some(me);
    h.depth += 1;
    if h.depth == 1 {
        if let Some(Ids { ede: Some(ede), .. }) = IDS.get().copied() {
            // SAFETY: integer arguments only.
            let rc = unsafe { setresuid(KEEP, ede, KEEP) };
            if rc != 0 {
                eprintln!("aep-ede: cannot raise to the EDE user, stopping");
                std::process::exit(3);
            }
        }
    }
    Raised { _private: () }
}

/// Every child process of the crate starts through this check: no child runs as the
/// EDE user. A split binary refuses a child while any thread holds the EDE user.
pub fn assert_lowered(what: &str) -> Result<(), String> {
    if is_split() && raised() {
        return Err(format!("{} would start as the EDE user", what));
    }
    Ok(())
}

/// The user id of a user name from /etc/passwd.
pub fn uid_of(name: &str) -> Option<u32> {
    let body = std::fs::read_to_string("/etc/passwd").ok()?;
    for line in body.lines() {
        let mut parts = line.split(':');
        if parts.next() == Some(name) {
            let _pw = parts.next();
            return parts.next().and_then(|u| u.parse().ok());
        }
    }
    None
}
