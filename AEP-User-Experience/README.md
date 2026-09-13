# AEP User Experience

Operator-facing tooling: harness, agent skill, validation shortcuts and the wrap example.

## Harness

Path: `AEP-User-Experience/harness/`

```bash
cd AEP-User-Experience/harness
npm run check
node ../aep-base-node-preflight.mjs
```

Slash commands: `.claude/commands/aep-preflight.md`, `aep-validate.md`, `aep-register.md`, `aep-base-node.md`

## Root shortcuts

From repo root:

```bash
npm run validate
node AEP-User-Experience/aep-validate.js
node AEP-User-Experience/aep-base-node-preflight.mjs
```

## Examples

Path: `AEP-User-Experience/examples/minimal-wrap/`

A single documented run that prints the allow decision, the sealed payload roundtrip, the compiled pulse and the deny report.

Path: `AEP-User-Experience/examples/end-to-end-run/`

A single documented run that walks every layer twice. The refuse path runs first and every layer fails closed. The pass path runs second and the same layers allow, with a ledger row at the end. The transcript of the run is committed beside the note.

## Legacy 2.75 harness

Retained at repo root for reference only.
## Secure deployment

- [AEP 2.8 Secure Deployment Guide](docs/AEP-2.8-SECURE-DEPLOYMENT-GUIDE.md)
