//! The exact-match memo: stored results of checks that are pure.
//!
//! A check is pure when its result depends on nothing but the bytes it reads from the
//! proposal and on code and tables that are compiled into the process. A check that
//! reads the clock, a budget, a counter, a file or any other state that can change
//! while the process runs is not pure and never enters the memo.
//!
//! The key of an entry is the SHA-256 of the name of the family of checks and of the
//! bytes the family read. A stored result is replayed only for byte identical input.
//! Similarity plays no part here: an input that is merely close to an earlier one is a
//! miss.
//!
//! The memo lives in the memory of one process and starts empty with it, so the code
//! and the tables that computed a stored row are the ones that would compute it again.
//! It is never written to a store: nothing a file holds can change a replayed row. It
//! holds a bounded number of entries and a bounded number of bytes.

use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

/// Entries a memo holds before the oldest one is dropped.
pub const DEFAULT_MEMO_CAPACITY: usize = 8192;
/// Bytes of rows a memo holds before the oldest entries are dropped.
pub const DEFAULT_MEMO_BYTES: usize = 16 * 1024 * 1024;

const KEY_TAG: &[u8] = b"aep.lattice-memory.memo.v2";

/// The key of one memo entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct MemoKey([u8; 32]);

impl MemoKey {
    /// The key of the rows a family of checks computes for `input`. The family name
    /// is framed by its length, so no two different pairs give the same key bytes.
    pub fn of(family: &str, input: &[u8]) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(KEY_TAG);
        hasher.update((family.len() as u64).to_le_bytes());
        hasher.update(family.as_bytes());
        hasher.update(input);
        MemoKey(hasher.finalize().into())
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

/// The bytes one stored row set counts for.
fn bytes_of(rows: &[WallRow]) -> usize {
    rows.iter()
        .map(|row| 64 + row.id.len() + row.family.len() + row.reason.len())
        .sum()
}

/// A bounded map from memo keys to rows. When it is full the oldest entries leave.
#[derive(Debug)]
pub struct ExactMemo {
    capacity: usize,
    max_bytes: usize,
    bytes: usize,
    rows: HashMap<MemoKey, Arc<[WallRow]>>,
    order: VecDeque<MemoKey>,
}

impl ExactMemo {
    /// A memo of at most `capacity` entries and `max_bytes` bytes of rows. A bound of
    /// zero stores nothing.
    pub fn new(capacity: usize, max_bytes: usize) -> Self {
        ExactMemo {
            capacity,
            max_bytes,
            bytes: 0,
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

    /// The rows stored under exactly this key.
    pub fn get(&self, key: &MemoKey) -> Option<Arc<[WallRow]>> {
        self.rows.get(key).cloned()
    }

    /// Store the rows of a pure check. The first rows stored under a key remain: a
    /// pure check gives the same rows every time, so a second insert has nothing to add.
    /// Rows that alone exceed the byte bound are not stored. Returns true when the
    /// rows were stored.
    pub fn insert(&mut self, key: MemoKey, rows: Vec<WallRow>) -> bool {
        let size = bytes_of(&rows);
        if self.capacity == 0 || size > self.max_bytes || self.rows.contains_key(&key) {
            return false;
        }
        while self.rows.len() >= self.capacity || self.bytes + size > self.max_bytes {
            let Some(oldest) = self.order.pop_front() else {
                break;
            };
            if let Some(gone) = self.rows.remove(&oldest) {
                self.bytes -= bytes_of(&gone);
            }
        }
        self.bytes += size;
        self.rows.insert(key, rows.into());
        self.order.push_back(key);
        true
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
        MemoKey::of("writing", &[n; 40])
    }

    fn memo(capacity: usize) -> ExactMemo {
        ExactMemo::new(capacity, DEFAULT_MEMO_BYTES)
    }

    #[test]
    fn a_stored_entry_is_replayed_only_for_byte_identical_input() {
        let mut memo = memo(16);
        let input = b"rename the parser module".to_vec();
        let stored = MemoKey::of("writing", &input);
        assert!(memo.insert(stored, rows("a")));
        assert_eq!(memo.get(&stored).unwrap().to_vec(), rows("a"));
        assert_eq!(MemoKey::of("writing", &input), stored);
        // One changed bit anywhere in the input is a miss.
        for byte in 0..input.len() {
            for bit in 0..8 {
                let mut other = input.clone();
                other[byte] ^= 1 << bit;
                assert!(memo.get(&MemoKey::of("writing", &other)).is_none());
            }
        }
        // A longer and a shorter input are misses.
        assert!(memo
            .get(&MemoKey::of("writing", b"rename the parser module "))
            .is_none());
        assert!(memo
            .get(&MemoKey::of("writing", b"rename the parser modul"))
            .is_none());
        // Another family of checks is a miss too.
        assert!(memo.get(&MemoKey::of("policy", &input)).is_none());
    }

    #[test]
    fn the_family_name_is_framed_by_its_length() {
        // The same bytes split at another place between family and input.
        assert_ne!(MemoKey::of("ab", b"c"), MemoKey::of("a", b"bc"));
        assert_ne!(MemoKey::of("", b"abc"), MemoKey::of("abc", b""));
        assert_eq!(MemoKey::of("a", b"bc"), MemoKey::of("a", b"bc"));
    }

    #[test]
    fn the_first_rows_of_a_key_remain() {
        let mut memo = memo(4);
        assert!(memo.insert(key(1), rows("first")));
        assert!(!memo.insert(key(1), rows("second")));
        assert_eq!(memo.get(&key(1)).unwrap().to_vec(), rows("first"));
        assert_eq!(memo.len(), 1);
    }

    #[test]
    fn the_oldest_entry_leaves_when_the_memo_is_full() {
        let mut memo = memo(3);
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
    fn the_bytes_of_the_rows_are_bounded() {
        let one = bytes_of(&rows("x"));
        // Room for two row sets and a part of a third.
        let mut memo = ExactMemo::new(100, 2 * one + one / 2);
        assert!(memo.insert(key(1), rows("x")));
        assert!(memo.insert(key(2), rows("x")));
        assert!(memo.insert(key(3), rows("x")));
        assert_eq!(memo.len(), 2);
        assert!(memo.get(&key(1)).is_none());
        assert!(memo.get(&key(3)).is_some());
        // Rows that are larger than the whole bound are not stored and push nothing out.
        let mut large = rows("x");
        large[0].reason = "r".repeat(3 * one);
        assert!(!memo.insert(key(4), large));
        assert_eq!(memo.len(), 2);
        assert!(memo.get(&key(2)).is_some());
        for n in 5..=60 {
            memo.insert(key(n), rows("x"));
            assert!(memo.len() <= 2);
        }
    }

    #[test]
    fn a_memo_of_capacity_zero_stores_nothing() {
        let mut memo = memo(0);
        assert!(!memo.insert(key(1), rows("x")));
        assert!(memo.is_empty());
        assert!(memo.get(&key(1)).is_none());
        let mut memo = ExactMemo::new(8, 0);
        assert!(!memo.insert(key(1), rows("x")));
        assert!(memo.is_empty());
    }
}
