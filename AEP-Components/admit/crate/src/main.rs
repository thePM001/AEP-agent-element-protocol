// @PAD: aep-admit-cli-v1
// @GCDE: gaplune.policy.v1
// CLI: one wall per line id=<id> closed=<true|false> reason=<text>
// writing_text=<prose> compiles writing.gap into Admit walls on this pass.
// trust_tier=<n> plus trust_floor=<n> compile the trust floor wall on this pass.
// Prints allow= and closed=<id>|<reason> lines. Closed set is sorted.

use aep_admit::{
    admit_collect_all, compile_trust_floor_wall, compile_writing_walls, AdmitWall,
};
use std::io::{self, Read};

fn parse_bool(raw: &str) -> bool {
    let s = raw.trim().to_ascii_lowercase();
    s == "true" || s == "1" || s == "yes" || s == "closed"
}

fn parse_line(line: &str) -> Vec<AdmitWall> {
    let line = line.trim();
    if line.is_empty() {
        return Vec::new();
    }
    if line.starts_with('#') || line.starts_with('@') {
        return Vec::new();
    }
    if let Some(text) = line.strip_prefix("writing_text=") {
        return compile_writing_walls(text);
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
        return Vec::new();
    }
    if closed {
        vec![AdmitWall::close(id, reason)]
    } else {
        vec![AdmitWall::open(id)]
    }
}

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let mut walls: Vec<AdmitWall> = Vec::new();
    let mut trust_tier: Option<u32> = None;
    let mut trust_floor: Option<u32> = None;
    for line in buf.lines() {
        let t = line.trim();
        if let Some(v) = t.strip_prefix("trust_tier=") {
            trust_tier = v.trim().parse::<u32>().ok();
            continue;
        }
        if let Some(v) = t.strip_prefix("trust_floor=") {
            trust_floor = v.trim().parse::<u32>().ok();
            continue;
        }
        walls.extend(parse_line(line));
    }
    if let (Some(tier), Some(floor)) = (trust_tier, trust_floor) {
        walls.push(compile_trust_floor_wall(tier, floor));
    }
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
