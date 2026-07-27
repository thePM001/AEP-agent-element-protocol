//! EPSCOM kernel writing conventions (writing.gap).
//! Enforced by Base Node for all governed prose - not LRP, not validation dock.

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const EPSCOM_CORE_ID: &str = "epscom-core";
pub const WRITING_GAP_DOMAIN: &str = "aep.reference.writing";

/// EPSCOM writing.gap rule ids enforced by the Base Node kernel.
pub const WRITING_RULE_NO_EM_DASHES: &str = "no_em_dashes";
pub const WRITING_RULE_NO_EN_DASHES: &str = "no_en_dashes";
pub const WRITING_RULE_NO_DASH_SUBSTITUTES: &str = "no_dash_substitutes";
pub const WRITING_RULE_NO_MINUS_AS_DASH: &str = "no_minus_as_dash";
pub const WRITING_RULE_NO_DOUBLE_HYPHEN: &str = "no_double_hyphen";
pub const WRITING_RULE_NO_OXFORD_COMMA: &str = "no_oxford_comma";
pub const WRITING_RULE_SPACED_SIGN_WORD_SPACE: &str = "spaced_sign_word_space";
pub const WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS: &str = "space_before_spaced_signs";
pub const WRITING_RULE_ATTACH_COMMA_SEMICOLON: &str = "attach_comma_semicolon";
pub const WRITING_RULE_ATTACH_DOUBLE_COLON: &str = "attach_double_colon";

pub const WRITING_RULE_IDS: &[&str] = &[
    WRITING_RULE_NO_EM_DASHES,
    WRITING_RULE_NO_EN_DASHES,
    WRITING_RULE_NO_DASH_SUBSTITUTES,
    WRITING_RULE_NO_MINUS_AS_DASH,
    WRITING_RULE_NO_DOUBLE_HYPHEN,
    WRITING_RULE_NO_OXFORD_COMMA,
    WRITING_RULE_SPACED_SIGN_WORD_SPACE,
    WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS,
    WRITING_RULE_ATTACH_COMMA_SEMICOLON,
    WRITING_RULE_ATTACH_DOUBLE_COLON,
];

const FORBIDDEN_DASH_CHARS: &[(char, &str, &str)] = &[
    ('\u{2014}', "U+2014", WRITING_RULE_NO_EM_DASHES),
    ('\u{2013}', "U+2013", WRITING_RULE_NO_EN_DASHES),
    ('\u{2015}', "U+2015", WRITING_RULE_NO_DASH_SUBSTITUTES),
    ('\u{2e3a}', "U+2E3A", WRITING_RULE_NO_DASH_SUBSTITUTES),
    ('\u{2e3b}', "U+2E3B", WRITING_RULE_NO_DASH_SUBSTITUTES),
    ('\u{2212}', "U+2212", WRITING_RULE_NO_MINUS_AS_DASH),
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

fn is_tree_diagram_line(line: &str) -> bool {
    line.chars().any(|c| "├└│┌┐┘┬┴┤┼".contains(c)) || line.starts_with('|') || line.starts_with('`')
}

fn is_allowed_double_hyphen_line(line: &str) -> bool {
    if line.contains("-->") {
        return true;
    }
    if line.trim().chars().all(|c| c == '-' || c.is_whitespace()) {
        return true;
    }
    if line.split_whitespace().any(|tok| {
        tok.chars().filter(|c| *c == '-').count() >= 2
            && tok.chars().any(|c| c.is_ascii_digit())
    }) {
        return true;
    }
    let lower = line.to_ascii_lowercase();
    if lower.contains("git") && lower.contains("checkout") && line.contains(" -- ") {
        return true;
    }
    for cmd in ["cargo", "npm", "node"] {
        if lower.contains(cmd) && line.contains(" -- ") {
            return true;
        }
    }
    false
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

pub fn lint_writing_prose_line(line: &str) -> Vec<WritingViolation> {
    let mut violations = Vec::new();
    if is_tree_diagram_line(line) {
        return violations;
    }
    for (ch, code, rule) in FORBIDDEN_DASH_CHARS {
        if line.contains(*ch) {
            violations.push(WritingViolation {
                rule: (*rule).into(),
                message: format!("forbidden dash {code}"),
                line: None,
            });
        }
    }
    if line.contains(", and ") {
        violations.push(WritingViolation {
            rule: WRITING_RULE_NO_OXFORD_COMMA.into(),
            message: "Oxford comma before \"and\"".into(),
            line: None,
        });
    }
    if line.contains(", or ") {
        violations.push(WritingViolation {
            rule: WRITING_RULE_NO_OXFORD_COMMA.into(),
            message: "Oxford comma before \"or\"".into(),
            line: None,
        });
    }
    if line.contains(" -- ") && !is_allowed_double_hyphen_line(line) {
        violations.push(WritingViolation {
            rule: WRITING_RULE_NO_DOUBLE_HYPHEN.into(),
            message: "double-hyphen prose separator".into(),
            line: None,
        });
    }
    if line.contains(" ,") || line.contains(" ;") {
        violations.push(WritingViolation {
            rule: WRITING_RULE_ATTACH_COMMA_SEMICOLON.into(),
            message: "attach comma or semicolon directly to the preceding word (no space before)".into(),
            line: None,
        });
    }
    if line.contains(" ::") {
        violations.push(WritingViolation {
            rule: WRITING_RULE_ATTACH_DOUBLE_COLON.into(),
            message: "attach double colon directly to the preceding word (no space before ::)".into(),
            line: None,
        });
    }
    let chars: Vec<char> = line.chars().collect();
    for i in 1..chars.len() {
        let ch = chars[i];
        if is_spaced_sign(ch) && chars[i - 1].is_ascii_alphanumeric() {
            violations.push(WritingViolation {
                rule: WRITING_RULE_SPACE_BEFORE_SPACED_SIGNS.into(),
                message: "add space before ? ! [ ] ( ) (write \"building ?\" or \"word [ note ]\" not \"building?\" or \"word[note]\")".into(),
                line: None,
            });
            break;
        }
    }
    for i in 0..chars.len().saturating_sub(1) {
        let ch = chars[i];
        let next = chars[i + 1];
        if is_spaced_sign(ch) && next.is_ascii_alphanumeric() {
            if skip_spaced_sign_after_context(&chars, i) {
                continue;
            }
            violations.push(WritingViolation {
                rule: WRITING_RULE_SPACED_SIGN_WORD_SPACE.into(),
                message: format!("missing space after '{ch}' before word"),
                line: None,
            });
            break;
        }
    }
    violations
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
    for (ch, _, _) in FORBIDDEN_DASH_CHARS {
        if out.contains(*ch) {
            out = out.replace(*ch, dash_replacement(*ch));
        }
    }
    out = out.replace(", and ", " and ");
    out = out.replace(", or ", " or ");
    if !is_allowed_double_hyphen_line(&out) && out.contains(" -- ") {
        out = out.replace(" -- ", " - ");
    }
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
        authority: EPSCOM_CORE_ID,
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