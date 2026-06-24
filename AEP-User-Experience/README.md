# AEP User Experience

Operator-facing tooling: harness, agent skill, validation shortcuts, and manual modification scripts.

## Harness

Path: `AEP-User-Experience/harness/`

```bash
cd AEP-User-Experience/harness
npm run check
node ../aep-base-node-preflight.mjs
```

Slash commands: `.claude/commands/aep-preflight.md`, `aep-validate.md`, `aep-register.md`, `aep-base-node.md`

## Operator scripts

Path: `AEP-User-Experience/scripts/`

Manual repo modifications, layout migrations, connector scaffolding, and E2E smoke checks.

```bash
# E2E protocol smoke (from repo root)
./AEP-User-Experience/scripts/e2e-lattice-smoke.sh
./AEP-User-Experience/scripts/e2e-ucb-smoke.sh

# Connector registry maintenance
node AEP-User-Experience/scripts/scaffold-aep-connectors.mjs
node AEP-User-Experience/scripts/register-aep-connectors.mjs
```

## Root shortcuts

From repo root:

```bash
npm run validate
node AEP-User-Experience/aep-validate.js
node AEP-User-Experience/aep-base-node-preflight.mjs
```

## Legacy 2.75 harness

Retained at repo root for reference only.