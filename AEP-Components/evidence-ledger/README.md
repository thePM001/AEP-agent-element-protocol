# Evidence Ledger

Merkle evidence ledger, rollback and ML-DSA-65 post-quantum signatures
(real `aep-ml-dsa` / pqcrypto-mldsa, not HMAC sim).

- **Component ID:** `evidence-ledger`
- **Path:** `evidence-ledger/`
- **Manifest:** `AEP-Base-Node/registry/components/evidence-ledger.json`

Runtime code lives in `lib/`.

## Standing

This component is a capability that frontends call and it stays in the catalog. It is not the runtime ledger.

The named runtime ledger is the SQLite lattice log in Base Node (`AEP-Base-Node/crate/src/lattice_log.rs` over the `action-lattice.db` store). This component keeps its own session evidence files as evidence output for a caller, so it does not own the runtime state and it is not a second runtime ledger.
