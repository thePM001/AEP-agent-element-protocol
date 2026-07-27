# Coding Governance Subprotocol

**One subprotocol** for AI coding change control (nool-inspired, AEP-native). All validation logic lives here as Rust. No scattered hooks across typescript-sdk, intent, or evidence-ledger.

## Actions (registry)

| Action | Purpose |
|--------|---------|
| `propose` | Declare intent + envelope; return blast radius |
| `blast_radius` | Recompute impact for paths or diff |
| `siee_check` | Semantic Impact Envelope Enforcement verdict |
| `solidify` | Record provenance after approved change |
| `announce` | Lattice `CODING_GOVERNANCE_ANNOUNCE` + task-manifest-v1 bind (requires agent_id) |
| `semantic_query` | Registry `pairs_with` neighbors (no parallel DAG) |
| `verify_token` | Check path against active ProposeToken |

## Invocation

```bash
aep-subprotocol coding-governance --action propose --payload '{...}'
```

TypeScript gateways call via `subprotocol-rust.ts` (same pattern as commerce).

## GAP integration

Reference instructions: `AEP-Components/gap/policies/reference/coding-governance-*.gap`

GAP meta-schema subprotocol slot: `coding-governance` in `gap/schemas/gap-meta-schema-v1.2.json`.

## Component siblings (not this crate)

| Component | Role |
|-----------|------|
| `gap/` | Language spec + meta-schemas + reference `.gap` policies |
| `intent-ledger/` | Append-only provenance storage |
| `semantic-topology/` | Hyperlattice blast overlay projector (read-only) |

This subprotocol **validates**. Sibling components **store and project onto existing topology**.