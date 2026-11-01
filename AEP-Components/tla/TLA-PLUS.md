# TLA+

AEP 2.9 ships five named MODULE models and the aep-tla-verify checker.
This page is the public documentation for that kit and the docs live only here.

## Models

AdmitConjunction lives at AEP-Components/tla.
Every Admit is the conjunction of the named invariants. Dropping one conjunct is a counterexample.
DockPulse lives at AEP-Components/tla. The kernel order is seal, freeze, wait, collect every Admit, then Apply.
WrapComplete lives at AEP-Components/tla. A wrap succeeds only when scene, action paths, written policy and dock channels are all present.
TemporalBounds lives at AEP-Components/tla. Time windows match the temporal bounds crate under AEP-Components.
LastApplied lives at AEP-Components/tla. The last applied map is monotonic and bounded.
Each model is a named MODULE with a sibling cfg file.

## Checker

The crate aep-tla-verify lives at AEP-Components/tla, where profile AEP_TLA_PROFILE accepts off, warn and strict while an empty value means off.
Named MODULE shape runs whenever a .tla file is present including profile off.
When the profile is warn, TLC runs if installed and a missing tool writes a warning.
When the profile is strict, a missing tool or a failed model check closes the lane.
Public Docker does not install TLC or Apalache and GAP remains the one form for writing Admit so a TLA+ pass never replaces GAP.
GAP remains the one form for writing Admit. A TLA+ pass never replaces GAP.

## Run

cargo test -p aep-tla-verify

/* nla-type-salt: 10 */
