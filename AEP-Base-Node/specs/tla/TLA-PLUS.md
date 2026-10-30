# TLA plus kit

AEP 2.8.6 ships five named MODULE models and the aep-tla-verify checker.

## Models

AdmitConjunction lives at AEP-Policy-System/tla.
DockPulse WrapComplete TemporalBounds and LastApplied live at AEP-Base-Node/specs/tla.
Each model is a named MODULE with a sibling cfg file.

## Checker

The crate aep-tla-verify lives at AEP-Components/verification/tla.
Profile AEP_TLA_PROFILE accepts off warn and strict. Empty means off.
Named MODULE shape runs whenever a .tla file is present including profile off.
Public Docker does not install TLC or Apalache.

## Run

cargo test -p aep-tla-verify

/* nla-type-salt: 7 */
