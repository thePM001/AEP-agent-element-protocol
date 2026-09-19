// The facade test imports the public kernel type set from the
// Base Node and proves the set is one definition site reached through the facade.
use aep_base_node::{
    AdmitResult, AdmitWall, AgentPermission, ClosedWall, DenyReport, Envelope, ProcessSealed,
    Pulse, PULSE_MS,
};

#[test]
fn facade_hands_over_every_public_type() {
    let wall = AdmitWall::close("writing:no_em_dashes", "em dash");
    let result = AdmitResult::from_walls(&[wall.clone()]);
    assert_eq!(result.allow, false);
    assert_eq!(result.closed.len(), 1);

    let envelope = Envelope {
        action_path: String::from("dock.entry"),
        ..Default::default()
    };
    assert_eq!(envelope.action_path.as_str(), "dock.entry");

    let permission = AgentPermission {
        agent_id: String::from("agent-a"),
        action: String::from("action:write"),
    };
    assert_eq!(permission.action.as_str(), "action:write");

    let closed = ClosedWall::new("writing:no_em_dashes", "em dash");
    let report = DenyReport::from_closed(&[closed]);
    assert_eq!(report.closed.len(), 1);
    assert_eq!(report.reseal_required, true);

    let pulse = Pulse::compiled();
    assert_eq!(pulse.ms, PULSE_MS);

    let sealed = ProcessSealed::seal(7, "sha256", "spec-a", 1);
    assert_eq!(sealed.is_sealed(), true);
    assert_eq!(sealed.matches(7, "sha256", "spec-a"), true);
    assert_eq!(sealed.matches(8, "sha256", "spec-a"), false);

    assert_eq!(std::mem::size_of_val(&result) > 0, true);
}

#[test]
fn facade_types_are_the_kernel_types() {
    assert_eq!(
        std::any::type_name::<AdmitResult>(),
        std::any::type_name::<aep_kernel_types::AdmitResult>()
    );
    assert_eq!(
        std::any::type_name::<ProcessSealed>(),
        std::any::type_name::<aep_kernel_types::ProcessSealed>()
    );
    assert_eq!(
        std::any::type_name::<Envelope>(),
        std::any::type_name::<aep_kernel_types::Envelope>()
    );
}
