# Intent Ledger Component

Append-only **Intent Provenance Ledger** for coding governance. Stores `SolidifyRecord` entries; validation is `AEP-Subprotocols/coding-governance`.

## Storage

| Path | Format |
|------|--------|
| `$AEP_DATA/intent-provenance.jsonl` | Hash-chained SolidifyRecord lines |
| `$AEP_DATA/intents/<intent_id>/` | IntentDeclaration + BlastRadiusReport + `git-refs-propose.json` |

## Cross-reference (11C)

Solidify records may include `evidence_ledger_ref` pointing at a gateway session ledger (`$AEP_LEDGER_DIR/<session_id>.jsonl` or `$AEP_DATA/ledgers/`). This links coding provenance to runtime governance actions without merging the two ledgers.

## CLI

```bash
aep propose --intent "..." --paths ...
aep solidify --intent-id INT-... [--session-id <gateway-session>]   # auto git_refs from HEAD
aep solidify --intent-id INT-... --no-git                            # skip git capture
aep solidify --intent-id INT-... --git-commit sha                    # manual override
aep semantic explain INT-... [--lrps epscom-core,gap-runtime-scanners]
aep semantic list [--limit 20]
aep semantic knot INT-...              Search lattice memory knots (sqlite-vec + USearch; optional Agentstream)
aep semantic knot INT-... --phase propose   Re-record knot for a governance phase
```

## Lattice memory knots (11E)

Intent knots are searchable attractors in lattice memory. The file ledger remains canonical; knots enable similarity search across past intents.

| Backend | Required | Notes |
|---------|----------|-------|
| Lattice Memory (`aep-memory`) | Yes | SQLite **3.46.0** bundled + **sqlite-vec 0.1.9** `vec0` + **USearch 2.25.3** `.usearch` sidecar on `$AEP_LATTICE_DB` (`action-lattice.db`) |
| Agentstream | No | Mirror when `AGENTSTREAM_URL` is set (capsule `aep-intent-knots`) |

## Library

| Module | Role |
|--------|------|
| `lib/ledger.mjs` | append, hash chain, `verifyChain`, `listIntentSnapshots` |
| `lib/explain.mjs` | `explainIntentRich` (overlay + policy + evidence summary) |
| `lib/evidence-link.mjs` | evidence-ledger session summary + ref builder |
| `lib/intent-knots.mjs` | Lattice memory (sqlite-vec + USearch) + optional Agentstream knot record/search |
| `lib/agentstream-knots.mjs` | Optional Agentstream mirror for knots |
| `lib/embedding.mjs` | Deterministic embeddings for knot search |

Schemas: `AEP-Base-Node/registry/schemas/solidify-record-v1.json`, `AEP-Base-Node/registry/schemas/intent-knot-v1.json`