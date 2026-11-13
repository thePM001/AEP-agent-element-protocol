# Policy system admit

This folder belongs to component 04 (Admit Gate) and the README of the whole component is `AEP-Components/admit/README.md`.

The crate loads the GAP files of `AEP-Policy-System/reference/` as live walls of the Admit pass. Each wall is bound to a wrap or to an action path prefix, while writing and security apply to every action. It also reads the shared scan rule table of the Scanners (12) and checks the receipts of the Universal Computation Module for computed values.

| Path | Role |
|------|------|
| `crate/` | The Rust crate `aep-policy-system-admit` |

Run its tests from the repository root with `cargo test -p aep-policy-system-admit`.
