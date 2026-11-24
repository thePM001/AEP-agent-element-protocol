# TLA+

AEP 2.9 ships five named MODULE models and the aep-tla-verify checker.
This page is the public documentation for that kit and the docs live only here.

## What the models check

TLC checks each model exhaustively for the finite instance its configuration names. Every configuration switches the deadlock check on and every specification states weak fairness on its steps. A passing run proves the safety invariants, the liveness properties under that fairness and freedom from deadlock of the model. The models are abstractions of the kernel rules and the Rust kernel remains normative.

## Models

AdmitConjunction lives at AEP-Components/tla. A frame is allowed only when every wall holds and is decided only after every wall was read. Every arrived frame is decided.
DockPulse lives at AEP-Components/tla. The kernel order is seal, freeze, wait, collect every Admit, then Apply on an allow or a refusal on a deny. Every sealed pulse ends.
WrapComplete lives at AEP-Components/tla. A wrap succeeds exactly when scene, action paths, written policy and dock channels are all present. Every request is decided.
TemporalBounds lives at AEP-Components/tla. An allowed frame carries a valid stamp at most 50 ms ahead of the kernel clock and at most 5000 ms behind it and has every causal parent. The two bounds are the constants of the pulse that the dock path enforces and a test holds them equal.
LastApplied lives at AEP-Components/tla. The book of last applied answers is bounded, holds each settled digest once and a held digest leaves only into the book. Every held digest gets an answer.
Each model is a named MODULE with a sibling cfg file.

## Checker

The crate aep-tla-verify lives at AEP-Components/tla, where profile AEP_TLA_PROFILE accepts off, warn and strict while an empty value means off.
The module shape and the configuration walls run with every profile: the deadlock check on, an invariant, a temporal property and a fairness condition.
When the profile is warn, TLC runs if installed and a missing tool writes a warning.
When the profile is strict, a missing tool or a failed model check closes the lane.
Eight mutants each break one rule and must fail the model check, so no property passes by checking nothing.
Public Docker does not install TLC or Apalache and GAP remains the one form for writing Admit so a TLA+ pass never replaces GAP.

## Run

```bash
cargo test -p aep-tla-verify
cargo test -p aep-tla-verify --test model_check
```
