# Semantic Topology Component

**Hyperlattice blast overlay projector.** Reads existing AEP topology and projects coding-governance intent onto it. Does **not** build or own a parallel semantic DAG.

## Topology sources (read-only)

| Source | Path | Role |
|--------|------|------|
| Hyperlattice canvas | hyperlattice graph file in `AEP_DATA` | Canonical visual node/edge graph (`catalog_id` on nodes) |
| Policy lattice | `AEP-Components/hyperlattice/lib/policy-lattice.mjs` | GAP hierarchy + LRP dock bindings |
| Registry | `AEP-Base-Node/registry/catalog.json`, `AEP-Base-Node/registry/components/*.json` | Component IDs, `pairs_with` neighbors |
| Intent snapshots | `intent-ledger` (`intents/<id>/blast-radius.json`) | Active blast radius component set |

AEP hyperlattice scene graphs are the topological substrate. `validateLatticeScene()` is boot-time structural proof, not runtime Admit. This component only annotates the hyperlattice canvas layer.

## Outputs

- `LatticeBlastOverlay v1` (`AEP-Base-Node/registry/schemas/lattice-blast-overlay-v1.json`)
- Consumed by hyperlattice `GET /api/graph/blast-overlay?intent_id=...`

## Phase 11B deliverables

- `lib/lattice-overlay.mjs` - project intent blast radius onto hyperlattice graph nodes
- Hyperlattice overlay is consumed by GET /api/graph/blast-overlay
- Remaining public importers live under hyperlattice and wizard

## Explicit non-goals

- No `lib/semantic-graph.mjs`
- No `GET /api/semantic/graph`
- No second "semantic view" graph beside the hyperlattice canvas