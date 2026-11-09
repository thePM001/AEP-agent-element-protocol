# Envelope

Status: reference. Stability: evolving. The Rust crate `aep-envelope` is the specification; `lib/admit.mjs` mirrors its walls in JavaScript.

`admit(action, snap)` evaluates every envelope wall of one action against a lattice snapshot and collects all of them: Action Lattice membership and parents, scene membership, GAP agent permission, GAP writing, covenant tools, channel dock, time authority, session rate, the scanner bundle and the Rego walls for restricted actions, forbidden sequences and the output ceiling. `planApply` and `applySnapshot` turn an open result into the next snapshot.

| Path | Role |
|------|------|
| `crate/` | `aep-envelope` walls and the lattice YAML reader |
| `lib/admit.mjs` | the JavaScript form of the envelope walls |
| `tests/` | vitest suites for every wall family with the writing kernel switched off |

The writing walls ask the kernel binary `aep-lattice-log`; without it they close.
