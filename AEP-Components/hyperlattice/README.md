# AEP Hyperlattice

Canonical hyperlattice implementation for AEP 2.8.

| Module | Purpose |
|--------|---------|
| `lib/hyperlattice.mjs` | Unified hyperlattice view, boot validation, plan overrides |
| `lib/composer-protocol.mjs` | Canvas node/edge protocol constraints |
| `lib/gap-constrained-engine.mjs` | GAP policy loading. Optional remote validate uses a GAP engine URL from the environment only when one is set |
| `lib/cca-writing-validator.mjs` | EPSCOM writing.gap enforcement on hyperlattice output |
| `lib/cca-governed-release.mjs` | Governed release pipeline for hyperlattice chat/topology |

This package is the JavaScript projection of the live graph, because the live graph state is owned by the dynamic engine at `AEP-Components/dynAEP/`. The composer canvas reads the projection held by `AEP-Components/hyperlattice/lib/graph-store.mjs`, so no second package owns a private state copy.