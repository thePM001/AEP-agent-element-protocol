# Policy leftover skins

This folder belongs to component 06 (GAP) and the README of the whole component is `AEP-Components/gap/README.md`.

The crate checks the policy folder. YAML and Rego files beside the GAP reference documents are leftovers for the host layer and the check fails when the collect-all pass would load anything other than GAP reference documents.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-policy-leftover-skins` |

Run its tests from the repository root with `cargo test -p aep-policy-leftover-skins`.
