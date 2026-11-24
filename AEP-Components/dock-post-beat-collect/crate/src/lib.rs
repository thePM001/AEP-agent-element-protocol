// Dock client collects post-beat Admit by digest.
// DenyReport.closed and allow event_id return on the wire. Enqueue is not Admit.
// The source gate that proves the dock and UCB keep this protocol is tests/source_gate.rs.

// One owner of the pulse constant is aep-kernel-types, so this crate imports it
// and re-exports it for the callers that read the beat interval from here.
pub use aep_kernel_types::PULSE_MS;

/// Build the unix dock collect-by-digest line from a capsule digest.
pub fn collect_line(digest: &str) -> String {
    let mut s = String::from("{\"collect\":\"");
    s.push_str(digest);
    s.push_str("\"}");
    s
}

/// True when the wire line is enqueue ok with digest and no event_id.
pub fn is_enqueue_ack(ok: bool, has_digest: bool, has_event_id: bool, has_deny: bool) -> bool {
    ok && has_digest && !has_event_id && !has_deny
}

/// True when the collected line carries allow event_id.
pub fn is_applied_allow(has_event_id: bool) -> bool {
    has_event_id
}

/// True when the collected line carries DenyReport.closed.
pub fn is_applied_deny(closed_len: usize) -> bool {
    closed_len > 0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ticket_id() {
        assert_eq!(PULSE_MS, 1000);
    }

    #[test]
    fn collect_line_is_digest_json() {
        assert_eq!(collect_line("abc"), "{\"collect\":\"abc\"}");
    }

    #[test]
    fn enqueue_ack_has_digest_and_no_event_id() {
        assert!(is_enqueue_ack(true, true, false, false));
        assert!(!is_enqueue_ack(true, true, true, false));
        assert!(!is_enqueue_ack(true, true, false, true));
        assert!(!is_enqueue_ack(false, true, false, false));
    }

    #[test]
    fn applied_allow_needs_event_id() {
        assert!(is_applied_allow(true));
        assert!(!is_applied_allow(false));
    }

    #[test]
    fn applied_deny_needs_closed() {
        assert!(is_applied_deny(1));
        assert!(!is_applied_deny(0));
    }
}
