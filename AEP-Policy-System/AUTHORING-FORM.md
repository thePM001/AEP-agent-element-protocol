# Authoring forms

One authoring form feeds the Admit layer. That form is GAP.

| Form | Path | Reaches the Admit layer | Read by |
|------|------|------|------|
| GAP | `AEP-Policy-System/reference/*.gap` | yes | `aep-admit` and `aep-policy-system-admit` |
| Policy YAML | `AEP-Policy-System/*.policy.yaml` | no | The host lattice engine |
| Rego rules | `AEP-Policy-System/*.rego` | no | The host lattice engine |

## Why one form

A loader that can pick up three forms cannot tell a reader which form is live.
The Admit layer reads GAP and it compiles each invariant into an Admit wall. The
host layer keeps its own rules, because the host engine sits outside the Admit
layer by design.

## How to add a rule

1. Add an invariant to a GAP file under `AEP-Policy-System/reference/`.
2. Name the wall owner. A writing rule reads the one writing rule table in
   `AEP-Components/admit/`.
3. Run `cargo test -p aep-policy-system-admit` and the conformance runner.

## Where the writing rules live

The writing rule family has one definition site, which is the compiled wall set
in `AEP-Components/admit/crate/src/lib.rs`. The table is emitted as
`AEP-Components/admit/rules/writing-rules.json`, so every JavaScript surface
reads the same table instead of a private copy.
