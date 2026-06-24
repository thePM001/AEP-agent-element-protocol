# AEP 2.8 Agent Skill

Loads the AEP 2.8 agent harness and governance configuration.

## Triggers

AEP, dynAEP, Base Node, Composer Lite, setup agent, component registry, GAP, policy lattice, trust ring, covenant, scanner.

## Harness

- `AEP-User-Experience/harness/` - current harness
- `harness/aep-base-node-preflight.mjs` - Base Node health check
- `harness/aep-validate.js` - UI registry validation

## Features (2.8 + inherited 2.75e)

- Base Node with four docking ports
- dynAEP Action Lattice merged in-repo
- Composer Lite WASM canvas
- Component registry and compliance LRP modules
- 15-step evaluation chain and 11 scanners
- Evidence ledger with Merkle proofs
- Schema Builder and Policy Builder