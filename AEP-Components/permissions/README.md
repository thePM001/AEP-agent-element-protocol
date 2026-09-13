# Permissions

This component is the kernel agent permission facade. The check itself lives in the admit crate on the collect-all Admit path. The crate here re-exports the public permission names so an attach reader imports one crate.

Agent permission is judged by the field name agent_permission and the wall id is gap:agent_permission, so an empty list refuses and one grant names one agent and one action. See the admit component for the kernel crate and the public API document for the exported names.
