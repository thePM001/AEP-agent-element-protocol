//! The index of one domain: its attractors in contiguous arrays.
//!
//! Search is an exact scan over the array of the domain. Nothing is approximate and no
//! index file exists: the arrays are rebuilt from the stored attractors at open.
//!
//! One question is asked on every record and on every hint: which attractor is the
//! nearest at or above the threshold. For SimHash domains a chunk table answers it
//! without reading every attractor. The table is exact, not approximate: two hashes
//! that differ in at most `r` bits agree in at least one of sixteen 16 bit chunks up to
//! `r / 16` bits, so every attractor inside the threshold is among the candidates of
//! the table. A test compares the table with the scan on random data.

use crate::error::CoreError;
use crate::fingerprint::{dot_i8, Fingerprint, FingerprintKind, SimHash, SIMHASH_MAX_SCORE};
use std::collections::{BTreeSet, HashMap, VecDeque};
use std::sync::Mutex;

/// Chunks of a SimHash in the chunk table.
const CHUNKS: usize = 16;
/// Bits of one chunk.
const CHUNK_BITS: u32 = 16;
/// Largest number of differing bits per chunk that the table enumerates. A threshold
/// that needs more is answered by the scan.
const MAX_CHUNK_RADIUS: u32 = 2;

/// One attractor as the index holds it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attractor {
    /// Key from the store.
    pub key: i64,
    pub fingerprint: Fingerprint,
    /// Shape digest of the record that formed the attractor.
    pub shape_digest: [u8; 32],
    /// Accepted records that formed or reinforced the attractor.
    pub support: u64,
    pub formed_at_unix: i64,
    pub last_seen_unix: i64,
}

/// One hit of a search.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Hit {
    pub key: i64,
    pub score: i32,
}

#[derive(Debug, Clone)]
struct Meta {
    shape_digest: [u8; 32],
    support: u64,
    formed_at_unix: i64,
    last_seen_unix: i64,
}

fn chunk_of(hash: &SimHash, chunk: usize) -> u16 {
    let word = hash.0[chunk / 4];
    ((word >> ((chunk % 4) as u32 * CHUNK_BITS)) & 0xffff) as u16
}

/// Marks an empty chain and the end of a chain in the chunk table.
const NONE: u32 = u32::MAX;
/// Values one chunk can take.
const CHUNK_VALUES: usize = 1 << CHUNK_BITS;
/// Attractors a SimHash domain holds before its chunk table is built. Below this
/// count the scan is as fast as the table and needs no extra memory.
const CHUNK_TABLE_FROM: usize = 2048;

/// Slots a bucket of the chunk table holds itself before it chains.
const INLINE_SLOTS: usize = 3;

/// One bucket of the chunk table: the slots whose hash holds one value in one chunk.
/// The first three slots sit in the bucket itself, so a lookup reads most buckets in
/// one step. Further slots hang on a chain that starts at `over`.
#[derive(Debug, Clone, Copy)]
struct Bucket {
    /// The first slots of the bucket, filled from the front. `NONE` marks a free place.
    inline: [u32; INLINE_SLOTS],
    /// The first slot of the chain of further slots, or `NONE`.
    over: u32,
}

const EMPTY_BUCKET: Bucket = Bucket {
    inline: [NONE; INLINE_SLOTS],
    over: NONE,
};

/// The chunk table of a SimHash domain: for each of the sixteen chunks and each value
/// of a chunk, the bucket of the slots whose hash holds that value there.
#[derive(Debug, Clone)]
struct ChunkTable {
    /// `chunk * 65536 + value` to the bucket.
    buckets: Vec<Bucket>,
    /// Per chunk: slot to the next slot of the chain of its bucket. Only slots on a
    /// chain have an entry that is read.
    next: Vec<Vec<u32>>,
}

impl ChunkTable {
    fn new() -> Self {
        ChunkTable {
            buckets: vec![EMPTY_BUCKET; CHUNKS * CHUNK_VALUES],
            next: (0..CHUNKS).map(|_| Vec::new()).collect(),
        }
    }

    fn bucket_at(chunk: usize, value: u16) -> usize {
        chunk * CHUNK_VALUES + value as usize
    }

    fn set_next(&mut self, chunk: usize, slot: usize, to: u32) {
        let list = &mut self.next[chunk];
        if list.len() <= slot {
            list.resize(slot + 1, NONE);
        }
        list[slot] = to;
    }

    fn next_of(&self, chunk: usize, slot: u32) -> u32 {
        self.next[chunk].get(slot as usize).copied().unwrap_or(NONE)
    }

    /// Put `slot` into the bucket of each of its chunk values.
    fn link(&mut self, hash: &SimHash, slot: usize) {
        for chunk in 0..CHUNKS {
            let at = Self::bucket_at(chunk, chunk_of(hash, chunk));
            let free = self.buckets[at].inline.iter().position(|s| *s == NONE);
            match free {
                Some(place) => self.buckets[at].inline[place] = slot as u32,
                None => {
                    let over = self.buckets[at].over;
                    self.set_next(chunk, slot, over);
                    self.buckets[at].over = slot as u32;
                }
            }
        }
    }

    /// Take `slot` out of the bucket of each chunk value of `hash`. The places in the
    /// bucket itself remain filled from the front: a slot of the chain moves up, or
    /// the last slot of the bucket takes the free place.
    fn unlink(&mut self, hash: &SimHash, slot: usize) {
        let gone = slot as u32;
        for chunk in 0..CHUNKS {
            let at = Self::bucket_at(chunk, chunk_of(hash, chunk));
            let place = self.buckets[at].inline.iter().position(|s| *s == gone);
            match place {
                Some(place) => {
                    let over = self.buckets[at].over;
                    if over != NONE {
                        self.buckets[at].inline[place] = over;
                        self.buckets[at].over = self.next_of(chunk, over);
                    } else {
                        let bucket = &mut self.buckets[at];
                        let filled = bucket.inline.iter().take_while(|s| **s != NONE).count();
                        bucket.inline[place] = bucket.inline[filled - 1];
                        bucket.inline[filled - 1] = NONE;
                    }
                }
                None => {
                    let after = self.next_of(chunk, gone);
                    if self.buckets[at].over == gone {
                        self.buckets[at].over = after;
                    } else {
                        let mut walk = self.buckets[at].over;
                        while walk != NONE {
                            let following = self.next_of(chunk, walk);
                            if following == gone {
                                self.set_next(chunk, walk as usize, after);
                                break;
                            }
                            walk = following;
                        }
                    }
                }
            }
        }
    }

    /// The slot `from` moves to the free slot `to`: every bucket that holds `from`
    /// holds `to` in the same place afterwards.
    fn rename(&mut self, hash: &SimHash, from: usize, to: usize) {
        let old = from as u32;
        let new = to as u32;
        for chunk in 0..CHUNKS {
            let at = Self::bucket_at(chunk, chunk_of(hash, chunk));
            if let Some(place) = self.buckets[at].inline.iter().position(|s| *s == old) {
                self.buckets[at].inline[place] = new;
                continue;
            }
            let after = self.next_of(chunk, old);
            if self.buckets[at].over == old {
                self.buckets[at].over = new;
                self.set_next(chunk, to, after);
                continue;
            }
            let mut walk = self.buckets[at].over;
            while walk != NONE {
                let following = self.next_of(chunk, walk);
                if following == old {
                    self.set_next(chunk, walk as usize, new);
                    self.set_next(chunk, to, after);
                    break;
                }
                walk = following;
            }
        }
    }

    /// Call `visit` with every slot of one bucket.
    fn each(&self, chunk: usize, value: u16, visit: &mut impl FnMut(usize)) {
        let bucket = self.buckets[Self::bucket_at(chunk, value)];
        for slot in bucket.inline {
            if slot == NONE {
                return;
            }
            visit(slot as usize);
        }
        let mut at = bucket.over;
        while at != NONE {
            visit(at as usize);
            at = self.next_of(chunk, at);
        }
    }
}

/// Attractors a domain remembers as newly joined.
const FORMED_KEPT: usize = 64;
/// Places of the answer cache of a domain. A power of two.
const ANSWER_PLACES: usize = 256;

/// An attractor that joined the set of its domain, with the version it brought.
#[derive(Debug, Clone, Copy)]
struct Formed {
    version: u64,
    key: i64,
    hash: SimHash,
}

/// The answer of one lookup of the nearest attractor.
#[derive(Debug, Clone, Copy)]
struct Answer {
    hash: SimHash,
    max_distance: u32,
    /// The version of the set the answer was computed on.
    version: u64,
    hit: Option<Hit>,
}

/// The answers of the newest lookups of one domain.
///
/// A proposal asks for its nearest attractor twice: for its route hint and when its
/// record is written. The second time the answer is here. An answer is handed out
/// only when it is the answer a fresh lookup gives: the set is unchanged, or every
/// attractor that joined since is compared and the remembered one is still there.
/// A cache that is busy is skipped, so a lookup never waits for it.
#[derive(Debug, Default)]
struct AnswerCache {
    answers: Mutex<Vec<Option<Answer>>>,
}

impl Clone for AnswerCache {
    /// A copy of an index starts with no remembered answer.
    fn clone(&self) -> Self {
        AnswerCache::default()
    }
}

fn answer_place(hash: &SimHash) -> usize {
    ((hash.0[0] ^ (hash.0[0] >> 32) ^ hash.0[1]) as usize) % ANSWER_PLACES
}

/// The attractors of one domain.
#[derive(Debug, Clone)]
pub struct DomainIndex {
    kind: FingerprintKind,
    /// Slot to key. Slots are contiguous: a removed slot is filled by the last one.
    keys: Vec<i64>,
    meta: Vec<Meta>,
    /// SimHash domains: one hash per slot.
    hashes: Vec<SimHash>,
    /// SimHash domains: the first word of the hash of each slot, kept together so a
    /// lookup can turn most candidates away without reading their full hash.
    first_words: Vec<u64>,
    /// Embedding domains: `dim` bytes per slot.
    vectors: Vec<i8>,
    slot_of: HashMap<i64, usize>,
    by_digest: HashMap<[u8; 32], i64>,
    /// Eviction order: lowest support, then least recently seen, then lowest key.
    eviction: BTreeSet<(u64, i64, i64)>,
    /// SimHash domains from `CHUNK_TABLE_FROM` attractors on: the chunk table.
    chunk_table: Option<ChunkTable>,
    /// Rises with every change of the set of attractors. A reinforcement is no change
    /// of the set.
    version: u64,
    /// SimHash domains: the attractors that joined the set last, oldest first.
    formed: VecDeque<Formed>,
    /// The version of the newest entry that left `formed`, 0 when none left.
    formed_dropped: u64,
    /// The answers of the newest lookups.
    answers: AnswerCache,
}

impl DomainIndex {
    pub fn new(kind: FingerprintKind) -> Self {
        let chunk_table = None;
        DomainIndex {
            kind,
            keys: Vec::new(),
            meta: Vec::new(),
            hashes: Vec::new(),
            first_words: Vec::new(),
            vectors: Vec::new(),
            slot_of: HashMap::new(),
            by_digest: HashMap::new(),
            eviction: BTreeSet::new(),
            chunk_table,
            version: 0,
            formed: VecDeque::new(),
            formed_dropped: 0,
            answers: AnswerCache::default(),
        }
    }

    pub fn kind(&self) -> FingerprintKind {
        self.kind
    }

    pub fn len(&self) -> usize {
        self.keys.len()
    }

    pub fn is_empty(&self) -> bool {
        self.keys.is_empty()
    }

    pub fn contains(&self, key: i64) -> bool {
        self.slot_of.contains_key(&key)
    }

    /// Refuse a fingerprint of another kind or dimension than the domain holds.
    pub fn check_kind(&self, domain: &str, fingerprint: &Fingerprint) -> Result<(), CoreError> {
        match (self.kind, fingerprint.kind()) {
            (FingerprintKind::SimHash, FingerprintKind::SimHash) => Ok(()),
            (FingerprintKind::Embedding { dim: a }, FingerprintKind::Embedding { dim: b }) => {
                if a == b {
                    Ok(())
                } else {
                    Err(CoreError::DimensionMismatch {
                        expected: a,
                        got: b,
                    })
                }
            }
            (expected, got) => Err(CoreError::KindMismatch {
                domain: domain.to_string(),
                expected: expected.name(),
                got: got.name(),
            }),
        }
    }

    /// Add an attractor. The key must be new and the fingerprint of the kind of the domain.
    pub fn insert(&mut self, attractor: Attractor) -> Result<(), CoreError> {
        if self.slot_of.contains_key(&attractor.key) {
            return Err(CoreError::invalid(
                "attractor key",
                format!("key {} is already in the index", attractor.key),
            ));
        }
        self.check_kind("", &attractor.fingerprint)?;
        let slot = self.keys.len();
        match &attractor.fingerprint {
            Fingerprint::SimHash(hash) => {
                self.hashes.push(*hash);
                self.first_words.push(hash.0[0]);
                match self.chunk_table.as_mut() {
                    Some(table) => table.link(hash, slot),
                    None => {
                        if self.hashes.len() >= CHUNK_TABLE_FROM {
                            let mut table = ChunkTable::new();
                            for (at, stored) in self.hashes.iter().enumerate() {
                                table.link(stored, at);
                            }
                            self.chunk_table = Some(table);
                        }
                    }
                }
            }
            Fingerprint::Embedding(embedding) => {
                self.vectors.extend_from_slice(embedding.as_slice());
            }
        }
        self.keys.push(attractor.key);
        self.slot_of.insert(attractor.key, slot);
        // The first attractor of a shape digest keeps the exact match.
        self.by_digest
            .entry(attractor.shape_digest)
            .or_insert(attractor.key);
        self.eviction
            .insert((attractor.support, attractor.last_seen_unix, attractor.key));
        self.joined(&attractor);
        self.meta.push(Meta {
            shape_digest: attractor.shape_digest,
            support: attractor.support,
            formed_at_unix: attractor.formed_at_unix,
            last_seen_unix: attractor.last_seen_unix,
        });
        Ok(())
    }

    /// Put a new attractor in the place of an evicted one. The set of attractors is
    /// the one that a removal and an insert leave. The new attractor takes the slot of
    /// the evicted one, so no other attractor moves.
    pub fn replace(&mut self, evicted: i64, attractor: Attractor) -> Result<(), CoreError> {
        let Some(&slot) = self.slot_of.get(&evicted) else {
            // Nothing to take the place of: the attractor is added.
            return self.insert(attractor);
        };
        if self.slot_of.contains_key(&attractor.key) {
            return Err(CoreError::invalid(
                "attractor key",
                format!("key {} is already in the index", attractor.key),
            ));
        }
        self.check_kind("", &attractor.fingerprint)?;
        let old = self.meta[slot].clone();
        self.eviction
            .remove(&(old.support, old.last_seen_unix, evicted));
        if self.by_digest.get(&old.shape_digest) == Some(&evicted) {
            self.by_digest.remove(&old.shape_digest);
        }
        self.slot_of.remove(&evicted);
        match &attractor.fingerprint {
            Fingerprint::SimHash(hash) => {
                let previous = self.hashes[slot];
                if let Some(table) = self.chunk_table.as_mut() {
                    table.unlink(&previous, slot);
                    table.link(hash, slot);
                }
                self.hashes[slot] = *hash;
                self.first_words[slot] = hash.0[0];
            }
            Fingerprint::Embedding(embedding) => {
                let dim = embedding.dim();
                self.vectors[slot * dim..slot * dim + dim].copy_from_slice(embedding.as_slice());
            }
        }
        self.keys[slot] = attractor.key;
        self.slot_of.insert(attractor.key, slot);
        self.by_digest
            .entry(attractor.shape_digest)
            .or_insert(attractor.key);
        self.eviction
            .insert((attractor.support, attractor.last_seen_unix, attractor.key));
        self.joined(&attractor);
        self.meta[slot] = Meta {
            shape_digest: attractor.shape_digest,
            support: attractor.support,
            formed_at_unix: attractor.formed_at_unix,
            last_seen_unix: attractor.last_seen_unix,
        };
        Ok(())
    }

    /// Remove an attractor. Returns false when the key is not in the index.
    pub fn remove(&mut self, key: i64) -> bool {
        let Some(slot) = self.slot_of.remove(&key) else {
            return false;
        };
        let last = self.keys.len() - 1;
        let meta = self.meta[slot].clone();
        self.eviction
            .remove(&(meta.support, meta.last_seen_unix, key));
        if self.by_digest.get(&meta.shape_digest) == Some(&key) {
            self.by_digest.remove(&meta.shape_digest);
        }
        match self.kind {
            FingerprintKind::SimHash => {
                let removed = self.hashes[slot];
                let moved = self.hashes[last];
                if let Some(table) = self.chunk_table.as_mut() {
                    table.unlink(&removed, slot);
                    if slot != last {
                        table.rename(&moved, last, slot);
                    }
                }
                self.hashes.swap_remove(slot);
                self.first_words.swap_remove(slot);
            }
            FingerprintKind::Embedding { dim } => {
                if slot != last {
                    let (head, tail) = self.vectors.split_at_mut(last * dim);
                    head[slot * dim..slot * dim + dim].copy_from_slice(&tail[..dim]);
                }
                self.vectors.truncate(last * dim);
            }
        }
        self.version += 1;
        self.keys.swap_remove(slot);
        self.meta.swap_remove(slot);
        if slot != last {
            let moved_key = self.keys[slot];
            self.slot_of.insert(moved_key, slot);
        }
        true
    }

    /// Count one more accepted record on an attractor. Returns the new support.
    pub fn reinforce(&mut self, key: i64, at_unix: i64) -> Option<u64> {
        let slot = *self.slot_of.get(&key)?;
        let meta = &mut self.meta[slot];
        self.eviction
            .remove(&(meta.support, meta.last_seen_unix, key));
        meta.support = meta.support.saturating_add(1);
        meta.last_seen_unix = meta.last_seen_unix.max(at_unix);
        self.eviction
            .insert((meta.support, meta.last_seen_unix, key));
        Some(meta.support)
    }

    /// The attractor that eviction removes next: lowest support, then least recently
    /// seen, then lowest key.
    pub fn eviction_candidate(&self) -> Option<i64> {
        self.eviction.iter().next().map(|entry| entry.2)
    }

    /// The attractor formed by a record of exactly this shape digest.
    pub fn exact(&self, shape_digest: &[u8; 32]) -> Option<i64> {
        self.by_digest.get(shape_digest).copied()
    }

    pub fn support(&self, key: i64) -> Option<u64> {
        self.slot_of.get(&key).map(|slot| self.meta[*slot].support)
    }

    /// One attractor by key.
    pub fn get(&self, key: i64) -> Option<Attractor> {
        let slot = *self.slot_of.get(&key)?;
        Some(self.attractor_at(slot))
    }

    fn attractor_at(&self, slot: usize) -> Attractor {
        let meta = &self.meta[slot];
        Attractor {
            key: self.keys[slot],
            fingerprint: self.fingerprint_at(slot),
            shape_digest: meta.shape_digest,
            support: meta.support,
            formed_at_unix: meta.formed_at_unix,
            last_seen_unix: meta.last_seen_unix,
        }
    }

    fn fingerprint_at(&self, slot: usize) -> Fingerprint {
        match self.kind {
            FingerprintKind::SimHash => Fingerprint::SimHash(self.hashes[slot]),
            FingerprintKind::Embedding { dim } => {
                let bytes: Vec<u8> = self.vectors[slot * dim..slot * dim + dim]
                    .iter()
                    .map(|v| v.to_le_bytes()[0])
                    .collect();
                match crate::fingerprint::QuantizedEmbedding::from_bytes(&bytes, dim) {
                    Ok(embedding) => Fingerprint::Embedding(embedding),
                    // The slice has the dimension of the domain, so this arm is not reached.
                    Err(_) => Fingerprint::SimHash(SimHash([0; 4])),
                }
            }
        }
    }

    /// Every attractor in key order.
    pub fn attractors(&self) -> Vec<Attractor> {
        let mut all: Vec<Attractor> = (0..self.keys.len())
            .map(|slot| self.attractor_at(slot))
            .collect();
        all.sort_unstable_by_key(|a| a.key);
        all
    }

    fn score_at(&self, slot: usize, query: &Fingerprint) -> i32 {
        match (self.kind, query) {
            (FingerprintKind::SimHash, Fingerprint::SimHash(hash)) => self.hashes[slot].score(hash),
            (FingerprintKind::Embedding { dim }, Fingerprint::Embedding(embedding))
                if embedding.dim() == dim =>
            {
                dot_i8(
                    &self.vectors[slot * dim..slot * dim + dim],
                    embedding.as_slice(),
                )
            }
            _ => i32::MIN,
        }
    }

    /// Exact scan: the `limit` best attractors at or above `min_score`. The filter
    /// runs before the cut to `limit`, so a search never returns fewer hits than exist.
    /// Order: highest score first, the lowest key first among equal scores.
    pub fn scan(&self, query: &Fingerprint, limit: usize, min_score: i32) -> Vec<Hit> {
        self.scan_where(query, limit, min_score, |_| true)
    }

    /// Exact scan with a filter on the key that runs before the cut to `limit`.
    pub fn scan_where(
        &self,
        query: &Fingerprint,
        limit: usize,
        min_score: i32,
        mut keep: impl FnMut(i64) -> bool,
    ) -> Vec<Hit> {
        if limit == 0 || self.kind != query.kind() {
            return Vec::new();
        }
        let mut hits: Vec<Hit> = Vec::new();
        for slot in 0..self.keys.len() {
            let score = self.score_at(slot, query);
            if score >= min_score && keep(self.keys[slot]) {
                hits.push(Hit {
                    key: self.keys[slot],
                    score,
                });
            }
        }
        let order = |a: &Hit, b: &Hit| b.score.cmp(&a.score).then(a.key.cmp(&b.key));
        if hits.len() > limit {
            hits.select_nth_unstable_by(limit - 1, order);
            hits.truncate(limit);
        }
        hits.sort_unstable_by(order);
        hits
    }

    /// The nearest attractor at or above `min_score`. The lowest key wins among equal
    /// scores. The answer always equals the first hit of [`DomainIndex::scan`].
    pub fn nearest(&self, query: &Fingerprint, min_score: i32) -> Option<Hit> {
        if let (FingerprintKind::SimHash, Fingerprint::SimHash(hash)) = (self.kind, query) {
            if min_score > SIMHASH_MAX_SCORE {
                // No pair of hashes scores above the maximum.
                return None;
            }
            let max_distance = (SIMHASH_MAX_SCORE - min_score.max(0)) as u32;
            if let Some(answer) = self.remembered(hash, max_distance) {
                return answer;
            }
            let answer = match (self.chunk_table.as_ref(), chunk_radius(min_score)) {
                (Some(table), Some(radius)) => {
                    self.nearest_by_chunks(table, hash, max_distance, radius)
                }
                _ => self.nearest_by_bounded_scan(hash, max_distance),
            };
            self.remember(hash, max_distance, answer);
            return answer;
        }
        self.scan(query, 1, min_score).first().copied()
    }

    /// The set of attractors gained one: the version rises and a SimHash domain
    /// remembers the newcomer for its answer cache.
    fn joined(&mut self, attractor: &Attractor) {
        self.version += 1;
        if let Fingerprint::SimHash(hash) = &attractor.fingerprint {
            self.formed.push_back(Formed {
                version: self.version,
                key: attractor.key,
                hash: *hash,
            });
            if self.formed.len() > FORMED_KEPT {
                if let Some(left) = self.formed.pop_front() {
                    self.formed_dropped = left.version;
                }
            }
        }
    }

    /// The remembered answer for a lookup, when it is the answer a fresh lookup gives.
    ///
    /// An answer computed on the present set is handed out as it is. An answer computed
    /// on an earlier set is brought up to date when every attractor that joined since
    /// is still remembered: the remembered attractor must still be in the set, and
    /// each newcomer is compared with the hash. Attractors that left the set since
    /// cannot become the answer, so they need no look. In every other case there is
    /// no answer here and the caller computes one.
    fn remembered(&self, hash: &SimHash, max_distance: u32) -> Option<Option<Hit>> {
        let mut answers = self.answers.answers.try_lock().ok()?;
        let place = answer_place(hash);
        let answer = answers.get(place).copied().flatten()?;
        if answer.hash != *hash || answer.max_distance != max_distance {
            return None;
        }
        if answer.version == self.version {
            return Some(answer.hit);
        }
        if answer.version < self.formed_dropped {
            return None;
        }
        let mut best = match answer.hit {
            // A key that joined since the answer names another attractor than then.
            Some(hit)
                if self
                    .formed
                    .iter()
                    .any(|f| f.version > answer.version && f.key == hit.key) =>
            {
                return None
            }
            Some(hit) if self.slot_of.contains_key(&hit.key) => Some(hit),
            Some(_) => return None,
            None => None,
        };
        for formed in self.formed.iter().filter(|f| f.version > answer.version) {
            if !self.slot_of.contains_key(&formed.key) {
                continue;
            }
            let Some(distance) = distance_within(&formed.hash, hash, max_distance) else {
                continue;
            };
            let score = SIMHASH_MAX_SCORE - distance as i32;
            let better = match best {
                None => true,
                Some(b) => score > b.score || (score == b.score && formed.key < b.key),
            };
            if better {
                best = Some(Hit {
                    key: formed.key,
                    score,
                });
            }
        }
        answers[place] = Some(Answer {
            hash: *hash,
            max_distance,
            version: self.version,
            hit: best,
        });
        Some(best)
    }

    /// Keep the answer of a lookup that was just computed on the present set.
    fn remember(&self, hash: &SimHash, max_distance: u32, hit: Option<Hit>) {
        let Ok(mut answers) = self.answers.answers.try_lock() else {
            return;
        };
        if answers.len() < ANSWER_PLACES {
            answers.resize(ANSWER_PLACES, None);
        }
        answers[answer_place(hash)] = Some(Answer {
            hash: *hash,
            max_distance,
            version: self.version,
            hit,
        });
    }

    /// Take the attractor at `slot` as the best so far when it lies within
    /// `max_distance` and beats the present best: nearer, or as near with a lower key.
    fn offer(&self, best: &mut Option<Hit>, slot: usize, hash: &SimHash, max_distance: u32) {
        // The first words sit in a compact array of their own. A hash that is far
        // apart is told apart there, before its full hash is read.
        if (self.first_words[slot] ^ hash.0[0]).count_ones() > max_distance {
            return;
        }
        let Some(distance) = distance_within(&self.hashes[slot], hash, max_distance) else {
            return;
        };
        let score = SIMHASH_MAX_SCORE - distance as i32;
        let key = self.keys[slot];
        let better = match best {
            None => true,
            Some(b) => score > b.score || (score == b.score && key < b.key),
        };
        if better {
            *best = Some(Hit { key, score });
        }
    }

    /// The nearest attractor within `max_distance` by a pass over every hash. A hash
    /// is left as soon as its counted bits exceed the bound.
    fn nearest_by_bounded_scan(&self, hash: &SimHash, max_distance: u32) -> Option<Hit> {
        let mut best: Option<Hit> = None;
        for slot in 0..self.hashes.len() {
            self.offer(&mut best, slot, hash, max_distance);
        }
        best
    }

    /// The nearest attractor within `max_distance` through the chunk table.
    ///
    /// Two hashes within `max_distance` differ in more than `radius` bits in at most
    /// `max_distance / (radius + 1)` of their sixteen chunks. Call that number `outside`.
    /// In the other `16 - outside` chunks they differ in at most `radius` bits, so an
    /// attractor within the bound sits in the probed buckets of at least that many
    /// tables. The lookup counts in how many tables each slot appears and compares the
    /// full hash only for the slots that appear often enough. Almost every slot that
    /// shares one chunk by chance is turned away without a read of its hash.
    fn nearest_by_chunks(
        &self,
        table: &ChunkTable,
        hash: &SimHash,
        max_distance: u32,
        radius: u32,
    ) -> Option<Hit> {
        let outside = (max_distance / (radius + 1)) as usize;
        let need = CHUNKS.saturating_sub(outside).max(1);
        let mut best: Option<Hit> = None;
        if need < 2 {
            // One table may be the only one that holds a match: every slot is compared.
            let mut consider = |slot: usize| self.offer(&mut best, slot, hash, max_distance);
            for chunk in 0..CHUNKS {
                probe_chunk(table, hash, chunk, radius, &mut consider);
            }
            return best;
        }
        let mut seen = SeenSlots::new();
        for chunk in 0..CHUNKS {
            probe_chunk(table, hash, chunk, radius, &mut |slot| {
                seen.count(slot as u32)
            });
        }
        seen.each(|slot, tables| {
            if tables as usize >= need {
                self.offer(&mut best, slot as usize, hash, max_distance);
            }
        });
        best
    }

    /// True when the chunk table of the domain is built.
    pub fn has_chunk_table(&self) -> bool {
        self.chunk_table.is_some()
    }
}

/// Call `visit` with every slot of the buckets of one table whose chunk value differs
/// from the one of `hash` in at most `radius` bits.
fn probe_chunk(
    table: &ChunkTable,
    hash: &SimHash,
    chunk: usize,
    radius: u32,
    visit: &mut impl FnMut(usize),
) {
    let value = chunk_of(hash, chunk);
    table.each(chunk, value, visit);
    if radius >= 1 {
        for i in 0..CHUNK_BITS {
            let one = value ^ (1u16 << i);
            table.each(chunk, one, visit);
            if radius >= 2 {
                for j in (i + 1)..CHUNK_BITS {
                    table.each(chunk, one ^ (1u16 << j), visit);
                }
            }
        }
    }
}

/// Places of the small table of [`SeenSlots`]. A power of two.
const SEEN_PLACES: usize = 1024;
/// Slots the small table takes before the count moves to a map.
const SEEN_LIMIT: usize = 768;

/// Counts in how many tables each slot appeared during one lookup. The count lives in
/// a small table that fits the innermost cache. A lookup that meets more slots than
/// the small table takes goes on in a map, so the count is exact for any number.
struct SeenSlots {
    slots: [u32; SEEN_PLACES],
    tables: [u8; SEEN_PLACES],
    used: usize,
    spill: Option<HashMap<u32, u8>>,
}

impl SeenSlots {
    fn new() -> Self {
        SeenSlots {
            slots: [NONE; SEEN_PLACES],
            tables: [0; SEEN_PLACES],
            used: 0,
            spill: None,
        }
    }

    fn count(&mut self, slot: u32) {
        if let Some(spill) = self.spill.as_mut() {
            let tables = spill.entry(slot).or_insert(0);
            *tables = tables.saturating_add(1);
            return;
        }
        let mut place = (slot.wrapping_mul(0x9e37_79b1) >> 22) as usize;
        loop {
            if self.slots[place] == slot {
                self.tables[place] = self.tables[place].saturating_add(1);
                return;
            }
            if self.slots[place] == NONE {
                break;
            }
            place = (place + 1) % SEEN_PLACES;
        }
        if self.used < SEEN_LIMIT {
            self.slots[place] = slot;
            self.tables[place] = 1;
            self.used += 1;
            return;
        }
        // The small table is full: every count moves to a map and goes on there.
        let mut spill = HashMap::with_capacity(SEEN_PLACES * 4);
        for (kept, tables) in self.slots.iter().zip(self.tables.iter()) {
            if *kept != NONE {
                spill.insert(*kept, *tables);
            }
        }
        spill.insert(slot, 1);
        self.spill = Some(spill);
    }

    /// Call `visit` with every counted slot and the number of tables it appeared in.
    fn each(&self, mut visit: impl FnMut(u32, u8)) {
        match &self.spill {
            Some(spill) => {
                for (slot, tables) in spill {
                    visit(*slot, *tables);
                }
            }
            None => {
                for (slot, tables) in self.slots.iter().zip(self.tables.iter()) {
                    if *slot != NONE {
                        visit(*slot, *tables);
                    }
                }
            }
        }
    }
}

/// The number of differing bits of two hashes, or None as soon as it exceeds `max`. Two
/// hashes that are far apart are told apart after their first word.
fn distance_within(a: &SimHash, b: &SimHash, max: u32) -> Option<u32> {
    let mut total = 0;
    for (x, y) in a.0.iter().zip(b.0.iter()) {
        total += (x ^ y).count_ones();
        if total > max {
            return None;
        }
    }
    Some(total)
}

/// Differing bits per chunk that the table must enumerate for a threshold. None when
/// the threshold is so low that the scan is the cheaper exact answer.
fn chunk_radius(min_score: i32) -> Option<u32> {
    if min_score > SIMHASH_MAX_SCORE {
        // No pair of hashes scores above the maximum, so the table has nothing to list.
        return Some(0);
    }
    let max_distance = (SIMHASH_MAX_SCORE - min_score.max(0)) as u32;
    let radius = max_distance / CHUNKS as u32;
    if radius <= MAX_CHUNK_RADIUS {
        Some(radius)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fingerprint::QuantizedEmbedding;

    /// A small generator with a fixed sequence, so every run sees the same data.
    pub(crate) struct Lcg(pub u64);

    impl Lcg {
        pub(crate) fn next(&mut self) -> u64 {
            self.0 = self
                .0
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            let mut x = self.0;
            x ^= x >> 33;
            x = x.wrapping_mul(0xff51_afd7_ed55_8ccd);
            x ^= x >> 33;
            x
        }

        pub(crate) fn hash(&mut self) -> SimHash {
            SimHash([self.next(), self.next(), self.next(), self.next()])
        }

        /// A hash that differs from `base` in a random number of bits below `bound`.
        pub(crate) fn near_within(&mut self, base: &SimHash, bound: u64) -> SimHash {
            let bits = (self.next() % bound) as u32;
            self.near(base, bits)
        }

        /// A hash that differs from `base` in exactly `bits` bits.
        pub(crate) fn near(&mut self, base: &SimHash, bits: u32) -> SimHash {
            let mut out = *base;
            let mut flipped = 0;
            while flipped < bits {
                let bit = (self.next() % 256) as usize;
                let mask = 1u64 << (bit % 64);
                let word = bit / 64;
                if (out.0[word] ^ base.0[word]) & mask == 0 {
                    out.0[word] ^= mask;
                    flipped += 1;
                }
            }
            out
        }
    }

    fn attractor(key: i64, hash: SimHash) -> Attractor {
        let mut digest = [0u8; 32];
        digest[..8].copy_from_slice(&key.to_le_bytes());
        Attractor {
            key,
            fingerprint: Fingerprint::SimHash(hash),
            shape_digest: digest,
            support: 1,
            formed_at_unix: 1000 + key,
            last_seen_unix: 1000 + key,
        }
    }

    /// The reference: every pair scored, sorted by score and then by key.
    fn naive(all: &[(i64, SimHash)], query: &SimHash, limit: usize, min_score: i32) -> Vec<Hit> {
        let mut hits: Vec<Hit> = all
            .iter()
            .map(|(key, hash)| Hit {
                key: *key,
                score: 256 - hash.distance(query) as i32,
            })
            .filter(|hit| hit.score >= min_score)
            .collect();
        hits.sort_by(|a, b| b.score.cmp(&a.score).then(a.key.cmp(&b.key)));
        hits.truncate(limit);
        hits
    }

    #[test]
    fn flat_scan_matches_naive_reference() {
        let mut rng = Lcg(7);
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        let mut all = Vec::new();
        let seeds: Vec<SimHash> = (0..20).map(|_| rng.hash()).collect();
        for key in 1..=3000i64 {
            let seed = seeds[(rng.next() % 20) as usize];
            let bits = (rng.next() % 90) as u32;
            let hash = rng.near(&seed, bits);
            index.insert(attractor(key, hash)).unwrap();
            all.push((key, hash));
        }
        for round in 0..200 {
            let seed = seeds[round % 20];
            let query = rng.near_within(&seed, 40);
            for (limit, min_score) in [(1, 0), (5, 200), (10, 230), (50, 128), (5000, 0)] {
                let got = index.scan(&Fingerprint::SimHash(query), limit, min_score);
                assert_eq!(got, naive(&all, &query, limit, min_score));
            }
        }
    }

    #[test]
    fn ties_break_by_lowest_key() {
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        let hash = SimHash([9, 9, 9, 9]);
        for key in [40i64, 7, 23, 11] {
            index.insert(attractor(key, hash)).unwrap();
        }
        let hits = index.scan(&Fingerprint::SimHash(hash), 3, 0);
        assert_eq!(
            hits.iter().map(|h| h.key).collect::<Vec<_>>(),
            vec![7, 11, 23]
        );
        assert_eq!(
            index
                .nearest(&Fingerprint::SimHash(hash), 230)
                .map(|h| h.key),
            Some(7)
        );
    }

    #[test]
    fn search_filters_before_topk() {
        let mut rng = Lcg(11);
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        let base = rng.hash();
        // Ten far attractors with low keys, then three near ones.
        for key in 1..=10i64 {
            index.insert(attractor(key, rng.near(&base, 120))).unwrap();
        }
        for key in 11..=13i64 {
            index.insert(attractor(key, rng.near(&base, 4))).unwrap();
        }
        // Even keys only: the filter runs before the cut, so both near even keys
        // would be found if two existed. Here one near key is even.
        let hits = index.scan_where(&Fingerprint::SimHash(base), 2, 240, |key| key % 2 == 0);
        assert_eq!(hits.iter().map(|h| h.key).collect::<Vec<_>>(), vec![12]);
        let hits = index.scan(&Fingerprint::SimHash(base), 2, 240);
        assert_eq!(hits.len(), 2);
        let hits = index.scan(&Fingerprint::SimHash(base), 100, 240);
        assert_eq!(hits.len(), 3);
        // A limit below the number of matches still returns the best of all of them.
        let all = index.scan(&Fingerprint::SimHash(base), 100, 0);
        let top = index.scan(&Fingerprint::SimHash(base), 4, 0);
        assert_eq!(top, all[..4].to_vec());
    }

    #[test]
    fn nearest_by_chunk_table_equals_the_scan() {
        for seed in 1..=4u64 {
            let mut rng = Lcg(seed);
            let mut index = DomainIndex::new(FingerprintKind::SimHash);
            let seeds: Vec<SimHash> = (0..30).map(|_| rng.hash()).collect();
            for key in 1..=2500i64 {
                let base = seeds[(rng.next() % 30) as usize];
                let hash = rng.near_within(&base, 70);
                index.insert(attractor(key, hash)).unwrap();
            }
            // Remove some so the swapped slots are part of the comparison.
            for key in (1..=2500i64).filter(|k| k % 7 == 0) {
                assert!(index.remove(key));
            }
            for round in 0..250 {
                let base = seeds[round % 30];
                let query = Fingerprint::SimHash(rng.near_within(&base, 60));
                // Thresholds on both sides of every chunk radius and beyond the table.
                for min_score in [
                    257, 256, 250, 241, 240, 230, 225, 224, 209, 208, 200, 128, 0,
                ] {
                    let by_table = index.nearest(&query, min_score);
                    let by_scan = index.scan(&query, 1, min_score).first().copied();
                    assert_eq!(by_table, by_scan, "seed {seed} min_score {min_score}");
                }
            }
        }
    }

    #[test]
    fn chunk_radius_follows_the_threshold() {
        assert_eq!(chunk_radius(256), Some(0));
        assert_eq!(chunk_radius(241), Some(0));
        assert_eq!(chunk_radius(240), Some(1));
        assert_eq!(chunk_radius(230), Some(1));
        assert_eq!(chunk_radius(225), Some(1));
        assert_eq!(chunk_radius(224), Some(2));
        assert_eq!(chunk_radius(209), Some(2));
        assert_eq!(chunk_radius(208), None);
        assert_eq!(chunk_radius(0), None);
        assert_eq!(chunk_radius(300), Some(0));
    }

    #[test]
    fn remove_keeps_every_other_attractor_findable() {
        let mut rng = Lcg(3);
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        let mut all: Vec<(i64, SimHash)> = Vec::new();
        for key in 1..=400i64 {
            let hash = rng.hash();
            index.insert(attractor(key, hash)).unwrap();
            all.push((key, hash));
        }
        let mut removed = 0;
        while all.len() > 5 {
            let at = (rng.next() % all.len() as u64) as usize;
            let (key, _) = all.swap_remove(at);
            assert!(index.remove(key));
            assert!(!index.remove(key));
            removed += 1;
            if removed % 25 == 0 {
                for (key, hash) in &all {
                    let found = index.nearest(&Fingerprint::SimHash(*hash), 256);
                    assert_eq!(found.map(|h| h.key), Some(*key));
                    assert_eq!(
                        index.get(*key).map(|a| a.fingerprint),
                        Some(Fingerprint::SimHash(*hash))
                    );
                }
                assert_eq!(index.len(), all.len());
            }
        }
    }

    #[test]
    fn chunk_table_follows_removals() {
        let mut rng = Lcg(5);
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        let mut all: Vec<(i64, SimHash)> = Vec::new();
        for key in 1..=2300i64 {
            // Few distinct chunk values, so the chains hold several slots.
            let mut hash = rng.hash();
            hash.0[0] &= 0x0003_0003_0003_0003;
            index.insert(attractor(key, hash)).unwrap();
            all.push((key, hash));
            assert_eq!(index.has_chunk_table(), key >= CHUNK_TABLE_FROM as i64);
        }
        for removed in 1..=900 {
            let at = (rng.next() % all.len() as u64) as usize;
            let (key, _) = all.swap_remove(at);
            assert!(index.remove(key));
            if removed % 150 == 0 {
                assert!(index.has_chunk_table());
                for (key, hash) in &all {
                    let query = Fingerprint::SimHash(*hash);
                    let found = index.nearest(&query, 256);
                    assert_eq!(found, index.scan(&query, 1, 256).first().copied());
                    assert!(found.is_some(), "key {key}");
                }
            }
        }
        // New attractors go into the slots the removals freed.
        for key in 5000..5200i64 {
            let hash = rng.hash();
            index.insert(attractor(key, hash)).unwrap();
            let found = index.nearest(&Fingerprint::SimHash(hash), 256);
            assert_eq!(found.map(|h| h.key), Some(key));
        }
    }

    #[test]
    fn replace_leaves_what_a_removal_and_an_insert_leave() {
        for size in [300i64, 2300] {
            let mut rng = Lcg(size as u64);
            let mut replaced = DomainIndex::new(FingerprintKind::SimHash);
            let mut reference = DomainIndex::new(FingerprintKind::SimHash);
            for key in 1..=size {
                let hash = rng.hash();
                replaced.insert(attractor(key, hash)).unwrap();
                reference.insert(attractor(key, hash)).unwrap();
            }
            for round in 0..600i64 {
                let evicted = reference.eviction_candidate().unwrap();
                assert_eq!(replaced.eviction_candidate(), Some(evicted));
                let hash = rng.hash();
                let key = size + 1 + round;
                replaced.replace(evicted, attractor(key, hash)).unwrap();
                assert!(reference.remove(evicted));
                reference.insert(attractor(key, hash)).unwrap();
                // Now and then an attractor is reinforced, so the eviction order moves.
                if round % 3 == 0 {
                    let lucky = size + 1 + round / 2;
                    assert_eq!(
                        replaced.reinforce(lucky, round),
                        reference.reinforce(lucky, round)
                    );
                }
                let query = Fingerprint::SimHash(hash);
                assert_eq!(replaced.nearest(&query, 256).map(|h| h.key), Some(key));
                assert!(!replaced.contains(evicted));
                if round % 100 == 99 {
                    assert_eq!(replaced.attractors(), reference.attractors());
                    assert_eq!(replaced.len(), size as usize);
                    for _ in 0..50 {
                        let probe = Fingerprint::SimHash(rng.hash());
                        for min_score in [256, 230, 150, 0] {
                            assert_eq!(
                                replaced.nearest(&probe, min_score),
                                reference.nearest(&probe, min_score)
                            );
                        }
                        assert_eq!(replaced.scan(&probe, 5, 0), reference.scan(&probe, 5, 0));
                    }
                }
            }
        }
        // A key that is not there to take the place of: the attractor is added.
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        index
            .replace(99, attractor(1, SimHash([1, 0, 0, 0])))
            .unwrap();
        assert_eq!(index.len(), 1);
        // A key that is already there is refused.
        index.insert(attractor(2, SimHash([2, 0, 0, 0]))).unwrap();
        assert!(index
            .replace(1, attractor(2, SimHash([3, 0, 0, 0])))
            .is_err());
        assert_eq!(index.len(), 2);
        // An embedding domain replaces in place too.
        let mut embedded = DomainIndex::new(FingerprintKind::Embedding { dim: 2 });
        for (key, values) in [(1i64, [1.0f32, 0.0]), (2, [0.0, 1.0])] {
            let mut a = attractor(key, SimHash([0; 4]));
            a.fingerprint = embedding(&values);
            embedded.insert(a).unwrap();
        }
        let mut third = attractor(3, SimHash([0; 4]));
        third.fingerprint = embedding(&[-1.0, 0.0]);
        embedded.replace(1, third).unwrap();
        assert_eq!(embedded.len(), 2);
        assert_eq!(
            embedded.get(3).map(|a| a.fingerprint),
            Some(embedding(&[-1.0, 0.0]))
        );
        assert_eq!(
            embedded.get(2).map(|a| a.fingerprint),
            Some(embedding(&[0.0, 1.0]))
        );
        assert!(embedded.get(1).is_none());
    }

    #[test]
    fn remembered_answers_equal_fresh_lookups() {
        // Small domains answer by the bounded scan and large ones by the chunk table.
        for size in [150i64, 2600] {
            let mut rng = Lcg(size as u64 + 9);
            let mut index = DomainIndex::new(FingerprintKind::SimHash);
            let mut held: Vec<(i64, SimHash)> = Vec::new();
            for key in 1..=size {
                let hash = rng.hash();
                index.insert(attractor(key, hash)).unwrap();
                held.push((key, hash));
            }
            // A few queries that come back again and again: some far from every
            // attractor, some near one that is held now.
            let mut queries: Vec<SimHash> = (0..12).map(|_| rng.hash()).collect();
            for at in 0..12 {
                let near = rng.near_within(&held[at * 7].1, 20);
                queries.push(near);
            }
            let mut next_key = size;
            let check = |index: &DomainIndex, queries: &[SimHash], what: &str| {
                for query in queries {
                    let fp = Fingerprint::SimHash(*query);
                    for min_score in [256, 230, 200] {
                        let fresh = index.scan(&fp, 1, min_score).first().copied();
                        // Twice: the second call reads the remembered answer.
                        assert_eq!(index.nearest(&fp, min_score), fresh, "{what}");
                        assert_eq!(index.nearest(&fp, min_score), fresh, "{what}");
                    }
                }
            };
            check(&index, &queries, "start");
            for round in 0..250u64 {
                match rng.next() % 6 {
                    0 => {
                        // An attractor joins right at a query, so the answer changes.
                        next_key += 1;
                        let at = (rng.next() % queries.len() as u64) as usize;
                        let hash = rng.near_within(&queries[at], 12);
                        index.insert(attractor(next_key, hash)).unwrap();
                        held.push((next_key, hash));
                    }
                    1 => {
                        next_key += 1;
                        let hash = rng.hash();
                        index.insert(attractor(next_key, hash)).unwrap();
                        held.push((next_key, hash));
                    }
                    2 => {
                        // The attractor a query remembers may be the one that leaves.
                        let at = (rng.next() % held.len() as u64) as usize;
                        let (key, _) = held.swap_remove(at);
                        assert!(index.remove(key));
                    }
                    3 => {
                        next_key += 1;
                        let at = (rng.next() % held.len() as u64) as usize;
                        let (evicted, _) = held.swap_remove(at);
                        let near = (rng.next() % queries.len() as u64) as usize;
                        let hash = rng.near_within(&queries[near], 30);
                        index.replace(evicted, attractor(next_key, hash)).unwrap();
                        held.push((next_key, hash));
                    }
                    4 => {
                        let at = (rng.next() % held.len() as u64) as usize;
                        index.reinforce(held[at].0, round as i64);
                    }
                    _ => {
                        // More joiners than the domain remembers between two looks.
                        for _ in 0..(FORMED_KEPT + 5) {
                            next_key += 1;
                            let hash = rng.hash();
                            index.insert(attractor(next_key, hash)).unwrap();
                            held.push((next_key, hash));
                        }
                    }
                }
                // Some rounds look at once and some let several changes pile up.
                if round % 3 != 0 {
                    check(&index, &queries, "after a change");
                }
            }
            check(&index, &queries, "end");
            // A copy of the index answers the same from an empty cache.
            let copy = index.clone();
            check(&copy, &queries, "copy");
        }
    }
    #[test]
    fn exact_digest_lookup_follows_insert_and_remove() {
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        let mut first = attractor(1, SimHash([1, 0, 0, 0]));
        first.shape_digest = [7; 32];
        let mut second = attractor(2, SimHash([2, 0, 0, 0]));
        second.shape_digest = [7; 32];
        index.insert(first).unwrap();
        index.insert(second).unwrap();
        assert_eq!(index.exact(&[7; 32]), Some(1));
        assert!(index.remove(1));
        assert_eq!(index.exact(&[7; 32]), None);
        assert_eq!(index.exact(&[8; 32]), None);
    }

    #[test]
    fn reinforce_moves_the_eviction_order() {
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        for key in 1..=3i64 {
            index
                .insert(attractor(key, SimHash([key as u64, 0, 0, 0])))
                .unwrap();
        }
        // Equal support: the least recently seen goes first, which is key 1.
        assert_eq!(index.eviction_candidate(), Some(1));
        assert_eq!(index.reinforce(1, 5000), Some(2));
        assert_eq!(index.eviction_candidate(), Some(2));
        assert_eq!(index.reinforce(2, 5000), Some(2));
        assert_eq!(index.reinforce(3, 5000), Some(2));
        // Equal support and equal time: the lowest key goes first.
        assert_eq!(index.eviction_candidate(), Some(1));
        assert_eq!(index.reinforce(99, 1), None);
        assert_eq!(index.support(1), Some(2));
    }

    #[test]
    fn a_duplicate_key_is_refused() {
        let mut index = DomainIndex::new(FingerprintKind::SimHash);
        index.insert(attractor(1, SimHash([1, 0, 0, 0]))).unwrap();
        assert!(index.insert(attractor(1, SimHash([2, 0, 0, 0]))).is_err());
        assert_eq!(index.len(), 1);
    }

    fn embedding(values: &[f32]) -> Fingerprint {
        Fingerprint::Embedding(QuantizedEmbedding::quantize(values, values.len()).unwrap())
    }

    #[test]
    fn embedding_domain_scans_removes_and_checks_the_dimension() {
        let mut index = DomainIndex::new(FingerprintKind::Embedding { dim: 3 });
        let rows = [
            (1i64, [1.0f32, 0.0, 0.0]),
            (2, [0.0, 1.0, 0.0]),
            (3, [0.9, 0.1, 0.0]),
            (4, [0.0, 0.0, 1.0]),
        ];
        for (key, values) in rows {
            let mut a = attractor(key, SimHash([0; 4]));
            a.fingerprint = embedding(&values);
            index.insert(a).unwrap();
        }
        let query = embedding(&[1.0, 0.0, 0.0]);
        let hits = index.scan(&query, 2, 0);
        assert_eq!(hits.iter().map(|h| h.key).collect::<Vec<_>>(), vec![1, 3]);
        assert_eq!(index.nearest(&query, 15_000).map(|h| h.key), Some(1));
        assert!(index.remove(1));
        assert_eq!(index.nearest(&query, 15_000).map(|h| h.key), Some(3));
        assert_eq!(
            index.get(4).map(|a| a.fingerprint),
            Some(embedding(&[0.0, 0.0, 1.0]))
        );
        let wrong = embedding(&[1.0, 0.0]);
        assert_eq!(
            index.check_kind("d", &wrong),
            Err(CoreError::DimensionMismatch {
                expected: 3,
                got: 2
            })
        );
        assert!(matches!(
            index.check_kind("d", &Fingerprint::SimHash(SimHash([0; 4]))),
            Err(CoreError::KindMismatch { .. })
        ));
        assert!(index
            .scan(&Fingerprint::SimHash(SimHash([0; 4])), 5, i32::MIN)
            .is_empty());
    }
}
