//! CORRECTWRITING_EN kernel writing conventions (writing.gap).
//! Enforced by Base Node for all governed prose - not LRP, not validation dock.
//!
//! The rule family lives in one compiled wall set in aep-admit. This module keeps the
//! fix helper and turns the compiled set into kernel violations. No matcher sits here.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub use aep_admit::{
    compile_writing_walls_line, is_allowed_double_hyphen_line, is_tree_diagram_line,
    line_closes_rule, writing_rule_ids, WritingRule, WRITING_GAP_SOURCE, WRITING_RULES,
    RULE_ATTACH_COMMA_SEMICOLON, RULE_ATTACH_DOUBLE_COLON, RULE_NO_BOX_DRAWING_DASHES,
    RULE_NO_DASH_SUBSTITUTES, RULE_NO_DOUBLE_HYPHEN, RULE_NO_EM_DASHES, RULE_NO_EN_DASHES,
    RULE_NO_MINUS_AS_DASH, RULE_NO_OXFORD_COMMA, RULE_PUNCTUATION_WORD_SPACE,
    RULE_SPACE_BEFORE_SPACED_SIGNS, RULE_SPACED_SIGN_WORD_SPACE,
};

pub const CORRECTWRITING_EN_CORE_ID: &str = "correctwriting-en";
pub const WRITING_GAP_DOMAIN: &str = "aep.reference.writing";

/// The rule source of the kernel writing family. It compiles into the one wall set.
pub const WRITING_GAP_SOURCE_TEXT: &str = WRITING_GAP_SOURCE;

/// CORRECTWRITING_EN writing.gap rule ids enforced by the Base Node kernel. Each id is
/// the id of the one compiled wall set.
pub const WRITING_RULE_NO_EM_DASHES: &str = RULE_NO_EM_DASHES;
pub const WRITING_RULE_NO_EN_DASHES: &str = RULE_NO_EN_DASHES;
pub const WRITING_RULE_NO_DASH_SUBSTITUTES: &str = RULE_NO_DASH_SUBSTITUTES;
pub const WRITING_RULE_NO_BOX_DRAWING_DASHES: &str = RULE_NO_BOX_DRAWING_DASHES;
pub const WRITING_RULE_NO_MINUS_AS_DASH: &str = RULE_NO_MINUS_AS_DASH;
pub const WRITING_RULE_NO_DOUBLE_HYPHEN: &str = RULE_NO_DOUBLE_HYPHEN;
pub const WRITING_RULE_NO_OXFORD_COMMA: &str = RULE_NO_OXFORD_COMMA;
pub const WRITING_RULE_SPACED_SIGN_WORD_SPACE: &str = RULE_SPACED_SIGN_WORD_SPACE;
pub const WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS: &str = RULE_SPACE_BEFORE_SPACED_SIGNS;
pub const WRITING_RULE_ATTACH_COMMA_SEMICOLON: &str = RULE_ATTACH_COMMA_SEMICOLON;
pub const WRITING_RULE_ATTACH_DOUBLE_COLON: &str = RULE_ATTACH_DOUBLE_COLON;

pub const WRITING_RULE_IDS: &[&str] = &[
    WRITING_RULE_NO_EM_DASHES,
    WRITING_RULE_NO_EN_DASHES,
    WRITING_RULE_NO_DASH_SUBSTITUTES,
    WRITING_RULE_NO_BOX_DRAWING_DASHES,
    WRITING_RULE_NO_MINUS_AS_DASH,
    WRITING_RULE_NO_DOUBLE_HYPHEN,
    WRITING_RULE_NO_OXFORD_COMMA,
    WRITING_RULE_SPACED_SIGN_WORD_SPACE,
    WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS,
    WRITING_RULE_ATTACH_COMMA_SEMICOLON,
    WRITING_RULE_ATTACH_DOUBLE_COLON,
];

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct WritingViolation {
    pub rule: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WritingEnforceResult {
    pub ok: bool,
    pub authority: &'static str,
    pub text: String,
    pub violations_corrected: usize,
    #[serde(skip_serializing_if = "Vec::is_empty", default)]
    pub violations: Vec<WritingViolation>,
}

fn rule_description(rule: &str) -> &'static str {
    WRITING_RULES
        .iter()
        .find(|r| r.id == rule)
        .map(|r| r.description)
        .unwrap_or("writing rule closed")
}

fn is_spaced_sign(ch: char) -> bool {
    matches!(ch, '?' | '!' | '[' | ']' | '(' | ')' | '\u{FF1F}' | '\u{FF01}')
}

fn skip_spaced_sign_after_context(chars: &[char], index: usize) -> bool {
    if index == 0 {
        return false;
    }
    let prev = chars[index - 1];
    prev == '/' || prev == '=' || prev == '&'
}

fn dash_replacement(ch: char) -> &'static str {
    if ch == '\u{2013}' || ch == '\u{2212}' {
        "-"
    } else {
        " - "
    }
}

/// Kernel violations of one line, read from the one compiled wall set.
pub fn lint_writing_prose_line(line: &str) -> Vec<WritingViolation> {
    compile_writing_walls_line(line)
        .into_iter()
        .filter(|wall| wall.closed)
        .map(|wall| {
            let rule = wall
                .id
                .strip_prefix("writing:")
                .unwrap_or(wall.id.as_str())
                .to_string();
            WritingViolation {
                message: rule_description(&rule).to_string(),
                rule,
                line: None,
            }
        })
        .collect()
}

pub fn lint_writing_prose(text: &str) -> Vec<WritingViolation> {
    let mut all = Vec::new();
    for (idx, line) in text.lines().enumerate() {
        for mut v in lint_writing_prose_line(line) {
            v.line = Some(idx + 1);
            all.push(v);
        }
    }
    all
}

pub fn fix_writing_prose_line(line: &str) -> String {
    if is_allowed_double_hyphen_line(line) || is_tree_diagram_line(line) {
        return line.to_string();
    }
    let mut out = line.to_string();
    for ch in ['\u{2014}', '\u{2013}', '\u{2015}', '\u{2e3a}', '\u{2e3b}', '\u{2212}'] {
        if out.contains(ch) {
            out = out.replace(ch, dash_replacement(ch));
        }
    }
    for ch in ['\u{2500}', '\u{2501}'] {
        if out.contains(ch) {
            out = out.replace(ch, "-");
        }
    }
    out = out.replace(", and ", " and ");
    out = out.replace(", or ", " or ");
    out = out.replace(" ,", ",");
    out = out.replace(" ;", ";");
    out = out.replace(" ::", "::");
    let mut prefixed = String::new();
    let pre_chars: Vec<char> = out.chars().collect();
    for i in 0..pre_chars.len() {
        let ch = pre_chars[i];
        if is_spaced_sign(ch) && i > 0 && pre_chars[i - 1].is_ascii_alphanumeric() {
            prefixed.push(' ');
        }
        prefixed.push(ch);
    }
    out = prefixed;
    let mut fixed = String::new();
    let chars: Vec<char> = out.chars().collect();
    let mut i = 0;
    while i < chars.len() {
        let ch = chars[i];
        if is_spaced_sign(ch)
            && i + 1 < chars.len()
            && chars[i + 1].is_ascii_alphanumeric()
            && !skip_spaced_sign_after_context(&chars, i)
        {
            let normalized = match ch {
                '\u{FF1F}' => '?',
                '\u{FF01}' => '!',
                other => other,
            };
            fixed.push(normalized);
            fixed.push(' ');
            i += 1;
            continue;
        }
        let normalized = match ch {
            '\u{FF1F}' => '?',
            '\u{FF01}' => '!',
            other => ch,
        };
        fixed.push(normalized);
        i += 1;
    }
    fixed
}

pub fn fix_writing_prose(text: &str) -> String {
    text.lines()
        .map(fix_writing_prose_line)
        .collect::<Vec<_>>()
        .join("\n")
}

pub fn enforce_writing_text(text: &str) -> WritingEnforceResult {
    let before = lint_writing_prose(text);
    let fixed = fix_writing_prose(text);
    let after = lint_writing_prose(&fixed);
    WritingEnforceResult {
        ok: after.is_empty(),
        authority: CORRECTWRITING_EN_CORE_ID,
        text: fixed,
        violations_corrected: before.len(),
        violations: after,
    }
}

pub fn value_has_writing_violations(value: &Value) -> bool {
    match value {
        Value::String(s) => !lint_writing_prose(s).is_empty(),
        Value::Array(items) => items.iter().any(value_has_writing_violations),
        Value::Object(map) => map.values().any(value_has_writing_violations),
        _ => false,
    }
}

pub fn enforce_writing_value(value: &Value) -> Value {
    match value {
        Value::String(s) => Value::String(fix_writing_prose(s)),
        Value::Array(items) => Value::Array(items.iter().map(enforce_writing_value).collect()),
        Value::Object(map) => {
            let mut out = serde_json::Map::new();
            for (k, v) in map {
                out.insert(k.clone(), enforce_writing_value(v));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_em_dash_and_oxford_comma() {
        let text = "Bad\u{2014}text, foo, bar, and baz.";
        let violations = lint_writing_prose(text);
        assert!(violations.iter().any(|v| v.rule == WRITING_RULE_NO_EM_DASHES));
        assert!(violations.iter().any(|v| v.rule == WRITING_RULE_NO_OXFORD_COMMA));
    }

    #[test]
    fn detects_en_dash_as_separate_rule() {
        let text = "Range\u{2013}style dash.";
        let violations = lint_writing_prose(text);
        assert!(violations.iter().any(|v| v.rule == WRITING_RULE_NO_EN_DASHES));
        assert!(!violations.iter().any(|v| v.rule == WRITING_RULE_NO_EM_DASHES));
    }

    #[test]
    fn the_kernel_ids_are_the_compiled_ids() {
        let mut kernel: Vec<&str> = WRITING_RULE_IDS.to_vec();
        let mut compiled = writing_rule_ids();
        assert_eq!(compiled.len(), kernel.len());
        kernel.sort();
        compiled.sort();
        assert_eq!(kernel, compiled);
    }

    #[test]
    fn the_rule_source_compiles_into_the_kernel_family() {
        assert!(aep_admit::writing_source_compiles());
        assert!(WRITING_GAP_SOURCE_TEXT.contains(WRITING_RULE_NO_OXFORD_COMMA));
    }

    #[test]
    fn enforce_clears_violations() {
        let text = "Bad\u{2014}text, foo, bar, and baz.";
        let result = enforce_writing_text(text);
        assert!(result.ok);
        assert!(!result.text.contains('\u{2014}'));
        assert!(!result.text.contains(", and "));
        assert!(result.violations_corrected > 0);
    }

    #[test]
    fn enforce_clears_en_dash() {
        let text = "Pages 10\u{2013}20 are ready.";
        let result = enforce_writing_text(text);
        assert!(result.ok);
        assert!(!result.text.contains('\u{2013}'));
        assert!(result.text.contains("10-20"));
    }

    #[test]
    fn enforce_inserts_space_after_question_mark() {
        let text = "How are you?I am here.";
        let result = enforce_writing_text(text);
        assert!(result.ok);
        assert!(result.text.contains("? I"));
        assert!(!result.text.contains("?I"));
    }

    #[test]
    fn enforce_inserts_space_after_exclamation_mark() {
        let text = "Great!Let me help.";
        let result = enforce_writing_text(text);
        assert!(result.ok);
        assert!(result.text.contains("! L"));
        assert!(!result.text.contains("!L"));
    }

    #[test]
    fn detects_missing_space_before_spaced_signs() {
        let text = "ready for building?";
        let violations = lint_writing_prose(text);
        assert!(violations
            .iter()
            .any(|v| v.rule == WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS));
    }

    #[test]
    fn enforce_inserts_space_before_spaced_signs() {
        let text = "ready for building?";
        let result = enforce_writing_text(text);
        assert!(result.ok);
        assert!(result.text.contains("building ?"));
        assert!(!result.text.contains("building?"));
    }

    #[test]
    fn allows_space_before_question_mark_per_writing_mode() {
        let text = "ready for building ? I am here.";
        let violations = lint_writing_prose(text);
        assert!(!violations
            .iter()
            .any(|v| v.rule == WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS));
    }

    #[test]
    fn detects_missing_space_before_brackets() {
        let text = "Hello[ hola ]";
        let violations = lint_writing_prose(text);
        assert!(violations
            .iter()
            .any(|v| v.rule == WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS));
    }

    #[test]
    fn allows_translation_bracket_spacing() {
        let text = "Hello [ hola ].";
        let violations = lint_writing_prose(text);
        assert!(violations.is_empty());
    }

    #[test]
    fn allows_cargo_double_hyphen() {
        let line = "cargo run --release -p aep-base-node";
        assert!(lint_writing_prose_line(line).is_empty());
    }

    #[test]
    fn enforce_value_walks_nested_strings() {
        let value = serde_json::json!({
            "user_intent": "Postgres\u{2014}EU AI Act, agents, and scanners",
            "warnings": ["Low RAM\u{2014}use cloud"]
        });
        let fixed = enforce_writing_value(&value);
        let intent = fixed["user_intent"].as_str().unwrap();
        assert!(!intent.contains('\u{2014}'));
        assert!(!intent.contains(", and "));
    }
}
