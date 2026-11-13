# AEP User Experience

This folder serves all 18 main components: it contains the harness, the operator documents and two example runs. The tables below state for each document the component it serves, by the numbers of the component map in `AEP-Components/component-map.json`.

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

## Legacy 2.9 harness

Retained at repo root for reference only.

## Harness by component

| Path | Serves | Topic |
|------|--------|-------|
| [`harness/README.md`](harness/README.md) | 01 AEP Base Node | Boot registration of an agent session |
| `harness/harness/aep-validate.js` | 07 dynAEP | Validation of the element registry, the scene and the theme |
| `harness/harness/aep-temporal-validate.js` | 07 dynAEP | Validation of timestamps |
| `harness/harness/aep-safety-guard.js` | 04 Admit Gate | Immutable safety rules |
| `harness/harness/aep-economics.js` | 14 Economics | Cost wiring example |
| [`harness/TEMPORAL-AUTHORITY.md`](harness/TEMPORAL-AUTHORITY.md) | 07 dynAEP and 10 Base Node Pulse | Who owns which clock |
| `aep-base-node-preflight.mjs` | 01 AEP Base Node | Health, docks and registry before a session |

## Documents by component

| Document | Serves | Topic |
|----------|--------|-------|
| [`docs/AEP-2.9-SECURE-DEPLOYMENT-GUIDE.md`](docs/AEP-2.9-SECURE-DEPLOYMENT-GUIDE.md) | 01 AEP Base Node with 02, 08, 11 and 13 | Secure deployment of the whole stack |
| [`docs/DATA-DOCK.md`](docs/DATA-DOCK.md) | 01 AEP Base Node | The HTTP JSON surface for admitted records |
| [`docs/ERROR-CATALOG.md`](docs/ERROR-CATALOG.md) | 04 Admit Gate | The public deny dialect with every refusal reason |
| [`docs/WHAT-IS-COMPILED.md`](docs/WHAT-IS-COMPILED.md) | 10 Base Node Pulse | Which kernel values are compiled constants |
| [`docs/FOREIGN-ATTACH.md`](docs/FOREIGN-ATTACH.md) | 02 UCB | How to attach an external system with a task manifest |
| [`docs/UCB-ATTACH-NOTES.md`](docs/UCB-ATTACH-NOTES.md) | 02 UCB | The public attach record with limits and waits |
| [`docs/SUBPROTOCOLS.md`](docs/SUBPROTOCOLS.md) | 07 dynAEP | Custom sub-lattices inside the hyperlattice |
| [`docs/LATTICE-MEMORY.md`](docs/LATTICE-MEMORY.md) | 15 Lattice Memory | Backends and the rule that memory never admits |
| [`docs/CODEX-INSTALL.md`](docs/CODEX-INSTALL.md) | 11 CAWs | Setup of a coding agent under AEP |
| `docs/PUBLIC-API.gap` | 06 GAP | The public interface of the tree as a GAP document |
| [`docs/compliance/COMPLIANCE.md`](docs/compliance/COMPLIANCE.md) | 06 GAP | The compliance modules |
