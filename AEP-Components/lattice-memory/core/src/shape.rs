//! The shape of a proposal: the fields that say what an agent asked for.
//!
//! Two digests come from a shape. The shape digest is SHA-256 over the canonical JSON
//! of the shape and finds exact matches. The SimHash over the shape tokens finds near
//! duplicates. The fields that feed both are listed here and each has a test.
//!
//! The shape leaves out what differs between two submissions of the same request: the
//! stamp of the agent, the sequence number and the scores the kernel derives. The body
//! of the proposal never leaves this module. Only the two digests are stored.

use serde_json::{Map, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

/// Fields of the opened event that are part of the shape, in the order of this list.
pub const SHAPE_EVENT_FIELDS: &[&str] = &[
    "type",
    "dynaep_type",
    "action_path",
    "tool",
    "dest_dock",
    "target_id",
    "payload",
    "delta",
];

/// Fields of the opened frame that are part of the shape. The signer of the frame is
/// the agent of the shape. The agent a proposal names in its own text is not read.
pub const SHAPE_FRAME_FIELDS: &[&str] = &["agent_id", "docking_port", "contract_id"];

/// Fields of the opened event that are never part of the shape.
pub const SHAPE_LEFT_OUT: &[&str] = &[
    "timestamp",
    "_sequenceNumber",
    "sequence_number",
    "trust_score",
    "anomaly_score",
    "_temporal",
    "expected_version",
];

/// Upper bound of the tokens of one shape. A shape with more tokens keeps the first
/// ones in byte order, so the choice is the same on every run.
pub const MAX_SHAPE_TOKENS: usize = 2048;

/// Upper bound of the nesting that is turned into tokens. Deeper values count as one leaf.
const MAX_TOKEN_DEPTH: usize = 32;

/// What the kernel knows about the frame a proposal arrived in.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct FrameContext<'a> {
    pub agent_id: &'a str,
    pub docking_port: &'a str,
    pub contract_id: &'a str,
}

/// Canonical JSON: object keys in byte order, no white space and the number text of
/// the input. Two values that are equal as JSON give the same bytes.
pub fn canonical_json(value: &Value) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn write_canonical(value: &Value, out: &mut String) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(true) => out.push_str("true"),
        Value::Bool(false) => out.push_str("false"),
        Value::Number(n) => out.push_str(&n.to_string()),
        Value::String(s) => write_string(s, out),
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_unstable();
            out.push('{');
            for (index, key) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                if let Some(item) = map.get(*key) {
                    write_canonical(item, out);
                }
            }
            out.push('}');
        }
    }
}

/// One JSON string with the escapes of RFC 8259 and nothing more.
fn write_string(text: &str, out: &mut String) {
    out.push('"');
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{08}' => out.push_str("\\b"),
            '\u{0c}' => out.push_str("\\f"),
            c if (c as u32) < 0x20 => {
                out.push_str("\\u00");
                let code = c as u32;
                for shift in [4u32, 0u32] {
                    let nibble = (code >> shift) & 0xf;
                    out.push(char::from_digit(nibble, 16).unwrap_or('0'));
                }
            }
            c => out.push(c),
        }
    }
    out.push('"');
}

/// SHA-256 of a byte string.
pub fn sha256(bytes: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hasher.finalize().into()
}

/// HMAC-SHA-256 of a message under a key, as RFC 2104 defines it.
pub fn hmac_sha256(key: &[u8; 32], message: &[u8]) -> [u8; 32] {
    const BLOCK: usize = 64;
    let mut inner_pad = [0x36u8; BLOCK];
    let mut outer_pad = [0x5cu8; BLOCK];
    for (index, byte) in key.iter().enumerate() {
        inner_pad[index] ^= byte;
        outer_pad[index] ^= byte;
    }
    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(message);
    let inner_digest: [u8; 32] = inner.finalize().into();
    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_digest);
    outer.finalize().into()
}

/// The shape of one proposal.
#[derive(Debug, Clone, PartialEq)]
pub struct ProposalShape {
    value: Value,
}

impl ProposalShape {
    /// The shape of an opened event in its frame. A field that the event does not
    /// carry and a field that is null are both absent from the shape.
    pub fn from_event(event: &Value, frame: &FrameContext<'_>) -> Self {
        let mut shape = Map::new();
        for field in SHAPE_EVENT_FIELDS {
            match event.get(*field) {
                None | Some(Value::Null) => {}
                Some(found) => {
                    shape.insert((*field).to_string(), found.clone());
                }
            }
        }
        for (field, text) in [
            ("agent_id", frame.agent_id),
            ("docking_port", frame.docking_port),
            ("contract_id", frame.contract_id),
        ] {
            if !text.is_empty() {
                shape.insert(field.to_string(), Value::String(text.to_string()));
            }
        }
        ProposalShape {
            value: Value::Object(shape),
        }
    }

    /// A shape that is a JSON value as it is. Domains outside the Admit Gate, such as
    /// intent records and graph runs, build their shape themselves.
    pub fn from_value(value: &Value) -> Self {
        ProposalShape {
            value: value.clone(),
        }
    }

    /// The canonical JSON of the shape.
    pub fn canonical(&self) -> String {
        canonical_json(&self.value)
    }

    /// The shape digest: SHA-256 over the canonical JSON of the shape.
    pub fn digest(&self) -> [u8; 32] {
        sha256(self.canonical().as_bytes())
    }

    /// The shape digest under a key: HMAC-SHA-256 over the canonical JSON of the
    /// shape. A reader without the key cannot confirm a shape it guesses.
    pub fn keyed_digest(&self, key: &[u8; 32]) -> [u8; 32] {
        hmac_sha256(key, self.canonical().as_bytes())
    }

    /// The tokens of the shape in byte order, without duplicates.
    ///
    /// Each leaf gives one token for its place. A leaf of one word or one number adds
    /// one token for its place with its value. A text of several words adds one token
    /// per word instead, so two texts that differ in one word remain close. Places in a
    /// list carry no index, so the order of a list does not change the tokens.
    pub fn tokens(&self) -> Vec<String> {
        let mut set = TokenSet {
            kept: BTreeSet::new(),
        };
        collect_tokens("", &self.value, 0, &mut set);
        set.kept.into_iter().collect()
    }
}

/// The tokens of a shape while they are collected. The set never holds more than
/// [`MAX_SHAPE_TOKENS`] tokens: once it is full, a new token takes the place of the
/// last one in byte order or is dropped. What remains is what a cut of the whole set
/// would leave, and the memory of the set does not grow with the proposal.
struct TokenSet {
    kept: BTreeSet<String>,
}

impl TokenSet {
    fn insert(&mut self, token: String) {
        if self.kept.len() >= MAX_SHAPE_TOKENS {
            let among_the_first = self.kept.last().is_some_and(|last| token < *last);
            if !among_the_first || self.kept.contains(&token) {
                return;
            }
            self.kept.pop_last();
        }
        self.kept.insert(token);
    }
}

fn collect_tokens(path: &str, value: &Value, depth: usize, out: &mut TokenSet) {
    if depth >= MAX_TOKEN_DEPTH {
        out.insert(format!("{path}={}", canonical_json(value)));
        return;
    }
    match value {
        Value::Object(map) => {
            for (key, item) in map {
                let next = if path.is_empty() {
                    key.clone()
                } else {
                    format!("{path}.{key}")
                };
                collect_tokens(&next, item, depth + 1, out);
            }
        }
        Value::Array(items) => {
            let next = format!("{path}[]");
            for item in items {
                collect_tokens(&next, item, depth + 1, out);
            }
        }
        Value::String(text) => {
            out.insert(format!("#{path}"));
            // The words are read one at a time, so a long text is never held twice.
            let mut words = words_of(text);
            match (words.next(), words.next()) {
                (Some(first), Some(second)) => {
                    out.insert(format!("{path}~{first}"));
                    out.insert(format!("{path}~{second}"));
                    for word in words {
                        out.insert(format!("{path}~{word}"));
                    }
                }
                _ => out.insert(format!("{path}={}", canonical_json(value))),
            }
        }
        scalar => {
            out.insert(format!("#{path}"));
            out.insert(format!("{path}={}", canonical_json(scalar)));
        }
    }
}

/// The words of a text in lower case. A word is a run of letters and digits.
fn words_of(text: &str) -> impl Iterator<Item = String> + '_ {
    text.split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty())
        .map(str::to_lowercase)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn frame() -> FrameContext<'static> {
        FrameContext {
            agent_id: "agent-a",
            docking_port: "validation_engine",
            contract_id: "PM-DYNAEP-001",
        }
    }

    fn event() -> Value {
        json!({
            "type": "CUSTOM",
            "dynaep_type": "AEP_MUTATE_STRUCTURE",
            "action_path": "action:write",
            "tool": "editor",
            "dest_dock": "validation_engine",
            "target_id": "scene-a",
            "payload": {"note": "rename the parser module", "count": 3},
            "delta": [{"op": "add", "path": "/elements/CP-1/z", "value": 4}],
            "timestamp": 1_000_000,
            "_sequenceNumber": 7,
            "sequence_number": 7,
            "trust_score": 600,
            "anomaly_score": 0.25,
            "_temporal": {"bridgeTimeMs": 1},
            "expected_version": 4,
            "agent_id": "someone-else"
        })
    }

    #[test]
    fn canonical_json_key_order_invariant() {
        let a: Value = serde_json::from_str(r#"{"b":1,"a":{"y":[1,2],"x":"t"}}"#).unwrap();
        let b: Value = serde_json::from_str(r#"{"a":{"x":"t","y":[1,2]},"b":1}"#).unwrap();
        assert_eq!(canonical_json(&a), canonical_json(&b));
        assert_eq!(canonical_json(&a), r#"{"a":{"x":"t","y":[1,2]},"b":1}"#);
    }

    #[test]
    fn canonical_json_keeps_array_order_and_number_text() {
        let v: Value = serde_json::from_str(r#"[3,1,2,1.5,-0.0,1e3,"a"]"#).unwrap();
        assert_eq!(canonical_json(&v), r#"[3,1,2,1.5,-0.0,1000.0,"a"]"#);
    }

    #[test]
    fn canonical_json_escapes_control_characters() {
        let v = Value::String("a\"b\\c\n\u{01}\u{1f}é".to_string());
        assert_eq!(canonical_json(&v), "\"a\\\"b\\\\c\\n\\u0001\\u001f\u{e9}\"");
        let back: Value = serde_json::from_str(&canonical_json(&v)).unwrap();
        assert_eq!(back, v);
    }

    /// Changing one listed event field changes the digest and the tokens.
    fn assert_field_feeds_shape(field: &str, other: Value) {
        let base = ProposalShape::from_event(&event(), &frame());
        let mut changed = event();
        changed[field] = other;
        let shape = ProposalShape::from_event(&changed, &frame());
        assert_ne!(
            base.digest(),
            shape.digest(),
            "{field} must feed the digest"
        );
        assert_ne!(
            base.tokens(),
            shape.tokens(),
            "{field} must feed the tokens"
        );
    }

    #[test]
    fn field_type_feeds_the_shape() {
        assert_field_feeds_shape("type", json!("STATE_DELTA"));
    }

    #[test]
    fn field_dynaep_type_feeds_the_shape() {
        assert_field_feeds_shape("dynaep_type", json!("AEP_MUTATE_SKIN"));
    }

    #[test]
    fn field_action_path_feeds_the_shape() {
        assert_field_feeds_shape("action_path", json!("action:read"));
    }

    #[test]
    fn field_tool_feeds_the_shape() {
        assert_field_feeds_shape("tool", json!("shell"));
    }

    #[test]
    fn field_dest_dock_feeds_the_shape() {
        assert_field_feeds_shape("dest_dock", json!("inference_engine"));
    }

    #[test]
    fn field_target_id_feeds_the_shape() {
        assert_field_feeds_shape("target_id", json!("scene-b"));
    }

    #[test]
    fn field_payload_feeds_the_shape() {
        assert_field_feeds_shape("payload", json!({"note": "rename the lexer module"}));
    }

    #[test]
    fn field_delta_feeds_the_shape() {
        assert_field_feeds_shape(
            "delta",
            json!([{"op": "add", "path": "/elements/CP-1/z", "value": 5}]),
        );
    }

    #[test]
    fn frame_agent_feeds_the_shape() {
        let base = ProposalShape::from_event(&event(), &frame());
        let mut other = frame();
        other.agent_id = "agent-b";
        let shape = ProposalShape::from_event(&event(), &other);
        assert_ne!(base.digest(), shape.digest());
        assert_ne!(base.tokens(), shape.tokens());
    }

    #[test]
    fn frame_docking_port_feeds_the_shape() {
        let base = ProposalShape::from_event(&event(), &frame());
        let mut other = frame();
        other.docking_port = "inference_engine";
        let shape = ProposalShape::from_event(&event(), &other);
        assert_ne!(base.digest(), shape.digest());
        assert_ne!(base.tokens(), shape.tokens());
    }

    #[test]
    fn frame_contract_feeds_the_shape() {
        let base = ProposalShape::from_event(&event(), &frame());
        let mut other = frame();
        other.contract_id = "PM-OTHER-002";
        let shape = ProposalShape::from_event(&event(), &other);
        assert_ne!(base.digest(), shape.digest());
        assert_ne!(base.tokens(), shape.tokens());
    }

    #[test]
    fn the_agent_named_by_the_event_is_not_the_agent_of_the_shape() {
        let base = ProposalShape::from_event(&event(), &frame());
        let mut changed = event();
        changed["agent_id"] = json!("a-third-agent");
        assert_eq!(
            base.digest(),
            ProposalShape::from_event(&changed, &frame()).digest()
        );
        assert!(base.canonical().contains(r#""agent_id":"agent-a""#));
    }

    #[test]
    fn every_left_out_field_leaves_the_shape_unchanged() {
        let base = ProposalShape::from_event(&event(), &frame());
        for field in SHAPE_LEFT_OUT {
            let mut changed = event();
            changed[*field] = json!("changed");
            let shape = ProposalShape::from_event(&changed, &frame());
            assert_eq!(base.digest(), shape.digest(), "{field}");
            assert_eq!(base.tokens(), shape.tokens(), "{field}");
            let mut removed = event();
            if let Some(map) = removed.as_object_mut() {
                map.remove(*field);
            }
            let shape = ProposalShape::from_event(&removed, &frame());
            assert_eq!(base.digest(), shape.digest(), "{field}");
        }
    }

    #[test]
    fn the_field_lists_do_not_overlap() {
        for field in SHAPE_LEFT_OUT {
            assert!(!SHAPE_EVENT_FIELDS.contains(field), "{field}");
        }
        assert_eq!(
            SHAPE_FRAME_FIELDS,
            &["agent_id", "docking_port", "contract_id"]
        );
    }

    #[test]
    fn an_absent_field_and_a_null_field_are_the_same_shape() {
        let with_null = json!({"type": "PING", "action_path": "root:ping", "tool": null});
        let without = json!({"type": "PING", "action_path": "root:ping"});
        assert_eq!(
            ProposalShape::from_event(&with_null, &frame()).digest(),
            ProposalShape::from_event(&without, &frame()).digest()
        );
    }

    #[test]
    fn tokens_ignore_list_order_and_key_order() {
        let a = ProposalShape::from_value(&json!({"tags": ["x", "y"], "k": 1}));
        let b = ProposalShape::from_value(&json!({"k": 1, "tags": ["y", "x"]}));
        assert_eq!(a.tokens(), b.tokens());
        // The digest is exact, so list order still changes it.
        assert_ne!(a.digest(), b.digest());
    }

    #[test]
    fn a_text_of_several_words_gives_word_tokens() {
        let shape = ProposalShape::from_value(&json!({"note": "Rename the Parser"}));
        let tokens = shape.tokens();
        assert!(tokens.contains(&"#note".to_string()));
        assert!(!tokens.iter().any(|t| t.starts_with("note=")));
        assert!(tokens.contains(&"note~rename".to_string()));
        assert!(tokens.contains(&"note~parser".to_string()));
        let single = ProposalShape::from_value(&json!({"note": "rename"}));
        assert!(!single.tokens().iter().any(|t| t.contains('~')));
    }

    #[test]
    fn tokens_are_bounded_and_sorted() {
        let mut map = Map::new();
        for index in 0..5000 {
            map.insert(format!("k{index:05}"), json!(index));
        }
        let tokens = ProposalShape::from_value(&Value::Object(map)).tokens();
        assert_eq!(tokens.len(), MAX_SHAPE_TOKENS);
        let mut sorted = tokens.clone();
        sorted.sort();
        assert_eq!(tokens, sorted);
    }

    #[test]
    fn the_keyed_digest_is_hmac_sha256() {
        // Values of an independent HMAC-SHA-256 for the key 01 02 .. 20.
        let mut key = [0u8; 32];
        for (index, byte) in key.iter_mut().enumerate() {
            *byte = index as u8 + 1;
        }
        let hex =
            |bytes: [u8; 32]| -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() };
        assert_eq!(
            hex(hmac_sha256(&key, b"what do ya want for nothing?")),
            "4d9d653fcd05f91cd858a20d50c74b604fe38f2cac49d9b0a7099584cf4fb35a"
        );
        assert_eq!(
            hex(hmac_sha256(&key, b"")),
            "462476a897ddfdbd40d1420e08a5bcfeeb25c3e2ade6a0a9083b327b9ef9fca1"
        );
        // The keyed digest of a shape is the HMAC of its canonical JSON. It differs
        // from the plain digest and from the digest under another key.
        let shape = ProposalShape::from_event(&event(), &frame());
        let keyed = shape.keyed_digest(&key);
        assert_eq!(keyed, hmac_sha256(&key, shape.canonical().as_bytes()));
        assert_ne!(keyed, shape.digest());
        let mut other = key;
        other[0] ^= 1;
        assert_ne!(keyed, shape.keyed_digest(&other));
        assert_eq!(keyed, shape.keyed_digest(&key));
    }

    #[test]
    fn tokens_are_capped_while_they_are_collected() {
        // Tokens arrive in an order that is not byte order. The set never holds more
        // than the cap, and it ends with the tokens a cut of the whole set would keep.
        let mut state = 7u64;
        let mut arriving = Vec::new();
        for _ in 0..3 * MAX_SHAPE_TOKENS {
            state = state
                .wrapping_mul(6_364_136_223_846_793_005)
                .wrapping_add(1_442_695_040_888_963_407);
            arriving.push(format!("t{:05}", (state >> 33) % 9000));
        }
        let mut set = TokenSet {
            kept: BTreeSet::new(),
        };
        for token in &arriving {
            set.insert(token.clone());
            assert!(set.kept.len() <= MAX_SHAPE_TOKENS);
        }
        let whole: BTreeSet<String> = arriving.into_iter().collect();
        assert!(whole.len() > MAX_SHAPE_TOKENS);
        let cut: Vec<String> = whole.into_iter().take(MAX_SHAPE_TOKENS).collect();
        assert_eq!(set.kept.into_iter().collect::<Vec<_>>(), cut);

        // A text of many words gives one token per word up to the cap.
        let text: Vec<String> = (0..20_000).map(|index| format!("w{index}")).collect();
        let shape = ProposalShape::from_value(&json!({"note": text.join(" ")}));
        let tokens = shape.tokens();
        assert_eq!(tokens.len(), MAX_SHAPE_TOKENS);
        assert_eq!(tokens[0], "#note");
        assert!(tokens[1..].iter().all(|token| token.starts_with("note~w")));
    }

    #[test]
    fn deep_values_end_in_one_leaf() {
        let mut value = json!(1);
        for _ in 0..100 {
            value = json!({ "a": value });
        }
        let tokens = ProposalShape::from_value(&value).tokens();
        assert_eq!(tokens.len(), 1);
    }

    #[test]
    fn the_object_map_of_the_json_parser_is_ordered() {
        // The memo of the Base Node relies on one text for one event. A parser that
        // kept the key order of the input would break that, so this test pins it.
        let v: Value = serde_json::from_str(r#"{"b":1,"a":2,"c":3}"#).unwrap();
        let keys: Vec<&String> = v.as_object().unwrap().keys().collect();
        assert_eq!(keys, ["a", "b", "c"]);
    }
}
