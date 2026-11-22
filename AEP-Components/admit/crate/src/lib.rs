// Live evaluator: Admit (AND of compiled walls, collect every closed wall)
// then OPA deny_lattice collect-all then Apply.
// Writing.gap rules compile into Admit walls on the same collect-all pass.
// LatticeFilter and PolicyEvaluator sequential stacks are lab-only.

// the public kernel type set lives in aep-kernel-types,
// so this crate re-exports the one definition site of every public type.
pub use aep_kernel_types::{
    AdmitResult, AdmitWall, AgentPermission, AgentPermissionLookup, Pulse, DENY_NO_PERMISSION,
    PULSE_MS, WALL_AGENT_PERMISSION,
};

// HVVCAS: admit_wall domain:policy type:library
pub mod admit_wall {
    pub use super::AdmitWall;
}

// HVVCAS: admit_collect_all domain:policy type:library
pub mod admit_collect_all {
    use super::{AdmitResult, AdmitWall};

    /// AND of compiled walls. Collect every closed wall. Do not stop at the first close.
    pub fn admit_collect_all(walls: &[AdmitWall]) -> AdmitResult {
        // one collect-all shape for every caller.
        AdmitResult::from_walls(walls)
    }
}

// HVVCAS: compile_writing_walls domain:admit type:library
pub mod compile_writing_walls {
    use super::AdmitWall;

    /// The writing rule source. The source is compiled through this same path, so the
    /// file is data for the one compiled wall set rather than a second rule copy.
    pub const WRITING_GAP_SOURCE: &str =
        include_str!("../../../../AEP-Policy-System/reference/writing.gap");

    /// One rule of the writing wall family.
    #[derive(Clone, Copy, Debug)]
    pub struct WritingRule {
        pub id: &'static str,
        pub description: &'static str,
    }

    pub const RULE_NO_EM_DASHES: &str = "no_em_dashes";
    pub const RULE_NO_EN_DASHES: &str = "no_en_dashes";
    pub const RULE_NO_DASH_SUBSTITUTES: &str = "no_dash_substitutes";
    pub const RULE_NO_BOX_DRAWING_DASHES: &str = "no_box_drawing_dashes";
    pub const RULE_NO_MINUS_AS_DASH: &str = "no_minus_as_dash";
    pub const RULE_NO_DOUBLE_HYPHEN: &str = "no_double_hyphen";
    pub const RULE_NO_OXFORD_COMMA: &str = "no_oxford_comma";
    pub const RULE_PUNCTUATION_WORD_SPACE: &str = "punctuation_word_space";
    pub const RULE_SPACE_BEFORE_SPACED_SIGNS: &str = "space_before_spaced_signs";
    pub const RULE_ATTACH_COMMA_SEMICOLON: &str = "attach_comma_semicolon";
    pub const RULE_ATTACH_DOUBLE_COLON: &str = "attach_double_colon";
    /// Older name of the punctuation rule. One rule keeps one id.
    pub const RULE_SPACED_SIGN_WORD_SPACE: &str = RULE_PUNCTUATION_WORD_SPACE;

    /// The one definition site of the writing wall family. Order follows the rule source.
    pub const WRITING_RULES: &[WritingRule] = &[
        WritingRule {
            id: RULE_NO_EM_DASHES,
            description: "Em dash U+2014 forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_NO_EN_DASHES,
            description: "En dash U+2013 forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_NO_DASH_SUBSTITUTES,
            description: "Dash substitute U+2015 U+2E3A U+2E3B forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_NO_BOX_DRAWING_DASHES,
            description: "Box drawing dash U+2500 U+2501 forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_NO_MINUS_AS_DASH,
            description: "Minus sign U+2212 used as dash forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_NO_DOUBLE_HYPHEN,
            description: "Double hyphen prose separator forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_NO_OXFORD_COMMA,
            description: "Oxford comma before and or or forbidden by writing.gap",
        },
        WritingRule {
            id: RULE_PUNCTUATION_WORD_SPACE,
            description: "Space after a spaced sign before the next word required by writing.gap",
        },
        WritingRule {
            id: RULE_SPACE_BEFORE_SPACED_SIGNS,
            description: "Space before a spaced sign required by writing.gap",
        },
        WritingRule {
            id: RULE_ATTACH_COMMA_SEMICOLON,
            description: "Comma and semicolon attach to the word before them",
        },
        WritingRule {
            id: RULE_ATTACH_DOUBLE_COLON,
            description: "Double colon attaches to the word before it",
        },
    ];

    /// The one writing rule table as JSON text. The JavaScript surfaces read this
    /// text, so no JavaScript surface holds a private copy of the rule family.
    pub fn writing_rules_manifest_json() -> String {
        let mut out = String::from("{\"schema\":\"aep.writing-rules.v1\",\"rules\":[");
        let mut first = true;
        for rule in WRITING_RULES.iter() {
            if !first {
                out.push(',');
            }
            first = false;
            out.push_str("{\"id\":\"");
            out.push_str(&json_escape(rule.id));
            out.push_str("\",\"description\":\"");
            out.push_str(&json_escape(rule.description));
            out.push_str("\"}");
        }
        out.push_str("]}");
        out
    }

    fn json_escape(value: &str) -> String {
        let mut out = String::new();
        for ch in value.chars() {
            match ch {
                '"' => out.push_str("\\\""),
                '\\' => out.push_str("\\\\"),
                '\n' => out.push_str("\\n"),
                '\r' => out.push_str("\\r"),
                '\t' => out.push_str("\\t"),
                c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
                c => out.push(c),
            }
        }
        out
    }

    /// The rule ids of the one compiled wall set, in table order.
    pub fn writing_rule_ids() -> Vec<&'static str> {
        WRITING_RULES.iter().map(|r| r.id).collect()
    }

    pub fn writing_wall_id(rule: &str) -> String {
        let mut id = String::from("writing:");
        id.push_str(rule);
        id
    }

    /// Rule ids named by a writing rule source, in source order. None when the source
    /// carries no constraints list.
    pub fn writing_rule_ids_from_source(source: &str) -> Option<Vec<String>> {
        let start = source.find("\"constraints\"")?;
        let open = source[start..].find('[')? + start;
        let close = source[open..].find(']')? + open;
        let mut ids = Vec::new();
        for token in source[open + 1..close].split(',') {
            let t = token.trim().trim_start_matches('"').trim_end_matches('"');
            if !t.is_empty() {
                ids.push(t.to_string());
            }
        }
        Some(ids)
    }

    /// True when the rule source names every rule of the compiled table and no other
    /// writing rule. This is the compile step for the source.
    pub fn writing_source_compiles() -> bool {
        match writing_rule_ids_from_source(WRITING_GAP_SOURCE) {
            Some(ids) => {
                let mut named: Vec<String> = ids
                    .into_iter()
                    .filter(|id| WRITING_RULES.iter().any(|r| r.id == id))
                    .collect();
                named.sort();
                let mut table: Vec<String> =
                    WRITING_RULES.iter().map(|r| r.id.to_string()).collect();
                table.sort();
                named == table
            }
            None => false,
        }
    }

    fn wall(rule: &str, closed: bool, reason: &str) -> AdmitWall {
        let id = writing_wall_id(rule);
        if closed {
            AdmitWall::close(id, reason)
        } else {
            AdmitWall::open(id)
        }
    }

    pub fn is_tree_diagram_line(line: &str) -> bool {
        line.chars().any(|c| "├└│┌┐┘┬┴┤┼".contains(c))
            || line.starts_with('|')
            || line.starts_with('`')
    }

    pub fn is_allowed_double_hyphen_line(line: &str) -> bool {
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
        if lower.contains("git") && lower.contains("checkout") && line.contains(" - ") {
            return true;
        }
        for cmd in ["cargo", "npm", "node"] {
            if lower.contains(cmd) && line.contains(" - ") {
                return true;
            }
        }
        false
    }

    fn is_spaced_sign(ch: char) -> bool {
        matches!(
            ch,
            '?' | '!' | '[' | ']' | '(' | ')' | '\u{FF1F}' | '\u{FF01}'
        )
    }

    fn skip_spaced_sign_after_context(chars: &[char], index: usize) -> bool {
        if index == 0 {
            return false;
        }
        let prev = chars[index - 1];
        prev == '/' || prev == '=' || prev == '&'
    }

    fn is_url_byte(ch: char) -> bool {
        ch.is_ascii_alphanumeric()
            || matches!(
                ch,
                '-' | '.'
                    | '_'
                    | '~'
                    | ':'
                    | '/'
                    | '?'
                    | '#'
                    | '['
                    | ']'
                    | '@'
                    | '!'
                    | '$'
                    | '&'
                    | '\''
                    | '('
                    | ')'
                    | '*'
                    | '+'
                    | ','
                    | ';'
                    | '='
                    | '%'
            )
    }

    /// Indexes inside a URL token or a query string. Path segments, query keys
    /// and query values are the identifier tokens of those spans. A `?` opens a
    /// query string only when the following token carries `=` or `&`, so prose
    /// such as `building?` stays under the spaced sign rules.
    pub fn protected_writing_token_mask(chars: &[char]) -> Vec<bool> {
        let n = chars.len();
        let mut mask = vec![false; n];
        let mut i = 0;
        while i < n {
            if chars[i].is_ascii_alphabetic() {
                let mut j = i + 1;
                while j < n
                    && (chars[j].is_ascii_alphanumeric() || matches!(chars[j], '+' | '-' | '.'))
                {
                    j += 1;
                }
                if j + 2 < n && chars[j] == ':' && chars[j + 1] == '/' && chars[j + 2] == '/' {
                    let mut k = j + 3;
                    while k < n && is_url_byte(chars[k]) {
                        k += 1;
                    }
                    mask[i..k].fill(true);
                    i = k;
                    continue;
                }
            }
            i += 1;
        }
        let mut q = 0;
        while q < n {
            if chars[q] == '?' && !mask[q] {
                let mut k = q + 1;
                let mut has_binding = false;
                while k < n && is_url_byte(chars[k]) && chars[k] != '?' {
                    if chars[k] == '=' || chars[k] == '&' {
                        has_binding = true;
                    }
                    k += 1;
                }
                if has_binding {
                    let mut start = q;
                    while start > 0
                        && !mask[start - 1]
                        && is_url_byte(chars[start - 1])
                        && chars[start - 1] != '?'
                    {
                        start -= 1;
                    }
                    mask[start..k].fill(true);
                    q = k;
                    continue;
                }
            }
            q += 1;
        }
        mask
    }

    fn contains_char(text: &str, ch: char) -> bool {
        text.chars().any(|c| c == ch)
    }

    /// The one matcher dispatch of the writing family. A rule closes a line when the
    /// dispatch says so. No other crate matches a writing rule.
    pub fn line_closes_rule(rule: &str, line: &str) -> bool {
        if is_tree_diagram_line(line) {
            return false;
        }
        match rule {
            RULE_NO_EM_DASHES => contains_char(line, '\u{2014}'),
            RULE_NO_EN_DASHES => contains_char(line, '\u{2013}'),
            RULE_NO_DASH_SUBSTITUTES => {
                contains_char(line, '\u{2015}')
                    || contains_char(line, '\u{2e3a}')
                    || contains_char(line, '\u{2e3b}')
            }
            RULE_NO_BOX_DRAWING_DASHES => {
                contains_char(line, '\u{2500}') || contains_char(line, '\u{2501}')
            }
            RULE_NO_MINUS_AS_DASH => contains_char(line, '\u{2212}'),
            RULE_NO_DOUBLE_HYPHEN => line.contains(" -- ") && !is_allowed_double_hyphen_line(line),
            RULE_NO_OXFORD_COMMA => line.contains(", and ") || line.contains(", or "),
            RULE_PUNCTUATION_WORD_SPACE => {
                let chars: Vec<char> = line.chars().collect();
                let protected = protected_writing_token_mask(&chars);
                let mut closed = false;
                for i in 0..chars.len().saturating_sub(1) {
                    if is_spaced_sign(chars[i])
                        && chars[i + 1].is_ascii_alphanumeric()
                        && !skip_spaced_sign_after_context(&chars, i)
                        && !protected[i]
                    {
                        closed = true;
                        break;
                    }
                }
                closed
            }
            RULE_SPACE_BEFORE_SPACED_SIGNS => {
                let chars: Vec<char> = line.chars().collect();
                let protected = protected_writing_token_mask(&chars);
                let mut closed = false;
                for i in 1..chars.len() {
                    if is_spaced_sign(chars[i])
                        && chars[i - 1].is_ascii_alphanumeric()
                        && !protected[i]
                    {
                        closed = true;
                        break;
                    }
                }
                closed
            }
            RULE_ATTACH_COMMA_SEMICOLON => line.contains(" ,") || line.contains(" ;"),
            RULE_ATTACH_DOUBLE_COLON => line.contains(" ::"),
            _ => false,
        }
    }

    /// Compile one line into one wall per rule of the compiled set.
    pub fn compile_writing_walls_line(line: &str) -> Vec<AdmitWall> {
        WRITING_RULES
            .iter()
            .map(|rule| wall(rule.id, line_closes_rule(rule.id, line), rule.description))
            .collect()
    }

    /// Compile writing.gap denies into Admit walls. One wall per rule, closed when any
    /// line of the text closes it. Collect-all later.
    pub fn compile_writing_walls(text: &str) -> Vec<AdmitWall> {
        let mut walls = compile_writing_walls_line("");
        for line in text.lines() {
            let line_walls = compile_writing_walls_line(line);
            for (index, wall) in line_walls.into_iter().enumerate() {
                if wall.closed {
                    walls[index] = wall;
                }
            }
        }
        walls
    }

    /// Join payload strings then compile. Same closed set as compiling the join.
    pub fn compile_writing_walls_for_strings(strings: &[String]) -> Vec<AdmitWall> {
        compile_writing_walls(&strings.join("\n"))
    }

    /// Split payload text on newlines. Empty lines dropped.
    pub fn collect_payload_strings(payload: &str) -> Vec<String> {
        payload
            .lines()
            .map(|s| s.trim())
            .filter(|s| !s.is_empty())
            .map(|s| s.to_string())
            .collect()
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn the_rule_source_compiles_into_the_one_table() {
            let ids = writing_rule_ids_from_source(WRITING_GAP_SOURCE).expect("constraints");
            assert!(ids.contains(&RULE_NO_EM_DASHES.to_string()));
            assert!(writing_source_compiles());
        }

        #[test]
        fn every_rule_of_the_family_has_exactly_one_id() {
            let mut ids = writing_rule_ids();
            let before = ids.len();
            ids.sort();
            ids.dedup();
            assert_eq!(ids.len(), before);
            assert_eq!(before, 11);
        }

        #[test]
        fn em_dash_and_oxford_close_on_one_pass() {
            let mut text = String::from("bad");
            text.push('\u{2014}');
            text.push_str("dash");
            text.push('\n');
            text.push_str("red, white, and blue");
            let walls = compile_writing_walls(&text);
            let closed: Vec<String> = walls
                .iter()
                .filter(|w| w.closed)
                .map(|w| w.id.clone())
                .collect();
            assert!(closed.contains(&writing_wall_id(RULE_NO_EM_DASHES)));
            assert!(closed.contains(&writing_wall_id(RULE_NO_OXFORD_COMMA)));
        }

        #[test]
        fn one_shape_per_rule_even_when_open() {
            let walls = compile_writing_walls("clean sentence");
            assert_eq!(walls.len(), WRITING_RULES.len());
            assert!(walls.iter().all(|w| !w.closed));
        }

        #[test]
        fn cargo_command_line_keeps_the_double_hyphen_exemption() {
            assert!(!line_closes_rule(
                RULE_NO_DOUBLE_HYPHEN,
                "cargo run --release -p aep-base-node"
            ));
        }

        #[test]
        fn spaced_sign_rules_close_and_open_as_documented() {
            assert!(line_closes_rule(
                RULE_SPACE_BEFORE_SPACED_SIGNS,
                "ready for building?"
            ));
            assert!(line_closes_rule(
                RULE_PUNCTUATION_WORD_SPACE,
                "ready?I am here"
            ));
            assert!(!line_closes_rule(
                RULE_PUNCTUATION_WORD_SPACE,
                "Hello [ hola ]."
            ));
            assert!(line_closes_rule(RULE_NO_DOUBLE_HYPHEN, "words -- words"));
            assert!(!line_closes_rule(RULE_NO_DOUBLE_HYPHEN, "Bad - text"));
            assert!(line_closes_rule(
                RULE_ATTACH_COMMA_SEMICOLON,
                "words , here"
            ));
            assert!(line_closes_rule(RULE_ATTACH_DOUBLE_COLON, "word :: here"));
        }

        #[test]
        fn url_and_query_tokens_stay_outside_the_spaced_sign_rules() {
            let url = "https://api.example.org/v1/items?id=7&page=2";
            let query = "items?id=7&page=2";
            let bare = "?id=7&page=2";
            let bracket = "https://api.example.org/v1/items[0]?id=7";
            let prose = "See https://example.org/a?b=1 for more.";
            for line in [url, query, bare, bracket, prose] {
                assert!(
                    !line_closes_rule(RULE_PUNCTUATION_WORD_SPACE, line),
                    "{line}"
                );
                assert!(
                    !line_closes_rule(RULE_SPACE_BEFORE_SPACED_SIGNS, line),
                    "{line}"
                );
            }
            assert!(line_closes_rule(
                RULE_SPACE_BEFORE_SPACED_SIGNS,
                "ready for building?"
            ));
            assert!(line_closes_rule(
                RULE_PUNCTUATION_WORD_SPACE,
                "How are you?I am here."
            ));
            assert!(line_closes_rule(
                RULE_SPACE_BEFORE_SPACED_SIGNS,
                "Hello[ hola ]"
            ));
        }
    }
}

// HVVCAS: admit_memory domain:admit type:library
pub mod admit_memory {
    //! What Admit reads of a memory of earlier verdicts. Admit only reads.
    //!
    //! One thing comes in: the stored rows of pure wall families. A wall family is
    //! pure when its rows depend on nothing but the bytes it reads from the proposal
    //! and on rules that are compiled into the process. A family that reads the clock,
    //! a budget, a file or any state that changes between two proposals is not pure
    //! and is computed every time.
    //!
    //! Stored rows decide no verdict. They are the rows the same family computed
    //! before in this process for byte identical input, so the collect-all pass reads
    //! the same rows either way. Similarity never replaces a wall.
    use super::AdmitWall;

    /// Read-only view of the stored rows of pure wall families.
    pub trait PureWallMemo {
        /// The rows an earlier run of `family` computed for exactly `input`. None when
        /// no such rows exist.
        fn replay(&self, family: &str, input: &str) -> Option<Vec<AdmitWall>>;
    }

    /// The view of a caller that holds no memory. Every lookup is a miss.
    #[derive(Clone, Copy, Debug, Default)]
    pub struct NoMemo;

    impl PureWallMemo for NoMemo {
        fn replay(&self, _family: &str, _input: &str) -> Option<Vec<AdmitWall>> {
            None
        }
    }

    /// What the caller of Admit hands over for one proposal.
    #[derive(Clone, Copy)]
    pub struct MemoryView<'a> {
        pub memo: &'a dyn PureWallMemo,
    }

    impl MemoryView<'static> {
        /// The view without a memory: no stored rows, so every row is computed.
        pub fn without_memory() -> Self {
            MemoryView { memo: &NoMemo }
        }
    }

    /// The rows of one pure wall family for one proposal and where they came from.
    #[derive(Clone, Debug, PartialEq, Eq)]
    pub struct PureWallTrace {
        pub family: &'static str,
        /// The bytes the family read from the proposal when the rows were computed
        /// now, so the caller can store the rows under them. Empty for stored rows.
        pub input: String,
        pub rows: Vec<AdmitWall>,
        /// True when the rows were stored rows, false when they were computed now.
        pub replayed: bool,
    }

    /// The rows of a pure wall family: stored rows when the memo holds rows for
    /// exactly this input that `well_formed` accepts, computed rows in every other
    /// case. A memo that answers with rows of the wrong form is treated as a miss.
    pub fn pure_walls(
        view: &MemoryView<'_>,
        family: &'static str,
        input: &str,
        well_formed: impl Fn(&[AdmitWall]) -> bool,
        compute: impl FnOnce(&str) -> Vec<AdmitWall>,
    ) -> PureWallTrace {
        if let Some(rows) = view.memo.replay(family, input) {
            if well_formed(&rows) {
                return PureWallTrace {
                    family,
                    input: String::new(),
                    rows,
                    replayed: true,
                };
            }
        }
        PureWallTrace {
            family,
            input: input.to_string(),
            rows: compute(input),
            replayed: false,
        }
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        struct Fixed(Vec<AdmitWall>);

        impl PureWallMemo for Fixed {
            fn replay(&self, family: &str, input: &str) -> Option<Vec<AdmitWall>> {
                if family == "writing" && input == "same text" {
                    Some(self.0.clone())
                } else {
                    None
                }
            }
        }

        fn computed(_input: &str) -> Vec<AdmitWall> {
            vec![AdmitWall::close("writing:x", "computed")]
        }

        #[test]
        fn stored_rows_are_replayed_only_for_byte_identical_input() {
            let stored = vec![AdmitWall::close("writing:x", "stored")];
            let memo = Fixed(stored.clone());
            let view = MemoryView { memo: &memo };
            let hit = pure_walls(&view, "writing", "same text", |_| true, computed);
            assert!(hit.replayed);
            assert_eq!(hit.rows, stored);
            assert_eq!(hit.input, "");
            let miss = pure_walls(&view, "writing", "same text.", |_| true, computed);
            assert!(!miss.replayed);
            assert_eq!(miss.rows, computed(""));
            assert_eq!(miss.input, "same text.");
            let other = pure_walls(&view, "policy", "same text", |_| true, computed);
            assert!(!other.replayed);
        }

        #[test]
        fn stored_rows_of_the_wrong_form_are_a_miss() {
            let memo = Fixed(vec![AdmitWall::open("writing:x")]);
            let view = MemoryView { memo: &memo };
            let trace = pure_walls(&view, "writing", "same text", |_| false, computed);
            assert!(!trace.replayed);
            assert_eq!(trace.rows, computed(""));
            assert_eq!(trace.input, "same text");
        }

        #[test]
        fn the_view_without_memory_computes_every_row() {
            let view = MemoryView::without_memory();
            assert!(view.memo.replay("writing", "same text").is_none());
            let trace = pure_walls(&view, "writing", "same text", |_| true, computed);
            assert!(!trace.replayed);
            assert_eq!(trace.rows, computed(""));
        }
    }
}

pub use admit_memory::{pure_walls, MemoryView, NoMemo, PureWallMemo, PureWallTrace};

pub use admit_collect_all::admit_collect_all;
pub use compile_writing_walls::{
    collect_payload_strings, compile_writing_walls, compile_writing_walls_for_strings,
    compile_writing_walls_line, is_allowed_double_hyphen_line, is_tree_diagram_line,
    line_closes_rule, protected_writing_token_mask, writing_rule_ids, writing_rule_ids_from_source,
    writing_rules_manifest_json, writing_source_compiles, writing_wall_id, WritingRule,
    RULE_ATTACH_COMMA_SEMICOLON, RULE_ATTACH_DOUBLE_COLON, RULE_NO_BOX_DRAWING_DASHES,
    RULE_NO_DASH_SUBSTITUTES, RULE_NO_DOUBLE_HYPHEN, RULE_NO_EM_DASHES, RULE_NO_EN_DASHES,
    RULE_NO_MINUS_AS_DASH, RULE_NO_OXFORD_COMMA, RULE_PUNCTUATION_WORD_SPACE,
    RULE_SPACED_SIGN_WORD_SPACE, RULE_SPACE_BEFORE_SPACED_SIGNS, WRITING_GAP_SOURCE, WRITING_RULES,
};

pub mod compile_lattice;
pub use compile_lattice::{
    compile_lattice_policy, compile_lattice_walls, default_rego_path, load_policy_sets,
    parse_policy_sets, prove_rego_source, CompiledPolicy, LatticeCompileInput, PolicySets,
};

pub mod compile_permission;
pub use compile_permission::{
    agent_has_permission, agent_permission, agent_permission_from_admit, agent_permission_wall_id,
    compile_agent_permission_wall, compile_agent_permission_wall_from,
    compile_node_agent_permission_wall, fold_agent_permission_into_admit,
};

/// Wave 4 kernel facade. ClosedWall and DenyReport are the dock Deny types.
/// Envelope and process_sealed live on envelope and base-node binds.
pub use aep_wall_set_backpressure::{ClosedWall, DenyReport};

#[cfg(test)]
mod kernel_facade_tests {
    #[test]
    fn pulse_is_compiled_1000() {
        assert_eq!(crate::Pulse::compiled().ms, crate::PULSE_MS);
        assert_eq!(crate::PULSE_MS, 1000);
    }

    #[test]
    fn closed_wall_and_deny_report_are_public() {
        let wall = crate::ClosedWall::new("gap.agent_permission", crate::DENY_NO_PERMISSION);
        assert_eq!(wall.id.as_str(), "gap.agent_permission");
        let _n = std::any::type_name::<crate::DenyReport>();
        let _a = std::any::type_name::<crate::AdmitResult>();
        let closed = crate::agent_permission("agent-a", "action:write", &[]);
        assert!(closed.closed);
        assert_eq!(closed.reason, crate::DENY_NO_PERMISSION);
    }
}
