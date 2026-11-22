# 15 / Lattice Memory

Status: normative. Stability: evolving. The store, the Base Node wiring and the read-only view of Admit are tested.

## What it is

Lattice Memory is the record of what the Admit Gate judged. A recorded verdict is one record in an append-only log with a hash chain. Accepted records form attractors: shapes that were accepted before, each with a count of the records that support it. A stored shape is evidence for a later reader. It is never a permission: a proposal similar to an earlier allow still passes every wall of the Admit Gate.

The memory is pure Rust. It uses no database engine, no query language and no C or C++ code.

## Place among the 18

The AEP Base Node (01) is the one writer of judged proposals. After a verdict of the Admit Gate (04) is written to the Evidence Ledger (09), the dock hands a note of it to a bounded queue and one thread writes it. That thread computes the shape of the proposal, its digest and its fingerprint, so none of that work is on the path of a verdict. The memory never holds a verdict back.

The Admit Gate (04) reads one thing from the Base Node and writes nothing: the rows of an exact-match memo. The Intent Ledger (16) records and searches intent records in the domain `intent`. The Graph Engine (05) keeps the checkpoints of a run in the domain `graph`. No component receives a verdict from the memory.

## What ships in 2.9

- The crate `aep-lattice-memory-core`. It computes and does no I/O:
  - the shape of a proposal and its SHA-256 digest over canonical JSON, plain or under a key
  - a 256 bit SimHash over the tokens of the shape, plain or under a key, compared by Hamming distance
  - operator embeddings with a strict dimension check, quantized to one signed byte per dimension
  - an exact scan per domain and an exact lookup of the nearest attractor at or above the threshold
  - attractors with support counts and eviction by lowest support, then least recently seen, then lowest key
  - the route hint, which says whether an accepted shape of this kind was recorded before
  - the exact-match memo
  - the format of a log entry and its hash
- The crate `aep-lattice-memory` with one backend trait and two backends:
  - `InMemoryBackend` for development and tests
  - `LogBackend` for production: one folder, one append-only log file per domain
- The program `aep-lattice-memory` for callers outside the Base Node.
- The wiring in the Base Node: the queue, the writer thread, the memo for Admit, the heads in the Evidence Ledger and the health fields.

How the store works:

- One record is one frame at the end of the log of its domain. A writer holds the exclusive lock of the log file while it reads what other processes appended, decides and appends. The key of a record is its place in the log, so two processes never give out one key twice.
- The log is opened in append mode. No backend has an operation that changes or removes a record.
- The end of a log is read by one rule. The rest of a write a crash cut short is shorter than the frame it declares and holds no whole frame. A run of zero bytes counts the same. Only that is cut off and only by the next writer. Everything else is damage: a changed bit in a length field, a changed byte in any frame, a removed or moved frame. Damage is reported as corrupt and never cut off.
- The attractors live in memory and follow from the log alone. A snapshot file per domain lets a large log open without a full replay. A log that is shorter than its snapshot or holds another record where the snapshot names one was cut or changed and is reported as corrupt. A snapshot file whose own bytes are damaged is set aside and the log is replayed.
- A writer that closes writes the snapshot of a domain only when the records behind the last snapshot are at least one part in four of the records it covers. A caller that adds one record to a large domain writes one frame and no snapshot. A writer that is kept open writes a snapshot every 50000 records.
- A call opens the domain it names and no other. A write and a search open the log and the attractors of their domain. `history`, `export`, `count` and `verdicts` read frames and open no attractors.
- `verify` reads every frame of every log, checks the hash chain, rebuilds the attractors and compares each snapshot with what its log says. It fails on a log that does not end in a whole frame.
- A health check opens files to read and reads the last frame of each log. It makes nothing and changes nothing.

What a store cannot see on its own and what closes that hole in the Base Node: a log that is cut at a frame boundary and has no snapshot ahead of the cut reads as a shorter log. The Base Node therefore keeps the head of each judged domain, its record count and the hash of its newest record, in the Evidence Ledger, signed with a key of the node. It compares the store with these heads before a writer opens it and in `aep-base-node --verify-memory`. A log that is shorter than the count the ledger holds or holds another record at that place is reported and nothing is written to it.

What Admit reads:

- The memo holds the rows of the writing walls for byte identical text. Its key is the SHA-256 of the text. Those rows follow from the text and from rules that are compiled into the process, so a stored row is the row the same code would compute again. A test of the live pass proves that neither the lattice, the signer, the port nor the clock feeds them.
- The memo lives in the process of the Base Node and starts empty at every start. Nothing a file holds can change a replayed row. It holds at most 8192 entries and 16 MiB of rows.
- Every wall that reads the clock, a budget, a file or the state of the node is computed on every proposal.
- Similarity never skips a wall. The route hint is not read by Admit: the writer counts it for the health answer.

What the memo saves, measured on the build host, a shared machine: the writing rows of a short text cost about 60 microseconds and the rows of a text of 8000 bytes about 3 milliseconds. The bench `admit_latency_memory_on_vs_off` sends the 3494 proposals of the conformance corpus through the whole dock path, five times in each mode. Without memory a proposal took 2402 microseconds in the median and 4661 in the mean. With memory it took 2335 in the median and 3975 in the mean, 15 percent less in the mean, because 1935 of the 3494 proposals carry a text that was judged before. A node whose store already held the corpus took 2376 and 3926: the memo lives in the process and starts empty, so a store that is already full adds nothing to it. A proposal whose text is new gains nothing. Nothing else of the memory is on the path of a verdict. The bench fails when the median with memory lies more than 5 percent above the median without it, which is what two runs of one mode differ by on a shared host. It also fails when the mean with memory is not below the mean without it.

What is recorded and what can be lost:

- The queue takes every verdict it has room for: 4096 notes and 64 MiB of proposals. A verdict that finds the queue full is dropped and counted. The verdict itself is in the Evidence Ledger.
- A write the store refuses is counted as failed and the status of the memory reads `failing` until a write succeeds again.
- A node that is killed loses the notes its queue held at that instant.
- The health answer shows the gap: verdict rows of the Evidence Ledger minus records of the memory, counted from the first start of the memory on.
- A frame the dock refuses before Admit, for a bad signature, a replay, a stale stamp or the writing check on entry, is a row of the Evidence Ledger and no record of the memory.
- A record of a judged proposal holds the shape digest, the fingerprint, the signer, the verdict and the ids of the closed walls. It never holds the body of the proposal. The digest and the fingerprint are computed under the memory key of the node, so a reader of the store who guesses a proposal cannot confirm it.

Who writes where: the program `aep-lattice-memory` refuses a record for a domain of judged proposals, `admit` and every `admit.<port>`. Only the Base Node writes there, through the library. This is a rule of the program and not a wall against a local process with the rights of the node: such a process can write the files directly. The signed heads in the Evidence Ledger are what a forged or cut log must also pass.

## Layout

| Path | Role |
|------|------|
| `core/src/shape.rs` | The shape of a proposal, canonical JSON, the shape digest and HMAC-SHA-256 |
| `core/src/fingerprint.rs` | SimHash and quantized operator embeddings |
| `core/src/index.rs` | The attractors of one domain: exact scan and exact nearest lookup |
| `core/src/attractor.rs` | Support counts, eviction, the route hint and the bound on lookup tables |
| `core/src/memo.rs` | The exact-match memo |
| `core/src/chain.rs` | The log entry format and the hash chain |
| `core/src/time.rs` | Timestamps as unix seconds |
| `core/tests/golden.rs` | Pinned digests, fingerprints and scores for every target |
| `core/tests/wasm_build.rs` | The build of the core for `wasm32-wasip2` |
| `crate/src/model.rs` | The backend trait and its types |
| `crate/src/frames.rs` | The frames of a log and how its end is read |
| `crate/src/snapshot.rs` | The snapshot file of a domain |
| `crate/src/memory.rs` | The in-memory backend |
| `crate/src/logstore.rs` | The log file backend |
| `crate/src/wire.rs` | The JSON of the program |
| `crate/src/main.rs` | The program `aep-lattice-memory` |
| `crate/benches/record_flat_cost_vs_n.rs` | The cost of one recorded verdict at 2000 and at 100000 attractors |

The Base Node side lives in `AEP-Base-Node/AEP-Crate/src/lattice_memory.rs` and the read-only view of Admit in `AEP-Components/admit/crate/src/lib.rs`. The bench of the dock path with memory on against off is `admit_latency_memory_on_vs_off` in `AEP-Base-Node/AEP-Crate/src/docking_corpus_tests.rs`.

## Interfaces

- Program: `aep-lattice-memory [--store <folder>] [--durable] <command>` with JSON on standard input and output. Commands: `record`, `record-lines`, `search`, `history`, `export`, `count`, `verdicts`, `health` and `verify`.
  - `record-lines` is the way to write many records: one process, one open of the store, one line per record.
  - `history`, `export` and `verdicts` answer with one page: `{"records": [...], "next": <place or null>}`. A request names `limit`, `max_bytes` and, for the next page, `after` with the `next` of the page before. One page holds at most 4 MiB of records unless `max_bytes` says otherwise.
  - `verdicts` is the reader for an operator: `{"port": "validation_engine"}` shows the recorded verdicts of that port with signer, verdict, closed walls and time. `agent_id` and `verdict` narrow the page.
- Environment of the program: `AEP_LATTICE_MEMORY_DIR` for the folder of the store and `AEP_LATTICE_MEMORY_CLI` for the path of the program.
- Environment of the Base Node:
  - `AEP_LATTICE_MEMORY=off` runs the node without memory.
  - `AEP_LATTICE_MEMORY_DURABLE=on` flushes every record to the disk before the writer goes on.
  - `AEP_LATTICE_MEMORY_ACCEPT_STORE=1` is for one start after an operator repaired or replaced a store: the node takes the store as it is and writes new heads to the Evidence Ledger.
- Rust: the trait `MemoryBackend` with `record`, `route_hint`, `search`, `records`, `count`, `counts`, `anchors` and `verify`.
- Admit: the trait `PureWallMemo` and the type `MemoryView` of the crate `aep-admit`. The Admit crates do not depend on the memory.
- Files: the folder `lattice-memory` in the data folder of the Base Node with `store.lmmeta`, one `<domain>.lmlog` and one `<domain>.lmsnap` per domain. The memory key of the node is the file `lattice-memory.key` in the data folder, outside the store.
- Health: the Base Node reports `lattice_memory_status`, `lattice_memory_records`, `lattice_memory_attractors`, `lattice_memory_dropped`, `lattice_memory_failed`, `lattice_memory_queue_depth`, `lattice_memory_hot`, `lattice_memory_cold`, `lattice_memory_memo_replayed`, `lattice_memory_ledger_gap`, `lattice_memory_durable`, `lattice_memory_dim` and `vector_store`.

## Limits

- Memory does not admit, does not apply and does not change an agent permission.
- A similar earlier allow is no proof for the present capsule.
- The logs only grow. A record of a judged proposal is about 250 bytes. No retention setting exists: an operator who needs room archives a log file with its snapshot while the node is stopped and starts the node once with `AEP_LATTICE_MEMORY_ACCEPT_STORE=1`.
- One domain holds 100000 attractors before eviction starts. A domain of operator embeddings is scanned in full on every record.
- A SimHash domain above 2048 attractors holds a lookup table of 16.8 MB of buckets at any size and up to 6.4 MB of chains at 100000 attractors. At most four domains of one memory hold a table at a time, the setting `lookup_table_domains`. A large domain beyond that answers by the scan.
- The Base Node opens only the domains of judged proposals. The memory of the writer is bounded by the attractors of those domains, the queue and the memo.
- Record cost. The bench `record_flat_cost_vs_n` times the hint and the write of one record together on the thread of the store. Medians in microseconds at 2000 and at 100000 attractors on the shared build host: deny 25.3 and 48.0 (factor 1.89), form 25.4 and 86.9 (3.43), reinforce 60.7 and 77.6 (1.28), real new 37.1 and 1355.3 (36.56) and real repeat 9.4 and 13.3 (1.42). The demand is a factor of two for every kind. Deny, reinforce and real repeat meet it. Form sits at the bound and moved between 2.02 and 3.43 with the load of the host. A new real shape does not meet it: it has no near attractor, real shapes cluster and the lookup compares the shape with every hash of the domain, about 1.1 to 1.4 milliseconds at 100000 attractors. This cost is on the writer thread after the verdict and not on the verdict path. The bench fails on the three kinds that meet the demand and prints the two others as above it. A batch that writes the snapshot costs 316.4 and 2107.9 microseconds per record and a record on a durable store costs 4935.1. The lookup then fetches the buckets of one chunk together instead of one after the other. A table that keeps overflowing rests. Two short runs after that change on 2026-11-22 at a host load of 11 on 4 cores measured deny 2.84 and 1.46, form 3.04 and 1.92, reinforce 1.64 and 1.21, real new 24.10 and 24.22 and real repeat 1.82 and 1.73. The gated kinds swing across the factor of two with the load of the shared host; real new remains far above it.
- A node that loses power may lose the newest records unless the store is durable. The order of the records is never lost. A loss of power can leave a last frame whose first bytes reached the disk and whose rest reads as zero. That frame is as long as it declares, so it is reported as corrupt and not cut off: the operator decides.
- With a snapshot in place a writer reads no frame the snapshot covers. `verify` is the check that reads every frame.
- A store of the earlier memory is not read. A node starts a fresh store and removes the rows and the index file of the earlier one.
- The build for `wasm32-wasip2` and the golden values under Wasmtime run in the CI job `lattice-memory-wasm`. A host without that target runs the golden values natively.

## Run and test

```bash
cargo test -p aep-lattice-memory-core -p aep-lattice-memory
cargo test -p aep-base-node memory
cargo test -p aep-conformance --test memory_verdict_identity
cargo bench -p aep-lattice-memory-core
cargo bench -p aep-lattice-memory
AEP_LATENCY_GATE=1 AEP_LATENCY_ROUNDS=5 cargo test --release -p aep-base-node --lib admit_latency_memory_on_vs_off
cargo build --release -p aep-lattice-memory
```

The Base Node test `the_corpus_through_the_dock_gets_the_same_answers_with_and_without_memory` sends every step of the multi-step corpus of the conformance suite as a sealed frame through the dock and the pulse of a node with memory and of a node without it and requires the same answer to every frame. The conformance test judges every chain of the corpus through the Admit entry with memory on and off and checks the counters of the memory after every run.

## Related documents

- `AEP-User-Experience/docs/LATTICE-MEMORY.md` for operators
- `AEP-Components/intent-ledger/README.md` for intent records in memory
- `AEP-Components/graph-engine/README.md` for the checkpoints of a graph run
- `AEP-Components/admit/README.md` for the walls and the read-only view
- `AEP-Base-Node/README.md` for the health answer
