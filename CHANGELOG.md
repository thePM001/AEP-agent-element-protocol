# Changelog

All notable changes to the AEP 2.8.x public tree are recorded here. One entry per version, one date per entry.

## [2.8.6] - 2026-09-14 - One public kernel type set

The kernel now ships one public type set.

Added: `AEP-Components/kernel-types` owns seven public types once, `Envelope`, `AdmitResult`, `DenyReport`, `ClosedWall`, `Pulse`, agent permission and `ProcessSealed`. Every other crate re-exports those names instead of defining its own copy, so each public type has exactly one definition site.

Added: `AEP-Components/isolation` returns process isolation to the protocol crate graph. It seals one process against one isolation specification, refuses a second seal for the same process and ships a seal test.

Changed: the Base Node facades the public set. The facade test `AEP-Base-Node/crate/tests/public_type_set.rs` imports every public name from the Base Node. The writing wall kernel module is now `correctwriting_en` and the core id is `correctwriting-en`. The `dynAEP` crate no longer depends on the envelope crate, so it stands on the shared type crate alone.

Fixed: the admit result carried four different shapes in four crates. The wall row now carries one shape with a family field.

Verified: `cargo build --workspace` is green, the facade test passes and the isolation seal test passes.

## [2.8.5] - 2026-09-12

Building and conformance baseline for the 2.8.5 line.
