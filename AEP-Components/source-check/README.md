# Source check

This folder is a shared part of the components. `AEP-Components/README.md` lists it among the shared parts.

A few rules of the Base Node are proven by reading its Rust source, for example that the dock request path never aborts on a poisoned lock. Every such check reads the source through this crate. It parses each file with syn and finds a function or a type by its identifier. A name in a comment, a doc comment or a string is never taken for the item. Test code is never production code. An item that is absent or named twice is an error, so a renamed function fails the check instead of passing it.

The crates that use it name it as a dev dependency and keep their checks in `tests/source_gate.rs`, so the kernel build never compiles the parser.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-source-check` |

Run its tests from the repository root with `cargo test -p aep-source-check`.
