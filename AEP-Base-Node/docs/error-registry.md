# Error registry (Base Node governance)

Structured error mapping for AEP-governed agents. Consulted by recovery flows when the Base Node kernel or harness detects violations.

## Fields

| Field | Purpose |
|-------|---------|
| Error code | Structured logging |
| Severity | info, warn, error, critical |
| Recovery | retry, fallback, escalate, terminate |
| Trust impact | Penalty points on lattice trust score |

## Related governance

- **Capability profiles:** `AEP-Components/gap/policies/reference/` (GAP instruction policies)
- **Task manifests:** `AEP-Base-Node/crate/src/task_manifest.rs` + `$AEP_DATA/ucb/manifests/`
- **Side-channel monitor:** `AEP-Base-Node/crate/src/side_channel_monitor.rs`

## Registration

New components register in `AEP-Base-Node/registry/catalog.json` and `AEP-Base-Node/registry/components/<id>.json`, not in a separate top-level folder.