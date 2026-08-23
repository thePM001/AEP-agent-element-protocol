// @PAD: aep-envelope-algebra-cli-v1
// @GCDE: gaplune-decode hmac-sha256:544c3507cb7f365dc10b67059b36c5fd3f4180964845e80ab8b5dd45138f8b1b
// CLI: wall lines id= closed= reason= dim=. Prints allow, applied, key and closed walls.

use aep_envelope_algebra::{envelope_cross, format_envelope, parse_fixture_text};
use std::io::{self, Read};

fn main() {
    let mut buf = String::new();
    io::stdin().read_to_string(&mut buf).expect("stdin");
    let input = parse_fixture_text(&buf);
    let mut apply_hits = 0;
    let result = envelope_cross(input, &mut apply_hits);
    print!("{}", format_envelope(&result));
}
