# 09 / Evidence Ledger

Status: normative. Stability: evolving. ML-DSA signing calls the aep-ml-dsa binary of the lattice crypto crate.

## What it is

The Evidence Ledger is the cryptographic audit trail a frontend or a gateway writes for a session. Every entry includes the SHA-256 hash of the entry before it, so a later change to any entry breaks the chain. Merkle trees over the entries let a third party verify one entry without the whole file.

## Place among the 18

The Model Gateway (17) and the session tools of the Graph Engine (05) write entries. The Intent Ledger (16) refers to a session ledger by reference. A later reader, an auditor or a counterparty receives the proof bundle. The runtime ledger of the kernel remains in the AEP Base Node (01).

## What ships in 2.9

- `EvidenceLedger`: an append-only file per session with a SHA-256 hash chain, `verify()` and a report.
- `MerkleTree` with a root and a proof per entry.
- Signatures with ML-DSA-65 through the program `aep-ml-dsa`.
- `RollbackManager` with compensation plans for one action or a whole session. These are the rollback anchors of the page.
- A queue for timestamps from an external timestamp authority and an offline ledger with later sync.
- Proof bundles with the reliability index theta in `AEP-Components/proof-bundle/`.
- An OpenTelemetry exporter in `AEP-Components/telemetry/`.

## Layout

| Path | Role |
|------|------|
| `lib/ledger/ledger.ts` | The ledger with the hash chain |
| `lib/ledger/merkle.ts` | Merkle tree and proofs |
| `lib/ledger/quantum.ts` | ML-DSA-65 key pairs, signing and verification |
| `lib/ledger/timestamp.ts` | Timestamp queue |
| `lib/ledger/offline.ts` | Offline ledger with sync |
| `lib/rollback/manager.ts` | Rollback with compensation plans |
| `lib/evidence/` | Optional mirror backend |
| `tests/` | vitest suites for ledger, Merkle, rollback, signatures and offline use |
| `AEP-Components/proof-bundle/` | Builder and verifier for proof bundles |
| `AEP-Components/telemetry/` | OpenTelemetry span and event exporter |

## Interfaces

- Classes: `EvidenceLedger`, `MerkleTree`, `RollbackManager`, `TimestampQueue` and `OfflineLedger`.
- Functions: `generateQuantumKeyPair`, `quantumSign` and `quantumVerify`.
- Files: one JSON lines file per session at the path the caller passes.
- Component id `evidence-ledger` with the manifest `AEP-Base-Node/AEP-Registry/components/evidence-ledger.json`.

## Standing

This component is a capability that frontends call, it remains in the catalog and it is not the runtime ledger.

The named runtime ledger is the SQLite lattice log in Base Node (`AEP-Base-Node/AEP-Crate/src/lattice_log.rs` over the `action-lattice.db` store). This component keeps its own session evidence files as evidence output for a caller, so it does not own the runtime state and it is not a second runtime ledger.

## Limits

- The component is not the runtime ledger. The SQLite lattice log of the AEP Base Node (01) is.
- A rollback runs the compensation a caller registered. The component cannot undo an effect nobody described.

## Run and test

```bash
npx vitest run AEP-Components/evidence-ledger AEP-Components/proof-bundle AEP-Components/telemetry
```

## Related documents

- `AEP-Components/evidence-ledger/lib/ledger/merkle/README.md` for the Merkle format
- `AEP-Components/proof-bundle/README.md` and `AEP-Components/telemetry/README.md`
- `AEP-Components/README.md` for the table of ledger surfaces
