# Semantic Topology Component

**Hyperlattice blast overlay projector.** Reads existing AEP topology and projects coding-governance intent onto it. Does **not** build or own a parallel semantic DAG.

## Topology sources (read-only)

| Source | Path | Role |
|--------|------|------|
| Composer hyperlattice canvas | `composer-lite-graph.json` in `AEP_DATA` | Canonical visual node/edge graph (`catalog_id` on nodes) |
| Policy lattice | `composer-lite/lib/policy-lattice.mjs` | GAP hierarchy + LRP dock bindings |
| Registry | `AEP-Base-Node/registry/catalog.json`, `AEP-Base-Node/registry/components/*.json` | Component IDs, `pairs_with` neighbors |
| Intent snapshots | `intent-ledger` (`intents/<id>/blast-radius.json`) | Active blast radius component set |

AEP hyperlattice scene graphs (`validateLatticeScene()`, UI scene graph, dynAEP Action Lattice) are the protocol's topological substrate. This component only **annotates** the Composer canvas layer.

## Outputs

- `LatticeBlastOverlay v1` (`AEP-Base-Node/registry/schemas/lattice-blast-overlay-v1.json`)
- Consumed by Composer Lite `GET /api/graph/blast-overlay?intent_id=...`

## Phase 11B deliverables

- `lib/lattice-overlay.mjs` - project intent blast radius onto composer graph nodes
- Composer route delegates here (thin proxy in `composer-lite/lib/http-api.mjs`)
- Canvas highlight toggle in `composer-lite/public/assets/canvas.js`

## Explicit non-goals

- No `lib/semantic-graph.mjs`
- No `GET /api/semantic/graph`
- No second "semantic view" graph beside the hyperlattice canvas