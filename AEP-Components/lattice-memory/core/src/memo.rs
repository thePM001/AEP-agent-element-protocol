//! The exact-match memo: stored results of checks that are pure.
//!
//! A check is pure when its result depends on nothing but the bytes it reads from the
//! proposal, the compiled lattice and the compiled wall set. A check that reads the
//! clock, a budget, a counter or any other state that changes between two proposals is
//! not pure and never enters the memo.
//!
//! The key binds three digests: the digest of the proposal bytes the check reads, the
//! digest of the compiled lattice and the digest of the wall set. A stored result is
//! replayed only when all three are byte identical. Similarity plays no part here: a
//! proposal that is merely close to an earlier one is a miss.
//!
//! The memo holds a bounded number of entries and lives in the memory of one process.
//! It is never written to a store, so nothing a file holds can change a replayed row.

use crate::shape::sha256;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

/// Entries a memo holds before the oldest one is dropped.
pub const DEFAULT_MEMO_CAPACITY: usize = 8192;

const KEY_TAG: &[u8] = b"aep.lattice-memory.memo.v1";

/// The key of one memo entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MemoKey([u8; 32]);

impl MemoKey {
    /// Bind a family of checks to the three digests. Every part is framed by its
    /// length, so no two different inputs give the same key bytes.
    pub fn derive(
        family: &str,
        proposal_digest: &[u8; 32],
        lattice_digest: &[u8; 32],
        wall_set_digest: &[u8; 32],
    ) -> Self {
        let mut bytes = Vec::with_capacity(KEY_TAG.len() + family.len() + 16 + 96);
        bytes.extend_from_slice(KEY_TAG);
        bytes.extend_from_slice(&(family.len() as u64).to_le_bytes());
        bytes.extend_from_slice(family.as_bytes());
        bytes.extend_from_slice(proposal_digest);
        bytes.extend_from_slice(lattice_digest);
        bytes.extend_from_slice(wall_set_digest);
        MemoKey(sha256(&bytes))
    }

    pub fn as_bytes(&self) -> &[u8; 32] {
        &self.0
    }
}

/// The result of one check as the memo keeps it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WallRow {
    pub id: String,
    pub family: String,
    pub closed: bool,
    pub reason: String,
}

/// A bounded map from memo keys to rows. When it is full the oldest entry leaves.
#[derive(Debug)]
pub struct ExactMemo {
    capacity: usize,
    rows: HashMap<MemoKey, Arc<[WallRow]>>,
    order: VecDeque<MemoKey>,
}

impl ExactMemo {
    /// A memo of the given capacity. A capacity of zero stores nothing.
    pub fn new(capacity: usize) -> Self {
        ExactMemo {
            capacity,
            rows: HashMap::new(),
            order: VecDeque::new(),
        }
    }

    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    pub fn capacity(&self) -> usize {
        self.capacity
    }

    /// The rows stored under exactly this key.
    pub fn get(&self, key: &MemoKey) -> Option<Arc<[WallRow]>> {
        self.rows.get(key).cloned()
    }

    /// Store the rows of a pure check. The first rows stored under a key remain: a
    /// pure check gives the same rows every time, so a second insert has nothing to add.
    /// Returns true when the rows were stored.
    pub fn insert(&mut self, key: MemoKey, rows: Vec<WallRow>) -> bool {
        if self.capacity == 0 || self.rows.contains_key(&key) {
            return false;
        }
        while self.rows.len() >= self.capacity {
            match self.order.pop_front() {
                Some(oldest) => {
                    self.rows.remove(&oldest);
                }
                None => break,
            }
        }
        self.rows.insert(key, rows.into());
        self.order.push_back(key);
        true
    }

    /// Drop every entry. A process calls this when its lattice or its wall set changes.
    pub fn clear(&mut self) {
        self.rows.clear();
        self.order.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rows(tag: &str) -> Vec<WallRow> {
        vec![
            WallRow {
                id: format!("writing:{tag}"),
                family: String::new(),
                closed: false,
                reason: String::new(),
            },
            WallRow {
                id: String::from("writing:no_em_dashes"),
                family: String::new(),
                closed: true,
                reason: String::from("Em dash forbidden"),
            },
        ]
    }

    fn key(n: u8) -> MemoKey {
        MemoKey::derive("writing", &[n; 32], &[1; 32], &[2; 32])
    }

    #[test]
    fn a_stored_entry_is_replayed_only_for_the_same_three_digests() {
        let mut memo = ExactMemo::new(16);
        let proposal = [5u8; 32];
        let lattice = [6u8; 32];
        let walls = [7u8; 32];
        let stored = MemoKey::derive("writing", &proposal, &lattice, &walls);
        assert!(memo.insert(stored, rows("a")));
        assert_eq!(memo.get(&stored).unwrap().to_vec(), rows("a"));
        // One changed bit in any of the three digests is a miss.
        for part in 0..3 {
            for byte in 0..32 {
                let mut p = proposal;
                let mut l = lattice;
                let mut w = walls;
                match part {
                    0 => p[byte] ^= 1,
                    1 => l[byte] ^= 1,
                    _ => w[byte] ^= 1,
                }
                let other = MemoKey::derive("writing", &p, &l, &w);
                assert!(memo.get(&other).is_none());
            }
        }
        // Another family of checks is a miss too.
        assert!(memo
            .get(&MemoKey::derive("policy", &proposal, &lattice, &walls))
            .is_none());
    }

    #[test]
    fn key_parts_are_framed_by_length() {
        let a = MemoKey::derive("ab", &[0; 32], &[0; 32], &[0; 32]);
        let b = MemoKey::derive("a", &[0; 32], &[0; 32], &[0; 32]);
        assert_ne!(a, b);
        // Swapping two digests changes the key.
        let c = MemoKey::derive("a", &[1; 32], &[2; 32], &[3; 32]);
        let d = MemoKey::derive("a", &[2; 32], &[1; 32], &[3; 32]);
        assert_ne!(c, d);
        assert_eq!(c, MemoKey::derive("a", &[1; 32], &[2; 32], &[3; 32]));
    }

    #[test]
    fn the_first_rows_of_a_key_remain() {
        let mut memo = ExactMemo::new(4);
        assert!(memo.insert(key(1), rows("first")));
        assert!(!memo.insert(key(1), rows("second")));
        assert_eq!(memo.get(&key(1)).unwrap().to_vec(), rows("first"));
        assert_eq!(memo.len(), 1);
    }

    #[test]
    fn the_oldest_entry_leaves_when_the_memo_is_full() {
        let mut memo = ExactMemo::new(3);
        for n in 1..=3 {
            assert!(memo.insert(key(n), rows("x")));
        }
        assert!(memo.insert(key(4), rows("x")));
        assert_eq!(memo.len(), 3);
        assert!(memo.get(&key(1)).is_none());
        for n in 2..=4 {
            assert!(memo.get(&key(n)).is_some());
        }
        for n in 5..=200 {
            memo.insert(key(n), rows("x"));
            assert_eq!(memo.len(), 3);
        }
        assert!(memo.get(&key(200)).is_some());
        assert!(memo.get(&key(197)).is_none());
    }

    #[test]
    fn a_memo_of_capacity_zero_stores_nothing() {
        let mut memo = ExactMemo::new(0);
        assert!(!memo.insert(key(1), rows("x")));
        assert!(memo.is_empty());
        assert!(memo.get(&key(1)).is_none());
    }

    #[test]
    fn clear_drops_every_entry() {
        let mut memo = ExactMemo::new(8);
        memo.insert(key(1), rows("x"));
        memo.insert(key(2), rows("x"));
        memo.clear();
        assert!(memo.is_empty());
        assert!(memo.get(&key(1)).is_none());
        assert!(memo.insert(key(1), rows("y")));
    }
}
