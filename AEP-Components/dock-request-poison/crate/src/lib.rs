// Dock request path returns ok false on poisoned locks.
// Do not abort the process. The source gate that proves the Base Node docking module
// keeps this rule is tests/source_gate.rs.
use std::sync::{Mutex, MutexGuard};

pub const POISONED_LOCK_PREFIX: &str = "poisoned lock:";

/// Build the dock request ok false error string for a poisoned lock.
pub fn poisoned_lock_message(name: &str) -> String {
    let mut s = String::from(POISONED_LOCK_PREFIX);
    s.push(' ');
    s.push_str(name);
    s
}

/// Map a poisoned mutex to an error string. Do not abort the process.
pub fn lock_or_poison<'a, T>(mutex: &'a Mutex<T>, name: &str) -> Result<MutexGuard<'a, T>, String> {
    match mutex.lock() {
        Ok(g) => Ok(g),
        Err(_) => Err(poisoned_lock_message(name)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn message_prefix() {
        assert_eq!(poisoned_lock_message("db"), "poisoned lock: db");
    }

    #[test]
    fn lock_or_poison_ok_on_live_mutex() {
        let m = Mutex::new(7u8);
        let got = lock_or_poison(&m, "db");
        match got {
            Ok(g) => assert_eq!(*g, 7u8),
            Err(e) => panic!("live mutex refused: {e}"),
        };
    }

    #[test]
    fn lock_or_poison_err_on_poisoned_mutex() {
        let m = Mutex::new(0u8);
        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            // Holding the guard while panicking is what poisons the mutex.
            let _g = m.lock();
            panic!("poison");
        }));
        let got = lock_or_poison(&m, "db");
        match got {
            Err(e) => assert_eq!(e, "poisoned lock: db"),
            Ok(_) => panic!("poisoned mutex was taken"),
        };
    }
}
