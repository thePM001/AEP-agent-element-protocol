# 18 / TLA+

Status: normative. Stability: evolving. The five models and the shape checker ship and a model check runs only where TLC is installed.

## What it is

TLA+ is a language for formal specifications. A model states the allowed states and steps of a system and a model checker searches every reachable state for a violated invariant. AEP writes its central kernel rules as TLA+ models, so the rules exist once more in a form a machine can check exhaustively.

## Place among the 18

The models describe rules of other components: the conjunction of the Admit Gate (04), the kernel order of the AEP Base Node (01) with the Base Node Pulse (10), the complete wrap of dynAEP (07) and the time bounds. The checker reports to the release checks. No component receives a runtime result from it.

## What ships in 2.9

Five models, each a named module with a configuration file beside it:

| Model | States |
|-------|--------|
| `AdmitConjunction` | Every Admit is the conjunction of the named invariants. Dropping one conjunct is a counterexample |
| `DockPulse` | The kernel order is seal, freeze, wait, collect every Admit and then Apply |
| `WrapComplete` | A wrap succeeds only when scene, action paths, written policy and dock channels are all present |
| `TemporalBounds` | Time windows match the temporal bounds crate |
| `LastApplied` | The map of last applied events is monotonic and bounded |

- The checker `aep-tla-verify` tests the module shape of every model in each run, with any profile.
- With the profile `warn` it runs TLC when TLC is installed and writes a warning when it is not. With `strict` a missing tool or a failed model check fails the run.
- The public Docker image installs neither TLC nor Apalache.
- The page states exhaustive model checking proves safety, liveness and freedom from deadlock. This tree ships the models and the checker. It ships no stored result of an exhaustive run and a recorded proof run in the release checks is planned.
- The conformance battery in `AEP-Components/conformance/` and the handshake verification in `AEP-Components/verification/` belong to this component.

## Layout

| Path | Role |
|------|------|
| `AdmitConjunction.tla`, `DockPulse.tla`, `WrapComplete.tla`, `TemporalBounds.tla`, `LastApplied.tla` | The models |
| `*.cfg` | One configuration file per model |
| `src/`, `tests/` | The crate `aep-tla-verify` |
| `TLA-PLUS.md` | The public page on the kit |
| `AEP-Components/verification/` | Handshake proofs and counterparty verification |
| `AEP-Components/conformance/` | The conformance battery, its runner and the language neutral vectors |

## Interfaces

- Program: `aep-tla-verify <file.tla>`, which checks each model file passed to it.
- Environment: `AEP_TLA_PROFILE` with `off`, `warn` or `strict`. An empty value means `off`.
- Conformance: `./AEP-Components/conformance/runner/run.sh` with the manifest `AEP-Components/conformance/tests/manifest.json`.

## Limits

- A model checks the rule as written in the model. The Rust kernel remains normative.
- A passed model never replaces a GAP (06) policy. GAP is the one form for writing Admit.
- Without TLC the checker proves the shape of the models only.

## Run and test

```bash
cargo test -p aep-tla-verify
cargo build -p aep-tla-verify
AEP_TLA_PROFILE=strict ./rust/target/debug/aep-tla-verify AEP-Components/tla/AdmitConjunction.tla
./AEP-Components/conformance/runner/run.sh
```

## Related documents

- `AEP-Components/tla/TLA-PLUS.md` for the kit
- `AEP-Components/conformance/README.md` for the battery
- `AEP-Components/verification/README.md` for the handshake proofs
