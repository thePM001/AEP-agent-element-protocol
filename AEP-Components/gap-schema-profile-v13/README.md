# GAP schema profile 1.3

This folder belongs to component 06 (GAP) and the README of the whole component is `AEP-Components/gap/README.md`.

The crate is the live Admit profile of the GAP schema in version 1.3. Who may act is the field `agent_permission`, the presence of a `trust_ring` field is a deny and the field `enabled` is read at load time.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `gap-schema-profile-v13` |

Run its tests from the repository root with `cargo test -p gap-schema-profile-v13`.
