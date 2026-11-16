//! Canonical JSON and its sha256 digest.
//!
//! The GAP compiler writes a record as JSON with the keys of every object in sorted
//! order and no white space and signs that text with a sha256 digest. This module
//! writes the same text from a parsed value, so the engine can check the digest of a
//! record and give its own plan a digest in the same form.

use serde_json::Value;
use sha2::{Digest, Sha256};

/// Writes `value` as canonical JSON: sorted keys, no white space.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_value(value, &mut out);
    out
}

fn write_value(value: &Value, out: &mut String) {
    match value {
        Value::Array(items) => {
            out.push('[');
            for (i, item) in items.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_value(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            out.push('{');
            for (i, key) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                out.push_str(&Value::String((*key).clone()).to_string());
                out.push(':');
                write_value(&map[*key], out);
            }
            out.push('}');
        }
        other => out.push_str(&other.to_string()),
    }
}

/// The digest of a text in the form `sha256:<hex>`.
pub fn sha256_label(text: &str) -> String {
    let hash = Sha256::digest(text.as_bytes());
    let mut out = String::with_capacity(7 + 64);
    out.push_str("sha256:");
    for byte in hash {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The digest of a JSON object without its own field `digest`.
pub fn digest_without_field(value: &Value) -> String {
    let mut copy = value.clone();
    if let Value::Object(map) = &mut copy {
        map.remove("digest");
    }
    sha256_label(&canonical_json(&copy))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn keys_are_sorted_at_every_depth_and_lists_keep_their_order() {
        let value = json!({"b": 1, "a": [{"d": null, "c": "x"}, 2], "e": true});
        assert_eq!(
            canonical_json(&value),
            r#"{"a":[{"c":"x","d":null},2],"b":1,"e":true}"#
        );
    }

    #[test]
    fn text_is_escaped_as_json() {
        let value = json!({"k\"": "line\nnext\ttab \u{1f} / é"});
        assert_eq!(
            canonical_json(&value),
            "{\"k\\\"\":\"line\\nnext\\ttab \\u001f / é\"}"
        );
    }

    #[test]
    fn the_digest_ignores_the_digest_field_and_the_key_order() {
        let one = digest_without_field(&json!({"a": 1, "b": {"c": 2, "d": 3}, "digest": "old"}));
        let two = digest_without_field(&json!({"b": {"d": 3, "c": 2}, "a": 1}));
        assert_eq!(one, two);
        assert!(one.starts_with("sha256:") && one.len() == 71);
        assert_ne!(
            one,
            digest_without_field(&json!({"a": 2, "b": {"c": 2, "d": 3}}))
        );
    }

    #[test]
    fn the_digest_of_the_empty_text_is_the_known_value() {
        assert_eq!(
            sha256_label(""),
            "sha256:e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }
}
