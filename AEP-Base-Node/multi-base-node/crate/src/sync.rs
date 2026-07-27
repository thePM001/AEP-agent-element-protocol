use sha2::{Digest, Sha256};

/// Merkle root over **sorted** policy bundle entry hashes (hex lines).
///
/// TASK-A28-H09: callers may pass entries in any order; this function sorts
/// lexicographically before hashing so the root is order-independent.
pub fn merkle_root_hex(entries: &[String]) -> String {
    if entries.is_empty() {
        return hex::encode(Sha256::digest(b""));
    }

    let mut sorted: Vec<&str> = entries.iter().map(String::as_str).collect();
    sorted.sort_unstable();

    let mut layer: Vec<[u8; 32]> = sorted
        .into_iter()
        .map(|entry| {
            let mut hasher = Sha256::new();
            hasher.update(entry.as_bytes());
            hasher.finalize().into()
        })
        .collect();

    while layer.len() > 1 {
        let mut next = Vec::with_capacity(layer.len().div_ceil(2));
        let mut i = 0;
        while i < layer.len() {
            let left = layer[i];
            let right = if i + 1 < layer.len() {
                layer[i + 1]
            } else {
                left
            };
            let mut hasher = Sha256::new();
            hasher.update(left);
            hasher.update(right);
            next.push(hasher.finalize().into());
            i += 2;
        }
        layer = next;
    }

    hex::encode(layer[0])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_root_is_stable() {
        let root = merkle_root_hex(&[]);
        assert_eq!(root.len(), 64);
    }

    #[test]
    fn order_of_pairing_is_deterministic() {
        let a = merkle_root_hex(&["alpha".into(), "beta".into()]);
        let b = merkle_root_hex(&["alpha".into(), "beta".into()]);
        assert_eq!(a, b);
    }

    #[test]
    fn permuting_input_order_yields_same_root() {
        let a = merkle_root_hex(&["gamma".into(), "alpha".into(), "beta".into()]);
        let b = merkle_root_hex(&["beta".into(), "gamma".into(), "alpha".into()]);
        let c = merkle_root_hex(&["alpha".into(), "beta".into(), "gamma".into()]);
        assert_eq!(a, b);
        assert_eq!(b, c);
    }
}