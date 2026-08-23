// @PAD: aep-admit-writing-walls-cli-v1
// @GCDE: gaplune.policy.v1
// CLI: stdin prose compiled to Admit walls then collect-all with optional extra walls.

use aep_admit::{admit_collect_all, compile_writing_walls, AdmitWall};
use std::io::{self, Read};

fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let mut writing_src = String::new();
    let mut extra: Vec<AdmitWall> = Vec::new();
    for raw in buf.lines() {
        let line = raw.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with('@') {
            continue;
        }
        if let Some(text) = line.strip_prefix("writing_text=") {
            if !writing_src.is_empty() {
                writing_src.push('\n');
            }
            writing_src.push_str(text);
            continue;
        }
        let mut id = String::new();
        let mut closed = false;
        let mut reason = String::new();
        for part in line.split('\t') {
            if let Some((k, v)) = part.split_once('=') {
                match k.trim() {
                    "id" => id = v.trim().to_string(),
                    "closed" => closed = parse_bool(v),
                    "reason" => reason = v.trim().to_string(),
                    _ => {}
                }
            }
        }
        if id.is_empty() {
            if writing_src.is_empty() {
                writing_src.push_str(line);
            }
            continue;
        }
        if closed {
            extra.push(AdmitWall::close(id, reason));
        } else {
            extra.push(AdmitWall::open(id));
        }
    }
    let mut walls = compile_writing_walls(&writing_src);
    walls.extend(extra);
    let result = admit_collect_all(&walls);
    let mut out = String::from("allow=");
    out.push_str(if result.allow { "true" } else { "false" });
    out.push('\n');
    for wall in &result.closed {
        out.push_str("closed=");
        out.push_str(&wall.id);
        out.push('|');
        out.push_str(&wall.reason);
        out.push('\n');
    }
    print!("{}", out);
}
