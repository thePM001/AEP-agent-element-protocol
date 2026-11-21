//! Fingerprints: what the index compares.
//!
//! Two kinds exist. The 256 bit SimHash is computed here from the tokens of a shape and
//! compared by Hamming distance. An operator embedding comes from outside, passes a
//! strict dimension check and is quantized to one signed byte per dimension. Both are
//! compared with integers alone, so a native build and a WASM build give the same score
//! for the same input, bit for bit.

use crate::error::CoreError;
use crate::shape::{sha256, ProposalShape};

/// Bits of a SimHash.
pub const SIMHASH_BITS: u32 = 256;
/// Bytes of a stored SimHash.
pub const SIMHASH_BYTES: usize = 32;
/// The score of two equal SimHashes.
pub const SIMHASH_MAX_SCORE: i32 = 256;
/// Largest magnitude of one quantized dimension.
pub const EMBEDDING_SCALE: i32 = 127;
/// The score two equal unit vectors approach: the square of the scale.
pub const EMBEDDING_MAX_SCORE: i32 = EMBEDDING_SCALE * EMBEDDING_SCALE;
/// Largest dimension of an operator embedding.
pub const MAX_EMBEDDING_DIM: usize = 4096;

/// A 256 bit SimHash as four words, the first word holding bits 0 to 63.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct SimHash(pub [u64; 4]);

impl SimHash {
    /// The SimHash of a list of tokens. Every token votes on every bit with the bits of
    /// its SHA-256. A bit is set when more tokens vote for it than against it. No
    /// token gives the zero hash.
    pub fn of_tokens<S: AsRef<str>>(tokens: &[S]) -> Self {
        let mut votes = [0i32; SIMHASH_BITS as usize];
        for token in tokens {
            let digest = sha256(token.as_ref().as_bytes());
            for (byte_index, byte) in digest.iter().enumerate() {
                for bit in 0..8 {
                    let slot = byte_index * 8 + bit;
                    if byte & (1u8 << bit) != 0 {
                        votes[slot] += 1;
                    } else {
                        votes[slot] -= 1;
                    }
                }
            }
        }
        let mut words = [0u64; 4];
        for (slot, vote) in votes.iter().enumerate() {
            if *vote > 0 {
                words[slot / 64] |= 1u64 << (slot % 64);
            }
        }
        SimHash(words)
    }

    /// The SimHash of a shape.
    pub fn of_shape(shape: &ProposalShape) -> Self {
        SimHash::of_tokens(&shape.tokens())
    }

    /// Number of bits in which two hashes differ.
    pub fn distance(&self, other: &SimHash) -> u32 {
        let mut total = 0;
        for (a, b) in self.0.iter().zip(other.0.iter()) {
            total += (a ^ b).count_ones();
        }
        total
    }

    /// The score of two hashes: the number of equal bits, 0 to 256.
    pub fn score(&self, other: &SimHash) -> i32 {
        SIMHASH_MAX_SCORE - self.distance(other) as i32
    }

    /// The stored form: 32 bytes, each word in little-endian order.
    pub fn to_bytes(&self) -> [u8; SIMHASH_BYTES] {
        let mut out = [0u8; SIMHASH_BYTES];
        for (index, word) in self.0.iter().enumerate() {
            out[index * 8..index * 8 + 8].copy_from_slice(&word.to_le_bytes());
        }
        out
    }

    /// Read the stored form. Any other length is refused.
    pub fn from_bytes(bytes: &[u8]) -> Result<Self, CoreError> {
        if bytes.len() != SIMHASH_BYTES {
            return Err(CoreError::DimensionMismatch {
                expected: SIMHASH_BYTES,
                got: bytes.len(),
            });
        }
        let mut words = [0u64; 4];
        for (index, word) in words.iter_mut().enumerate() {
            let mut chunk = [0u8; 8];
            chunk.copy_from_slice(&bytes[index * 8..index * 8 + 8]);
            *word = u64::from_le_bytes(chunk);
        }
        Ok(SimHash(words))
    }
}

/// An operator embedding after normalization and quantization.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct QuantizedEmbedding(Vec<i8>);

impl QuantizedEmbedding {
    /// Quantize an operator embedding.
    ///
    /// The length must equal `expected_dim`. A vector of any other length is refused
    /// and is never cut or padded. Every value must be finite and the vector must not
    /// be zero. The vector is scaled to unit length and each dimension is rounded to a
    /// signed byte in the range -127 to 127.
    pub fn quantize(values: &[f32], expected_dim: usize) -> Result<Self, CoreError> {
        if expected_dim == 0 {
            return Err(CoreError::EmbeddingsOff);
        }
        if values.len() != expected_dim {
            return Err(CoreError::DimensionMismatch {
                expected: expected_dim,
                got: values.len(),
            });
        }
        let mut sum = 0f64;
        for (index, value) in values.iter().enumerate() {
            if !value.is_finite() {
                return Err(CoreError::NotFinite { index });
            }
            sum += f64::from(*value) * f64::from(*value);
        }
        let norm = sum.sqrt();
        if norm <= 0.0 || !norm.is_finite() {
            return Err(CoreError::ZeroNorm);
        }
        let scale = f64::from(EMBEDDING_SCALE);
        let quantized = values
            .iter()
            .map(|value| {
                let scaled = (f64::from(*value) / norm * scale).round();
                scaled.clamp(-scale, scale) as i8
            })
            .collect();
        Ok(QuantizedEmbedding(quantized))
    }

    /// Read the stored form: one signed byte per dimension.
    pub fn from_bytes(bytes: &[u8], expected_dim: usize) -> Result<Self, CoreError> {
        if expected_dim == 0 {
            return Err(CoreError::EmbeddingsOff);
        }
        if bytes.len() != expected_dim {
            return Err(CoreError::DimensionMismatch {
                expected: expected_dim,
                got: bytes.len(),
            });
        }
        Ok(QuantizedEmbedding(
            bytes.iter().map(|b| i8::from_le_bytes([*b])).collect(),
        ))
    }

    /// The stored form.
    pub fn to_bytes(&self) -> Vec<u8> {
        self.0.iter().map(|v| v.to_le_bytes()[0]).collect()
    }

    pub fn dim(&self) -> usize {
        self.0.len()
    }

    pub fn as_slice(&self) -> &[i8] {
        &self.0
    }

    /// The score of two embeddings: their integer dot product. Embeddings of different
    /// dimensions never compare, so that case scores the lowest value.
    pub fn score(&self, other: &QuantizedEmbedding) -> i32 {
        if self.0.len() != other.0.len() {
            return i32::MIN;
        }
        dot_i8(&self.0, &other.0)
    }
}

/// Integer dot product of two byte vectors of the same length.
pub(crate) fn dot_i8(a: &[i8], b: &[i8]) -> i32 {
    let mut total = 0i32;
    for (x, y) in a.iter().zip(b.iter()) {
        total += i32::from(*x) * i32::from(*y);
    }
    total
}

/// The kind of a fingerprint. One domain holds one kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FingerprintKind {
    SimHash,
    Embedding { dim: usize },
}

impl FingerprintKind {
    pub fn name(&self) -> &'static str {
        match self {
            FingerprintKind::SimHash => "simhash256",
            FingerprintKind::Embedding { .. } => "embedding-i8",
        }
    }

    /// The stored code of the kind.
    pub fn code(&self) -> i64 {
        match self {
            FingerprintKind::SimHash => 1,
            FingerprintKind::Embedding { .. } => 2,
        }
    }

    /// The score of two equal fingerprints of this kind.
    pub fn max_score(&self) -> i32 {
        match self {
            FingerprintKind::SimHash => SIMHASH_MAX_SCORE,
            FingerprintKind::Embedding { .. } => EMBEDDING_MAX_SCORE,
        }
    }
}

/// One fingerprint of either kind.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Fingerprint {
    SimHash(SimHash),
    Embedding(QuantizedEmbedding),
}

impl Fingerprint {
    pub fn kind(&self) -> FingerprintKind {
        match self {
            Fingerprint::SimHash(_) => FingerprintKind::SimHash,
            Fingerprint::Embedding(e) => FingerprintKind::Embedding { dim: e.dim() },
        }
    }

    /// The stored form of the vector.
    pub fn to_bytes(&self) -> Vec<u8> {
        match self {
            Fingerprint::SimHash(h) => h.to_bytes().to_vec(),
            Fingerprint::Embedding(e) => e.to_bytes(),
        }
    }

    /// Read a stored vector of the given kind code. `embedding_dim` is the dimension
    /// of the store and is checked for an embedding.
    pub fn from_stored(code: i64, bytes: &[u8], embedding_dim: usize) -> Result<Self, CoreError> {
        match code {
            1 => Ok(Fingerprint::SimHash(SimHash::from_bytes(bytes)?)),
            2 => Ok(Fingerprint::Embedding(QuantizedEmbedding::from_bytes(
                bytes,
                embedding_dim,
            )?)),
            other => Err(CoreError::invalid(
                "fingerprint kind",
                format!("unknown code {other}"),
            )),
        }
    }

    /// The score of two fingerprints. Fingerprints of different kinds never compare.
    pub fn score(&self, other: &Fingerprint) -> i32 {
        match (self, other) {
            (Fingerprint::SimHash(a), Fingerprint::SimHash(b)) => a.score(b),
            (Fingerprint::Embedding(a), Fingerprint::Embedding(b)) => a.score(b),
            _ => i32::MIN,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn proposal(note: &str, action: &str) -> ProposalShape {
        ProposalShape::from_value(&json!({
            "type": "CUSTOM",
            "action_path": action,
            "agent_id": "agent-a",
            "docking_port": "validation_engine",
            "target_id": "scene-a",
            "payload": {
                "note": note,
                "files": ["src/parser.rs", "src/lexer.rs", "src/lib.rs"],
                "mode": "write",
                "reviewer": "agent-b",
                "priority": 3
            }
        }))
    }

    #[test]
    fn simhash_near_duplicate_above_threshold() {
        let a = SimHash::of_shape(&proposal(
            "rename the parser module and update every caller in the workspace",
            "action:write",
        ));
        let b = SimHash::of_shape(&proposal(
            "rename the parser module and update every caller in the repository",
            "action:write",
        ));
        let score = a.score(&b);
        assert!(score >= crate::DEFAULT_SIMHASH_MIN_SCORE, "score {score}");
        assert!(score < SIMHASH_MAX_SCORE, "the two shapes are not equal");
    }

    #[test]
    fn simhash_unrelated_below_threshold() {
        let a = SimHash::of_shape(&proposal(
            "rename the parser module and update every caller in the workspace",
            "action:write",
        ));
        let b = SimHash::of_shape(&ProposalShape::from_value(&json!({
            "type": "STATE_DELTA",
            "action_path": "billing:refund",
            "agent_id": "agent-z",
            "docking_port": "inference_engine",
            "delta": [{"op": "replace", "path": "/registry/CN-7/amount", "value": 4200}],
            "payload": {"reason": "customer asked for a refund after the trial ended"}
        })));
        let score = a.score(&b);
        assert!(score < crate::DEFAULT_SIMHASH_MIN_SCORE, "score {score}");
    }

    #[test]
    fn simhash_of_equal_shapes_is_equal_and_scores_the_maximum() {
        let a = SimHash::of_shape(&proposal("one two three", "action:write"));
        let b = SimHash::of_shape(&proposal("one two three", "action:write"));
        assert_eq!(a, b);
        assert_eq!(a.score(&b), SIMHASH_MAX_SCORE);
        assert_eq!(a.distance(&b), 0);
    }

    #[test]
    fn simhash_does_not_depend_on_token_order() {
        let forward = SimHash::of_tokens(&["a", "b", "c", "d"]);
        let backward = SimHash::of_tokens(&["d", "c", "b", "a"]);
        assert_eq!(forward, backward);
    }

    #[test]
    fn simhash_of_no_token_is_zero() {
        let none: [&str; 0] = [];
        assert_eq!(SimHash::of_tokens(&none), SimHash([0; 4]));
    }

    #[test]
    fn simhash_has_a_pinned_value() {
        // The value is the same on every target. A change of the hash, of the bit
        // order or of the vote rule changes it and breaks stored attractors.
        let hash = SimHash::of_tokens(&["action_path=\"root:ping\"", "#action_path"]);
        assert_eq!(hash.distance(&hash), 0);
        let bytes = hash.to_bytes();
        assert_eq!(SimHash::from_bytes(&bytes).unwrap(), hash);
        // One token alone gives the bits of its SHA-256.
        let one = SimHash::of_tokens(&["abc"]);
        let digest = sha256(b"abc");
        assert_eq!(one.to_bytes(), digest);
    }

    #[test]
    fn simhash_bytes_of_wrong_length_are_refused() {
        assert_eq!(
            SimHash::from_bytes(&[0u8; 31]),
            Err(CoreError::DimensionMismatch {
                expected: 32,
                got: 31
            })
        );
    }

    #[test]
    fn dimension_mismatch_is_error() {
        let short = vec![0.5f32; 127];
        let long = vec![0.5f32; 129];
        assert_eq!(
            QuantizedEmbedding::quantize(&short, 128),
            Err(CoreError::DimensionMismatch {
                expected: 128,
                got: 127
            })
        );
        assert_eq!(
            QuantizedEmbedding::quantize(&long, 128),
            Err(CoreError::DimensionMismatch {
                expected: 128,
                got: 129
            })
        );
        assert_eq!(
            QuantizedEmbedding::quantize(&[1.0, 0.0, 0.0], 128),
            Err(CoreError::DimensionMismatch {
                expected: 128,
                got: 3
            })
        );
        assert!(QuantizedEmbedding::quantize(&vec![0.5f32; 128], 128).is_ok());
    }

    #[test]
    fn embeddings_are_refused_when_the_store_holds_no_dimension() {
        assert_eq!(
            QuantizedEmbedding::quantize(&[1.0], 0),
            Err(CoreError::EmbeddingsOff)
        );
    }

    #[test]
    fn embedding_values_must_be_finite_and_not_all_zero() {
        assert_eq!(
            QuantizedEmbedding::quantize(&[1.0, f32::NAN], 2),
            Err(CoreError::NotFinite { index: 1 })
        );
        assert_eq!(
            QuantizedEmbedding::quantize(&[f32::INFINITY, 1.0], 2),
            Err(CoreError::NotFinite { index: 0 })
        );
        assert_eq!(
            QuantizedEmbedding::quantize(&[0.0, 0.0], 2),
            Err(CoreError::ZeroNorm)
        );
    }

    #[test]
    fn quantization_normalizes_and_keeps_direction() {
        let a = QuantizedEmbedding::quantize(&[3.0, 4.0], 2).unwrap();
        assert_eq!(a.as_slice(), &[76, 102]);
        let scaled = QuantizedEmbedding::quantize(&[300.0, 400.0], 2).unwrap();
        assert_eq!(a, scaled);
        let opposite = QuantizedEmbedding::quantize(&[-3.0, -4.0], 2).unwrap();
        assert_eq!(opposite.as_slice(), &[-76, -102]);
        assert_eq!(a.score(&opposite), -a.score(&a));
        let axis = QuantizedEmbedding::quantize(&[1.0, 0.0], 2).unwrap();
        assert_eq!(axis.as_slice(), &[127, 0]);
        assert_eq!(axis.score(&axis), EMBEDDING_MAX_SCORE);
    }

    #[test]
    fn embedding_scores_order_by_angle() {
        let base = QuantizedEmbedding::quantize(&[1.0, 0.0, 0.0, 0.0], 4).unwrap();
        let near = QuantizedEmbedding::quantize(&[0.98, 0.2, 0.0, 0.0], 4).unwrap();
        let far = QuantizedEmbedding::quantize(&[0.0, 1.0, 0.0, 0.0], 4).unwrap();
        assert!(base.score(&near) > crate::DEFAULT_EMBEDDING_MIN_SCORE);
        assert_eq!(base.score(&far), 0);
        assert!(base.score(&near) > base.score(&far));
    }

    #[test]
    fn embedding_bytes_round_trip_and_check_the_dimension() {
        let a = QuantizedEmbedding::quantize(&[0.1, -0.7, 0.3], 3).unwrap();
        let bytes = a.to_bytes();
        assert_eq!(QuantizedEmbedding::from_bytes(&bytes, 3).unwrap(), a);
        assert_eq!(
            QuantizedEmbedding::from_bytes(&bytes, 4),
            Err(CoreError::DimensionMismatch {
                expected: 4,
                got: 3
            })
        );
    }

    #[test]
    fn fingerprints_of_different_kinds_never_compare() {
        let hash = Fingerprint::SimHash(SimHash([1, 2, 3, 4]));
        let emb = Fingerprint::Embedding(QuantizedEmbedding::quantize(&[1.0, 0.0], 2).unwrap());
        assert_eq!(hash.score(&emb), i32::MIN);
        assert_eq!(hash.kind().name(), "simhash256");
        assert_eq!(emb.kind(), FingerprintKind::Embedding { dim: 2 });
        let stored = Fingerprint::from_stored(1, &hash.to_bytes(), 0).unwrap();
        assert_eq!(stored, hash);
        let stored = Fingerprint::from_stored(2, &emb.to_bytes(), 2).unwrap();
        assert_eq!(stored, emb);
        assert!(Fingerprint::from_stored(9, &[], 0).is_err());
    }
}
