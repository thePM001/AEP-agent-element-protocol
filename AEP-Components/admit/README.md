# 04 / Admit Gate

Status: normative. Stability: stable. The Rust crate `aep-admit` is the specification; `lib/admit.mjs` is the live JavaScript Admit path of dynAEP.

## What it is

The Admit Gate is the judgement of AEP. A wall is one named check with an open or closed result. Admit takes every wall of an action and closes the action when any wall is closed. It collects every closed wall and never stops at the first, so one answer lists all failed rules with their reasons.

## Place among the 18

The One Validation Envelope (03) hands over its 15 walls. GAP (06) adds the walls compiled from the written policy, the Scanners (12) add their result and the Base Node Pulse (10) supplies the frozen time. The verdict returns to the AEP Base Node (01), which applies an allowed action. UCB (02) and the CAWs (11) rely on the same verdict.

## What ships in 2.9

- One collect-all function, `admit_collect_all`, for every caller. The closed set is sorted, so the order of the walls never changes the answer.
- The writing rules of `AEP-Policy-System/reference/writing.gap` compile into walls of the same pass.
- The agent permission wall: an agent may do an action only when a grant lists this agent and this action. An empty grant list refuses.
- Wall families folded into the same pass by the member crates: time bounds, channel and partial order, window budgets per agent and wrap as well as the policy files of `AEP-Policy-System/reference/`.
- Covenants in TypeScript: the permit, forbid and require rules of an agent.
- A deny report with closed wall ids, a class per wall and a mechanical repair for missing fields and writing.

## Layout

| Path | Role |
|------|------|
| `crate/` | The crate `aep-admit`: wall evaluation, permission and lattice compilation |
| `lib/admit.mjs` | Collect-all over walls, wall line parsing and result formatting |
| `lib/writing-rules.mjs` | Reads `rules/writing-rules.json` and compiles text into writing walls |
| `rules/writing-rules.json` | The one writing rule table |
| `tests/` | vitest suites for the JavaScript path |
| `AEP-Components/admit-live-dock/` | Folds the wall crates into the live pass |
| `AEP-Components/admit-writing-walls/` | Writing rules as walls |
| `AEP-Components/admit-temporal-bounds/` | Time bounds as walls |
| `AEP-Components/admit-channel-order-walls/` | Channel and partial order as walls |
| `AEP-Components/admit-budget-window/` | Window budgets per agent and wrap |
| `AEP-Components/policy-system-admit/` | Loads the policy files as walls bound to a wrap or a prefix |
| `AEP-Components/one-admit-id/` | Source check: one Admit function and one id vocabulary |
| `AEP-Components/covenant/` | Covenant parser, evaluator and compiler |
| `AEP-Components/permissions/` | The public names of the agent permission check |

## Interfaces

- Rust: `admit_collect_all`, `compile_writing_walls` and `compile_agent_permission_wall` with the types `AdmitWall` and `AdmitResult`.
- Programs: `aep-admit` reads one wall per line as `id=<id> closed=<true|false> reason=<text>` and prints the verdict. `aep-writing-rules-manifest` prints the writing rule table as JSON.
- JavaScript: `lib/admit.mjs` and `lib/writing-rules.mjs`.
- Environment: `AEP_LATTICE_LOG_BIN` points at the kernel program for the writing walls. Without the program every writing wall closes.

## Limits

- Admit does not apply an action. The AEP Base Node (01) applies after an allow.
- Admit does not read stored shapes. Lattice Memory (15) never replaces a check.
- Admit does not write policy. GAP (06) is the only form it loads.

## Run and test

```bash
cargo test -p aep-admit -p aep-admit-live-dock -p aep-admit-writing-walls -p aep-admit-temporal-bounds -p aep-admit-channel-order-walls -p aep-admit-budget-window -p aep-policy-system-admit
npx vitest run AEP-Components/admit AEP-Components/covenant
```

## Related documents

- `AEP-Components/envelope/README.md` for the 15 walls of the envelope
- `AEP-Components/admit-budget-window/README.md` for window budgets
- `AEP-Policy-System/SETUP.md` for the setup of live policy files
- `AEP-Components/tla/README.md` for the model AdmitConjunction
