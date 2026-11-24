// Unbound scene, channel, time and sequence close.
// dest_dock may bind from the opened frame docking port.
// tests/source_gate.rs proves by Admit and by the wall sources that every unbound field
// closes its wall.
use aep_envelope::dest_dock_from_opened_frame;

/// dest_dock binds from the opened frame docking port when the event field is empty.
pub fn bind_dest_dock_from_opened_frame(event_dest_dock: &str, docking_port: &str) -> String {
    dest_dock_from_opened_frame(event_dest_dock, docking_port)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dest_dock_binds_from_port() {
        assert_eq!(
            bind_dest_dock_from_opened_frame("", "inference_engine"),
            "inference_engine"
        );
        assert_eq!(
            bind_dest_dock_from_opened_frame("dock-b", "inference_engine"),
            "dock-b"
        );
    }
}
