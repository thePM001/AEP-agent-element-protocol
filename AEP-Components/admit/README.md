# Admit

Status: normative. Stability: stable. The Rust crate `aep-admit` is the specification; `lib/admit.mjs` is the live JavaScript Admit path of dynAEP.

Admit evaluates every wall of a crossing and closes the crossing when any wall closes (AND, collect-all). The writing rules and the GAP agent permission dimensions compile into walls on the same pass.

| Path | Role |
|------|------|
| `crate/` | `aep-admit`: wall evaluation, permission and lattice compilation |
| `lib/admit.mjs` | collect-all over walls, wall line parsing, result formatting, the writing kernel lookup (`resolveWritingKernel`) |
| `lib/writing-rules.mjs` | reads `rules/writing-rules.json` and compiles text into writing walls |
| `rules/writing-rules.json` | the one writing rule table |
| `tests/` | vitest suites for the JavaScript path |

The writing walls ask the kernel binary `aep-lattice-log` (`AEP_LATTICE_LOG_BIN`, else the workspace `target` folders). Without the binary every writing wall closes.

Run the tests from the repository root with `npx vitest run AEP-Components/admit`.
