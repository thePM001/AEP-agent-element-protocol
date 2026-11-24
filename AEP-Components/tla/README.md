# 18 / TLA+

Status: normative. Stability: evolving. The five models and the checker ship. The model check runs where TLC is installed.

## What it is

TLA+ is a language for formal specifications. A model states the allowed states and steps of a system and a model checker searches every reachable state for a violated invariant, a violated temporal property or a state with no next step. AEP writes its central kernel rules as TLA+ models, so the rules exist once more in a form a machine can check exhaustively.

## Place among the 18

The models describe rules of other components: the conjunction of the Admit Gate (04), the kernel order of the AEP Base Node (01) with the Base Node Pulse (10), the complete wrap of dynAEP (07), the time checks of the dock path and the book of last applied answers of the pulse. The checker reports to the release checks. No component receives a runtime result from it.

## What ships in 2.9

Five models, each a named module with a configuration file beside it. Every configuration switches the deadlock check on, names its invariants and names its temporal properties. Every specification states weak fairness on its steps.

| Model | Safety invariants | Liveness under weak fairness |
|-------|-------------------|------------------------------|
| `AdmitConjunction` | A frame is allowed only when every wall holds, denied when one wall is closed and decided only after every wall was read | Every arrived frame is decided and the gate returns for the next frame |
| `DockPulse` | Each step of seal, freeze, wait and collect needs the step before it. Apply needs a collected allow and a refused pulse never applies | Every sealed pulse ends in Apply or a refusal and the dock returns for the next pulse |
| `WrapComplete` | A wrap succeeds exactly when scene, action paths, written policy and dock channels are all present | Every wrap request is decided |
| `TemporalBounds` | An allowed frame carries a valid stamp at most 50 ms ahead of the kernel clock and at most 5000 ms behind it and has every causal parent. Every other decided frame is denied | Every arrived frame is decided |
| `LastApplied` | The book of answers is bounded, holds each settled digest exactly once and a held digest leaves only into the book | Every held digest gets an answer |

What a passing run proves and what it does not:

- TLC checks each model exhaustively for the finite instance its configuration names: three walls, four wrap parts, three digests with a book of two and the stamp offsets on both sides of each time bound.
- The deadlock check is on in every configuration, so a state with no next step fails the run. Every model is a loop that takes the next frame, pulse or request, so a live node never reaches a state without a next step.
- A liveness property holds under the weak fairness that the specification states: a step that remains possible is taken. The models say nothing about how long a step takes.
- `TemporalBounds` follows the dock path of the kernel. The enqueue step refuses a stamp outside the window around the kernel clock. Admit then reads the checked stamp as the event time and closes for a frame with no usable stamp or a missing causal parent. Its two bounds are `MAX_DRIFT_MS` and `MAX_AGE_MS` of `aep-base-node-pulse` and a test of this crate fails when they differ.
- The models are abstractions of the rules. No refinement proof ties them to the Rust kernel, which remains normative.

## The checker

- `aep-tla-verify` checks the module shape and the configuration of every model in each run, with any profile. A configuration that switches the deadlock check off, names no invariant or no temporal property or a specification without a fairness condition fails the run. So does a module whose name differs from its file or a path that does not exist.
- With the profile `warn` it also runs TLC when TLC is installed and writes a warning when it is not. With `strict` a missing tool or a failed model check fails the run.
- TLC is the program that `AEP_TLA_TLC` names, `tlc` or `tlc2` on PATH or `java` on PATH with `tla2tools.jar` from `AEP_TLA_TLC_JAR`, `TLA2TOOLS_JAR`, `/opt/tla/tla2tools.jar` or `/usr/share/java/tla2tools.jar`.
- The test `model_check` runs TLC on the five models and on eight mutants. Each mutant breaks one rule, such as Apply after a deny, a drift window one step wider or a dock that takes no next pulse. Each must fail for that reason. A mutant that passed would mean the property it targets checks nothing.
- The public Docker image installs neither TLC nor Apalache. No CI job runs TLC yet. The fuzz and model checker jobs belong to the verification plan of the tech status findings.
- The conformance battery in `AEP-Components/conformance/` and the handshake verification in `AEP-Components/verification/` belong to this component.

## Layout

| Path | Role |
|------|------|
| `AdmitConjunction.tla`, `DockPulse.tla`, `WrapComplete.tla`, `TemporalBounds.tla`, `LastApplied.tla` | The models |
| `*.cfg` | One configuration file per model |
| `src/lib.rs` | The shape and configuration walls and the profiles |
| `src/tlc.rs` | The TLC run and the class of its result |
| `tests/` | The walls on the shipped models, the command line and the model check with its mutants |
| `TLA-PLUS.md` | The public page on the kit |
| `AEP-Components/verification/` | Handshake proofs and counterparty verification |
| `AEP-Components/conformance/` | The conformance battery, its runner and the language neutral vectors |

## Interfaces

- Program: `aep-tla-verify <file.tla | folder>...`, which checks each model file passed to it or found in a folder. It prints one verdict line per model and exits 0 when every model passes, 1 when one fails and 2 on a usage error or an unknown profile.
- Environment: `AEP_TLA_PROFILE` with `off`, `warn` or `strict`. An empty value means `off`.
- Conformance: `./AEP-Components/conformance/runner/run.sh` with the manifest `AEP-Components/conformance/tests/manifest.json`.

## Limits

- A model checks the rule as written in the model. The Rust kernel remains normative.
- A passed model never replaces a GAP (06) policy. GAP is the one form for writing Admit.
- Without TLC the checker proves the shape and the configuration of the models only.

## Run and test

```bash
cargo test -p aep-tla-verify
cargo test -p aep-tla-verify --test model_check
cargo build -p aep-tla-verify
AEP_TLA_PROFILE=strict ./rust/target/debug/aep-tla-verify AEP-Components/tla
./AEP-Components/conformance/runner/run.sh
```

## Related documents

- `AEP-Components/tla/TLA-PLUS.md` for the kit
- `AEP-Components/conformance/README.md` for the battery
- `AEP-Components/verification/README.md` for the handshake proofs
