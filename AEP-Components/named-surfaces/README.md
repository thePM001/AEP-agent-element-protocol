# Named Surfaces

Status: sketch. Stability: experimental. This folder is not in the Cargo workspace or the registry.

Named surfaces are live so policy transpilers emit GAP. `sketch/smoke.ts` runs the Cedar and Rego transpilers of the policy engine to GAP and back. It is illustrative and compiles under the root tsconfig. The crate reads the transpiler sources and checks that they emit GAP.
