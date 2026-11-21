# 15 / Lattice Memory

Status: normative. Stability: evolving. The store, the Base Node wiring and the read-only view of Admit are tested.

## What it is

Lattice Memory keeps what the Admit Gate judged. Every verdict is one record in an append-only log with a hash chain. Accepted records form attractors: shapes that were accepted before, each with a count of the records that support it. A stored shape is evidence for a later reader. It is never a permission: a proposal similar to an earlier allow still passes every wall of the Admit Gate.

The memory is pure Rust. It uses no database engine, no query language and no C or C++ code.

## Place among the 18

The AEP Base Node (01) is the one writer of judged proposals. After a verdict of the Admit Gate (04) is written to the Evidence Ledger (09), the dock hands a note of it to a bounded queue and one thread writes it. A full queue drops the note and counts it, so the memory never holds a verdict back.

The Admit Gate (04) reads two things from the Base Node and writes nothing: a route hint and the rows of an exact-match memo. The Intent Ledger (16) records and searches intent records in the domain `intent`. The Graph Engine (05) keeps the checkpoints of a run in the domain `graph`. No component receives a verdict from the memory.

## What ships in 2.9

- The crate `aep-lattice-memory-core`. It computes and does no I/O:
  - the shape of a proposal and its SHA-256 digest over canonical JSON
  - a 256 bit SimHash over the tokens of the shape, compared by Hamming distance
  - operator embeddings with a strict dimension check, quantized to one signed byte per dimension
  - an exact scan per domain and an exact lookup of the nearest attractor at or above the threshold, which reads a fixed number of table buckets at any size of the domain
  - attractors with support counts and eviction by lowest support, then least recently seen, then lowest key
  - the route hint and the exact-match memo
  - the format of a log entry and its hash
- The crate `aep-lattice-memory` with one backend trait and two backends:
  - `InMemoryBackend` for development and tests
  - `LogBackend` for production: one folder, one append-only log file per domain
- The program `aep-lattice-memory` for callers outside the Base Node.
- The wiring in the Base Node: the writer thread, the hint and the memo for Admit and the health fields.

How the store works:

- One record is one frame at the end of the log of its domain. A frame a crash cut short fails its length or its hash and the next writer cuts it off.
- A writer holds the exclusive lock of the log file while it reads what other processes appended, decides and appends. The key of a record is its place in the log, so two processes never give out one key twice.
- The log is opened in append mode. No backend has an operation that changes or removes a record. A changed, removed or moved record breaks the hash chain and is reported, never repaired in silence.
- The attractors live in memory and follow from the log alone. They are rebuilt at open. A snapshot file per domain lets a large log open without a full replay. A snapshot that does not fit its log is ignored.
- A health check opens files to read and reads the last frame of each log. It makes nothing and changes nothing.

What Admit reads:

- The route hint is hot when an accepted proposal of the same shape or a near one was recorded. It is cold in every other case and whenever the memory cannot be read at that instant.
- The memo holds the rows of the writing walls for byte identical text under the same compiled lattice and the same wall set. Those rows depend on nothing else. Every wall that reads the clock, a budget or the state of the node is computed on every proposal.
- The memo lives in the process of the Base Node and starts empty at every start. Nothing a file holds can change a replayed row.
- A hint never decides a verdict and similarity alone never skips a wall.

What is recorded: the verdicts of the Admit Gate. A frame the dock refuses before Admit, for a bad signature, a replay, a stale stamp or the writing check on entry, is a row of the Evidence Ledger and no record of the memory. A record of a judged proposal holds the shape digest, the fingerprint, the signer, the verdict and the ids of the closed walls. It never holds the body of the proposal.

## Layout

| Path | Role |
|------|------|
| `core/src/shape.rs` | The shape of a proposal, canonical JSON and the shape digest |
| `core/src/fingerprint.rs` | SimHash and quantized operator embeddings |
| `core/src/index.rs` | The attractors of one domain: exact scan and exact nearest lookup |
| `core/src/attractor.rs` | Support counts, eviction and the route hint |
| `core/src/memo.rs` | The exact-match memo |
| `core/src/chain.rs` | The log entry format and the hash chain |
| `core/src/time.rs` | Timestamps as unix seconds |
| `crate/src/model.rs` | The backend trait and its types |
| `crate/src/memory.rs` | The in-memory backend |
| `crate/src/logstore.rs` | The log file backend |
| `crate/src/wire.rs` | The JSON of the program |
| `crate/src/main.rs` | The program `aep-lattice-memory` |

The Base Node side lives in `AEP-Base-Node/AEP-Crate/src/lattice_memory.rs` and the read-only view of Admit in `AEP-Components/admit/crate/src/lib.rs`.

## Interfaces

- Program: `aep-lattice-memory [--store <folder>] <command>` with JSON on standard input and output. Commands: `record`, `record-lines`, `search`, `history`, `export`, `count`, `health` and `verify`.
- Environment: `AEP_LATTICE_MEMORY_DIR` for the folder of the store, `AEP_LATTICE_MEMORY_CLI` for the path of the program and `AEP_LATTICE_MEMORY=off` to run a Base Node without memory.
- Rust: the trait `MemoryBackend` with `record`, `route_hint`, `search`, `history`, `export`, `counts`, `verify` and `reader`.
- Admit: the trait `PureWallMemo` and the type `MemoryView` of the crate `aep-admit`. The Admit crates do not depend on the memory.
- Files: the folder `lattice-memory` in the data folder of the Base Node with `store.lmmeta`, one `<domain>.lmlog` and one `<domain>.lmsnap` per domain.
- Health: the Base Node reports `lattice_memory_attractors`, `lattice_memory_records`, `lattice_memory_dropped`, `lattice_memory_failed`, `lattice_memory_status`, `lattice_memory_dim` and `vector_store`.

## Limits

- Memory does not admit, does not apply and does not change an agent permission.
- A similar earlier allow is no proof for the present capsule.
- The logs only grow. A record of a judged proposal is about 250 bytes. Retention is not built: an operator who needs it archives a log file while the node is stopped.
- One domain holds 100000 attractors before eviction starts. A domain of operator embeddings is scanned in full on every record.
- The lookup of the nearest attractor is exact and reads memory in many places. On the build host, under load, it costs 8 microseconds at 2000 attractors and 28 at 100000. It runs once per proposal for the route hint. The write of the record reuses its answer and costs 6 to 9 microseconds at both sizes. A record written without a hint before it, as the program writes it, does the lookup itself and costs 15 and 36 microseconds.
- A SimHash domain above 2048 attractors holds a lookup table of 17 MB.
- A node that loses power may lose the newest records unless the store is opened as durable. The order of the records is never lost.
- A store of the earlier memory is not read. A node starts a fresh store and removes the rows and the index file of the earlier one.

## Run and test

```bash
cargo test -p aep-lattice-memory-core -p aep-lattice-memory
cargo test -p aep-base-node memory
cargo test -p aep-conformance --test memory_verdict_identity
cargo bench -p aep-lattice-memory-core
cargo bench -p aep-lattice-memory
cargo build --release -p aep-lattice-memory
```

The conformance test judges every chain of the multi-step corpus with memory on and off and requires the same verdict and the same deny report for every step.

## Related documents

- `AEP-User-Experience/docs/LATTICE-MEMORY.md` for operators
- `AEP-Components/intent-ledger/README.md` for intent records in memory
- `AEP-Components/graph-engine/README.md` for the checkpoints of a graph run
- `AEP-Components/admit/README.md` for the walls and the read-only view
- `AEP-Base-Node/README.md` for the health answer
