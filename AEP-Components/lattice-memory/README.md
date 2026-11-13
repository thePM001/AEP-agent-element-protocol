# 15 / Lattice Memory

Status: normative. Stability: evolving. The store is tested and the optional backends are attached by the operator.

## What it is

Lattice Memory stores the shapes of judged proposals as vectors, called attractors. It serves audit, health telemetry and fast similarity search over earlier decisions. A stored shape is evidence for a later reader. It is never a permission: a proposal similar to an earlier allow still passes the full Admit Gate.

## Place among the 18

The AEP Base Node (01) records judged proposals and reports the number of attractors in its health answer. The Intent Ledger (16) stores and searches intent records through it. The Graph Engine (05) can persist run data to it. No component receives a verdict from it.

## What ships in 2.9

- The crate `aep-lattice-memory` with two stores: sqlite-vec for durable vectors and metadata in the SQLite file of the Base Node and USearch for a fast index in memory.
- The program `aep-memory` with the commands `record`, `search`, `history`, `export` and `count`.
- Search by vector similarity and a validation count per element.
- The page describes stored shapes feeding the admit phase, so validation gets cheaper over time. In this tree no stored shape takes part in Admit and this feed is planned. The rule of the page remains in force either way: stored shapes never skip admit validation.

## Layout

| Path | Role |
|------|------|
| `crate/src/store.rs` | The store with record, search, history and export |
| `crate/src/sqlite.rs` | The sqlite-vec backend |
| `crate/src/entry.rs` | The entry format |
| `crate/src/main.rs` | The program `aep-memory` |

## Interfaces

- Program: `aep-memory [--db <file>] [--config <file>] <command>` with JSON on standard input and output.
- Environment: `AEP_LATTICE_DB` for the database file.
- Functions: `LatticeMemoryStore::open`, `record`, `search`, `history_entries`, `export_entries` and `validation_count`.
- File: the `action-lattice.db` store of the Base Node with a USearch companion file.

## Limits

- Memory does not admit, does not apply and does not change an agent permission.
- A similar earlier allow is no proof for the present capsule.
- The optional graph and vector backend named Polygres is attached by an operator and is no default service.

## Run and test

```bash
cargo test -p aep-lattice-memory
cargo build --release -p aep-lattice-memory
```

## Related documents

- `AEP-User-Experience/docs/LATTICE-MEMORY.md` for backends and operator notes
- `AEP-Components/intent-ledger/README.md` for intent records in memory
- `AEP-Base-Node/README.md` for the health answer
