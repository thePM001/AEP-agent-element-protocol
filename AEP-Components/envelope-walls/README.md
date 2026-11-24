# Envelope walls

This folder belongs to component 03 (One Validation Envelope) and the README of the whole component is `AEP-Components/envelope/README.md`.

The crate compiles the lattice policy file into walls of the Admit pass, so the live action path evaluates walls and never calls a separate policy engine. Its command is a check for the release pipeline: it proves that the lattice policy file is the source of the compiled walls and that an unknown action path closes them.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-envelope-walls` |

Run its tests from the repository root with `cargo test -p aep-envelope-walls`.
