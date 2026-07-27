# AEP Hyperlattice

Canonical hyperlattice implementation for AEP 2.8 Composer Lite and CCA.

| Module | Purpose |
|--------|---------|
| `lib/hyperlattice.mjs` | Unified hyperlattice view, boot validation, plan overrides |
| `lib/composer-protocol.mjs` | Canvas node/edge protocol constraints |
| `lib/gap-constrained-engine.mjs` | CCA GAP policy loading |
| `lib/cca-writing-validator.mjs` | EPSCOM writing.gap enforcement on CCA output |
| `lib/cca-governed-release.mjs` | Governed release pipeline for CCA chat/topology |

Composer Lite re-exports from this package. Canvas graph state still lives in `AEP-Composer-Lite/lib/graph-store.mjs`.