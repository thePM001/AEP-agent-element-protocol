# Agent Control Hub

Base Node kernel extension. The daemon loads this crate. GAP profile language lives in AEP-Components/gap. This crate binds those instructions into kernel-owned session, mount and agent-permission state.

## Crate

The workspace crate is AEP-Base-Node/AEP-Agent-Control-Hub/crate (package aep-agent-control-hub). DockingRuntime holds the loaded hub. Health JSON reports hub_loaded, hub_sessions, hub_mounts and hub_permissions.

Load path is AEP_GAP_ROOT or AEP-Components/gap. This is not a compiler re-export and not a YAML mount-profile tree.
