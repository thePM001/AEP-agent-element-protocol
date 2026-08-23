// @PAD: aep-dynaep-live-crossing-e2e-cli-v1
// @GCDE: gaplune-decode hmac-sha256:2a7c3be6127483f6004369dee352d16b4f99b77cfa39791b3d427a04a62afc53
// CLI: wall lines id= closed= reason= plus opa=<deny>. Prints allow, applied, closed and reasons.

use aep_dynaep_live_crossing_e2e::{format_crossing, live_cross, parse_fixture_text};
use std::io::{self, Read};

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let input = parse_fixture_text(&buf);
    let mut apply_hits = 0;
    let result = live_cross(input, &mut apply_hits);
    print!("{}", format_crossing(&result));
}