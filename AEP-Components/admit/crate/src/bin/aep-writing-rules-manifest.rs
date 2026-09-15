// Emit the one writing rule table as JSON. The JavaScript surfaces read this
// file, so no JavaScript surface carries a private copy of the rule family.
fn main() {
    print!("{}", aep_admit::writing_rules_manifest_json());
}
