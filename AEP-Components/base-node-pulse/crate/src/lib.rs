use std::collections::HashSet;
// One owner of the pulse constant is aep-kernel-types, so this crate imports it
// and re-exports it for the callers that read the beat interval from here.
pub use aep_kernel_types::PULSE_MS;
pub const MAX_DRIFT_MS: i64 = 50;
pub const MAX_AGE_MS: i64 = 5000;
pub const MAX_FRAME_AGE_SECS: u64 = 300;
pub const MAX_FRAME_FUTURE_SKEW_SECS: u64 = 60;
pub const QUEUE_CAP_CAPSULES: usize = 256;
pub const QUEUE_CAP_BYTES: usize = 262144;
/// One signer holds at most this part of the queue, so the frames of one signer
/// never take the room of every other signer.
pub const QUEUE_SIGNER_SHARE_DIVISOR: usize = 2;
pub const QUEUE_SIGNER_SHARE_CAPSULES: usize = QUEUE_CAP_CAPSULES / QUEUE_SIGNER_SHARE_DIVISOR;
pub const QUEUE_SIGNER_SHARE_BYTES: usize = QUEUE_CAP_BYTES / QUEUE_SIGNER_SHARE_DIVISOR;
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FrozenSnapshot {
    pub bridge_ts_ms: i64,
    pub max_drift_ms: i64,
    pub max_age_ms: i64,
    pub epoch_id: u64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QueuedCapsule {
    pub digest: String,
    pub agent_id: String,
    pub sequence_number: i64,
    pub byte_len: usize,
    pub freeze: FrozenSnapshot,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EnqueueDeny {
    OverflowCapsules,
    OverflowBytes,
    DuplicateDigest,
    SignerShareCapsules,
    SignerShareBytes,
}
impl EnqueueDeny {
    pub fn as_str(&self) -> &'static str {
        match self {
            EnqueueDeny::OverflowCapsules => "pulse queue overflow capsules",
            EnqueueDeny::OverflowBytes => "pulse queue overflow bytes",
            EnqueueDeny::DuplicateDigest => "frame replay rejected",
            EnqueueDeny::SignerShareCapsules => "pulse queue signer share capsules",
            EnqueueDeny::SignerShareBytes => "pulse queue signer share bytes",
        }
    }
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CapsuleFate {
    Ready,
    Wait,
    Aged,
}
#[derive(Clone, Debug, Default)]
pub struct BeatRelease {
    pub ready: Vec<QueuedCapsule>,
    pub aged: Vec<QueuedCapsule>,
    pub epoch_id: u64,
}
#[derive(Debug, Default)]
pub struct PulseQueue {
    items: Vec<QueuedCapsule>,
    bytes: usize,
    epoch: u64,
    queued_digests: HashSet<String>,
}
pub fn freeze_temporal_snapshot(bridge_ts_ms: i64, epoch_id: u64) -> FrozenSnapshot {
    FrozenSnapshot {
        bridge_ts_ms,
        max_drift_ms: MAX_DRIFT_MS,
        max_age_ms: MAX_AGE_MS,
        epoch_id,
    }
}
pub fn drift_against_freeze(agent_ts_ms: i64, freeze: &FrozenSnapshot) -> i64 {
    (agent_ts_ms - freeze.bridge_ts_ms).abs()
}
pub fn age_against_freeze(agent_ts_ms: i64, freeze: &FrozenSnapshot) -> i64 {
    freeze.bridge_ts_ms.saturating_sub(agent_ts_ms)
}
pub fn hold_age_ms(now_ms: i64, freeze: &FrozenSnapshot) -> i64 {
    now_ms.saturating_sub(freeze.bridge_ts_ms)
}
pub fn fate_at(now_ms: i64, freeze: &FrozenSnapshot) -> CapsuleFate {
    let held = hold_age_ms(now_ms, freeze);
    if held > MAX_AGE_MS {
        return CapsuleFate::Aged;
    }
    if held >= PULSE_MS {
        return CapsuleFate::Ready;
    }
    CapsuleFate::Wait
}
impl PulseQueue {
    pub fn new() -> Self {
        Self::default()
    }
    pub fn len(&self) -> usize {
        self.items.len()
    }
    pub fn bytes(&self) -> usize {
        self.bytes
    }
    pub fn epoch_id(&self) -> u64 {
        self.epoch
    }
    pub fn is_empty(&self) -> bool {
        self.items.is_empty()
    }
    pub fn enqueue(&mut self, cap: QueuedCapsule) -> Result<(), EnqueueDeny> {
        if self.queued_digests.contains(&cap.digest) {
            return Err(EnqueueDeny::DuplicateDigest);
        }
        if self.items.len() >= QUEUE_CAP_CAPSULES {
            return Err(EnqueueDeny::OverflowCapsules);
        }
        let next = self.bytes.saturating_add(cap.byte_len);
        if next > QUEUE_CAP_BYTES {
            return Err(EnqueueDeny::OverflowBytes);
        }
        // The signer share is checked after the queue caps, so a full queue still
        // answers with the queue overflow and a signer at its share reads its own deny.
        let (signer_capsules, signer_bytes) = self.signer_load(&cap.agent_id);
        if signer_capsules >= QUEUE_SIGNER_SHARE_CAPSULES {
            return Err(EnqueueDeny::SignerShareCapsules);
        }
        if signer_bytes.saturating_add(cap.byte_len) > QUEUE_SIGNER_SHARE_BYTES {
            return Err(EnqueueDeny::SignerShareBytes);
        }
        self.queued_digests.insert(cap.digest.clone());
        self.bytes = next;
        self.items.push(cap);
        Ok(())
    }
    /// Capsules and bytes that one signer holds in the queue.
    pub fn signer_load(&self, agent_id: &str) -> (usize, usize) {
        let mut capsules = 0usize;
        let mut bytes = 0usize;
        for item in &self.items {
            if item.agent_id == agent_id {
                capsules = capsules.saturating_add(1);
                bytes = bytes.saturating_add(item.byte_len);
            }
        }
        (capsules, bytes)
    }
    pub fn beat(&mut self, now_ms: i64) -> BeatRelease {
        self.epoch = self.epoch.saturating_add(1);
        let epoch_id = self.epoch;
        let mut stay: Vec<QueuedCapsule> = Vec::new();
        let mut aged: Vec<QueuedCapsule> = Vec::new();
        let mut candidates: Vec<QueuedCapsule> = Vec::new();
        for cap in self.items.drain(..) {
            match fate_at(now_ms, &cap.freeze) {
                CapsuleFate::Aged => aged.push(cap),
                CapsuleFate::Ready => candidates.push(cap),
                CapsuleFate::Wait => stay.push(cap),
            }
        }
        let mut ready: Vec<QueuedCapsule> = Vec::new();
        for cap in candidates {
            let lower_still_queued = stay
                .iter()
                .any(|o| o.agent_id == cap.agent_id && o.sequence_number < cap.sequence_number);
            if lower_still_queued {
                stay.push(cap);
            } else {
                ready.push(cap);
            }
        }
        ready.sort_by(|a, b| match a.agent_id.cmp(&b.agent_id) {
            std::cmp::Ordering::Equal => a.sequence_number.cmp(&b.sequence_number),
            other => other,
        });
        self.bytes = stay.iter().map(|c| c.byte_len).sum();
        self.queued_digests = stay.iter().map(|c| c.digest.clone()).collect();
        self.items = stay;
        BeatRelease {
            ready,
            aged,
            epoch_id,
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn must(cond: bool) {
        if !cond {
            std::process::abort();
        }
    }
    fn cap(digest: &str, agent: &str, seq: i64, freeze_ms: i64, bytes: usize) -> QueuedCapsule {
        QueuedCapsule {
            digest: String::from(digest),
            agent_id: String::from(agent),
            sequence_number: seq,
            byte_len: bytes,
            freeze: freeze_temporal_snapshot(freeze_ms, 0),
        }
    }
    #[test]
    fn ticket_and_bounds() {
        must(PULSE_MS == 1000 && MAX_DRIFT_MS == 50 && MAX_AGE_MS == 5000);
        must(MAX_FRAME_AGE_SECS == 300 && MAX_FRAME_FUTURE_SKEW_SECS == 60);
        must(QUEUE_CAP_CAPSULES == 256 && QUEUE_CAP_BYTES == 262144);
        must(QUEUE_SIGNER_SHARE_CAPSULES == 128 && QUEUE_SIGNER_SHARE_BYTES == 131072);
        must(MAX_DRIFT_MS != PULSE_MS);
        must(MAX_DRIFT_MS != 1000);
        let freeze = freeze_temporal_snapshot(1_000_000, 1);
        must(freeze.max_drift_ms == 50);
        must(drift_against_freeze(1_000_040, &freeze) <= 50);
        must(drift_against_freeze(1_000_051, &freeze) > 50);
        must(fate_at(1_001_000, &freeze) == CapsuleFate::Ready);
        must(fate_at(1_005_000, &freeze) == CapsuleFate::Ready);
        must(fate_at(1_005_001, &freeze) == CapsuleFate::Aged);
        must(hold_age_ms(1_001_000, &freeze) == 1000);
    }
    #[test]
    fn overflow_and_duplicate() {
        let mut q = PulseQueue::new();
        for i in 0..QUEUE_CAP_CAPSULES {
            let signer = format!("ag-{}", i / QUEUE_SIGNER_SHARE_CAPSULES);
            q.enqueue(cap(&format!("d{i}"), &signer, i as i64 + 1, 1000, 1))
                .expect("enq");
        }
        match q.enqueue(cap("overflow", "ag-new", 999, 1000, 1)) {
            Err(EnqueueDeny::OverflowCapsules) => {}
            _ => std::process::abort(),
        }
        let mut q = PulseQueue::new();
        q.enqueue(cap("big-a", "ag-a", 1, 1000, QUEUE_SIGNER_SHARE_BYTES))
            .expect("enq");
        q.enqueue(cap("big-b", "ag-b", 1, 1000, QUEUE_SIGNER_SHARE_BYTES))
            .expect("enq");
        match q.enqueue(cap("one-more", "ag-c", 2, 1000, 1)) {
            Err(EnqueueDeny::OverflowBytes) => {}
            _ => std::process::abort(),
        }
        let mut q = PulseQueue::new();
        q.enqueue(cap("same", "ag", 1, 1000, 8)).expect("enq");
        match q.enqueue(cap("same", "ag", 2, 1000, 8)) {
            Err(EnqueueDeny::DuplicateDigest) => {}
            _ => std::process::abort(),
        }
    }
    #[test]
    fn one_signer_holds_only_its_share() {
        let mut q = PulseQueue::new();
        for i in 0..QUEUE_SIGNER_SHARE_CAPSULES {
            q.enqueue(cap(&format!("a{i}"), "ag-a", i as i64 + 1, 1000, 1))
                .expect("enq");
        }
        match q.enqueue(cap("a-over", "ag-a", 999, 1000, 1)) {
            Err(EnqueueDeny::SignerShareCapsules) => {}
            _ => std::process::abort(),
        }
        // The share of one signer leaves the room of every other signer open.
        q.enqueue(cap("b0", "ag-b", 1, 1000, 1)).expect("enq");
        let mut q = PulseQueue::new();
        q.enqueue(cap("a-big", "ag-a", 1, 1000, QUEUE_SIGNER_SHARE_BYTES))
            .expect("enq");
        match q.enqueue(cap("a-more", "ag-a", 2, 1000, 1)) {
            Err(EnqueueDeny::SignerShareBytes) => {}
            _ => std::process::abort(),
        }
        q.enqueue(cap("b-big", "ag-b", 1, 1000, QUEUE_SIGNER_SHARE_BYTES))
            .expect("enq");
        must(q.signer_load("ag-a") == (1, QUEUE_SIGNER_SHARE_BYTES));
        let mut q = PulseQueue::new();
        match q.enqueue(cap(
            "too-big",
            "ag-a",
            1,
            1000,
            QUEUE_SIGNER_SHARE_BYTES + 1,
        )) {
            Err(EnqueueDeny::SignerShareBytes) => {}
            _ => std::process::abort(),
        }
    }
    #[test]
    fn sequence_order_and_hold() {
        let mut q = PulseQueue::new();
        q.enqueue(cap("b", "ag-a", 2, 1000, 4)).expect("enq");
        q.enqueue(cap("a", "ag-a", 1, 1000, 4)).expect("enq");
        let rel = q.beat(2000);
        let a: Vec<_> = rel
            .ready
            .iter()
            .filter(|c| c.agent_id == "ag-a")
            .map(|c| c.sequence_number)
            .collect();
        must(a == vec![1, 2]);
        let mut q = PulseQueue::new();
        q.enqueue(cap("late", "ag", 1, 1500, 4)).expect("enq");
        q.enqueue(cap("early", "ag", 2, 1000, 4)).expect("enq");
        must(q.beat(2000).ready.is_empty());
        let rel2 = q.beat(2500);
        must(
            rel2.ready.len() == 2
                && rel2.ready[0].sequence_number == 1
                && rel2.ready[1].sequence_number == 2,
        );
        let mut q = PulseQueue::new();
        q.enqueue(cap("w", "ag", 1, 1000, 4)).expect("enq");
        must(q.beat(1999).ready.is_empty());
        must(q.beat(2000).ready.len() == 1);
    }
}
