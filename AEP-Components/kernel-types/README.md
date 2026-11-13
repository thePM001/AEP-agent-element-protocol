# Kernel types

This folder belongs to component 01 (AEP Base Node) and the README of the whole component is `AEP-Base-Node/README.md`.

The crate defines the one public set of kernel types: Envelope, AdmitResult, DenyReport, ClosedWall, Pulse, AgentPermission and ProcessSealed. Every other crate imports these types from this crate, so each type has one definition.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-kernel-types` |

Run its tests from the repository root with `cargo test -p aep-kernel-types`.
