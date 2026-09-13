{
  "address": {
    "domain": "aep.public.api",
    "id": "public-api.v1"
  },
  "pattern": {
    "guard": "true",
    "wrap": "public-api",
    "constraints": [
      "hard: one field name carries the who may grant and it is agent_permission",
      "hard: the permission wall id is gap:agent_permission",
      "hard: an empty grant list refuses",
      "hard: one grant names one agent and one action",
      "hard: an attachable catalog row resolves to code in this tree"
    ]
  },
  "action": {
    "type": "reference",
    "content": "The kernel crate under AEP-Base-Node is the single import surface for AEP 2.8.6 and its facade re-exports every name listed here, so a builder attaches through this list and no second evaluator is required. The permission names reach a reader through the permissions component crate. The operator reading order, the compiled pulse description, the error catalogue and the memory note sit beside this file in the docs folder. Export surface: error AdmitDeny BaseNodeError. backpressure ClosedWall DenyReport. pulse PULSE_MS. live entry AdmitResult Envelope Pulse agent_permission AgentPermission DENY_NO_PERMISSION. sealed payload process_sealed. side channel record_side_channel_anomaly SideChannelAnomaly SideChannelAnomalyKind SIDE_CHANNEL_EVENT_TYPE. docking drain_docking_servers process_request pulse_beat run_docking_servers sockets_exist unlink_sockets DockFrameResponse DockingRuntime. lattice log build_transport_frame default_aep_data_dir default_lattice_db_path export_dynaep_events open_lattice_db record_dynaep_event refuse_world_writable_lattice_parent refuse_world_writable_lattice_parent_with_allow world_writable_lattice_parent_allowed ALLOW_WORLD_WRITABLE_LATTICE_PARENT_ENV DynAepEventExport DynAepEventInput DynAepEventRecord. writing enforce_writing_text enforce_writing_value lint_writing_prose value_has_writing_violations WritingEnforceResult WritingViolation EPSCOM_CORE_ID WRITING_GAP_DOMAIN WRITING_RULE_IDS WRITING_RULE_NO_DASH_SUBSTITUTES WRITING_RULE_NO_DOUBLE_HYPHEN WRITING_RULE_NO_EM_DASHES WRITING_RULE_NO_EN_DASHES WRITING_RULE_NO_MINUS_AS_DASH WRITING_RULE_NO_OXFORD_COMMA. structs DockingPortSpec BaseNodeHealth ReplayGuard. functions docking_port_specs init_action_lattice_db agentmesh_bundle_for_frame frame_digest_exists verify_inbound_dock_frame record_channel_frame record_lattice_event event_count resolve_mesh_peers count_epscom_signature_entries health now_unix bootstrap_contracts bootstrap_contracts_from_lrps. constants COMPONENT_ID EPSCOM_PRIORITY."
  },
  "weight": 1.0,
  "composition": {
    "type": "atomic"
  },
  "metadata": {
    "provenance": "aep.reference.public-api",
    "version": "1.0.0",
    "stability": "stable",
    "aspect": "objective",
    "agent_permission": [
      "agent-a"
    ],
    "aep_version": "2.8.6"
  }
}
