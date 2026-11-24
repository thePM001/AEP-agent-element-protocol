use aep_admit::{admit_collect_all, AdmitResult, AdmitWall};

pub use aep_admit::{
    collect_payload_strings, compile_writing_walls, compile_writing_walls_for_strings,
    writing_wall_id, RULE_NO_EM_DASHES, RULE_NO_OXFORD_COMMA,
};

/// Fold writing walls plus extra walls into one collect-all pass.
pub fn fold_writing_into_admit(text: &str, extra: &[AdmitWall]) -> AdmitResult {
    let mut walls = aep_admit::compile_writing_walls(text);
    walls.extend(extra.iter().cloned());
    admit_collect_all(&walls)
}

#[cfg(test)]
mod tests {
    use super::*;
    use aep_admit::{AdmitWall, RULE_NO_EM_DASHES, RULE_NO_OXFORD_COMMA};

    fn em_sample() -> String {
        let mut s = String::from("bad");
        s.push('\u{2014}');
        s.push_str("dash");
        s
    }

    fn oxford_sample() -> String {
        let mut s = String::from("red, white");
        s.push(',');
        s.push_str(" and blue");
        s
    }

    #[test]
    fn fold_keeps_writing_and_constraint_on_one_pass() {
        let extra = vec![AdmitWall::close(
            "constraint:required_field:alpha",
            "alpha required",
        )];
        let result = fold_writing_into_admit(&em_sample(), &extra);
        assert!(!result.allow);
        let wid = writing_wall_id(RULE_NO_EM_DASHES);
        let ids: Vec<&str> = result.closed.iter().map(|w| w.id.as_str()).collect();
        assert!(ids.contains(&wid.as_str()));
        assert!(ids.contains(&"constraint:required_field:alpha"));
    }

    #[test]
    fn oxford_and_em_both_close() {
        let mut text = em_sample();
        text.push('\n');
        text.push_str(&oxford_sample());
        let result = fold_writing_into_admit(&text, &[]);
        assert!(!result.allow);
        let em = writing_wall_id(RULE_NO_EM_DASHES);
        let ox = writing_wall_id(RULE_NO_OXFORD_COMMA);
        let ids: Vec<&str> = result.closed.iter().map(|w| w.id.as_str()).collect();
        assert!(ids.contains(&em.as_str()));
        assert!(ids.contains(&ox.as_str()));
    }

    #[test]
    fn writing_wall_id_has_writing_prefix() {
        assert_eq!(writing_wall_id(RULE_NO_EM_DASHES), "writing:no_em_dashes");
    }
}
