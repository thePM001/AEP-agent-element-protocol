//! Append-only SHA-256 evidence chain. record() never waits on disk.
//! @PAD: aep-sdk-dynaep-ledger
//! @GCDE: gaplune.code.v1

use super::temporal::BridgeClock;
use sha2::{Digest, Sha256};

const GENESIS: &str = "0000000000000000000000000000000000000000000000000000000000000000";

#[derive(Debug, Clone)]
pub struct LedgerEntry {
    pub seq: u64,
    pub bridge_time_ms: i64,
    pub decision: String,
    pub target_id: String,
    pub detail: String,
    pub hash: String,
    pub prev_hash: String,
}

pub struct BufferedLedger {
    clock: BridgeClock,
    buffer: Vec<LedgerEntry>,
    seq: u64,
    prev: String,
    cap: usize,
}

impl BufferedLedger {
    pub fn new(clock: BridgeClock, cap: usize) -> Self {
        Self { clock, buffer: Vec::with_capacity(cap), seq: 0, prev: GENESIS.into(), cap }
    }
    pub fn record(&mut self, decision: &str, target_id: &str, detail: &str) {
        self.seq += 1;
        let t = self.clock.now_ms();
        let prev = self.prev.clone();
        let payload = format!("{}|{}|{}|{}|{}|{}", prev, self.seq, t, decision, target_id, detail);
        let hash = hex::encode(Sha256::digest(payload.as_bytes()));
        self.prev = hash.clone();
        self.buffer.push(LedgerEntry {
            seq: self.seq, bridge_time_ms: t, decision: decision.into(), target_id: target_id.into(),
            detail: detail.into(), hash, prev_hash: prev,
        });
        if self.buffer.len() >= self.cap { self.flush(); }
    }
    pub fn flush(&mut self) -> usize {
        let n = self.buffer.len();
        self.buffer.clear();
        n
    }
    pub fn last_hash(&self) -> &str { &self.prev }
    pub fn total(&self) -> u64 { self.seq }
}
