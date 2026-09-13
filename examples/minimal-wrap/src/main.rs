use aep_minimal_wrap::{
    deny_report, pulse_ms, seal_and_open, wrap_allow, writing_class_wall,
};

fn main() {
    if wrap_allow("agent-a", "action:write") {
        println!("allow true");
    } else {
        println!("allow false");
    }
    match seal_and_open(b"aep-2.8.6-minimal-wrap") {
        Ok(opened) => println!("sealed roundtrip ok: {}", String::from_utf8_lossy(&opened)),
        Err(e) => println!("sealed roundtrip failed: {e}"),
    }
    println!("pulse ms {}", pulse_ms());
    let report = deny_report("agent-a", "action:write");
    println!("deny report error: {}", report.error);
    println!("deny report closed walls: {}", report.closed.len());
    println!("deny report closed set key: {}", report.closed_set_key);
    let writing = writing_class_wall();
    println!("writing wall {} class {}", writing.id, writing.class);
}
