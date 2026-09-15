// The one rule source reader for the Admit layer scan.
// The policy loader and its scan path read the rule table that the scanners
// package also reads, so the Admit layer holds no private copy of the scanner
// classes. A rule id resolves against the shared table and no rule pattern is
// written in Rust.
use serde_json::Value;
use std::sync::OnceLock;

/// The shared scan rule table. The same file is the source for the scanners package.
pub const RULE_TABLE_PATH: &str = "AEP-Components/scanners/rules/scan-rule-table.json";

pub const RULE_TABLE_JSON: &str =
    include_str!("../../../scanners/rules/scan-rule-table.json");

fn table() -> &'static Value {
    static TABLE: OnceLock<Value> = OnceLock::new();
    TABLE.get_or_init(|| serde_json::from_str(RULE_TABLE_JSON).unwrap_or(Value::Null))
}

fn rules() -> Vec<Value> {
    match table().get("rules").and_then(|v| v.as_array()) {
        Some(a) => a.clone(),
        None => Vec::new(),
    }
}

fn field_str<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(|x| x.as_str()).unwrap_or("")
}

fn admit_spec(rule: &Value) -> Option<Value> {
    match rule.get("admit") {
        Some(v) => {
            if v.is_object() {
                Some(v.clone())
            } else {
                None
            }
        }
        None => None,
    }
}

/// Count the rules that carry an Admit matcher. The scan proof reads this number.
pub fn admit_rule_count() -> usize {
    rules()
        .iter()
        .filter(|r| admit_spec(r).is_some())
        .count()
}

/// True when the shared table parsed and carries rules.
pub fn rule_table_loaded() -> bool {
    rules().is_empty() == false
}

/// True when one rule id matches the text.
pub fn rule(id: &str, text: &str) -> bool {
    for r in rules() {
        if field_str(&r, "id") != id {
            continue;
        }
        if let Some(spec) = admit_spec(&r) {
            if spec_hit(&spec, text) {
                return true;
            }
        }
    }
    false
}

/// True when any rule of one class with an Admit matcher matches the text.
pub fn class(name: &str, text: &str) -> bool {
    for r in rules() {
        if field_str(&r, "class") != name {
            continue;
        }
        if let Some(spec) = admit_spec(&r) {
            if spec_hit(&spec, text) {
                return true;
            }
        }
    }
    false
}

fn spec_hit(spec: &Value, text: &str) -> bool {
    let kind = field_str(spec, "kind");
    let low = if spec.get("ci").and_then(|v| v.as_bool()).unwrap_or(false) {
        text.to_ascii_lowercase()
    } else {
        text.to_string()
    };
    match kind {
        "email" => match_email(text),
        "ssn" => match_ssn(text),
        "luhn" => match_luhn(text),
        "phone" => match_phone(text),
        "ipv4" => match_ipv4(text),
        "chars" => match_chars(spec, text),
        "literal" => {
            let needle = field_str(spec, "text");
            if needle.is_empty() {
                false
            } else if spec.get("ci").and_then(|v| v.as_bool()).unwrap_or(false) {
                low.contains(&needle.to_ascii_lowercase())
            } else {
                text.contains(needle)
            }
        }
        "any_literal" => {
            let mut hit = false;
            if let Some(a) = spec.get("texts").and_then(|v| v.as_array()) {
                for t in a {
                    if let Some(s) = t.as_str() {
                        let needle = s.to_ascii_lowercase();
                        if needle.is_empty() == false && low.contains(&needle) {
                            hit = true;
                        }
                    }
                }
            }
            hit
        }
        "all_any" => match_all_any(spec, &low),
        "prefix_len" => {
            let prefix = field_str(spec, "prefix").to_ascii_lowercase();
            let min = spec.get("min_text_len").and_then(|v| v.as_u64()).unwrap_or(1) as usize;
            prefix.is_empty() == false && low.contains(&prefix) && text.len() >= min
        }
        _ => false,
    }
}

fn match_all_any(spec: &Value, low: &str) -> bool {
    let mut all_ok = true;
    if let Some(a) = spec.get("all").and_then(|v| v.as_array()) {
        for t in a {
            if let Some(s) = t.as_str() {
                if low.contains(&s.to_ascii_lowercase()) == false {
                    all_ok = false;
                }
            }
        }
    }
    if all_ok == false {
        return false;
    }
    match spec.get("any").and_then(|v| v.as_array()) {
        Some(a) => {
            if a.is_empty() {
                return true;
            }
            let mut any_ok = false;
            for t in a {
                if let Some(s) = t.as_str() {
                    if low.contains(&s.to_ascii_lowercase()) {
                        any_ok = true;
                    }
                }
            }
            any_ok
        }
        None => true,
    }
}

fn match_chars(spec: &Value, text: &str) -> bool {
    let mut hit = false;
    if let Some(a) = spec.get("codepoints").and_then(|v| v.as_array()) {
        for c in a {
            let code = c.as_u64().unwrap_or(0) as u32;
            if let Some(ch) = char::from_u32(code) {
                if text.chars().any(|x| x == ch) {
                    hit = true;
                }
            }
        }
    }
    hit
}

fn match_email(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut i = 0usize;
    while i < n {
        if chars[i] == '@' {
            let mut l = i;
            while l > 0
                && (chars[l - 1].is_ascii_alphanumeric()
                    || chars[l - 1] == '.'
                    || chars[l - 1] == '_'
                    || chars[l - 1] == '+'
                    || chars[l - 1] == '-')
            {
                l -= 1;
            }
            let mut r = i + 1;
            let mut dot = false;
            while r < n && (chars[r].is_ascii_alphanumeric() || chars[r] == '.' || chars[r] == '-') {
                if chars[r] == '.' {
                    dot = true;
                }
                r += 1;
            }
            if i > l && r > i + 1 && dot {
                return true;
            }
        }
        i += 1;
    }
    false
}

fn match_ssn(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut i = 0usize;
    while i + 11 <= n {
        if chars[i].is_ascii_digit()
            && chars[i + 1].is_ascii_digit()
            && chars[i + 2].is_ascii_digit()
            && chars[i + 3] == '-'
            && chars[i + 4].is_ascii_digit()
            && chars[i + 5].is_ascii_digit()
            && chars[i + 6] == '-'
            && chars[i + 7].is_ascii_digit()
            && chars[i + 8].is_ascii_digit()
            && chars[i + 9].is_ascii_digit()
            && chars[i + 10].is_ascii_digit()
        {
            return true;
        }
        i += 1;
    }
    false
}

fn luhn_ok(digits: &[u8]) -> bool {
    if digits.len() < 13 || digits.len() > 19 {
        return false;
    }
    let mut sum = 0u32;
    let mut alt = false;
    for d in digits.iter().rev() {
        let mut n = *d as u32;
        if alt {
            n *= 2;
            if n > 9 {
                n -= 9;
            }
        }
        sum += n;
        alt = !alt;
    }
    sum % 10 == 0
}

fn match_luhn(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut i = 0usize;
    while i < n {
        if chars[i].is_ascii_digit() {
            let mut digits: Vec<u8> = Vec::new();
            let mut j = i;
            while j < n {
                let ch = chars[j];
                if ch.is_ascii_digit() {
                    digits.push((ch as u8) - b'0');
                    j += 1;
                } else if (ch == ' ' || ch == '-') && digits.is_empty() == false {
                    j += 1;
                } else {
                    break;
                }
            }
            if luhn_ok(&digits) {
                return true;
            }
            i += 1;
        } else {
            i += 1;
        }
    }
    false
}

fn match_phone(text: &str) -> bool {
    let mut digits = String::new();
    for c in text.chars() {
        if c.is_ascii_digit() {
            digits.push(c);
        } else if c == '+' || c == '-' || c == ' ' || c == '(' || c == ')' || c == '.' {
            continue;
        } else {
            if digits.len() == 10 || digits.len() == 11 {
                return true;
            }
            digits.clear();
        }
    }
    digits.len() == 10 || digits.len() == 11
}

fn match_ipv4(text: &str) -> bool {
    let chars: Vec<char> = text.chars().collect();
    let n = chars.len();
    let mut i = 0usize;
    while i < n {
        if chars[i].is_ascii_digit() {
            let mut parts = 0u8;
            let mut j = i;
            let mut ok = true;
            while parts < 4 && j < n && ok {
                let mut val: u32 = 0;
                let mut digits = 0u8;
                while j < n && chars[j].is_ascii_digit() {
                    val = val * 10 + chars[j].to_digit(10).unwrap_or(0);
                    digits += 1;
                    j += 1;
                    if digits > 3 {
                        ok = false;
                        break;
                    }
                }
                if digits == 0 || val > 255 {
                    ok = false;
                    break;
                }
                parts += 1;
                if parts < 4 {
                    if j < n && chars[j] == '.' {
                        j += 1;
                    } else {
                        ok = false;
                        break;
                    }
                }
            }
            if ok && parts == 4 {
                return true;
            }
        }
        i += 1;
    }
    false
}
