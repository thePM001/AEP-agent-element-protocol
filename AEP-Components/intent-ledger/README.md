# 16 / Intent Ledger

Status: normative. Stability: evolving. Intent knots call the aep-memory binary of Lattice Memory for record and search.

## What it is

The Intent Ledger is the provenance register for coding actions. A coding agent first declares what it intends to change and which files the change reaches. When the change lands as a commit, the ledger writes a solidify record linking the commit to the declaration. The file is append-only and every record includes the hash of the record before it.

## Place among the 18

Coding agents inside the CAWs (11) propose and solidify through the `aep` command line. The validation of a proposal is the Admit Gate (04) with the GAP (06) reference policies. Records refer to a session of the Evidence Ledger (09) and intent records are searchable through Lattice Memory (15).

## What ships in 2.9

- An append-only ledger of solidify records with a hash chain and `verifyChain`.
- A snapshot per intent with the declaration, the report of affected files and the git references.
- An explain view per intent with policy, evidence sessions and related intents.
- Similarity search over past intents, called intent knots, through Lattice Memory.
- The intent drift detector in `AEP-Components/intent/`, which compares the actions of an agent with its baseline.
- The page describes commits verified through semantic topology. In this tree a commit is linked to its intent by record, hash and git reference. Verification through semantic topology is planned.

## Layout

| Path | Role |
|------|------|
| `lib/ledger.mjs` | Append, hash chain, `verifyChain` and `listIntentSnapshots` |
| `lib/explain.mjs` | `explainIntentRich` over policy lattice, evidence sessions and intent knots |
| `lib/evidence-link.mjs` | Summary of an evidence session and the reference builder |
| `lib/intent-knots.mjs` | Record and search of intent knots in Lattice Memory |
| `lib/agentstream-knots.mjs` | Optional mirror for knots |
| `lib/embedding.mjs` | Deterministic embeddings for knot search |
| `tests/` | vitest suites |
| `AEP-Components/intent/` | Intent baseline and drift detection |

## Interfaces

Storage:

| Path | Format |
|------|--------|
| `$AEP_DATA/intent-provenance.jsonl` | Hash-chained SolidifyRecord lines |
| `$AEP_DATA/intents/<intent_id>/` | IntentDeclaration + BlastRadiusReport + `git-refs-propose.json` |

Command line:

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

Schemas: `AEP-Base-Node/AEP-Registry/schemas/solidify-record-v1.json` and `AEP-Base-Node/AEP-Registry/schemas/intent-knot-v1.json`.

## Standing

This component is a derived provenance view over coding intent. It is not the runtime ledger. The named runtime ledger is the SQLite lattice log in Base Node (`AEP-Base-Node/AEP-Crate/src/lattice_log.rs` over the `action-lattice.db` store).

## Cross-reference (11C)

Solidify records may include `evidence_ledger_ref` pointing at a gateway session ledger (`$AEP_LEDGER_DIR/<session_id>.jsonl` or `$AEP_DATA/ledgers/`). This links coding provenance to runtime governance actions without merging the two ledgers.

## Lattice memory knots (11E)

Intent knots are searchable attractors in lattice memory. The file ledger remains canonical; knots enable similarity search across past intents.

| Backend | Required | Notes |
|---------|----------|-------|
| Lattice Memory (`aep-memory`) | Yes | SQLite **3.54.1** bundled + **sqlite-vec 0.1.9** `vec0` + **USearch 2.25.3** `.usearch` companion file on `$AEP_LATTICE_DB` (`action-lattice.db`) |
| Agentstream | No | Mirror when `AGENTSTREAM_URL` is set (capsule `aep-intent-knots`) |

## Limits

- The ledger is a derived provenance view. It is not the runtime ledger of the AEP Base Node (01).
- The ledger records and links. It does not judge a change. The Admit Gate (04) does.
- The file ledger is canonical. Intent knots only make it searchable.

## Run and test

```bash
npx vitest run AEP-Components/intent-ledger AEP-Components/intent
```

## Related documents

- `AEP-Components/intent/README.md` for drift detection
- `AEP-Components/evidence-ledger/README.md` for the session ledger a record refers to
- `AEP-Components/lattice-memory/README.md` for the store behind intent knots
