//! Canonical JSON by the JSON Canonicalization Scheme (JCS) plus SHA3-256 digests.
//! UCM records never carry JSON numbers, so the number rules of JCS never apply and a
//! number in a record is refused.

use crate::error::{Result, UcmError};
use serde_json::Value as J;
use sha3::{Digest, Sha3_256};

fn write_str(out: &mut String, s: &str) {
    out.push('"');
    for ch in s.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{08}' => out.push_str("\\b"),
            '\u{09}' => out.push_str("\\t"),
            '\u{0A}' => out.push_str("\\n"),
            '\u{0C}' => out.push_str("\\f"),
            '\u{0D}' => out.push_str("\\r"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

fn write(out: &mut String, v: &J) -> Result<()> {
    match v {
        J::Null => out.push_str("null"),
        J::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
        J::Number(_) => {
            return Err(UcmError::Form(
                "UCM canonical JSON carries no JSON numbers; write numbers as strings".into(),
            ))
        }
        J::String(s) => write_str(out, s),
        J::Array(a) => {
            out.push('[');
            for (i, x) in a.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write(out, x)?;
            }
            out.push(']');
        }
        J::Object(o) => {
            // JCS orders keys by their UTF-16 code units.
            let mut keys: Vec<&String> = o.keys().collect();
            keys.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
            out.push('{');
            for (i, k) in keys.iter().enumerate() {
                if i > 0 {
                    out.push(',');
                }
                write_str(out, k);
                out.push(':');
                write(out, &o[*k])?;
            }
            out.push('}');
        }
    }
    Ok(())
}

pub fn canonical(v: &J) -> Result<String> {
    let mut s = String::new();
    write(&mut s, v)?;
    Ok(s)
}

pub fn sha3_hex(bytes: &[u8]) -> String {
    hex::encode(Sha3_256::digest(bytes))
}

/// SHA3-256 over the JCS bytes of a JSON value, as lowercase hex.
pub fn digest(v: &J) -> Result<String> {
    Ok(sha3_hex(canonical(v)?.as_bytes()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn sorts_keys_and_escapes() {
        let v = json!({"b": "x", "a": ["1", true, null], "\u{e9}": "q\"\n"});
        assert_eq!(
            canonical(&v).expect("canon"),
            "{\"a\":[\"1\",true,null],\"b\":\"x\",\"\u{e9}\":\"q\\\"\\n\"}"
        );
        assert!(canonical(&json!({"n": 1})).is_err());
    }
}
