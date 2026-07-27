# AEP 2.8 Agent Skill

Loads the AEP 2.8 agent skill, harness pointers and governance configuration.

**Canonical skill file:** `SKILL.md` (full protocol). Companion summary: `skill.md`.

## Triggers

AEP, dynAEP (main event runtime), Base Node, Composer Lite, CCA / setup agent, CAW, UCB, Path A/B, GAP, policy lattice, trust ring, covenant, scanner, secure deployment.

## Stack pointers

| Component | Path |
|-----------|------|
| Base Node | `AEP-Base-Node/` |
| dynAEP | `AEP-Components/dynAEP/` |
| dynAEP SDK | `AEP-SDKs/typescript/dynaep/` |
| CCA | `AEP-Components/cca/` (`setup-agent.mjs`, CLI `aep-cca` / `aep-setup-agent`) |
| Composer Lite | `AEP-Composer-Lite/` |
| Registry | `AEP-Base-Node/registry/` |
| CAW | `AEP-Components/caw-framework/` |
| UCB | `AEP-Docks/ucb/` |
| Harness | `AEP-User-Experience/harness/` |

## Harness / checks

- `AEP-User-Experience/aep-base-node-preflight.mjs` - Base Node health check
- `AEP-User-Experience/aep-validate.js` - UI registry / scene / theme validation
- `AEP-User-Experience/harness/harness/aep-validate.js` - nested harness validator copy
- `./AEP-Components/conformance/runner/run.sh` - public-tier conformance runner

## Secure deployment

**[AEP secure deployment guide](../docs/AEP-2.8-SECURE-DEPLOYMENT-GUIDE.md)** - dynAEP as main runtime, Path A (native lattice) and Path B (optional UCB).

## Features (2.8 + inherited 2.75e)

- Base Node kernel with docking ports and lattice channels
- dynAEP Action Lattice merged in-repo (main event runtime)
- Composer Lite WASM canvas and CCA plan/execute
- Component registry and compliance LRP modules
- 15-step evaluation chain and 11 scanners
- Evidence ledger with Merkle proofs
- Schema Builder and Policy Builder
- CAW execution-layer security (`aep-caw`)
