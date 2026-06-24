# AEP Merkle-Tree Audit Records

Extends the SHA-256 evidence ledger with Merkle proofs for tamper-evident decision records.

## Architecture

Each audit entry is hashed with SHA-256. Entries are organized into a Merkle tree:
- Leaf nodes: individual audit entries
- Branch nodes: SHA-256(left_child + right_child)
- Root: single hash proving integrity of entire ledger

## Proof Generation

For any entry in the ledger, a Merkle proof can be generated:
- The entry's hash
- The sibling hashes on the path to the root
- The root hash

Anyone can verify the entry is authentic by recomputing the path.

## Export Format

Compatible audit log format for enterprise integration:
```
{
 "version": "2.7",
 "root_hash": "sha256:...",
 "entries": [...],
 "merkle_proofs": [...]
}
```

## Verification

```bash
aep verify-chain --from <entry_id> --to <entry_id>
```
