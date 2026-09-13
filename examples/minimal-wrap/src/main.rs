use aep_minimal_wrap::wrap_allow;
fn main() {
    if wrap_allow("agent-a", "action:write") {
        println!("allow true");
    } else {
        println!("allow false");
    }
}
