// @PAD: aep-stream-hard-findings-cli-v1
// @GCDE: gaplune.policy.v1
// CLI: one finding per line scanner=<id> category=<cat> severity=<hard|soft> match=<text> position=<n>
// Prints refused= and category= and ledger= lines.

use aep_stream_hard_findings::{
    refuse_after_collect, StreamFinding, StreamScan,
};
use std::io::{self, Read};

fn parse_u32(raw: &str) -> u32 {
    raw.trim().parse().unwrap_or(0)
}

fn parse_line(line: &str) -> Option<StreamFinding> {
    let line = line.trim();
    if line.is_empty() {
        return None;
    }
    if line.starts_with('#') || line.starts_with('@') {
        return None;
    }
    let mut scanner = String::new();
    let mut category = String::new();
    let mut severity = String::from("hard");
    let mut match_text = String::new();
    let mut position: u32 = 0;
    for part in line.split('\t') {
        if let Some((k, v)) = part.split_once('=') {
            match k.trim() {
                "scanner" => scanner = v.trim().to_string(),
                "category" => category = v.trim().to_string(),
                "severity" => severity = v.trim().to_string(),
                "match" => match_text = v.trim().to_string(),
                "position" => position = parse_u32(v),
                _ => {}
            }
        }
    }
    if scanner.is_empty() || category.is_empty() {
        return None;
    }
    Some(StreamFinding {
        scanner,
        category,
        severity,
        match_text,
        position,
    })
}

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let findings: Vec<StreamFinding> = buf.lines().filter_map(parse_line).collect();
    let decision = refuse_after_collect(&StreamScan { findings });
    let mut out = String::from("refused=");
    out.push_str(if decision.refused { "true" } else { "false" });
    out.push('\n');
    for cat in &decision.categories {
        out.push_str("category=");
        out.push_str(cat);
        out.push('\n');
    }
    for row in &decision.ledger_findings {
        out.push_str("ledger=");
        out.push_str(row);
        out.push('\n');
    }
    print!("{}", out);
}
